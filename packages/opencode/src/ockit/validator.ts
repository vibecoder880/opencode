// OC Kit kit validator. Validates a typed `Kit` manifest against its own
// declarative structure. Pure — operates on the already-decoded `Kit` schema,
// no disk I/O — so it is trivially unit-testable and reused by the
// `oc kit validate` CLI command.
//
// Checks performed:
//   - unique ids within each kind (skills/agents/workflows/hooks); the index
//     silently collapses duplicates, so the original array is checked directly.
//   - every workflow step references a skill declared by the kit.
//   - every agent's `skills` reference declared skills.
//   - every skill's `agent` references a declared agent.

import { Effect } from "effect"
import { Kit, KitSkill, KitAgent, Workflow, KitHook } from "./types"
import { indexKit } from "./resolver"

export interface ValidationIssue {
  readonly kind: "skill" | "agent" | "workflow" | "hook"
  readonly id: string
  readonly message: string
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly issues: ValidationIssue[] }

/**
 * Validate a decoded kit manifest. Returns `ok` when every declared id is unique
 * and every cross-reference resolves; otherwise lists the typed issues (each
 * carries a `kind` + `id` for precise surfacing).
 */
export const validateKit = Effect.fn("OCKit.validate")(function* (kit: Kit) {
  const index = indexKit(kit)
  const issues: ValidationIssue[] = []

  // Duplicate ids within a kind are silently collapsed by the index, so check
  // the source arrays directly — a duplicate means a malformed manifest.
  const checkUnique = (values: ReadonlyArray<{ readonly id: string }>, kind: ValidationIssue["kind"], label: string) => {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value.id)) {
        issues.push({ kind, id: value.id, message: `duplicate ${label} id "${value.id}"` })
      }
      seen.add(value.id)
    }
  }
  checkUnique(kit.skills ?? [], "skill", "skill")
  checkUnique(kit.agents ?? [], "agent", "agent")
  checkUnique(kit.workflows ?? [], "workflow", "workflow")
  checkUnique(kit.hooks ?? [], "hook", "hook")

  // Each workflow step must reference a declared skill.
  for (const workflow of kit.workflows ?? []) {
    for (const step of workflow.steps) {
      if (index.skills.get(step.skill) === undefined) {
        issues.push({
          kind: "workflow",
          id: workflow.id,
          message: `workflow "${workflow.id}" references undeclared skill "${step.skill}"`,
        })
      }
    }
  }

  // Each agent's declared skills must be declared by the kit.
  for (const agent of kit.agents ?? []) {
    for (const skillId of agent.skills ?? []) {
      if (index.skills.get(skillId) === undefined) {
        issues.push({
          kind: "agent",
          id: agent.id,
          message: `agent "${agent.id}" references undeclared skill "${skillId}"`,
        })
      }
    }
  }

  // Each skill's backing agent must be declared by the kit.
  for (const skill of kit.skills ?? []) {
    if (skill.agent !== undefined && index.agents.get(skill.agent) === undefined) {
      issues.push({
        kind: "skill",
        id: skill.id,
        message: `skill "${skill.id}" references undeclared agent "${skill.agent}"`,
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true }
})

// Re-export the consumed schemas so callers build fixtures without reaching into
// `./types` directly. Not strictly required, but keeps the validator self-contained.
export { Kit, KitSkill, KitAgent, Workflow, KitHook }
