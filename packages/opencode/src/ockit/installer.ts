// OC Kit installer. Given a kit id + remote registry source, resolves the
// release, downloads the archive over HttpClient, verifies its sha256 against
// the release checksums, stages and extracts the files, then writes them into
// the kit directory under `<config>/kits/<id>/` while recording ownership (via
// `claim`) and a pre-operation checkpoint.
//
// The extraction step is injectable so tests can run the full pipeline with an
// in-memory archive reader while production uses the on-disk `Archive` util
// (zip) / `tar` (tar.gz). Ownership paths are recorded root-relative so
// `detectUserEdits` / `planUpdate` resolve against the same root.

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { Global } from "@opencode-ai/core/global"
import { Process } from "../util/process"
import path from "path"
import { resolveLatest, ReleaseInfo, type RemoteRegistrySource } from "./registry-remote"
import { loadOwnership, saveOwnership, claim } from "./ownership"
import type { OwnershipEntry } from "./types"
import { Checkpoint } from "./checkpoint"
import { loadManifest } from "./manifest"

export class InstallerError extends Schema.TaggedErrorClass<InstallerError>()("OCKitInstallerError", {
  kind: Schema.Literals(["fetch", "checksum", "extract", "conflict", "write", "manifest", "not-found"]),
  kit: Schema.String,
  detail: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit installer: ${this.kind} for "${this.kit}"${this.version ? ` ${this.version}` : ""} — ${this.detail}`
  }
}

export class InstallSummary extends Schema.Class<InstallSummary>("OCKit.InstallSummary")({
  kitId: Schema.String,
  version: Schema.String,
  dir: Schema.String,
  filesInstalled: Schema.Array(Schema.String),
  mode: Schema.Literals(["production", "development"]),
}) {}

export interface InstallOptions {
  readonly version?: string
  readonly source?: RemoteRegistrySource
  readonly dev?: boolean
  readonly http?: HttpClient.HttpClient
  readonly root?: string
  /** Test seam: extract archive bytes into staged files. Defaults to the real extraction util. */
  readonly extract?: (archive: Uint8Array, dest: string) => Effect.Effect<void, InstallerError | FSUtil.Error, FSUtil.Service>
}

const defaultRoot = () => Global.Path.config

export const COLLECTED_ROOT_DIR = "kits"

const download = Effect.fn("OCKit.install.download")(function* (http: HttpClient.HttpClient, url: string) {
  const response = yield* http.execute(HttpClientRequest.get(url)).pipe(
    Effect.mapError((err) => new InstallerError({ kind: "fetch", kit: url, detail: `HTTP request failed: ${String(err)}` })),
  )
  if (response.status !== 200) {
    return yield* new InstallerError({ kind: "fetch", kit: url, detail: `HTTP ${response.status}` })
  }
  const body = yield* response.arrayBuffer
  return new Uint8Array(body)
})

/** Recursively collect `relative path -> content` for every file under `dir`. */
export const collectFiles = Effect.fn("OCKit.install.collectFiles")(function* (
  fs: FSUtil.Interface,
  dir: string,
) {
  const result: Record<string, string> = {}
  const walk = (current: string, rel: string): Effect.Effect<void, FSUtil.Error> =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectoryEntries(current)
      for (const entry of entries) {
        const childPath = path.join(current, entry.name)
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.type === "directory") {
          yield* walk(childPath, childRel)
        } else if (entry.type === "file") {
          const content = yield* fs.readFileStringSafe(childPath)
          if (content !== undefined) result[childRel] = content
        }
      }
    })
  yield* walk(dir, "")
  return result
})

/** Verify archive bytes against an expected sha256 (hex). */
export const verifySha256 = Effect.fn("OCKit.install.verifySha256")(function* (
  archive: Uint8Array,
  expected: string,
) {
  const actual = Hash.sha256(Buffer.from(archive))
  if (!expected || actual.toLowerCase() !== expected.toLowerCase()) {
    return yield* new InstallerError({
      kind: "checksum",
      kit: "archive",
      detail: `sha256 mismatch (expected ${expected}, got ${actual})`,
    })
  }
})

/** Extract archive bytes into `dest` using unzip/tar (or Expand-Archive on Windows). */
export const extractArchive = Effect.fn("OCKit.install.extractArchive")(function* (
  archive: Uint8Array,
  dest: string,
) {
  const fsutil = yield* FSUtil.Service
  yield* fsutil.ensureDir(dest)
  const tmpFile = path.join(dest, `.stage-${Date.now()}`)
  yield* fsutil.writeWithDirs(tmpFile, archive)
  try {
    if (process.platform === "win32") {
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${tmpFile}' -DestinationPath '${dest}' -Force`
      yield* Effect.promise(() => Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])).pipe(
        Effect.mapError(() => new InstallerError({ kind: "extract", kit: dest, detail: "expand-archive failed" })),
      )
    } else {
      yield* Effect.promise(() => Process.run(["tar", "-xzf", tmpFile, "-C", dest])).pipe(
        Effect.catch(() => Effect.promise(() => Process.run(["unzip", "-o", "-q", tmpFile, "-d", dest]))),
        Effect.mapError(() => new InstallerError({ kind: "extract", kit: dest, detail: "tar/unzip extraction failed" })),
      )
    }
  } finally {
    yield* fsutil.remove(tmpFile, { recursive: true, force: true }).pipe(Effect.ignore)
  }
})

