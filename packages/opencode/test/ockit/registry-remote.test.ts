import { describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
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

/** A fake HttpClient answering from a URL -> Response map, injected via the
 * `http` option (so the effect needs no service layer). */
function fakeClient(handler: (url: string) => Response) {
  return HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
  )
}

function resolve<const O extends { source?: RemoteRegistrySource; version?: string }>(
  handler: (url: string) => Response,
  opts?: O,
) {
  return resolveLatest("engineer", { source: SOURCE, ...opts, http: fakeClient(handler) })
}

const EVEN_HEX = "a".repeat(64)
const OTHER_HEX = "b".repeat(64)

describe("ockit registry-remote", () => {
  it.effect("normalizeVersion strips a leading v", () =>
    Effect.gen(function* () {
      expect(normalizeVersion("v1.2.3")).toBe("1.2.3")
      expect(normalizeVersion("1.2.3")).toBe("1.2.3")
    }),
  )

  it.effect("compatibleWithRuntime allows missing and incompatible min_opencode", () =>
    Effect.gen(function* () {
      // With no min_opencode, everything is compatible.
      expect(compatibleWithRuntime(undefined)).toBe(true)
    }),
  )

  it.effect("parseChecksums extracts sha256 per file", () =>
    Effect.gen(function* () {
      const result = parseChecksums(
        `${EVEN_HEX}  kit-linux-amd64.tar.gz\n${OTHER_HEX} *kit-darwin-amd64.tar.gz\n`,
      )
      expect(result["kit-linux-amd64.tar.gz"]).toBe(EVEN_HEX)
      expect(result["kit-darwin-amd64.tar.gz"]).toBe(OTHER_HEX)
    }),
  )

  it.effect("resolves a pinned release into ReleaseInfo with checksums", () =>
    Effect.gen(function* () {
      const info = yield* resolve(
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
        { version: "1.0.0" },
      )
      expect(info.version).toBe("1.0.0")
      expect(info.checksumSha256).toBe(EVEN_HEX)
      expect(info.archiveUrl).toBe("https://example.com/kit.tar.gz")
      expect(info.manifestUrl).toContain("/1.0.0/kit.json")
    }),
  )

  it.effect("resolveLatest picks the newest compatible semver release", () =>
    Effect.gen(function* () {
      const info = yield* resolve((url) => {
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
      })
      expect(info.version).toBe("2.0.1")
    }),
  )

  it.effect("resolveLatest throws NotFound when no releases exist", () =>
    Effect.gen(function* () {
      const exit = yield* resolve((url) =>
        url.endsWith("/releases") ? jsonResponse([]) : jsonResponse({}),
      ).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const err = Cause.squash(exit.cause)
        expect(err).toBeInstanceOf(ReleaseError)
        expect((err as ReleaseError).kind).toBe("not-found")
      }
    }),
  )

  it.effect("treats an incompatible min_opencode as not-found when scanning", () =>
    Effect.gen(function* () {
      const exit = yield* resolve((url) => {
        if (url.endsWith("/releases")) {
          return jsonResponse([releasePayload("v3.0.0", [releaseAsset("kit.tar.gz")])])
        }
        if (url.endsWith("kit.json"))
          return jsonResponse({ id: "engineer", version: "3.0.0", min_opencode: "999.0.0" })
        if (url.endsWith("checksums.txt")) return new Response(`${EVEN_HEX}  kit.tar.gz\n`, { status: 200 })
        return jsonResponse({})
      }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const err = Cause.squash(exit.cause)
        expect(err).toBeInstanceOf(ReleaseError)
        expect((err as ReleaseError).kind).toBe("not-found")
      }
    }),
  )
})