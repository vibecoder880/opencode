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

function makeRoot() {
  return Effect.gen(function* () {
    const dir = path.join(os.tmpdir(), "ockit-cp-" + Math.random().toString(36).slice(2))
    yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
    return dir
  })
}

describe("ockit checkpoint", () => {
  it.effect("creates a checkpoint recording file hashes", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        const path_ = yield* create({
          root,
          kit: "engineer",
          kitVersion: "1.0.0",
          operation: "update",
          files: { "a.md": "content" },
        })
        expect(path_).toContain(".oc/state/checkpoints")
        const cp = yield* read(root, path_.split("/").pop()!.replace(".json", ""))
        expect(cp.kit).toBe("engineer")
        expect(cp.files["a.md"]).toBe(Hash.sha256("content"))
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))

  it.effect("lists checkpoints newest first and filters by kit", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        const one = yield* create({ root, kit: "engineer", kitVersion: "1.0.0", operation: "update", files: {} })
        yield* Effect.sleep("5 millis")
        const two = yield* create({ root, kit: "security", kitVersion: "1.0.0", operation: "update", files: {} })
        const idOne = one.split("/").pop()!.replace(".json", "")
        const idTwo = two.split("/").pop()!.replace(".json", "")
        const engineerIds = yield* list(root, "engineer")
        expect(engineerIds).toEqual([idOne])
        const all = yield* list(root)
        expect(all.sort()).toEqual([idOne, idTwo].sort())
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))

  it.effect("fails with CheckpointError reading a missing checkpoint", () =>
    Effect.gen(function* () {
      const root = yield* makeRoot()
      try {
        const result = yield* read(root, "nope").pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
      }
    }))
})
