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
import {
  install,
  InstallSummary,
  InstallerError,
  COLLECTED_ROOT_DIR,
  verifySha256,
} from "../../src/ockit/installer"
import { loadOwnership } from "../../src/ockit/ownership"
import { RemoteRegistrySource, ReleaseInfo } from "../../src/ockit/registry-remote"

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

/** Fake HttpClient serving from a URL -> Response map. */
function clientFor(handler: (url: string) => Response) {
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
  )
  return Layer.succeed(HttpClient.HttpClient, client)
}

function withRoot<E, R>(use: (root: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-inst-" + Math.random().toString(36).slice(2))
      yield* Effect.promise(() => fs.mkdir(path.join(dir, ".oc", "state"), { recursive: true }))
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

const KIT_MANIFEST = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Plan" }],
}

const KIT_FILES: Record<string, string> = {
  "kit.json": JSON.stringify(KIT_MANIFEST),
  "skills/plan.md": "# Plan skill",
}

/** A fake extract that writes a staged kit tree into `dest`. */
function fakeExtract(files: Record<string, string>) {
  return (archive: Uint8Array, dest: string) =>
    Effect.gen(function* () {
      const fsutil = yield* FSUtil.Service
      yield* fsutil.ensureDir(dest)
      for (const [file, content] of Object.entries(files)) {
        yield* fsutil.writeWithDirs(path.join(dest, file), content)
      }
    }) as unknown as Effect.Effect<void, InstallerError>
}

function archiveHandler(hex: string, files: Record<string, string> = KIT_FILES) {
  const content = "compressed-kit-bytes"
  return (url: string) => {
    if (url.endsWith("/releases/tags/1.0.0")) {
      return jsonResponse(
        releasePayload("1.0.0", [
          releaseAsset("kit.tar.gz", "https://example.com/kit.tar.gz"),
          releaseAsset("checksums.txt", "https://example.com/checksums.txt"),
        ]),
      )
    }
    if (url.endsWith("kit.tar.gz")) return new Response(content, { status: 200 })
    if (url.endsWith("checksums.txt")) return new Response(`${hex}  kit.tar.gz\n`, { status: 200 })
    if (url.includes("kit.json")) return jsonResponse(KIT_MANIFEST)
    return jsonResponse({})
  }
}

describe("ockit installer", () => {
  it.effect("verifySha256 is real: valid hash passes, invalid fails", () =>
    Effect.gen(function* () {
      const content = new TextEncoder().encode("hello world")
      const hex = Hash.sha256(Buffer.from(content))
      yield* verifySha256(content, hex).pipe(Effect.exit)
      const err = yield* verifySha256(content, "b".repeat(64)).pipe(Effect.flip)
      expect(err.kind).toBe("checksum")
    }),
  )

  it.effect("install verifies checksum, records ownership and returns a summary", () =>
    withRoot((root) =>
      install("engineer", {
        source: SOURCE,
        root,
        version: "1.0.0",
        dev: false,
        extract: fakeExtract(KIT_FILES),
      }).pipe(
        Effect.provide(clientFor(archiveHandler(Hash.sha256(Buffer.from("compressed-kit-bytes"))))),
        Effect.flatMap((summary: InstallSummary) =>
          Effect.gen(function* () {
            expect(summary.kitId).toBe("engineer")
            expect(summary.version).toBe("1.0.0")
            expect(summary.dir).toBe(path.join(root, COLLECTED_ROOT_DIR, "engineer"))
            expect(summary.filesInstalled).toContain("kit.json")
            expect(summary.filesInstalled).toContain("skills/plan.md")
            expect(summary.mode).toBe("production")

            const manifest = yield* loadOwnership(root)
            expect(manifest.files[`${COLLECTED_ROOT_DIR}/engineer/kit.json`]?.kit).toBe("engineer")
            expect(manifest.files[`${COLLECTED_ROOT_DIR}/engineer/kit.json`]?.version).toBe("1.0.0")
            expect(manifest.files[`${COLLECTED_ROOT_DIR}/engineer/skills/plan.md`]?.sha256).toBe(
              Hash.sha256("# Plan skill"),
            )
          }),
        ),
      ),
    ),
  )

  it.effect("install fails with a checksum error when the archive does not match", () =>
    withRoot((root) =>
      install("engineer", {
        source: SOURCE,
        root,
        version: "1.0.0",
        extract: fakeExtract(KIT_FILES),
      }).pipe(
        Effect.provide(clientFor(archiveHandler("b".repeat(64)))),
        Effect.flip,
        Effect.flatMap((err: InstallerError) => {
          expect(err).toBeInstanceOf(InstallerError)
          expect(err.kind).toBe("checksum")
          return Effect.succeed(undefined)
        }),
      ),
    ),
  )

  it.effect("install in dev mode marks the kit as development", () =>
    withRoot((root) =>
      install("engineer", {
        source: SOURCE,
        root,
        version: "1.0.0",
        dev: true,
        extract: fakeExtract(KIT_FILES),
      }).pipe(
        Effect.provide(clientFor(archiveHandler(Hash.sha256(Buffer.from("compressed-kit-bytes"))))),
        Effect.flatMap((summary: InstallSummary) => {
          expect(summary.mode).toBe("development")
          return Effect.succeed(undefined)
        }),
      ),
    ),
  )
})