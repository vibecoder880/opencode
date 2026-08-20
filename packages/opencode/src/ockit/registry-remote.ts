// OC Kit remote release registry. MVP backend is GitHub Releases: resolves a
// kit's newest release, reads its release metadata (archive URL, sha256
// checksums, manifest URL) and validates `min_opencode` compatibility against
// the current runtime OPENCODE_VERSION.
//
// The transport is deliberately narrow — all fetches go through an injected
// `HttpClient` and a `RemoteRegistrySource` — so a private/local registry can
// be added later without redesigning the installer or updater: only the source
// resolution changes.

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import semver from "semver"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

/** Structured release metadata resolved from a remote registry. */
export class ReleaseInfo extends Schema.Class<ReleaseInfo>("OCKit.ReleaseInfo")({
  id: Schema.String,
  version: Schema.String,
  archiveUrl: Schema.String,
  checksumSha256: Schema.String,
  manifestUrl: Schema.String,
  minOpencode: Schema.optional(Schema.String),
  tag: Schema.String,
}) {}

/** Where GitHub releases live. Override owner/repo via env or for tests. */
export class RemoteRegistrySource extends Schema.Class<RemoteRegistrySource>("OCKit.RemoteRegistrySource")({
  owner: Schema.String,
  repo: Schema.String,
}) {}

export const DEFAULT_REGISTRY_OWNER = process.env.OCKIT_REGISTRY_OWNER ?? "opencode-ai"
export const DEFAULT_REGISTRY_REPO = process.env.OCKIT_REGISTRY_REPO ?? "kits"

export const defaultSource = () => new RemoteRegistrySource({ owner: DEFAULT_REGISTRY_OWNER, repo: DEFAULT_REGISTRY_REPO })

export const resolveSource = (source: RemoteRegistrySource | undefined) => source ?? defaultSource()

export const makeApiUrl = (source: RemoteRegistrySource) =>
  `https://api.github.com/repos/${source.owner}/${source.repo}/releases`

export const makeRawUrl = (source: RemoteRegistrySource, version: string, file: string) =>
  `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${version}/${file}`

export const ARCHIVE_ASSET_NAME = "kit.tar.gz"
export const CHECKSUMS_ASSET_NAME = "checksums.txt"

/**
 * Typed errors from the remote registry. `not-found` when a kit/release is
 * missing; `incompatible` when no release satisfies the min_opencode contract;
 * `checksum` when a fetched archive fails its sha256 guard; `decode`/`network`
 * for transport failures.
 */
export class ReleaseError extends Schema.TaggedErrorClass<ReleaseError>()("OCKit.ReleaseError", {
  kind: Schema.Literals(["not-found", "network", "decode", "checksum", "incompatible"]),
  id: Schema.String,
  detail: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message(): string {
    const version = this.version ? ` ${this.version}` : ""
    return `OC Kit registry: ${this.kind} for "${this.id}"${version} — ${this.detail}`
  }
}

const GitHubAsset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.String,
})

const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(GitHubAsset),
})

const KitManifestSchema = Schema.Struct({
  version: Schema.optional(Schema.String),
  min_opencode: Schema.optional(Schema.String),
})

/** Parse a checksums file into `file basename -> lowercase sha256`. */
export function parseChecksums(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = /^([0-9a-fA-F]{64})\s+(.+)$/.exec(trimmed)
    if (!m) continue
    const file = m[2].replace(/^\*/, "")
    const base = file.includes("/") ? file.slice(file.lastIndexOf("/") + 1) : file
    result[base] = m[1].toLowerCase()
  }
  return result
}

/** Strip a leading `v` from a release tag so it reads like a semver. */
export function normalizeVersion(value: string): string {
  return value.replace(/^v/, "")
}

/** Does the current runtime OpenCode version satisfy `min_opencode`? */
export function compatibleWithRuntime(minOpencode: string | undefined): boolean {
  if (!minOpencode) return true
  const runtime = InstallationVersion
  if (runtime === "local") return true
  return semver.gte(runtime, minOpencode, { loose: true })
}

const fetchJson = <S extends Schema.Top>(schema: S) =>
  Effect.fn("OCKit.registry.fetchJson")(function* (http: HttpClient.HttpClient, url: string) {
    const response = yield* http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson))
    if (response.status !== 200) {
      return yield* new ReleaseError({ kind: "not-found", id: url, detail: `HTTP ${response.status}` })
    }
    const data = yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError((err) => new ReleaseError({ kind: "decode", id: url, detail: `Invalid JSON: ${String(err)}` })),
    )
    return data
  })

const fetchText = Effect.fn("OCKit.registry.fetchText")(function* (http: HttpClient.HttpClient, url: string) {
  const response = yield* http.execute(HttpClientRequest.get(url))
  if (response.status !== 200) {
    return yield* new ReleaseError({ kind: "not-found", id: url, detail: `HTTP ${response.status}` })
  }
  return yield* response.text
})

// Treat a not-found fetch as an optional asset: succeeds with undefined rather
// than failing the whole resolution.
const fetchOptionalText = Effect.fn("OCKit.registry.fetchOptionalText")(function* (
  http: HttpClient.HttpClient,
  url: string,
) {
  return yield* fetchText(http, url).pipe(
    Effect.catchTag("OCKit.ReleaseError", (err) =>
      err.kind === "not-found" ? Effect.succeed(undefined) : Effect.fail(err),
    ),
  )
})

/**
 * Resolve a release for a kit. With `version` set, resolves exactly that tag;
 * otherwise scans the release list for the newest semver that is compatible
 * with the running OpenCode runtime. Returns a typed `ReleaseInfo` or a typed
 * `ReleaseError` (not-found when nothing compatible exists).
 */
