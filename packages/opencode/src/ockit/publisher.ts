// OC Kit publisher. Publishes kit archives to GitHub releases with checksums
// and changelog support.

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Hash } from "@opencode-ai/core/util/hash"
import { Process } from "@/util/process"
import path from "path"

/** Result of publishing a kit. */
export class PublishResult extends Schema.Class<PublishResult>("OCKit.PublishResult")({
  releaseUrl: Schema.String,
  version: Schema.String,
  checksum: Schema.String,
}) {}

/** Error types for publish operations. */
export class PublishError extends Schema.TaggedErrorClass<PublishError>()("OCKitPublishError", {
  kind: Schema.Literals(["release", "upload", "checksum", "auth"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit publisher: ${this.kind} — ${this.detail}`
  }
}

export interface PublishOptions {
  readonly owner: string
  readonly repo: string
  readonly archivePath: string
  readonly version: string
  readonly changelog?: string
  readonly token?: string
}

/** Create a GitHub release via the API. */
function createRelease(
  owner: string,
  repo: string,
  version: string,
  changelog?: string,
): Effect.Effect<{ uploadUrl: string; htmlUrl: string }, PublishError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    const body = {
      tag_name: `v${version}`,
      name: `v${version}`,
      body: changelog ?? `Release ${version}`,
      draft: false,
      prerelease: false,
    }

    const request = yield* HttpClientRequest.post(
      `https://api.github.com/repos/${owner}/${repo}/releases`,
    ).pipe(
      HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
      HttpClientRequest.setHeader("X-GitHub-Api-Version", "2022-11-28"),
      HttpClientRequest.bodyJson(body),
      Effect.mapError(() => new PublishError({
        kind: "release",
        detail: `Failed to encode request body for v${version}`,
      })),
    )

    const response = yield* http.execute(request).pipe(
      Effect.mapError(() => new PublishError({
        kind: "release",
        detail: `Failed to create release v${version}`,
      })),
    )

    const json = yield* response.json.pipe(
      Effect.mapError(() => new PublishError({
        kind: "release",
        detail: "Failed to parse release response",
      })),
    )

    return {
      uploadUrl: (json as Record<string, unknown>).upload_url as string,
      htmlUrl: (json as Record<string, unknown>).html_url as string,
    }
  })
}

/** Upload an asset to a GitHub release. */
function uploadAsset(
  uploadUrl: string,
  archivePath: string,
  archiveName: string,
): Effect.Effect<void, PublishError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    const content = yield* Effect.tryPromise({
      try: () => Bun.file(archivePath).arrayBuffer(),
      catch: () => new PublishError({ kind: "upload", detail: `Failed to read ${archivePath}` }),
    })

    const url = uploadUrl.replace("{?name,label}", `?name=${archiveName}`)

    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
      HttpClientRequest.setHeader("Content-Type", "application/gzip"),
      HttpClientRequest.bodyUint8Array(new Uint8Array(content)),
    )

    yield* http.execute(request).pipe(
      Effect.mapError(() => new PublishError({
        kind: "upload",
        detail: `Failed to upload ${archiveName}`,
      })),
    )
  })
}

/**
 * Publish a kit archive to a GitHub release. Creates the release, uploads the
 * archive, and computes the sha256 checksum.
 */
export const publish = Effect.fn("OCKit.publisher.publish")(function* (opts: PublishOptions) {
  // 1. Compute checksum
  const content = yield* Effect.tryPromise({
    try: () => Bun.file(opts.archivePath).arrayBuffer(),
    catch: () => new PublishError({ kind: "checksum", detail: "Failed to read archive" }),
  })
  const checksum = Hash.sha256(Buffer.from(content))

  // 2. Create release
  const release = yield* createRelease(opts.owner, opts.repo, opts.version, opts.changelog).pipe(
    Effect.mapError((err) => new PublishError({
      kind: "release",
      detail: err instanceof PublishError ? err.detail : `Failed to create release: ${String(err)}`,
    })),
  )

  // 3. Upload archive
  const archiveName = path.basename(opts.archivePath)
  yield* uploadAsset(release.uploadUrl, opts.archivePath, archiveName)

  // 4. Upload checksums
  const checksumsContent = `${checksum}  ${archiveName}\n`
  yield* Effect.tryPromise({
    try: async () => {
      const proc = Process.spawn(
        ["gh", "api", release.uploadUrl.replace("{?name,label}", `?name=checksums.txt`), "--method", "POST", "--header", "Content-Type: text/plain", "--input", "-"],
        { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
      )
      if (proc.stdin) {
        proc.stdin.write(checksumsContent)
        proc.stdin.end()
      }
      await proc.exited
    },
    catch: () => new PublishError({ kind: "checksum", detail: "Failed to upload checksums" }),
  })

  return new PublishResult({
    releaseUrl: release.htmlUrl,
    version: opts.version,
    checksum,
  })
})

export * as Publisher from "./publisher"
