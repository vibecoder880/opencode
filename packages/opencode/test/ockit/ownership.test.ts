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

async function makeRoot() {
  const dir = path.join(os.tmpdir(), "ockit-own-" + Math.random().toString(36).slice(2))
  await fs.mkdir(path.join(dir, ".oc", "state"), { recursive: true })
  return dir
}

describe("ockit ownership", () => {
  it.effect("claims ownership of shipped files with sha256", async () => {
    const manifest: OwnershipManifest = { files: {} }
    const result = await Effect.runPromise(claim(manifest, "engineer", "1.0.0", { "a.md": "hello" }))
    const entry = result.files["a.md"]
    expect(entry?.owner).toBe("oc-kit")
    expect(entry?.kit).toBe("engineer")
    expect(entry?.sha256).toBe(Hash.sha256("hello"))
  })

  it.effect("rejects a file already owned by another kit", async () => {
    const manifest: OwnershipManifest = {
      files: { "a.md": { owner: "oc-kit", kit: "security", version: "1.0.0", sha256: Hash.sha256("x") } },
    }
    const result = await Effect.runPromise(claim(manifest, "engineer", "1.0.0", { "a.md": "hello" }).pipe(Effect.exit))
    expect(result._tag).toBe("Failure")
  })

  it.effect("detects user edits by hash mismatch", async () => {
    const root = await makeRoot()
    try {
      await Bun.write(path.join(root, "a.md"), "original")
      const manifest: OwnershipManifest = {
        files: { "a.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("original") } },
      }
      const runEdits = (m: OwnershipManifest) => Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        return yield* detectUserEdits(fs, root, m)
      })
      expect((await Effect.runPromise(runEdits(manifest))).length).toBe(0)

      await Bun.write(path.join(root, "a.md"), "edited")
      expect(await Effect.runPromise(runEdits(manifest))).toEqual(["a.md"])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.effect("planUpdate replaces owned/unmodified, preserves modified and foreign files", async () => {
    const root = await makeRoot()
    try {
      await Bun.write(path.join(root, "owned.md"), "owned content")
      await Bun.write(path.join(root, "foreign.md"), "user file")
      const manifest: OwnershipManifest = {
        files: {
          "owned.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("owned content") },
          "foreign.md": { owner: "oc-kit", kit: "security", version: "1.0.0", sha256: Hash.sha256("other") },
        },
      }
      const plan = await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          return yield* planUpdate(fs, root, manifest, "engineer", { "owned.md": "new content", "new.md": "x" })
        }),
      )
      expect(plan.replace).toEqual(["owned.md"])
      expect(plan.preserve).toContain("foreign.md")
      expect(plan.preserve).toContain("new.md")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.effect("round-trips an ownership manifest through disk", async () => {
    const root = await makeRoot()
    try {
      const manifest: OwnershipManifest = {
        files: { "a.md": { owner: "oc-kit", kit: "engineer", version: "1.0.0", sha256: Hash.sha256("a") } },
      }
      await Effect.runPromise(saveOwnership(root, manifest))
      const loaded = await Effect.runPromise(loadOwnership(root))
      expect(loaded.files["a.md"]?.kit).toBe("engineer")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.effect("loadOwnership returns empty manifest when absent", async () => {
    const root = await makeRoot()
    try {
      const loaded = await Effect.runPromise(loadOwnership(root))
      expect(loaded.files).toEqual({})
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
