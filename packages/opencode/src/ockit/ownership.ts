// OC Kit ownership model: tracks which kit owns a managed file,
// at which version, and the sha256 it shipped. Used to make kit update/rollback
// safe — files the user has modified since install are preserved, never
// overwritten, and conflicts between kits are detected.

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { OwnershipManifest, type OwnershipEntry } from "./types"

/** Default location of the ownership manifest inside `.oc/state`. */
export const OWNERSHIP_MANIFEST_PATH = ".oc/state/ownership.json"

export class OwnershipError extends Schema.TaggedErrorClass<OwnershipError>()("OCKitOwnershipError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {
  override get message() {
    return `OC Kit ownership: ${this.path}${this.message ? ` — ${this.message}` : ""}`
  }
}

/** Load the ownership manifest, returning an empty manifest when absent. */
export const loadOwnership = Effect.fn("OCKit.ownership.load")(function* (root: string) {
  const fs = yield* FSUtil.Service
  const path = `${root}/${OWNERSHIP_MANIFEST_PATH}`
  const raw = yield* fs.readFileStringSafe(path)
  if (raw === undefined) return { files: {} }
  const decoded = yield* Schema.decodeUnknown(OwnershipManifest)(JSON.parse(raw)).pipe(
    Effect.mapError((err) => new OwnershipError({ path, message: Schema.TreeFormatter.formatIssueSync(err.issue) })),
  )
  return decoded
})

/** Persist an ownership manifest (creating parent directories as needed). */
export const saveOwnership = Effect.fn("OCKit.ownership.save")(function* (root: string, manifest: OwnershipManifest) {
  const fs = yield* FSUtil.Service
  const path = `${root}/${OWNERSHIP_MANIFEST_PATH}`
  yield* fs.writeWithDirs(path, JSON.stringify(manifest, null, 2))
})

/**
 * Claim ownership of files shipped by a kit: records each file's owner, kit,
 * version, and the sha256 of the content being installed. Existing entries are
 * checked for conflicting owners (a file may only be owned by one kit).
 */
export const claim = Effect.fn("OCKit.ownership.claim")(function* (
  manifest: OwnershipManifest,
  kit: string,
  version: string,
  files: Record<string, string>,
) {
  const conflicts: string[] = []
  for (const file of Object.keys(files)) {
    const existing = manifest.files[file]
    if (existing && existing.kit !== kit) conflicts.push(file)
  }
  if (conflicts.length > 0) {
    return yield* new OwnershipError({
      path: conflicts.join(", "),
      message: `These files are already owned by another kit`,
    })
  }
  for (const [file, content] of Object.entries(files)) {
    const entry: OwnershipEntry = { owner: "oc-kit", kit, version, sha256: Hash.sha256(content) }
    manifest.files[file] = entry
  }
  return manifest
})

/**
 * Detect user edits: compares the current sha256 of a managed file against the
 * sha256 recorded at install time. Returns the list of modified files.
 */
export const detectUserEdits = Effect.fn("OCKit.ownership.detectEdits")(function* (
  fs: FSUtil.Interface,
  root: string,
  manifest: OwnershipManifest,
) {
  const modified: string[] = []
  for (const [file, entry] of Object.entries(manifest.files)) {
    const content = yield* fs.readFileStringSafe(`${root}/${file}`)
    if (content !== undefined && Hash.sha256(content) !== entry.sha256) modified.push(file)
  }
  return modified
})

/**
 * Decide per-file update action:
 *  - owned by us and unmodified  → "replace"
 *  - owned by us but user-modified → "preserve" (warn)
 *  - not owned (user file)       → "preserve"
 */
export const planUpdate = Effect.fn("OCKit.ownership.planUpdate")(function* (
  fs: FSUtil.Interface,
  root: string,
  manifest: OwnershipManifest,
  kit: string,
  files: Record<string, string>,
) {
  const plan: { replace: string[]; preserve: string[]; warn: string[] } = { replace: [], preserve: [], warn: [] }
  for (const file of Object.keys(files)) {
    const entry = manifest.files[file]
    if (!entry || entry.kit !== kit) {
      plan.preserve.push(file)
      continue
    }
    const content = yield* fs.readFileStringSafe(`${root}/${file}`)
    if (content === undefined || Hash.sha256(content) === entry.sha256) plan.replace.push(file)
    else plan.warn.push(file)
  }
  plan.warn.forEach((file) => plan.preserve.push(file))
  return plan
})

export * as Ownership from "./ownership"