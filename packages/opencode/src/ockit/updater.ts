// OC Kit updater + rollback. `update` resolves the latest release for an
// installed kit, computes a per-file update plan through `ownership.planUpdate`
// (replace / preserve / warn) and applies only the replaceable files — user
// modified files are never overwritten. `--check`/`--dry-run` produce the same
// conflict preview WITHOUT mutating anything. `--rollback` restores the latest
// checkpoint's file contents after comparing the current state (reverting only
// files whose bytes no longer match what the checkpoint shipped).

import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { resolveLatest, type ReleaseInfo, type RemoteRegistrySource } from "./registry-remote"
import { loadOwnership, saveOwnership, planUpdate, claim } from "./ownership"
import { Checkpoint } from "./checkpoint"
import { loadManifest } from "./manifest"
import {
  COLLECTED_ROOT_DIR,
  downloadAndExtract,
  findStagedRoot,
  backupOwnedFiles,
  type InstallerError,
} from "./installer"

export class UpdateError extends Schema.TaggedErrorClass<UpdateError>()("OCKitUpdateError", {
  kind: Schema.Literals(["not-found", "fetch", "checksum", "extract", "conflict", "write", "rollback", "manifest"]),
  kit: Schema.String,
  detail: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit updater: ${this.kind} for "${this.kit}"${this.version ? ` ${this.version}` : ""} — ${this.detail}`
  }
}

export class UpdateSummary extends Schema.Class<UpdateSummary>("OCKit.UpdateSummary")({
  kitId: Schema.String,
  fromVersion: Schema.String,
  toVersion: Schema.String,
  replaced: Schema.Array(Schema.String),
  preserved: Schema.Array(Schema.String),
  warned: Schema.Array(Schema.String),
  dryRun: Schema.Boolean,
}) {}

export interface UpdateOptions {
  readonly check?: boolean
  readonly dryRun?: boolean
  readonly yes?: boolean
  readonly force?: boolean
  readonly rollback?: boolean
  readonly version?: string
  readonly source?: RemoteRegistrySource
  readonly http?: HttpClient.HttpClient
  readonly root?: string
  /** Test seam mirroring `installer.install`. */
  readonly extract?: (archive: Uint8Array, dest: string) => Effect.Effect<void, InstallerError>
}

const defaultRoot = () => Global.Path.config

const relToKit = (rootRel: string, kitId: string) =>
  rootRel.startsWith(`${COLLECTED_ROOT_DIR}/${kitId}/`)
    ? rootRel.slice(`${COLLECTED_ROOT_DIR}/${kitId}/`.length)
    : rootRel

const kitRelToOwned = (kitRel: string, kitId: string) => `${COLLECTED_ROOT_DIR}/${kitId}/${kitRel}`

/**
 * Produce the update plan for a kit — a preview of which files would be
 * replaced, preserved, or warned — WITHOUT mutating anything. Used by
 * `--check`/`--dry-run` and as the first step of a real update.
 */
export const previewUpdate = Effect.fn("OCKit.update.preview")(function* (
  kitId: string,
  opts: UpdateOptions = {},
) {
  const fsutil = yield* FSUtil.Service
  const http = opts.http ?? (yield* HttpClient.HttpClient)
  const root = opts.root ?? defaultRoot()
  const kitDir = path.join(root, COLLECTED_ROOT_DIR, kitId)
  const exists = yield* fsutil.isDir(kitDir)
  if (!exists) {
    return yield* new UpdateError({ kind: "not-found", kit: kitId, detail: `Kit "${kitId}" is not installed` })
  }

  const release = yield* resolveLatest(kitId, { http, version: opts.version, source: opts.source }).pipe(
    Effect.mapError((err) =>
      new UpdateError({
        kind: err.kind === "not-found" ? "not-found" : "fetch",
        kit: kitId,
        version: err.version ?? opts.version,
        detail: err.detail,
      }),
    ),
  )

  const staging = path.join(root, ".oc", "state", `update-${kitId}-${Date.now()}`)
  yield* fsutil.ensureDir(staging).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
  )
  return yield* Effect.gen(function* () {
    const files = yield* downloadAndExtract({ http, kitId, release, staging, extract: opts.extract })
    // Validate the staged manifest before committing to any plan.
    const stagedRoot = yield* findStagedRoot(fsutil, staging)
    yield* readStagedManifest(stagedRoot).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "manifest", kit: kitId, detail: err.message ?? "invalid manifest" })),
    )
    return { release, files }
  }).pipe(
    Effect.mapError((err) =>
      err instanceof UpdateError ? err : new UpdateError({ kind: "write", kit: kitId, detail: err.message }),
    ),
    Effect.ensuring(fsutil.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
  )
})

/**
 * Update an installed kit to the latest (or pinned) release. When `check` or
 * `dryRun` is set, only the conflict preview is produced — nothing is written.
 * Otherwise the plan from `ownership.planUpdate` is applied: files we own and
 * that are unmodified are replaced; user-modified and foreign files are
 * preserved (never overwritten). `warn`ed files are preserved too, with the
 * plan marked so callers can surface the warning.
 */
export const update = Effect.fn("OCKit.update")(function* (
  kitId: string,
  opts: UpdateOptions = {},
) {
  const fsutil = yield* FSUtil.Service
  const http = opts.http ?? (yield* HttpClient.HttpClient)
  const root = opts.root ?? defaultRoot()

  const { release, files } = yield* previewUpdate(kitId, { ...opts, http, root })

  const currentManifest = yield* loadOwnership(root).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
  )
  const upstreamOwned = Object.fromEntries(
    Object.entries(files).map(([file, content]) => [kitRelToOwned(file, kitId), content]),
  )

  // Plan uses the installed file tree at root — reads user-edited files.
  const plan = yield* planUpdate(fsutil, root, currentManifest, kitId, upstreamOwned).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
  )

  const warned = plan.warn
  const preserved = plan.preserve.filter((f) => f.startsWith(`${COLLECTED_ROOT_DIR}/${kitId}/`))

  // `--check` / `--dry-run` stop here without mutating.
  if (opts.check || opts.dryRun) {
    return new UpdateSummary({
      kitId,
      fromVersion: "",
      toVersion: release.version,
      replaced: [...plan.replace],
      preserved,
      warned,
      dryRun: true,
    })
  }

  // Snapshot the pre-update bytes of every owned-and-unmodified file about to be
  // replaced, and checkpoint that state so `--rollback` restores the old bytes.
  const toReplace = new Map<string, string>()
  for (const rel of plan.replace) {
    const content = upstreamOwned[rel]
    if (content !== undefined) toReplace.set(rel, content)
  }
  const preUpdate: Record<string, string> = {}
  for (const rel of toReplace.keys()) {
    const existing = yield* fsutil.readFileStringSafe(path.join(root, rel)).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
    )
    if (existing !== undefined) preUpdate[rel] = existing
  }
  if (Object.keys(preUpdate).length > 0) {
    yield* backupOwnedFiles(root, kitId, preUpdate).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
    )
    yield* Checkpoint.create({
      root,
      kit: kitId,
      kitVersion: release.version,
      operation: "update",
      files: preUpdate,
    }).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: err.message })),
    )
  }

  // Apply the plan: replace files we own and the user has not touched. Never
  // overwrite user-modified or foreign files (those remain in `preserved`).
  const kitDir = path.join(root, COLLECTED_ROOT_DIR, kitId)
  for (const rel of plan.replace) {
    const content = upstreamOwned[rel]
    if (content === undefined) continue
    yield* fsutil.writeWithDirs(path.join(kitDir, relToKit(rel, kitId)), content).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: `failed to write ${rel}: ${err}` })),
    )
  }

  // Record the new ownership for the replaced files; preserved entries stay as
  // they were (claim merges over the existing manifest).
  const newOwned: Record<string, string> = {}
  for (const [rel, content] of toReplace) {
    newOwned[rel] = content
  }
  const claimed = yield* claim(currentManifest, kitId, release.version, newOwned).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "conflict", kit: kitId, detail: err.message })),
  )
  yield* saveOwnership(root, claimed).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "write", kit: kitId, detail: `failed to save ownership: ${err.message}` })),
  )

  return new UpdateSummary({
    kitId,
    fromVersion: "",
    toVersion: release.version,
    replaced: [...plan.replace],
    preserved,
    warned,
    dryRun: false,
  })
})

/**
 * Roll back an installed kit to its latest checkpoint. Compares the current
 * hash of each tracked file against the checkpoint's recorded hash and only
 * rewrites files that differ (or are missing), restoring content from the
 * pre-operation backup written by install/update.
 */
export const rollback = Effect.fn("OCKit.update.rollback")(function* (
  kitId: string,
  opts: UpdateOptions = {},
) {
  const fsutil = yield* FSUtil.Service
  const root = opts.root ?? defaultRoot()

  const ids = yield* Checkpoint.list(root, kitId).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: err.message })),
  )
  if (ids.length === 0) {
    return yield* new UpdateError({ kind: "rollback", kit: kitId, detail: `No checkpoints found for "${kitId}"` })
  }
  const cp = yield* Checkpoint.read(root, ids[0]).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: err.message })),
  )

  const backupDir = yield* latestBackupDir(root, kitId).pipe(
    Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: err.message })),
  )
  const restored: string[] = []
  const skipped: string[] = []
  for (const [file, hash] of Object.entries(cp.files)) {
    const target = path.join(root, file)
    const current = yield* fsutil.readFileStringSafe(target).pipe(
      Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: err.message })),
    )
    if (current === undefined || Hash.sha256(current) !== hash) {
      // The file diverges from checkpoint state — restore the backup content.
      const content = backupDir
        ? yield* fsutil.readFileStringSafe(path.join(backupDir, file)).pipe(
            Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: err.message })),
          )
        : undefined
      if (content === undefined) {
        skipped.push(file)
        continue
      }
      yield* fsutil.writeWithDirs(target, content).pipe(
        Effect.mapError((err) => new UpdateError({ kind: "rollback", kit: kitId, detail: `failed to restore ${file}: ${err}` })),
      )
      restored.push(file)
    } else {
      skipped.push(file)
    }
  }

  return new UpdateSummary({
    kitId,
    fromVersion: cp.kit_version,
    toVersion: cp.kit_version,
    replaced: restored,
    preserved: skipped,
    warned: [],
    dryRun: false,
  })
})

/** Find the (newest-first) rollback snapshot directory for a kit. */
export const latestBackupDir = Effect.fn("OCKit.update.latestBackupDir")(function* (root: string, kit: string) {
  const base = path.join(root, ".oc", "state", "rollback", kit)
  const fsutil = yield* FSUtil.Service
  if (!(yield* fsutil.isDir(base))) return undefined
  const entries = yield* fsutil.readDirectoryEntries(base)
  const dirs = entries.map((e) => e.name).filter((name) => /^\d+-/.test(name)).sort().reverse()
  return dirs.length > 0 ? path.join(base, dirs[0]) : undefined
})

const readStagedManifest = Effect.fn("OCKit.update.readStagedManifest")(function* (stagedRoot: string) {
  return yield* loadManifest(stagedRoot)
})

export * as Updater from "./updater"