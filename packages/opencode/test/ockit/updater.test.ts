import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { Hash } from "@opencode-ai/core/util/hash"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { update, rollback, previewUpdate, UpdateSummary, UpdateError } from "../../src/ockit/updater"
import { COLLECTED_ROOT_DIR, install } from "../../src/ockit/installer"
import { loadOwnership } from "../../src/ockit/ownership"
import { RemoteRegistrySource } from "../../src/ockit/registry-remote"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

const SOURCE = new RemoteRegistrySource({ owner: "opencode-ai", repo: "kits" })

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function releaseAsset(name: string, url = `https://example.com/${name}`) {
  return { name, browser_download_url: url }
}

function releasePayload(tag: string, assets: Array<{ name: string; browser_download_url: string }>) {
  return { tag_name: tag, assets }
}

function clientFor(handler: (url: string) => Response) {
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
  )
  return Layer.succeed(HttpClient.HttpClient, client)
}

function withRoot<E, R>(use: (root: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-upd-" + Math.random().toString(36).slice(2))
      yield* Effect.promise(() => fs.mkdir(path.join(dir, ".oc", "state"), { recursive: true }))
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

const KIT_V1_MANIFEST = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Plan" }],
}

const KIT_V2_MANIFEST = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "2.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Plan v2" }],
}

const KIT_V1_FILES: Record<string, string> = {
  "kit.json": JSON.stringify(KIT_V1_MANIFEST),
  "skills/plan.md": "# Plan v1",
}

const KIT_V2_FILES: Record<string, string> = {
  "kit.json": JSON.stringify(KIT_V2_MANIFEST),
  "skills/plan.md": "# Plan v2",
}

function fakeExtract(files: Record<string, string>) {
  return (archive: Uint8Array, dest: string) =>
    Effect.gen(function* () {
      const fsutil = yield* FSUtil.Service
      yield* fsutil.ensureDir(dest)
      for (const [file, content] of Object.entries(files)) {
        yield* fsutil.writeWithDirs(path.join(dest, file), content)
      }
    }) as unknown as Effect.Effect<void, import("../../src/ockit/installer").InstallerError>
}

const V1_BYTES = "v1-archive"
const V2_BYTES = "v2-archive"

function v1Handler(url: string) {
  if (url.endsWith("/releases/tags/1.0.0")) {
    return jsonResponse(
      releasePayload("1.0.0", [
        releaseAsset("kit.tar.gz", "https://example.com/v1.tar.gz"),
        releaseAsset("checksums.txt", "https://example.com/v1-checksums.txt"),
      ]),
    )
  }
  if (url.endsWith("v1.tar.gz")) return new Response(V1_BYTES, { status: 200 })
  if (url.endsWith("checksums.txt")) return new Response(`${Hash.sha256(Buffer.from(V1_BYTES))}  kit.tar.gz\n`, { status: 200 })
  if (url.includes("kit.json")) return jsonResponse(KIT_V1_MANIFEST)
  return jsonResponse({})
}

function v2Handler(url: string) {
  if (url.endsWith("/releases")) {
    return jsonResponse([
      releasePayload("v2.0.0", [
        releaseAsset("kit.tar.gz", "https://example.com/v2.tar.gz"),
        releaseAsset("checksums.txt", "https://example.com/v2-checksums.txt"),
      ]),
    ])
  }
  if (url.endsWith("v2.tar.gz")) return new Response(V2_BYTES, { status: 200 })
  if (url.endsWith("checksums.txt")) return new Response(`${Hash.sha256(Buffer.from(V2_BYTES))}  kit.tar.gz\n`, { status: 200 })
  if (url.includes("kit.json")) return jsonResponse(KIT_V2_MANIFEST)
  return jsonResponse({})
}

/** Install v1 into root so an update can run against it. */
function installedV1(root: string) {
  return install("engineer", {
    source: SOURCE,
    root,
    version: "1.0.0",
    extract: fakeExtract(KIT_V1_FILES),
  }).pipe(Effect.provide(clientFor(v1Handler)))
}

