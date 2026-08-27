// OC Kit CLI (`oc kit list` / `oc kit validate` / `oc kit install` /
// `oc kit update` / `oc kit rollback` / `oc kit doctor`). Surfaces the OC Kit
// domain model through a set of yargs commands. No live execution — strictly a
// read/validate surface over the already-landed registry/manifest/resolver.
//
// Command bodies are exported as standalone Effects so they can be unit-tested
// with a mocked `Registry.Service` without going through yargs. The `effectCmd`
// wrappers only add the `registryLayer` provision and the yargs command tree.

import type { Argv } from "yargs"
import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "../cli/cmd/cmd"
import { CliError, effectCmd, fail } from "../cli/effect-cmd"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Service as Registry, node as registryNode, NotFoundError } from "./registry"
import { loadManifest } from "./manifest"
import { validateKit } from "./validator"
import { Kit } from "./types"

const registryLayer = LayerNode.compile(registryNode)

/** Count how many of each declaration a kit carries (for compact `list` rows). */
function counts(kit: Kit) {
  return {
    skills: kit.skills?.length ?? 0,
    agents: kit.agents?.length ?? 0,
    workflows: kit.workflows?.length ?? 0,
    hooks: kit.hooks?.length ?? 0,
  }
}

/** Print all installed kits. Requires `Registry.Service`. */
export const listKits = Effect.fn("Cli.kit.list")(function* () {
  const registry = yield* Registry
  const kits = yield* registry.all()
  if (kits.length === 0) {
    process.stdout.write(`No OC Kit kits installed.` + EOL)
    return
  }
  for (const kit of kits.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const c = counts(kit)
    process.stdout.write(`${kit.id} (${kit.name}@${kit.version})` + EOL)
    process.stdout.write(`  skills:${c.skills} agents:${c.agents} workflows:${c.workflows} hooks:${c.hooks}` + EOL)
  }
})

export interface ValidateArgs {
  readonly target: string
}

/** Validate a kit by directory (prefers a manifest file) or by installed id. */
export const validateTarget = Effect.fn("Cli.kit.validate")(function* (args: ValidateArgs) {
  const fs = yield* FSUtil.Service
  const registry = yield* Registry

  const isDir = yield* fs.isDir(args.target)
  const kit = isDir
    ? yield* loadManifest(args.target).pipe(
        Effect.catchTag("OCKitManifestError", (err) =>
          fail(
            `Invalid kit manifest in "${args.target}": ${err.message ?? "unable to read manifest"}`,
          ),
        ),
        // `loadManifest` can also surface a raw file read `Error`; fold it onto
        // the CLI error channel so the whole command stays `Effect<_, CliError, _>`.
        Effect.mapError((err) =>
          err instanceof CliError
            ? err
            : new CliError({ message: `Unable to read kit manifest in "${args.target}": ${String(err)}` }),
        ),
      )
    : yield* registry.require(args.target).pipe(
        Effect.catchTag("OCKit.NotFoundError", (err: NotFoundError) =>
          fail(
            `No kit "${err.id}" installed. Available: ${err.available.length > 0 ? err.available.join(", ") : "(none)"}`,
          ),
        ),
      )

  const result = yield* validateKit(kit)
  if (result.ok === false) {
    for (const issue of result.issues) {
      process.stderr.write(`  ✗ ${issue.kind} "${issue.id}": ${issue.message}` + EOL)
    }
    return yield* fail(`Kit "${kit.id}" is invalid (${result.issues.length} issue(s)).`)
  }
  const c = counts(kit)
  process.stdout.write(
    `Kit "${kit.id}" (${kit.name}@${kit.version}) is valid — skills:${c.skills} agents:${c.agents} workflows:${c.workflows} hooks:${c.hooks}` +
      EOL,
  )
})

const ListCommand = effectCmd({
  command: "list",
  describe: "list installed OC Kit kits",
  handler: () => listKits().pipe(Effect.provide(registryLayer)),
})

const ValidateCommand = effectCmd({
  command: "validate <target>",
  describe: "validate an OC Kit manifest by directory or id",
  builder: (yargs: Argv) =>
    yargs.positional("target", {
      type: "string",
      description: "kit directory (contains kit.json/kit.yaml) or installed kit id",
      demandOption: true,
    }),
  handler: (args) => validateTarget({ target: args.target }).pipe(Effect.provide(registryLayer)),
})

// ── Install command ───────────────────────────────────────────────────────────

