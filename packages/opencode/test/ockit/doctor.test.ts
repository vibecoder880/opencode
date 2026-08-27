import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { doctor, DoctorReport } from "../../src/ockit/doctor"
import { Service as Registry, NotFoundError, type Interface as RegistryInterface } from "../../src/ockit/registry"
import { RemoteRegistrySource } from "../../src/ockit/registry-remote"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

const SOURCE = new RemoteRegistrySource({ owner: "opencode-ai", repo: "kits" })

const EVEN_HEX = "a".repeat(64)

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function releaseAsset(name: string, url = `https://example.com/${name}`) {
  return { name, browser_download_url: url }
}

function clientFor(handler: (url: string) => Response) {
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
  )
  return Layer.succeed(HttpClient.HttpClient, client)
}

// Doctor statically requires Registry.Service (via the installed-kits fallback)
// even when `options.kits` is provided, so every test provides a stub registry.
function registryLayer() {
  return Layer.succeed(
    Registry,
    Registry.of({
      all: () => Effect.succeed([]),
      get: () => Effect.succeed(undefined),
      require: Effect.fn(function* () {
        return yield* new NotFoundError({ id: "missing", available: [] })
      }),
      dirs: () => Effect.succeed([]),
    }) as unknown as RegistryInterface,
  )
}

const offlineClient = () => new Response("unused", { status: 404 })

// A reachable-registry probe: the release list, a valid checksums.txt, and a
// compatible kit.json — enough for `resolveLatest("engineer")` to succeed.
function reachableHandler(url: string) {
  if (url.endsWith("/releases")) {
    return jsonResponse([
      {
        tag_name: "v1.0.0",
        assets: [releaseAsset("kit.tar.gz"), releaseAsset("checksums.txt")],
      },
    ])
  }
  if (url.endsWith("checksums.txt")) return new Response(`${EVEN_HEX}  kit.tar.gz\n`, { status: 200 })
  if (url.includes("kit.json")) return jsonResponse({ id: "engineer", version: "1.0.0" })
  return jsonResponse({})
}

function withRoot<E, R>(use: (root: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-doc-" + Math.random().toString(36).slice(2))
      yield* Effect.promise(() => fs.mkdir(path.join(dir, ".oc", "state"), { recursive: true }))
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

describe("ockit doctor", () => {
  it.effect("produces a typed report with pass items when everything is fine", () =>
    withRoot((root) =>
      doctor({
        root,
        offline: true,
        source: SOURCE,
        kits: [{ id: "engineer", version: "1.0.0" }],
        config: { oc_kit: { enabled: true } },
      }).pipe(
        Effect.provide(clientFor(offlineClient)),
        Effect.provide(registryLayer()),
        Effect.map((report: DoctorReport) => {
          expect(report).toBeInstanceOf(DoctorReport)
          expect(report.runtimeVersion).toBeTruthy()
          expect(report.offline).toBe(true)
          expect(report.items.length).toBeGreaterThan(0)
          const sections = report.items.map((i) => i.section)
          expect(sections).toContain("runtime")
          expect(sections).toContain("config")
          expect(sections).toContain("kits")
          expect(sections).toContain("registry")
          expect(report.items.find((i) => i.section === "registry")?.message).toContain("offline")
        }),
      ),
    ),
  )

  it.effect("does not crash when no kit is installed", () =>
    withRoot((root) =>
      doctor({ root, offline: true, kits: [], source: SOURCE }).pipe(
        Effect.provide(clientFor(offlineClient)),
        Effect.provide(registryLayer()),
        Effect.map((report: DoctorReport) => {
          const kitItem = report.items.find((i) => i.section === "kits")
          expect(kitItem?.severity).toBe("warn")
          expect(kitItem?.message).toContain("no OC Kit kits installed")
        }),
      ),
    ),
  )

  it.effect("reports registry reachability when online and the probe succeeds", () =>
    withRoot((root) =>
      doctor({ root, offline: false, source: SOURCE, kits: [] }).pipe(
        Effect.provide(clientFor(reachableHandler)),
        Effect.provide(registryLayer()),
        Effect.map((report: DoctorReport) => {
          const reg = report.items.find((i) => i.section === "registry")
          expect(reg?.severity).toBe("pass")
          expect(reg?.message).toContain("registry reachable")
        }),
      ),
    ),
  )
})