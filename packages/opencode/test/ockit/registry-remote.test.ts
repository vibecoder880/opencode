import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "../lib/effect"
import {
  RemoteRegistrySource,
  resolveLatest,
  parseChecksums,
  compatibleWithRuntime,
  normalizeVersion,
  ReleaseError,
} from "../../src/ockit/registry-remote"

const it = testEffect(Layer.empty)

const SOURCE = new RemoteRegistrySource({ owner: "opencode-ai", repo: "kits" })

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function releaseAsset(name: string, url = `https://example.com/${name}`) {
  return { name, browser_download_url: url }
}

function releasePayload(tag: string, assets: Array<{ name: string; browser_download_url: string }>) {
  return { tag_name: tag, assets }
}

/** A fake client answering from a URL -> Response map. */
function clientFor(handler: (url: string) => Response) {
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
  )
  return Layer.succeed(HttpClient.HttpClient, client)
}

function withClient<A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, handler: (url: string) => Response) {
  return Effect.provide(effect, clientFor(handler))
}

const EVEN_HEX = "a".repeat(64)
const OTHER_HEX = "b".repeat(64)

describe("ockit registry-remote", () => {
  it.effect("normalizeVersion strips a leading v", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3")
    expect(normalizeVersion("1.2.3")).toBe("1.2.3")
  })

  it.effect("compatibleWithRuntime allows missing and incompatible min_opencode", () => {
    // With no min_opencode, everything is compatible.
    expect(compatibleWithRuntime(undefined)).toBe(true)
  })

  it.effect("parseChecksums extracts sha256 per file", () => {
    const result = parseChecksums(
      `${EVEN_HEX}  kit-linux-amd64.tar.gz\n${OTHER_HEX} *kit-darwin-amd64.tar.gz\n`,
    )
    expect(result["kit-linux-amd64.tar.gz"]).toBe(EVEN_HEX)
    expect(result["kit-darwin-amd64.tar.gz"]).toBe(OTHER_HEX)
  })

  it.effect("resolves a pinned release into ReleaseInfo with checksums", () =>
    withClient(
      resolveLatest("engineer", { source: SOURCE, version: "1.0.0" }),
      (url) => {
        if (url.endsWith("/releases/tags/1.0.0")) {
          return jsonResponse(
            releasePayload("1.0.0", [
              releaseAsset("kit.tar.gz", "https://example.com/kit.tar.gz"),
              releaseAsset("checksums.txt", "https://example.com/checksums.txt"),
            ]),
          )
        }
        if (url.endsWith("kit.tar.gz")) return jsonResponse({})
        if (url.endsWith("checksums.txt")) return new Response(`${EVEN_HEX}  kit.tar.gz\n`, { status: 200 })
        if (url.includes("kit.json")) return jsonResponse({ id: "engineer", version: "1.0.0" })
        return jsonResponse({})
      },
    ).pipe(
      Effect.flatMap((info: import("../../src/ockit/registry-remote").ReleaseInfo) => {
        expect(info.version).toBe("1.0.0")
        expect(info.checksumSha256).toBe(EVEN_HEX)
        expect(info.archiveUrl).toBe("https://example.com/kit.tar.gz")
        expect(info.manifestUrl).toContain("/1.0.0/kit.json")
        return Effect.succeed(undefined)
      }),
    ),
  )

  it.effect("resolveLatest picks the newest compatible semver release", () =>
    withClient(
      resolveLatest("engineer", { source: SOURCE }),
      (url) => {
        if (url.endsWith("/releases")) {
          return jsonResponse([
            releasePayload("v1.0.0", [releaseAsset("kit.tar.gz")]),
            releasePayload("v2.0.0", [releaseAsset("kit.tar.gz")]),
            releasePayload("v2.0.1", [releaseAsset("kit.tar.gz")]),
          ])
        }
        if (url.endsWith("kit.json"))
          return jsonResponse({ id: "engineer", version: "2.0.1", min_opencode: "1.0.0" })
        if (url.endsWith("checksums.txt"))
          return new Response(`${EVEN_HEX}  kit.tar.gz\n`, { status: 200 })
        if (url.endsWith("kit.tar.gz")) return jsonResponse({})
        return jsonResponse({})
      },
    ).pipe(
      Effect.flatMap((info) => {
        expect(info.version).toBe("2.0.1")
        return Effect.succeed(undefined)
      }),
    ),
  )

  it.effect("resolveLatest throws NotFound when no releases exist", () =>
    withClient(
      resolveLatest("engineer", { source: SOURCE }),
      (url) => (url.endsWith("/releases") ? jsonResponse([]) : jsonResponse({})),
    ).pipe(
      Effect.flip,
      Effect.flatMap((err: ReleaseError) => {
        expect(err).toBeInstanceOf(ReleaseError)
        expect(err.kind).toBe("not-found")
        return Effect.succeed(undefined)
      }),
    ),
  )

  it.effect("treats an incompatible min_opencode as not-found when scanning", () =>
    withClient(
      resolveLatest("engineer", { source: SOURCE }),
      (url) => {
        if (url.endsWith("/releases")) {
          return jsonResponse([releasePayload("v3.0.0", [releaseAsset("kit.tar.gz")])])
        }
        if (url.endsWith("kit.json"))
          return jsonResponse({ id: "engineer", version: "3.0.0", min_opencode: "999.0.0" })
        if (url.endsWith("checksums.txt")) return new Response(`${EVEN_HEX}  kit.tar.gz\n`, { status: 200 })
        return jsonResponse({})
      },
    ).pipe(
      Effect.flip,
      Effect.flatMap((err: ReleaseError) => {
        expect(err).toBeInstanceOf(ReleaseError)
        expect(err.kind).toBe("not-found")
        return Effect.succeed(undefined)
      }),
    ),
  )
})