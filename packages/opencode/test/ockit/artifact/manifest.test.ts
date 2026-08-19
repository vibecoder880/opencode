import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../../lib/effect"
import { TestConfig } from "../../fixture/config"
import {
  artifactsRoot,
  emptyManifest,
  loadArtifactManifest,
  saveArtifactManifest,
  ARTIFACT_MANIFEST_FILE,
} from "../../../src/ockit/artifact/manifest"
import type { Artifact } from "../../../src/ockit/types"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = Layer.mergeAll(LayerNode.compile(FSUtil.node), TestConfig.layer())
const it = testEffect(layer)

/** Create a clean root dir, then remove it when the effect scope closes. */
function withRoot<E, R>(use: (root: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-manifest-" + Math.random().toString(36).slice(2))
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

const sampleArtifact: Artifact = {
  id: "art-1",
  type: "report",
  workflow_id: "wf-1",
  path: "/tmp/report.md",
  status: "created",
  checksum: "abc123",
}

describe("ockit artifact manifest", () => {
  it.effect("round-trips a manifest through save then load at the artifacts root", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        yield* saveArtifactManifest(root, {
          version: "1",
          artifacts: { "art-1": sampleArtifact },
        })

        const reloaded = yield* loadArtifactManifest(root)
        expect(reloaded.version).toBe("1")
        expect(reloaded.artifacts["art-1"]).toEqual(sampleArtifact)

        // Verify the file landed under .oc/artifacts/manifest.json.
        const filePath = path.join(artifactsRoot(root), ARTIFACT_MANIFEST_FILE)
        const raw = yield* fs.readFile(filePath, "utf8")
        expect(JSON.parse(raw).artifacts["art-1"].id).toBe("art-1")
      }),
    ),
  )

  it.effect("loads an empty manifest when none has been written", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const manifest = yield* loadArtifactManifest(root)
        expect(manifest).toEqual(emptyManifest())
      }),
    ),
  )
})