/** Find the staging directory that actually holds the kit files. */
export const findStagedRoot = Effect.fn("OCKit.install.findStagedRoot")(function* (
  fs: FSUtil.Interface,
  staging: string,
) {
  const entries = yield* fs.readDirectoryEntries(staging)
  const dirs = entries.filter((e) => e.type === "directory")
  const files = entries.filter((e) => e.type === "file")
  // If the archive contains exactly one top-level directory (a wrapped kit
  // release, e.g. `v1.2.3/`), descend into it so the manifest is at the root.
  if (dirs.length === 1 && files.length === 0) return path.join(staging, dirs[0].name)
  return staging
})

export interface DownloadExtractOptions {
  readonly http: HttpClient.HttpClient
  readonly kitId: string
  readonly release: ReleaseInfo
  readonly staging: string
  readonly extract?: (archive: Uint8Array, dest: string) => Effect.Effect<void, InstallerError | FSUtil.Error, FSUtil.Service>
}

/**
 * Download a release archive, verify its sha256, extract it into `staging` and
 * return the relative file map. Shared by install and update so both pipelines
 * exercise the same download → verify → extract path.
 */
export const downloadAndExtract = Effect.fn("OCKit.install.downloadAndExtract")(function* (
  opts: DownloadExtractOptions,
) {
  const fsutil = yield* FSUtil.Service
  const extract = opts.extract ?? extractArchive

  // Download
  const archive = yield* download(opts.http, opts.release.archiveUrl)

  // Verify sha256
  yield* verifySha256(archive, opts.release.checksumSha256).pipe(
    Effect.mapError(() =>
      new InstallerError({ kind: "checksum", kit: opts.kitId, version: opts.release.version, detail: "archive checksum mismatch" }),
    ),
  )

  // Extract
  yield* extract(archive, opts.staging).pipe(
    Effect.mapError((err) =>
      new InstallerError({ kind: "extract", kit: opts.kitId, version: opts.release.version, detail: err.message }),
    ),
  )

  // Collect staged files
  const stagedRoot = yield* findStagedRoot(fsutil, opts.staging)
  return yield* collectFiles(fsutil, stagedRoot)
})

/**
 * Snapshot the current contents of every owned path into `.oc/state/rollback/<kit>/<token>/`
 * so a later `--rollback` can restore the exact bytes. Returns the snapshot dir.
 */
export const backupOwnedFiles = Effect.fn("OCKit.install.backupOwnedFiles")(function* (
  root: string,
  kit: string,
  files: Record<string, string>,
) {
  const fsutil = yield* FSUtil.Service
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const dir = path.join(root, ".oc", "state", "rollback", kit, token)
  yield* fsutil.ensureDir(dir)
  for (const [file, content] of Object.entries(files)) {
    yield* fsutil.writeWithDirs(path.join(dir, file), content)
  }
  return dir
})

/**
 * Install a kit. Resolves the release (version or latest compatible), downloads
 * and verifies the archive, stages + extracts it, plans file ownership via
 * `claim`, writes the files, records ownership, and snapshots a checkpoint.
 * `dev` installs the kit as untrusted/development.
 */
