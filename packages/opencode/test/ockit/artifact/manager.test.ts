import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../../lib/effect"
import { TestConfig } from "../../fixture/config"
import { create, list, read, verify, markVerified, markFailed } from "../../../src/ockit/artifact/manager"
import { artifactsRoot } from "../../../src/ockit/artifact/manifest"
import { Hash } from "@opencode-ai/core/util/hash"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = Layer.mergeAll(LayerNode.compile(FSUtil.node), TestConfig.layer())
const it = testEffect(layer)

/** Create a clean root dir, then remove it when the effect scope closes. */
function withRoot<E, R>(use: (root: string) => Effect.Effect<unknown, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const dir = path.join(os.tmpdir(), "ockit-artifact-" + Math.random().toString(36).slice(2))
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      return dir
    }),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

describe("ockit artifact manager", () => {
  it.effect("creates an artifact record with a sha256 checksum and manifest entry", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "report.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "# report", "utf8"))

        const artifact = yield* create({
          root,
          id: "art-1",
          type: "report",
          workflow_id: "wf-1",
          session_id: "sess-1",
          path: contentFile,
        })

        expect(artifact.id).toBe("art-1")
        expect(artifact.type).toBe("report")
        expect(artifact.status).toBe("created")
        expect(artifact.checksum).toBe(Hash.sha256("# report"))

        // The record file exists on disk.
        const recordPath = `${artifactsRoot(root)}/report/art-1.json`
        yield* Effect.promise(() => fs.access(recordPath, fs.constants.F_OK))

        // The manifest indexes it.
        const all = yield* list(root)
        expect(all.map((a) => a.id)).toEqual(["art-1"])
      }),
    ),
  )

  it.effect("lists only artifacts of a requested type", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "a", "utf8"))
        yield* create({ root, id: "art-1", type: "report", path: contentFile })
        yield* create({ root, id: "art-2", type: "diagram", path: contentFile })

        const reports = yield* list(root, "report")
        expect(reports.map((a) => a.id)).toEqual(["art-1"])
        expect((yield* list(root)).length).toBe(2)
      }),
    ),
  )

  it.effect("read round-trips the artifact and verify recomputes the checksum", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "payload", "utf8"))
        yield* create({ root, id: "art-1", type: "report", workflow_id: "wf-1", path: contentFile })

        const readBack = yield* read(root, "art-1")
        expect(readBack.id).toBe("art-1")
        expect(readBack.workflow_id).toBe("wf-1")

        const verified = yield* verify(root, "art-1")
        expect(verified.checksum).toBe(Hash.sha256("payload"))
      }),
    ),
  )

  it.effect("fails with a typed ArtifactError reading a missing artifact", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const exit = yield* read(root, "missing").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  it.effect("verify fails when the content file was tampered with", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "original", "utf8"))
        yield* create({ root, id: "art-1", type: "report", path: contentFile })

        yield* Effect.promise(() => fs.writeFile(contentFile, "tampered", "utf8"))
        const exit = yield* verify(root, "art-1").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  it.effect("markVerified and markFailed update the record and manifest", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "payload", "utf8"))
        yield* create({ root, id: "art-1", type: "report", path: contentFile })

        const verified = yield* markVerified(root, "art-1")
        expect(verified.status).toBe("verified")
        expect((yield* read(root, "art-1")).status).toBe("verified")

        const failed = yield* markFailed(root, "art-1")
        expect(failed.status).toBe("failed")
        expect((yield* read(root, "art-1")).status).toBe("failed")
      }),
    ),
  )

  it.effect("writes a checkpoint marker when oc_kit.checkpoint is enabled (default)", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "payload", "utf8"))
        yield* create({ root, id: "art-1", type: "report", path: contentFile })

        const checkpointDir = path.join(root, ".oc", "state", "checkpoints")
        const entries = yield* Effect.promise(() => fs.readdir(checkpointDir).catch(() => []))
        expect(entries.length).toBeGreaterThan(0)
      }),
    ),
  )
})

describe("ockit artifact manager config-respect", () => {
  const disabledLayer = Layer.mergeAll(
    LayerNode.compile(FSUtil.node),
    TestConfig.layer({ get: () => Effect.succeed({ oc_kit: { checkpoint: false } } as never) }),
  )
  const itDisabled = testEffect(disabledLayer)

  itDisabled.effect("does not write a checkpoint marker when oc_kit.checkpoint is disabled", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const contentFile = path.join(root, "out", "a.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(contentFile), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(contentFile, "payload", "utf8"))
        yield* create({ root, id: "art-1", type: "report", path: contentFile })

        const checkpointDir = path.join(root, ".oc", "state", "checkpoints")
        const exists = yield* Effect.promise(() =>
          fs
            .access(checkpointDir)
            .then(() => true)
            .catch(() => false),
        )
        expect(exists).toBe(false)
      }),
    ),
  )
})