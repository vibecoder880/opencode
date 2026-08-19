// OC Kit checkpoints: a snapshot of managed files taken before a
// risky operation (kit install/update/rollback). Each checkpoint records the
// kit version, operation, timestamp, and per-file sha256 so the operation can
// be rolled back to a known-good state.

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { Checkpoint } from "./types"

/** Default directory where checkpoint snapshots are stored. */
export const CHECKPOINT_DIR = ".oc/state/checkpoints"

export class CheckpointError extends Schema.TaggedErrorClass<CheckpointError>()("OCKitCheckpointError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit checkpoint: ${this.path}${this.message ? ` — ${this.message}` : ""}`
  }
}

/** Write a checkpoint file for the given operation + managed files. */
export const create = Effect.fn("OCKit.checkpoint.create")(function* (input: {
  root: string
  kit: string
  kitVersion: string
  operation: string
  session?: string
  workflow?: string
  files: Record<string, string>
}) {
  const fs = yield* FSUtil.Service
  const id = `${Date.now()}-${input.kit}-${input.operation}`
  const checkpoint: Checkpoint = {
    kit: input.kit,
    kit_version: input.kitVersion,
    operation: input.operation,
    timestamp: new Date().toISOString(),
    session: input.session,
    workflow: input.workflow,
    files: Object.fromEntries(Object.entries(input.files).map(([file, content]) => [file, Hash.sha256(content)])),
  }
  const path = `${input.root}/${CHECKPOINT_DIR}/${id}.json`
  yield* fs.writeWithDirs(path, JSON.stringify(checkpoint, null, 2))
  return path
})

/** List checkpoint ids for a kit/operation, newest first. */
export const list = Effect.fn("OCKit.checkpoint.list")(function* (root: string, kit?: string) {
  const fs = yield* FSUtil.Service
  const dir = `${root}/${CHECKPOINT_DIR}`
  if (!(yield* fs.isDir(dir))) return [] as string[]
  const entries = yield* fs.readDirectoryEntries(dir)
  const files = entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
  const ids = files.map((entry) => entry.name.replace(/\.json$/, ""))
  return kit ? ids.filter((id) => id.includes(`-${kit}-`)).toReversed() : ids.toReversed()
})

/** Read a single checkpoint by id. */
export const read = Effect.fn("OCKit.checkpoint.read")(function* (root: string, id: string) {
  const fs = yield* FSUtil.Service
  const path = `${root}/${CHECKPOINT_DIR}/${id}.json`
  const raw = yield* fs.readFileStringSafe(path)
  if (raw === undefined) return yield* new CheckpointError({ path, message: `No checkpoint "${id}"` })
  const decoded = yield* Schema.decodeUnknownEffect(Checkpoint)(JSON.parse(raw)).pipe(
    Effect.mapError((err) => new CheckpointError({ path, message: String(err) })),
  )
  return decoded
})

export * as Checkpoint from "./checkpoint"