export const install = Effect.fn("OCKit.install")(function* (
  kitId: string,
  opts: InstallOptions = {},
) {
  const fsutil = yield* FSUtil.Service
  const http = opts.http ?? (yield* HttpClient.HttpClient)
  const root = opts.root ?? defaultRoot()
  const extract = opts.extract ?? extractArchive

  // 1. Resolve the release
  const release: ReleaseInfo = yield* resolveLatest(kitId, {
    http,
    version: opts.version,
    source: opts.source,
  }).pipe(
    Effect.mapError((err) =>
      new InstallerError({
        kind: err.kind === "not-found" ? "not-found" : "fetch",
        kit: kitId,
        version: err.version ?? opts.version,
        detail: err.detail,
      }),
    ),
  )

  // 2-5. Download → verify → extract → collect (staging removed on exit)
  const staging = path.join(root, ".oc", "state", `stage-${kitId}-${Date.now()}`)
  yield* fsutil.ensureDir(staging).pipe(
    Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, version: release.version, detail: err.message })),
  )

  return yield* Effect.gen(function* () {
    const files = yield* downloadAndExtract({ http, kitId, release, staging, extract })

    // Validate the staged kit manifest — never install a broken kit.
    const stagedRoot = yield* findStagedRoot(fsutil, staging)
    yield* loadManifest(stagedRoot).pipe(
      Effect.mapError((err) =>
        new InstallerError({ kind: "manifest", kit: kitId, version: release.version, detail: err.message ?? "invalid manifest" }),
      ),
    )

    // 6. Plan via ownership claim (cross-kit conflict check)
    const currentManifest = yield* loadOwnership(root).pipe(
      Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: err.message })),
    )
    // Ownership paths are root-relative: `kits/<id>/<file>`.
    const owned: Record<string, string> = {}
    for (const [file, content] of Object.entries(files)) {
      owned[`${COLLECTED_ROOT_DIR}/${kitId}/${file}`] = content
    }
    const claimed = yield* claim(currentManifest, kitId, release.version, owned).pipe(
      Effect.mapError((err) => new InstallerError({ kind: "conflict", kit: kitId, detail: err.message })),
    )

    // 6b. Snapshot the pre-install state of previously owned files so a later
    // `--rollback` can restore the exact bytes that existed before this install.
    const previous = Object.entries(currentManifest.files).filter(([file, entry]) =>
      file.startsWith(`${COLLECTED_ROOT_DIR}/${kitId}/`) && entry.kit === kitId,
    )
    const preInstall: Record<string, string> = {}
    if (previous.length > 0) {
      for (const [file] of previous) {
        const content = yield* fsutil.readFileStringSafe(path.join(root, file))
        if (content !== undefined) preInstall[file] = content
      }
      if (Object.keys(preInstall).length > 0) {
        yield* backupOwnedFiles(root, kitId, preInstall)
        yield* Checkpoint.create({
          root,
          kit: kitId,
          kitVersion: release.version,
          operation: "install",
          files: preInstall,
        })
      }
    }

    // 7. Write files into the kit directory `<root>/kits/<id>/`
    const kitDir = path.join(root, COLLECTED_ROOT_DIR, kitId)
    yield* fsutil.ensureDir(kitDir)
    for (const [file, content] of Object.entries(files)) {
      yield* fsutil.writeWithDirs(path.join(kitDir, file), content).pipe(
        Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: `failed to write ${file}: ${err}` })),
      )
    }

    // 8. Record ownership
    yield* saveOwnership(root, claimed).pipe(
      Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: `failed to save ownership: ${err.message}` })),
    )

    // 10. Dev marker
    if (opts.dev) {
      yield* fsutil.writeWithDirs(
        path.join(kitDir, ".oc-kit-dev"),
        JSON.stringify({ id: kitId, version: release.version, mode: "development" }),
      )
    }

    return new InstallSummary({
      kitId,
      version: release.version,
      dir: kitDir,
      filesInstalled: Object.keys(files),
      mode: opts.dev ? "development" : "production",
    })
  }).pipe(
    Effect.mapError((err) =>
      err instanceof InstallerError
        ? err
        : new InstallerError({ kind: "write", kit: kitId, version: release.version, detail: err.message }),
    ),
    Effect.ensuring(fsutil.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
  )
})

/** Uninstall a kit: remove its directory and drop its ownership rows. */
export const uninstall = Effect.fn("OCKit.install.uninstall")(function* (kitId: string) {
  const fsutil = yield* FSUtil.Service
  const root = defaultRoot()
  const kitDir = path.join(root, COLLECTED_ROOT_DIR, kitId)
  const exists = yield* fsutil.isDir(kitDir)
  if (!exists) {
    return yield* new InstallerError({ kind: "not-found", kit: kitId, detail: `Kit "${kitId}" is not installed` })
  }
  const manifest = yield* loadOwnership(root).pipe(
    Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: err.message })),
  )
  const next: Record<string, OwnershipEntry> = {}
  for (const [file, entry] of Object.entries(manifest.files)) {
    if (entry.kit !== kitId) next[file] = entry
  }
  yield* fsutil.remove(kitDir, { recursive: true, force: true }).pipe(
    Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: err.message })),
  )
  yield* saveOwnership(root, { files: next }).pipe(
    Effect.mapError((err) => new InstallerError({ kind: "write", kit: kitId, detail: `failed to save ownership: ${err.message}` })),
  )
})

export * as Installer from "./installer"// OC Kit installer — triggers CI re-run for typecheck and tests