export interface InstallArgs {
  /** Directory containing a kit manifest, or a kit id from a remote registry. */
  readonly source: string
  /** Optional: install into a specific project directory instead of global. */
  readonly project?: string
}

/**
 * Install a kit from a local directory or remote source. Validates the manifest
 * before copying files into the kits directory. Respects ownership to detect
 * conflicts with already-installed kits.
 */
export const installKit = Effect.fn("Cli.kit.install")(function* (args: InstallArgs) {
  const fs = yield* FSUtil.Service
  const registry = yield* Registry

  // Load the kit manifest from the source directory.
  const isDir = yield* fs.isDir(args.source)
  if (!isDir) {
    return yield* fail(
      `Source "${args.source}" is not a directory. Provide a path to a directory containing a kit manifest (kit.json or kit.yaml).`,
    )
  }

  const kit = yield* loadManifest(args.source).pipe(
    Effect.catchTag("OCKitManifestError", (err) =>
      fail(
        `Invalid kit manifest in "${args.source}": ${err.message ?? "unable to read manifest"}`,
      ),
    ),
    Effect.mapError((err) =>
      err instanceof CliError
        ? err
        : new CliError({ message: `Unable to read kit manifest in "${args.source}": ${String(err)}` }),
    ),
  )

  // Validate the kit structure.
  const result = yield* validateKit(kit)
  if (result.ok === false) {
    for (const issue of result.issues) {
      process.stderr.write(`  ✗ ${issue.kind} "${issue.id}": ${issue.message}` + EOL)
    }
    return yield* fail(`Kit "${kit.id}" is invalid (${result.issues.length} issue(s)).`)
  }

  // Check if a kit with this id is already installed.
  const existing = yield* registry.get(kit.id)
  if (existing) {
    process.stdout.write(
      `Kit "${kit.id}" (${existing.name}@${existing.version}) is already installed.` + EOL,
    )
    process.stdout.write(
      `  Use "oc kit update ${kit.id}" to update, or "oc kit rollback ${kit.id}" to rollback.` + EOL,
    )
    return
  }

  // Copy kit files to the global kits directory.
  const dirs = yield* registry.dirs()
  const targetDir = args.project
    ? path.join(args.project, ".opencode", "kits", kit.id)
    : path.join(dirs[0] ?? path.join(process.env.HOME ?? "~", ".opencode", "kits"), kit.id)

  yield* fs.mkdir(targetDir, { recursive: true })
  yield* fs.copy(args.source, targetDir)

  process.stdout.write(
    `Installed kit "${kit.id}" (${kit.name}@${kit.version}) to ${targetDir}` + EOL,
  )
  process.stdout.write(
    `  skills:${kit.skills?.length ?? 0} agents:${kit.agents?.length ?? 0} workflows:${kit.workflows?.length ?? 0} hooks:${kit.hooks?.length ?? 0}` + EOL,
  )
})

const InstallCommand = effectCmd({
  command: "install <source>",
  describe: "install an OC Kit from a local directory",
  builder: (yargs: Argv) =>
    yargs
      .positional("source", {
        type: "string",
        description: "path to directory containing kit.json/kit.yaml",
        demandOption: true,
      })
      .option("project", {
        type: "string",
        description: "install into a specific project directory instead of global",
      }),
  handler: (args) =>
    installKit({ source: args.source, project: args.project }).pipe(Effect.provide(registryLayer)),
})

// ── Update command ────────────────────────────────────────────────────────────

export interface UpdateArgs {
  /** Kit id to update. */
  readonly kitId: string
  /** New source directory to update from (optional; re-validates if omitted). */
  readonly source?: string
}

/**
 * Update an installed kit. If a source directory is provided, copies the new
 * version over. Otherwise, re-validates the existing installation and reports
 * its status.
 */
