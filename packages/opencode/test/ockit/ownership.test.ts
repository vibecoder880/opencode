import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { claim, detectUserEdits, planUpdate, loadOwnership, saveOwnership } from "../../src/ockit/ownership"
import { Hash } from "@opencode-ai/core/util/hash"
import type { OwnershipManifest } from "../../src/ockit/types"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

function makeRoot() {
  return Effect.gen(function* () {
    const dir = path.join(os.tmpdir(), "ockit-own-" + Math.random().toString(36).slice(2))
    yield* Effect.promise(() => fs.mkdir(path.join(dir, ".oc", "state"), { recursive: true }))
    return dir
  })
}

describe("ockit ownership", () => {
  it.effect("claims ownership of shipped files with sha256", () =>
    Effect.gen(function* () {
      const manifest: OwnershipManifest = { files: {} }
      const result = yield* claim(manifest, "engineer", "1.0.0", { "a.md": "hello" })
      const entry = result.files["a.md"]
      expect(entry?.owner).toBe("oc-kit")
      expect(entry?.kit).toBe("engineer")
      expect(entry?.sha256).toBe(Hash.sha256("hello"))
    }))

  it.effect("rejects a file already owned by another kit", () =>
    Effect.gen(function* () {
      const manifest: OwnershipManifest = {
        files: { "a.md": { owner: "oc-kit", kit: "security", version: "1.0.0", sha256: Hash.sha256("x") } },
      }
      const result = yield* claim(manifest, "engineer", "1.0.0", { "a.md": "hello" }).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
    }))

  it.effect("detects user edits by hash mismatch", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        yield* Effect.promise(() => Bun.write(path.join(root, "a.md"), "original"))
        const manifest: OwnershipManifest = {
          files: { "a.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("original") } },
        }
        const fs = yield* FSUtil.Service
        expect((yield* detectUserEdits(fs, root, manifest)).length).toBe(0)

        yield* Effect.promise(() => Bun.write(path.join(root, "a.md"), "edited"))
        expect(yield* detectUserEdits(fs, root, manifest)).toEqual(["a.md"])
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))

  it.effect("planUpdate replaces owned/unmodified, preserves modified and foreign files", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        yield* Effect.promise(() => Bun.write(path.join(root, "owned.md"), "owned content"))
        yield* Effect.promise(() => Bun.write(path.join(root, "foreign.md"), "user file"))
        const manifest: OwnershipManifest = {
          files: {
            "owned.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("owned content") },
            "foreign.md": { owner: "oc-kit", kit: "security", version: "1.0.0", sha256: Hash.sha256("other") },
          },
        }
        const fs = yield* FSUtil.Service
        const plan = yield* planUpdate(fs, root, manifest, "engineer", { "owned.md": "new content", "new.md": "x" })
        expect(plan.replace).toEqual(["owned.md"])
        expect(plan.preserve).toContain("foreign.md")
        expect(plan.preserve).toContain("new.md")
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))

  it.effect("round-trips an ownership manifest through disk", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        const manifest: OwnershipManifest = {
          files: { "a.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("a") } },
        }
        yield* saveOwnership(root, manifest)
        const loaded = yield* loadOwnership(root)
        expect(loaded.files["a.md"]?.kit).toBe("engineer")
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))

  it.effect("loadOwnership returns empty manifest when absent", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        const loaded = yield* loadOwnership(root)
        expect(loaded.files).toEqual({})
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))
})