describe("ockit updater", () => {
  it.effect("update with --dry-run previews without mutating", () =>
    withRoot((root) =>
      installedV1(root).pipe(
        Effect.flatMap(() =>
          update("engineer", { source: SOURCE, root, dryRun: true, extract: fakeExtract(KIT_V2_FILES) }).pipe(Effect.provide(clientFor(v2Handler))),
        ),
        Effect.flatMap((summary: UpdateSummary) =>
          Effect.gen(function* () {
            expect(summary.dryRun).toBe(true)
            expect(summary.toVersion).toBe("2.0.0")
            expect(summary.replaced).toContain(`${COLLECTED_ROOT_DIR}/engineer/kit.json`)

            // --dry-run must NOT change the installed kit.json on disk.
            const kitJson = yield* Effect.promise(() =>
              fs.readFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "kit.json"), "utf8"),
            )
            expect(kitJson).toContain('"version": "1.0.0"')
          }),
        ),
      ),
    ),
  )

  it.effect("update replaces owned-unmodified files and preserves user edits", () =>
    withRoot((root) =>
      installedV1(root).pipe(
        Effect.flatMap(() =>
          Effect.gen(function* () {
            // User edits skills/plan.md after v1 install.
            yield* Effect.promise(() =>
              fs.writeFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "skills", "plan.md"), "# user edit"),
            )
            const summary = yield* update("engineer", { source: SOURCE, root, extract: fakeExtract(KIT_V2_FILES) }).pipe(
              Effect.provide(clientFor(v2Handler)),
            )
            expect(summary.toVersion).toBe("2.0.0")
            expect(summary.replaced).toContain(`${COLLECTED_ROOT_DIR}/engineer/kit.json`)
            // User-edited file is preserved, not overwritten.
            expect(summary.preserved).toContain(`${COLLECTED_ROOT_DIR}/engineer/skills/plan.md`)

            const planMd = yield* Effect.promise(() =>
              fs.readFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "skills", "plan.md"), "utf8"),
            )
            expect(planMd).toBe("# user edit")

            const kitJson = yield* Effect.promise(() =>
              fs.readFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "kit.json"), "utf8"),
            )
            expect(kitJson).toContain('"version": "2.0.0"')
          }),
        ),
      ),
    ),
  )

  it.effect("rollback restores the previous bytes from the latest checkpoint", () =>
    withRoot((root) =>
      installedV1(root).pipe(
        Effect.flatMap(() =>
          update("engineer", { source: SOURCE, root, extract: fakeExtract(KIT_V2_FILES) }).pipe(Effect.provide(clientFor(v2Handler))),
        ),
        Effect.flatMap(() => {
          // After update, engine.json says 2.0.0.
          return Effect.gen(function* () {
            const after = yield* Effect.promise(() =>
              fs.readFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "kit.json"), "utf8"),
            )
            expect(after).toContain('"version": "2.0.0"')
          })
        }),
        Effect.flatMap(() => rollback("engineer", { root }).pipe(
          Effect.flatMap((summary: UpdateSummary) =>
            Effect.gen(function* () {
              const restored = yield* Effect.promise(() =>
                fs.readFile(path.join(root, COLLECTED_ROOT_DIR, "engineer", "kit.json"), "utf8"),
              )
              // The rollback restores the backup of the previous version.
              expect(restored).toContain('"version": "1.0.0"')
            }),
          ),
        )),
      ),
    ),
  )

  it.effect("rollback fails with a typed error when no checkpoint exists", () =>
    withRoot((root) =>
      rollback("engineer", { root }).pipe(
        Effect.flip,
        Effect.flatMap((err: UpdateError) => {
          expect(err).toBeInstanceOf(UpdateError)
          expect(err.kind).toBe("rollback")
          return Effect.succeed(undefined)
        }),
      ),
    ),
  )

  it.effect("update fails with not-found when the kit is not installed", () =>
    withRoot((root) =>
      previewUpdate("engineer", { source: SOURCE, root }).pipe(
        Effect.provide(clientFor(v2Handler)),
        Effect.flip,
        Effect.flatMap((err: UpdateError) => {
          expect(err).toBeInstanceOf(UpdateError)
          expect(err.kind).toBe("not-found")
          return Effect.succeed(undefined)
        }),
      ),
    ),
  )
})