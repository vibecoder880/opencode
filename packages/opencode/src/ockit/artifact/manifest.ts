// OC Kit artifact manifest. The artifact manager persists every artifact record
// under `.oc/artifacts/<type>/<id>.json` AND records an `ArtifactManifest` — the
// index of artifacts written — under `manifest.json` so the whole tree can be
// listed without a full directory scan.
//
// The manifest schema is local to this module (the shared `types.ts` schema is
// owned by the domain layer; per the ownership contract we do not extend it).

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Artifact } from "../types"

/** Manifest file name inside the artifacts root. */
export const ARTIFACT_MANIFEST_FILE = "manifest.json"

/** Index of artifacts, keyed by artifact id. */
export const ArtifactManifest = Schema.Struct({
  version: Schema.Literal("1"),
  artifacts: Schema.Record(Schema.String, Artifact),
})

export type ArtifactManifest = Schema.Schema.Type<typeof ArtifactManifest>

export class ArtifactManifestError extends Schema.TaggedErrorClass<ArtifactManifestError>()(
  "OCKitArtifactManifestError",
  {
    path: Schema.String,
    message: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `OC Kit artifact manifest: ${this.path}${this.message ? ` — ${this.message}` : ""}`
  }
}

/** The artifacts root directory for a project root. */
export const artifactsRoot = (root: string) => `${root}/.oc/artifacts`

/** An empty manifest with no artifacts recorded. */
export function emptyManifest(): ArtifactManifest {
  return { version: "1", artifacts: {} }
}

/** Load the artifact manifest, returning an empty manifest when absent. */
export const loadArtifactManifest = Effect.fn("OCKit.artifact.manifest.load")(function* (root: string) {
  const fs = yield* FSUtil.Service
  const path = `${artifactsRoot(root)}/${ARTIFACT_MANIFEST_FILE}`
  const raw = yield* fs.readFileStringSafe(path)
  if (raw === undefined) return emptyManifest()
  const decoded = yield* Schema.decodeUnknownEffect(ArtifactManifest)(JSON.parse(raw)).pipe(
    Effect.mapError((err) => new ArtifactManifestError({ path, message: String(err) })),
  )
  return decoded
})

/** Persist the artifact manifest, creating parent directories as needed. */
export const saveArtifactManifest = Effect.fn("OCKit.artifact.manifest.save")(function* (
  root: string,
  manifest: ArtifactManifest,
) {
  const fs = yield* FSUtil.Service
  const path = `${artifactsRoot(root)}/${ARTIFACT_MANIFEST_FILE}`
  yield* fs.writeWithDirs(path, JSON.stringify(manifest, null, 2))
})