import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { Service as Registry, node as registryNode } from "../../src/ockit/registry"
import { TestInstance } from "../fixture/fixture"
import fs from "fs/promises"

// The registry scans Global.Path.config (== Flag.OPENCODE_CONFIG_DIR when set)
// for <config>/kits/<id>/kit.json, and needs a live InstanceRef. Each test
// points OPENCODE_CONFIG_DIR at the tmpdir instance dir, writes kits under it,
// and runs inside that instance (via it.instance) so InstanceState resolves.
const it = testEffect(LayerNode.compile(registryNode))

const VALID_KIT = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
}

function withConfigDir<A, E, R>(configDir: string, self: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG_DIR = configDir
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = prev
      }),
  )
}

function writeKit(configDir: string, kitId: string, manifest: unknown = VALID_KIT) {
  return Effect.gen(function* () {
    yield* Effect.promise(() => fs.mkdir(`${configDir}/kits/${kitId}`, { recursive: true }))
    yield* Effect.promise(() => Bun.write(`${configDir}/kits/${kitId}/kit.json`, JSON.stringify(manifest)))
  })
}

describe("ockit registry", () => {
  it.instance(
    "indexes a global kit and resolves it by id",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        yield* withConfigDir(
          directory,
          Effect.gen(function* () {
            yield* writeKit(directory, "engineer")
            const registry = yield* Registry
            const result = yield* registry.get("engineer")
            expect(result?.name).toBe("OC Engineer Kit")
          }),
        )
      }),
  )

  it.instance(
    "require throws NotFoundError for an unknown kit",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        yield* withConfigDir(
          directory,
          Effect.gen(function* () {
            yield* writeKit(directory, "engineer")
            const registry = yield* Registry
            const result = yield* registry.require("missing").pipe(Effect.exit)
            expect(result._tag).toBe("Failure")
          }),
        )
      }),
  )

  it.instance(
    "skips a kit with an invalid manifest",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        yield* withConfigDir(
          directory,
          Effect.gen(function* () {
            yield* writeKit(directory, "engineer")
            yield* writeKit(directory, "broken", { id: "broken" })
            const registry = yield* Registry
            const result = yield* registry.all()
            expect(result.map((kit) => kit.id)).toEqual(["engineer"])
          }),
        )
      }),
  )
})