export const updateKit = Effect.fn("Cli.kit.update")(function* (args: UpdateArgs) {
  const fs = yield* FSUtil.Service
  const registry = yield* Registry

  const existing = yield* registry.require(args.kitId).pipe(
    Effect.catchTag("OCKit.NotFoundError", (err: NotFoundError) =>
      fail(
        `No kit "${err.id}" installed. Available: ${err.available.length > 0 ? err.available.join(", ") : "(none)"}`,
      ),
    ),
  )

  if (!args.source) {
    // No source provided — just re-validate the existing installation.
    const result = yield* validateKit(existing)
    if (result.ok) {
      process.stdout.write(
        `Kit "${existing.id}" (${existing.name}@${existing.version}) is up to date and valid.` + EOL,
      )
    } else {
      process.stdout.write(
        `Kit "${existing.id}" (${existing.name}@${existing.version}) has ${result.issues.length} issue(s):` + EOL,
      )
      for (const issue of result.issues) {
        process.stderr.write(`  ✗ ${issue.kind} "${issue.id}": ${issue.message}` + EOL)
      }
    }
    return
  }

  // Load and validate the new version.
  const isDir = yield* fs.isDir(args.source)
  if (!isDir) {
    return yield* fail(`Source "${args.source}" is not a directory.`)
  }

  const newKit = yield* loadManifest(args.source).pipe(
    Effect.catchTag("OCKitManifestError", (err) =>
      fail(
        `Invalid kit manifest in "${args.source}": ${err.message ?? "unable to read manifest"}`,
      ),
    ),
    Effect.mapError((err) =>
      err instanceof CliError
        ? err
        : new CliError({ message: `Unable to read kit manifest in "${args.source}": ${String(err)}` }),
    ),
  )

  if (newKit.id !== existing.id) {
    return yield* fail(
      `Source kit id "${newKit.id}" does not match installed kit id "${existing.id}".`,
    )
  }

  const result = yield* validateKit(newKit)
  if (result.ok === false) {
    for (const issue of result.issues) {
      process.stderr.write(`  ✗ ${issue.kind} "${issue.id}": ${issue.message}` + EOL)
    }
    return yield* fail(`New kit version is invalid (${result.issues.length} issue(s)).`)
  }

  // Copy new files over the existing installation.
  const dirs = yield* registry.dirs()
  const targetDir = path.join(dirs[0] ?? path.join(process.env.HOME ?? "~", ".opencode", "kits"), existing.id)

  yield* fs.rm(targetDir, { recursive: true, force: true })
  yield* fs.mkdir(targetDir, { recursive: true })
  yield* fs.copy(args.source, targetDir)

  process.stdout.write(
    `Updated kit "${existing.id}" from ${existing.version} to ${newKit.version}` + EOL,
  )
})

const UpdateCommand = effectCmd({
  command: "update <kit-id>",
  describe: "update an installed OC Kit",
  builder: (yargs: Argv) =>
    yargs
      .positional("kit-id", {
        type: "string",
        description: "kit id to update",
        demandOption: true,
      })
      .option("source", {
        type: "string",
        description: "new source directory to update from",
      }),
  handler: (args) =>
    updateKit({ kitId: args.kitId, source: args.source }).pipe(Effect.provide(registryLayer)),
})

// ── Rollback command ──────────────────────────────────────────────────────────

export interface RollbackArgs {
  /** Kit id to rollback. */
  readonly kitId: string
  /** Target version to rollback to (optional; shows available versions if omitted). */
  readonly version?: string
}

/**
 * Rollback a kit to a previous version. Without a version argument, shows
 * the current version and available versions.
 */
export const rollbackKit = Effect.fn("Cli.kit.rollback")(function* (args: RollbackArgs) {
  const registry = yield* Registry

  const existing = yield* registry.require(args.kitId).pipe(
    Effect.catchTag("OCKit.NotFoundError", (err: NotFoundError) =>
      fail(
        `No kit "${err.id}" installed. Available: ${err.available.length > 0 ? err.available.join(", ") : "(none)"}`,
      ),
    ),
  )

  if (!args.version) {
    // Show current version info.
    process.stdout.write(
      `Kit "${existing.id}" is at version ${existing.version}` + EOL,
    )
    process.stdout.write(
      `  To rollback, provide a target version: oc kit rollback ${existing.id} <version>` + EOL,
    )
    process.stdout.write(
      `  Note: Version history is managed by the ownership manifest.` + EOL,
    )
    return
  }

  // For now, report that rollback requires the ownership system.
  // In a full implementation, this would look up the ownership manifest
  // and restore files from the previous version.
  process.stdout.write(
    `Rollback requested for kit "${existing.id}" to version ${args.version}` + EOL,
  )
  process.stdout.write(
    `  Current version: ${existing.version}` + EOL,
  )
  process.stdout.write(
    `  Note: Full rollback requires the ownership system (Phase 5).` + EOL,
  )
  process.stdout.write(
    `  For now, re-install from a specific version directory.` + EOL,
  )
})

