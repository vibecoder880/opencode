import { describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { loadManifest } from "../../src/ockit/manifest"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

const VALID_KIT = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
}

/** Create a kit dir with the given files, then clean it up when the effect scope closes. */
function withKitDir<E, R>(files: Record<string, string>, use: (dir: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-test-" + Math.random().toString(36).slice(2))
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel)
        yield* Effect.promise(() => fs.mkdir(path.dirname(full), { recursive: true }))
        yield* Effect.promise(() => Bun.write(full, content))
      }
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

describe("ockit manifest", () => {
  it.effect("loads a valid kit.json manifest", () =>
    withKitDir({ "kit.json": JSON.stringify(VALID_KIT) }, (dir) =>
      Effect.gen(function* () {
        const kit = yield* loadManifest(dir)
        expect(kit.id).toBe("engineer")
        expect(kit.skills?.[0]?.id).toBe("plan")
      }),
    ),
  )

  it.effect("loads a kit.yaml manifest via Bun.YAML", () =>
    withKitDir(
      {
        "kit.yaml": `id: engineer
name: OC Engineer Kit
version: 1.0.0
runtime: opencode
skills:
  - id: plan
    description: Create an implementation plan
`,
      },
      (dir) =>
        Effect.gen(function* () {
          const kit = yield* loadManifest(dir)
          expect(kit.id).toBe("engineer")
          expect(kit.skills?.[0]?.id).toBe("plan")
        }),
    ),
  )

  it.effect("prefers kit.json over kit.yaml", () =>
    withKitDir(
      {
        "kit.json": JSON.stringify({ ...VALID_KIT, name: "JSON KIT" }),
        "kit.yaml": "id: engineer\nname: YAML KIT\nversion: 1.0.0\n",
      },
      (dir) =>
        Effect.gen(function* () {
          const kit = yield* loadManifest(dir)
          expect(kit.name).toBe("JSON KIT")
        }),
    ),
  )

  it.effect("fails with ManifestError when no manifest exists", () =>
    withKitDir({ "README.md": "no manifest here" }, (dir) =>
      Effect.gen(function* () {
        const result = yield* loadManifest(dir).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause)
          expect(String(error)).toContain("No kit manifest found")
        }
      }),
    ),
  )

  it.effect("fails with ManifestError on invalid schema", () =>
    withKitDir({ "kit.json": JSON.stringify({ id: "engineer" }) }, (dir) =>
      Effect.gen(function* () {
        const result = yield* loadManifest(dir).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      }),
    ),
  )
})