// OC Kit CLI (`oc kit list` / `oc kit validate`). Surfaces the Phase 1 domain
// model: `list` prints installed kits discovered through `Registry.Service`,
// `validate` loads a kit's manifest (from a directory or by id) and checks its
// declaration structure via the validator. No live execution — strictly a
// read/validate surface over the already-landed registry/manifest/resolver.
//
// The two command bodies are exported as standalone Effects (`listKits`,
// `validateTarget`) so they can be unit-tested with a mocked `Registry.Service`
// without going through yargs. The `effectCmd` wrappers only add the
// `registryLayer` provision (the registry is a LayerNode that is NOT part of
// AppRuntime) and the yargs command tree.

import type { Argv } from "yargs"
import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "../cli/cmd/cmd"
import { effectCmd, fail } from "../cli/effect-cmd"
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
      )
    : yield* registry.require(args.target).pipe(
        Effect.catchTag("OCKit.NotFoundError", (err: NotFoundError) =>
          fail(
            `No kit "${err.id}" installed. Available: ${err.available.length > 0 ? err.available.join(", ") : "(none)"}`,
          ),
        ),
      )

  const result = yield* validateKit(kit)
  if (!result.ok) {
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

export const OCKitCommand = cmd({
  command: "kit",
  describe: "manage OC Kit workflows, skills, and agents",
  builder: (yargs) => yargs.command(ListCommand).command(ValidateCommand).demandCommand(),
  async handler() {},
})

// Re-export the dependency node so `index.ts` can wire it without re-importing registry.
export { registryNode }
