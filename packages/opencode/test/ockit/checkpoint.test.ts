import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { create, list, read } from "../../src/ockit/checkpoint"
import { Hash } from "@opencode-ai/core/util/hash"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

async function makeRoot() {
  const dir = path.join(os.tmpdir(), "ockit-cp-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  return dir
}

describe("ockit checkpoint", () => {
  it.effect("creates a checkpoint recording file hashes", async () => {
    const root = await makeRoot()
    try {
      const path_ = await Effect.runPromise(
        create({ root, kit: "engineer", kitVersion: "1.0.0", operation: "update", files: { "a.md": "content" } }),
      )
      expect(path_).toContain(".oc/state/checkpoints")
      const cp = await Effect.runPromise(read(root, path_.split("/").pop()!.replace(".json", "")))
      expect(cp.kit).toBe("engineer")
      expect(cp.files["a.md"]).toBe(Hash.sha256("content"))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.effect("lists checkpoints newest first and filters by kit", async () => {
    const root = await makeRoot()
    try {
      const one = await Effect.runPromise(
        create({ root, kit: "engineer", kitVersion: "1.0.0", operation: "update", files: {} }),
      )
      await new Promise((r) => setTimeout(r, 5))
      const two = await Effect.runPromise(
        create({ root, kit: "security", kitVersion: "1.0.0", operation: "update", files: {} }),
      )
      const idOne = one.split("/").pop()!.replace(".json", "")
      const idTwo = two.split("/").pop()!.replace(".json", "")
      const engineerIds = await Effect.runPromise(list(root, "engineer"))
      expect(engineerIds).toEqual([idOne])
      const all = await Effect.runPromise(list(root))
      expect(all.sort()).toEqual([idOne, idTwo].sort())
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.effect("fails with CheckpointError reading a missing checkpoint", async () => {
    const root = await makeRoot()
    try {
      const result = await Effect.runPromise(read(root, "nope").pipe(Effect.exit))
      expect(result._tag).toBe("Failure")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
