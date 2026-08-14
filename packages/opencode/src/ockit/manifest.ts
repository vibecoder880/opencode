// Kit manifest loading and validation. A kit is a directory containing a
// manifest file (`kit.json` or `kit.yaml`) plus optional skills/agents/
// workflows/hooks/rules directories. Manifest data is validated structurally
// against the OC Kit schema so a malformed kit fails with a typed error.

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Kit, KitSkill, KitAgent, Workflow, KitHook } from "./types"

export const KIT_MANIFEST_JSON = "kit.json"
export const KIT_MANIFEST_YAML = "kit.yaml"

export class ManifestError extends Schema.TaggedErrorClass<ManifestError>()("OCKitManifestError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {}

/**
 * Read and validate the manifest of a kit directory. Prefers `kit.json`;
 * falls back to `kit.yaml` (parsed via Bun's built-in YAML support, so no
 * extra dependency). Returns the typed kit manifest, or a ManifestError when
 * neither manifest exists or the content does not validate.
 */
export const loadManifest = Effect.fn("OCKit.manifest")(function* (kitDir: string) {
  const fs = yield* FSUtil.Service

  const jsonPath = `${kitDir}/${KIT_MANIFEST_JSON}`
  const yamlPath = `${kitDir}/${KIT_MANIFEST_YAML}`

  const hasJson = yield* fs.exists(jsonPath)
  const hasYaml = yield* fs.exists(yamlPath)
  if (!hasJson && !hasYaml) {
    return yield* new ManifestError({
      path: kitDir,
      message: `No kit manifest found (expected ${KIT_MANIFEST_JSON} or ${KIT_MANIFEST_YAML})`,
    })
  }

  const path = hasJson ? jsonPath : yamlPath
  const source = yield* fs.readFileStringSafe(path)
  if (source === undefined) {
    return yield* new ManifestError({ path, message: `Unable to read ${path}` })
  }
  const raw = yield* Effect.try({
    try: () => (hasJson ? JSON.parse(source) : Bun.YAML.parse(source)),
    catch: (cause) => new ManifestError({ path, message: `Invalid ${KIT_MANIFEST_JSON} syntax: ${String(cause)}` }),
  })

  const decoded = yield* Schema.decodeUnknown(Kit)(raw).pipe(
    Effect.mapError(
      (err) => new ManifestError({ path, message: Schema.TreeFormatter.formatIssueSync(err.issue) }),
    ),
  )

  return decoded
})

/**
 * Load the skill/agent/workflow/hook definitions embedded in a kit's
 * directory tree (`.opencode`-style SKILL.md/agent files are NOT loaded here —
 * they surface through the existing OpenCode Skill/Agent services). This
 * resolves the declarative skill/agent definitions from `kit.yaml`/`kit.json`
 * manifests into runnable metadata.
 */
export function resolveKitDeclarations(kit: Kit) {
  const skills = (kit.skills ?? []).map((skill) => SkillDeclaration(skill))
  const agents = (kit.agents ?? []).map((agent) => AgentDeclaration(agent))
  const workflows = (kit.workflows ?? []).map((workflow) => WorkflowDeclaration(workflow))
  const hooks = (kit.hooks ?? []).map((hook) => HookDeclaration(hook))
  return { skills, agents, workflows, hooks }
}

function SkillDeclaration(skill: KitSkill) {
  return { type: "skill" as const, ...skill }
}
function AgentDeclaration(agent: KitAgent) {
  return { type: "agent" as const, ...agent }
}
function WorkflowDeclaration(workflow: Workflow) {
  return { type: "workflow" as const, ...workflow }
}
function HookDeclaration(hook: KitHook) {
  return { type: "hook" as const, ...hook }
}
