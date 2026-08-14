// OC Kit resolver: resolve a skill/agent/workflow declared by a kit by name.
// Works purely against the typed kit manifest (no disk I/O), so it is cheap to
// call and trivially testable.

import { Schema } from "effect"
import { Kit, KitSkill, KitAgent, Workflow, KitHook } from "./types"

export class ResolveError extends Schema.TaggedErrorClass<ResolveError>()("OCKit.ResolveError", {
  kind: Schema.Literals(["skill", "agent", "workflow", "hook"]),
  id: Schema.String,
  kit: Schema.String,
}) {
  override get message() {
    return `OC Kit: no ${this.kind} "${this.id}" declared in kit "${this.kit}"`
  }
}

/** Everything a kit declares, indexed by name for lookup. */
export interface KitIndex {
  readonly kit: Kit
  readonly skills: Map<string, KitSkill>
  readonly agents: Map<string, KitAgent>
  readonly workflows: Map<string, Workflow>
  readonly hooks: Map<string, KitHook>
}

/** Build a name-indexed view of a kit's declarations. */
export function indexKit(kit: Kit): KitIndex {
  return {
    kit,
    skills: new Map((kit.skills ?? []).map((skill) => [skill.id, skill])),
    agents: new Map((kit.agents ?? []).map((agent) => [agent.id, agent])),
    workflows: new Map((kit.workflows ?? []).map((workflow) => [workflow.id, workflow])),
    hooks: new Map((kit.hooks ?? []).map((hook) => [hook.event, hook])),
  }
}

/** Resolve a kit's own declarations by name; throws ResolveError when absent. */
export function resolveFromKit(index: KitIndex, kind: KitIndexKeys, id: string) {
  const found = index[kind].get(id)
  if (found) return found
  throw new ResolveError({ kind, id, kit: index.kit.id })
}

type KitIndexKeys = "skills" | "agents" | "workflows" | "hooks"

/**
 * Resolve a declaration across all installed kits. `registry` is an injected
 * async iterator of kits (an Effect), so this stays framework-agnostic and can
 * be driven by the Registry.Service in production and by a plain array in tests.
 */
export async function resolveAcross(
  kits: Iterable<Kit>,
  kind: KitIndexKeys,
  id: string,
): Promise<{ kit: Kit; value: unknown } | undefined> {
  for (const kit of kits) {
    const index = indexKit(kit)
    const value = index[kind].get(id)
    if (value) return { kit, value }
  }
  return undefined
}

export * as Resolver from "./resolver"
