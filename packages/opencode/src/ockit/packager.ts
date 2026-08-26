// OC Kit packager. Creates kit archives (tar.gz) from kit directories,
// computes checksums, and validates kit structure before packaging.

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { Process } from "@/util/process"
import path from "path"
import { loadManifest } from "./manifest"

/** Result of packing a kit. */
export class PackResult extends Schema.Class<PackResult>("OCKit.PackResult")({
  archivePath: Schema.String,
  version: Schema.String,
  checksum: Schema.String,
  fileCount: Schema.Number,
}) {}

/** Error types for pack operations. */
export class PackError extends Schema.TaggedErrorClass<PackError>()("OCKitPackError", {
  kind: Schema.Literals(["manifest", "archive", "checksum", "write"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit packager: ${this.kind} — ${this.detail}`
  }
}

export interface PackOptions {
  readonly sourceDir: string
  readonly outputPath?: string
  readonly version?: string
}

/** Count files in a directory recursively. */
async function countFiles(dir: string): Promise<number> {
  const fsutil = await FSUtil.createNode()
  const entries = await fsutil.readDirectoryEntries(dir)
  let count = 0
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory) {
      count += await countFiles(fullPath)
    } else {
      count++
    }
  }
  return count
}

/**
 * Pack a kit directory into a tar.gz archive. Validates the manifest first,
 * then creates the archive and computes its sha256 checksum.
 */
export const pack = Effect.fn("OCKit.packager.pack")(function* (opts: PackOptions) {
  const fsutil = yield* FSUtil.Service

  // 1. Load and validate manifest
  const manifest = yield* loadManifest(opts.sourceDir).pipe(
    Effect.mapError((err) => new PackError({
      kind: "manifest",
      detail: `Failed to load manifest: ${String(err)}`,
    })),
  )

  // 2. Determine version
  const version = opts.version ?? manifest.version

  // 3. Create archive
  const archiveName = `${manifest.id}-${version}.tar.gz`
  const archivePath = opts.outputPath ?? path.join(path.dirname(opts.sourceDir), archiveName)

  yield* Effect.tryPromise({
    try: async () => {
      const proc = Process.spawn(
        ["tar", "-czf", archivePath, "-C", path.dirname(opts.sourceDir), path.basename(opts.sourceDir)],
        { stdout: "ignore", stderr: "pipe" },
      )
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        throw new Error(`tar exited with code ${exitCode}`)
      }
    },
    catch: (err) => new PackError({
      kind: "archive",
      detail: `Failed to create archive: ${String(err)}`,
    }),
  })

  // 4. Compute checksum
  const checksum = yield* Effect.tryPromise({
    try: async () => {
      const content = await Bun.file(archivePath).arrayBuffer()
      return Hash.sha256(Buffer.from(content))
    },
    catch: (err) => new PackError({
      kind: "checksum",
      detail: `Failed to compute checksum: ${String(err)}`,
    }),
  })

  // 5. Count files
  const fileCount = yield* Effect.tryPromise({
    try: () => countFiles(opts.sourceDir),
    catch: (err) => new PackError({
      kind: "manifest",
      detail: `Failed to count files: ${String(err)}`,
    }),
  })

  return new PackResult({
    archivePath,
    version,
    checksum,
    fileCount,
  })
})

export * as Packager from "./packager"