export const resolveLatest = Effect.fn("OCKit.registry.resolveLatest")(function* (
  id: string,
  opts: { source?: RemoteRegistrySource; http?: HttpClient.HttpClient; version?: string } = {},
) {
  const http = opts.http ?? (yield* HttpClient.HttpClient)
  const source = resolveSource(opts.source)

  if (opts.version) {
    const release = yield* fetchJson(GitHubRelease)(http, `${makeApiUrl(source)}/tags/${opts.version}`).pipe(
      Effect.mapError((err) =>
        err instanceof ReleaseError && err.kind === "not-found"
          ? new ReleaseError({ kind: "not-found", id, version: opts.version, detail: `Release tag not found` })
          : err,
      ),
    )
    return yield* releaseInfoCore(http, source, id, release, true)
  }

  const releases = yield* fetchJson(Schema.Array(GitHubRelease))(http, makeApiUrl(source)).pipe(
    Effect.mapError((err) =>
      err instanceof ReleaseError && err.kind === "not-found"
        ? new ReleaseError({
            kind: "not-found",
            id,
            detail: `No releases found for ${source.owner}/${source.repo}`,
          })
        : err,
    ),
  )
  const sorted = (releases as typeof GitHubRelease.Type[]).toSorted((a, b) =>
    semver.rcompare(normalizeVersion(a.tag_name), normalizeVersion(b.tag_name), { loose: true }),
  )
  for (const release of sorted) {
    const info = yield* releaseInfoCore(http, source, id, release, false)
    if (info) return info
  }
  return yield* new ReleaseError({
    kind: "not-found",
    id,
    detail: `No release of ${source.owner}/${source.repo} is compatible with OpenCode ${InstallationVersion}`,
  })
})

/** Build a typed `ReleaseInfo` from a GitHub release payload. */
export const toReleaseInfo = Effect.fn("OCKit.registry.toReleaseInfo")(function* (
  http: HttpClient.HttpClient,
  source: RemoteRegistrySource,
  id: string,
  release: typeof GitHubRelease.Type,
  hard: boolean,
) {
  return yield* releaseInfoCore(http, source, id, release, hard)
})

const releaseInfoCore = Effect.fn("OCKit.registry.releaseInfoCore")(function* (
  http: HttpClient.HttpClient,
  source: RemoteRegistrySource,
  id: string,
  release: typeof GitHubRelease.Type,
  hard: boolean,
) {
  const tag = release.tag_name
  const version = normalizeVersion(tag)
  const archive = release.assets.find(
    (asset) => asset.name === ARCHIVE_ASSET_NAME || asset.name.endsWith(".tar.gz"),
  )
  if (!archive) {
    return yield* whenIncompatible(hard, new ReleaseError({
      kind: "incompatible",
      id,
      version,
      detail: `Release ${tag} has no ${ARCHIVE_ASSET_NAME} asset`,
    }))
  }

  const checksumAsset = release.assets.find((asset) => asset.name === CHECKSUMS_ASSET_NAME)
  let checksums: Record<string, string> | undefined
  if (checksumAsset) {
    const text = yield* fetchOptionalText(http, checksumAsset.browser_download_url)
    if (text !== undefined) checksums = parseChecksums(text)
  } else {
    const text = yield* fetchOptionalText(http, makeRawUrl(source, tag, CHECKSUMS_ASSET_NAME))
    if (text !== undefined) checksums = parseChecksums(text)
  }

  const archiveName = archive.name
  const expected = checksums ? checksums[archiveName] ?? checksums[archiveName.replace(/^\.\//, "")] : undefined
  if (checksums && expected === undefined) {
    return yield* whenIncompatible(hard, new ReleaseError({
      kind: "incompatible",
      id,
      version,
      detail: `Checksums file has no entry for "${archiveName}"`,
    }))
  }

  const minOpencode = yield* readKitMinOpencode(http, source, tag, id, version)
  if (!compatibleWithRuntime(minOpencode)) {
    return yield* whenIncompatible(hard, new ReleaseError({
      kind: "incompatible",
      id,
      version,
      detail: `Release requires OpenCode >= ${minOpencode}, running ${InstallationVersion}`,
    }))
  }

  return new ReleaseInfo({
    id,
    version,
    archiveUrl: archive.browser_download_url,
    checksumSha256: expected ?? "",
    manifestUrl: makeRawUrl(source, tag, "kit.json"),
    minOpencode,
    tag,
  })
})

function whenIncompatible<T>(hard: boolean, error: ReleaseError): Effect.Effect<T, ReleaseError> {
  // In "soft" mode (used while scanning the release list) an incompatible
  // release is skipped rather than aborting the whole resolution.
  return hard ? Effect.fail(error) : Effect.succeed(undefined as never)
}

const readKitMinOpencode = Effect.fn("OCKit.registry.readKitMinOpencode")(function* (
  http: HttpClient.HttpClient,
  source: RemoteRegistrySource,
  tag: string,
  id: string,
  version: string,
) {
  const text = yield* fetchOptionalText(http, makeRawUrl(source, tag, "kit.json"))
  if (text === undefined) return undefined
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new ReleaseError({ kind: "decode", id, version, detail: `Invalid kit manifest: ${String(cause)}` }),
  })
  const decoded = yield* Schema.decodeUnknownEffect(KitManifestSchema)(parsed).pipe(
    Effect.mapError((err) => new ReleaseError({ kind: "decode", id, version, detail: `Invalid kit manifest: ${String(err)}` })),
  )
  return decoded.min_opencode
})

export * as RegistryRemote from "./registry-remote"