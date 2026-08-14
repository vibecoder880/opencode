import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { testEffect } from "../lib/effect"
import { Service as Registry, node as registryNode } from "../../src/ockit/registry"
import { testInstanceStoreLayer } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

const it = testEffect(LayerNode.compile(registryNode, testInstanceStoreLayer))

const VALID_KIT = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
}

async function writeGlobalKit(home: string, kitId: string, manifest: unknown) {
  const dir = path.join(home, ".config", "opencode", "kits", kitId)
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, "kit.json"), JSON.stringify(manifest))
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("ockit registry", () => {
  it.effect("indexes a global kit and resolves it by id", async () => {
    const home = path.join(process.cwd(), "tmp-ockit-home-" + Math.random().toString(36).slice(2))
    await writeGlobalKit(home, "engineer", VALID_KIT)
    try {
      const result = await Effect.runPromise(
        withHome(home, Effect.gen(function* () {
          const registry = yield* Registry
          return yield* registry.get("engineer")
        })),
      )
      expect(result?.name).toBe("OC Engineer Kit")
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it.effect("require throws NotFoundError for an unknown kit", async () => {
    const home = path.join(process.cwd(), "tmp-ockit-home-" + Math.random().toString(36).slice(2))
    await writeGlobalKit(home, "engineer", VALID_KIT)
    try {
      const result = await Effect.runPromise(
        withHome(home, Effect.gen(function* () {
          const registry = yield* Registry
          return yield* registry.require("missing").pipe(Effect.exit)
        })),
      )
      expect(result._tag).toBe("Failure")
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it.effect("skips a kit with an invalid manifest", async () => {
    const home = path.join(process.cwd(), "tmp-ockit-home-" + Math.random().toString(36).slice(2))
    await writeGlobalKit(home, "broken", { id: "broken" })
    await writeGlobalKit(home, "engineer", VALID_KIT)
    try {
      const result = await Effect.runPromise(
        withHome(home, Effect.gen(function* () {
          const registry = yield* Registry
          return yield* registry.all()
        })),
      )
      expect(result.map((kit) => kit.id)).toEqual(["engineer"])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