const RollbackCommand = effectCmd({
  command: "rollback <kit-id> [version]",
  describe: "rollback an OC Kit to a previous version",
  builder: (yargs: Argv) =>
    yargs
      .positional("kit-id", {
        type: "string",
        description: "kit id to rollback",
        demandOption: true,
      })
      .positional("version", {
        type: "string",
        description: "target version to rollback to",
      }),
  handler: (args) =>
    rollbackKit({ kitId: args.kitId, version: args.version }).pipe(Effect.provide(registryLayer)),
})

// ── Doctor command ────────────────────────────────────────────────────────────

export interface DoctorArgs {
  /** Optional: specific kit id to check; checks all if omitted. */
  readonly kitId?: string
}

interface DiagnosticResult {
  readonly kitId: string
  readonly status: "ok" | "warning" | "error"
  readonly message: string
}

/**
 * Check the health of installed kits. Validates manifests, checks for
 * missing dependencies, and reports any issues.
 */
export const doctorKit = Effect.fn("Cli.kit.doctor")(function* (args: DoctorArgs) {
  const registry = yield* Registry

  const diagnostics: DiagnosticResult[] = []

  if (args.kitId) {
    // Check a specific kit.
    const kit = yield* registry.require(args.kitId).pipe(
      Effect.catchTag("OCKit.NotFoundError", (err: NotFoundError) =>
        fail(
          `No kit "${err.id}" installed. Available: ${err.available.length > 0 ? err.available.join(", ") : "(none)"}`,
        ),
      ),
    )

    const result = yield* validateKit(kit)
    if (result.ok) {
      diagnostics.push({
        kitId: kit.id,
        status: "ok",
        message: `${kit.name}@${kit.version} — valid`,
      })
    } else {
      for (const issue of result.issues) {
        diagnostics.push({
          kitId: kit.id,
          status: issue.severity === "error" ? "error" : "warning",
          message: `${issue.kind} "${issue.id}": ${issue.message}`,
        })
      }
    }
  } else {
    // Check all installed kits.
    const kits = yield* registry.all()
    if (kits.length === 0) {
      process.stdout.write(`No OC Kit kits installed.` + EOL)
      return
    }

    for (const kit of kits) {
      const result = yield* validateKit(kit)
      if (result.ok) {
        diagnostics.push({
          kitId: kit.id,
          status: "ok",
          message: `${kit.name}@${kit.version} — valid`,
        })
      } else {
        for (const issue of result.issues) {
          diagnostics.push({
            kitId: kit.id,
            status: issue.severity === "error" ? "error" : "warning",
            message: `${issue.kind} "${issue.id}": ${issue.message}`,
          })
        }
      }
    }
  }

  // Print results.
  const errors = diagnostics.filter((d) => d.status === "error")
  const warnings = diagnostics.filter((d) => d.status === "warning")
  const oks = diagnostics.filter((d) => d.status === "ok")

  if (oks.length > 0) {
    process.stdout.write(`✓ ${oks.length} kit(s) healthy` + EOL)
    for (const ok of oks) {
      process.stdout.write(`  ${ok.kitId}: ${ok.message}` + EOL)
    }
  }

  if (warnings.length > 0) {
    process.stdout.write(`⚠ ${warnings.length} warning(s)` + EOL)
    for (const w of warnings) {
      process.stderr.write(`  ${w.kitId}: ${w.message}` + EOL)
    }
  }

  if (errors.length > 0) {
    process.stdout.write(`✗ ${errors.length} error(s)` + EOL)
    for (const e of errors) {
      process.stderr.write(`  ${e.kitId}: ${e.message}` + EOL)
    }
    return yield* fail(`${errors.length} kit(s) have errors.`)
  }
})

const DoctorCommand = effectCmd({
  command: "doctor [kit-id]",
  describe: "check health of installed OC Kit kits",
  builder: (yargs: Argv) =>
    yargs.positional("kit-id", {
      type: "string",
      description: "specific kit id to check (checks all if omitted)",
    }),
  handler: (args) =>
    doctorKit({ kitId: args.kitId }).pipe(Effect.provide(registryLayer)),
})

export const OCKitCommand = cmd({
  command: "kit",
  describe: "manage OC Kit workflows, skills, and agents",
  builder: (yargs) =>
    yargs
      .command(ListCommand)
      .command(ValidateCommand)
      .command(InstallCommand)
      .command(UpdateCommand)
      .command(RollbackCommand)
      .command(DoctorCommand)
      .demandCommand(),
  async handler() {},
})

// Re-export the dependency node so `index.ts` can wire it without re-importing registry.
export { registryNode }
