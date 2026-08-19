// OC Kit artifact manager. Artifacts persist as typed records under
// `.oc/artifacts/<type>/<id>.json` and are indexed in the artifact manifest.
// Every record carries the sha256 of the artifact's content file so integrity
// can be re-verified later. The manager honors the `oc_kit.checkpoint` config
// flag: when enabled, creating an artifact also snapshots a checkpoint marker
// (through the shared checkpoint module); when disabled, no checkpoint is
// written.

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { Artifact } from "../types"
import { read as readOCKitConfig } from "../config"
import { create as createCheckpoint } from "../checkpoint"
import { loadArtifactManifest, saveArtifactManifest, artifactsRoot } from "./manifest"

/** Directory holding artifact records, relative to a project root. */
export const ARTIFACT_DIR = ".oc/artifacts"

export class ArtifactError extends Schema.TaggedErrorClass<ArtifactError>()("OCKitArtifactError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit artifact: ${this.path}${this.message ? ` — ${this.message}` : ""}`
  }
}

/** Path of a single artifact record. */
export const artifactPath = (root: string, type: string, id: string) =>
  `${artifactsRoot(root)}/${type}/${id}.json`

/** Write an artifact record to disk, creating parent directories as needed. */
const writeRecord = Effect.fn("OCKit.artifact.writeRecord")(function* (root: string, artifact: Artifact) {
  const fs = yield* FSUtil.Service
  const path = artifactPath(root, artifact.type, artifact.id)
  yield* fs.writeWithDirs(path, JSON.stringify(artifact, null, 2))
})

/** Insert (or replace) an artifact in the persisted manifest index. */
const upsertManifest = Effect.fn("OCKit.artifact.upsertManifest")(function* (root: string, artifact: Artifact) {
  const manifest = yield* loadArtifactManifest(root)
  yield* saveArtifactManifest(root, {
    version: manifest.version,
    artifacts: { ...manifest.artifacts, [artifact.id]: artifact },
  })
})

/**
 * Create an artifact record for the file at `input.path`. The record is stored
 * at `{root}/.oc/artifacts/{type}/{id}.json`, indexed in the manifest, and
 * (when `oc_kit.checkpoint` is enabled) snapshotted as a checkpoint marker.
 */
export const create = Effect.fn("OCKit.artifact.create")(function* (input: {
  root: string
  id: string
  type: string
  workflow_id?: string
  session_id?: string
  path: string
}) {
  const fs = yield* FSUtil.Service
  const raw = yield* fs.readFileStringSafe(input.path)
  const artifact: Artifact = {
    id: input.id,
    type: input.type,
    workflow_id: input.workflow_id,
    session_id: input.session_id,
    path: input.path,
    status: "created",
    checksum: raw === undefined ? undefined : Hash.sha256(raw),
  }
  yield* writeRecord(input.root, artifact)
  yield* upsertManifest(input.root, artifact)

  const cfg = yield* readOCKitConfig()
  if (cfg.checkpoint) {
    const record = JSON.stringify(artifact)
    yield* createCheckpoint({
      root: input.root,
      kit: input.type,
      kitVersion: "1",
      operation: "artifact:create",
      session: input.session_id,
      workflow: input.workflow_id,
      files: { [artifactPath(input.root, input.type, input.id)]: record },
    })
  }
  return artifact
})

/** List recorded artifacts, optionally scoped to one type. */
export const list = Effect.fn("OCKit.artifact.list")(function* (root: string, type?: string) {
  const manifest = yield* loadArtifactManifest(root)
  const artifacts = Object.values(manifest.artifacts)
  return type ? artifacts.filter((artifact) => artifact.type === type) : artifacts
})

/** Read a single artifact record by id (from the manifest index). */
export const read = Effect.fn("OCKit.artifact.read")(function* (root: string, id: string) {
  const fs = yield* FSUtil.Service
  const manifest = yield* loadArtifactManifest(root)
  const recorded = manifest.artifacts[id]
  if (!recorded) {
    return yield* new ArtifactError({ path: id, message: `No artifact "${id}"` })
  }
  const path = artifactPath(root, recorded.type, id)
  const raw = yield* fs.readFileStringSafe(path)
  if (raw === undefined) return yield* new ArtifactError({ path, message: "Artifact record missing" })
  const decoded = yield* Schema.decodeUnknownEffect(Artifact)(JSON.parse(raw)).pipe(
    Effect.mapError((err) => new ArtifactError({ path, message: String(err) })),
  )
  return decoded
})

/**
 * Recompute the sha256 of the artifact's content file and fail with a typed
 * ArtifactError when it no longer matches the checksum recorded at create time
 * (the file was tampered with, or is missing).
 */
export const verify = Effect.fn("OCKit.artifact.verify")(function* (root: string, id: string) {
  const fs = yield* FSUtil.Service
  const artifact = yield* read(root, id)
  const raw = yield* fs.readFileStringSafe(artifact.path)
  if (raw === undefined) {
    return yield* new ArtifactError({ path: artifact.path, message: "Artifact content missing" })
  }
  if (artifact.checksum !== undefined && Hash.sha256(raw) !== artifact.checksum) {
    return yield* new ArtifactError({ path: artifact.path, message: "Checksum mismatch — file may have been modified" })
  }
  return artifact
})

/** Mark an artifact verified, updating the record and manifest. */
export const markVerified = Effect.fn("OCKit.artifact.markVerified")(function* (root: string, id: string) {
  const artifact = yield* read(root, id)
  const updated: Artifact = { ...artifact, status: "verified" }
  yield* writeRecord(root, updated)
  yield* upsertManifest(root, updated)
  return updated
})

/** Mark an artifact failed, updating the record and manifest. */
export const markFailed = Effect.fn("OCKit.artifact.markFailed")(function* (root: string, id: string) {
  const artifact = yield* read(root, id)
  const updated: Artifact = { ...artifact, status: "failed" }
  yield* writeRecord(root, updated)
  yield* upsertManifest(root, updated)
  return updated
})