// OC Kit kit validator. Validates a typed `Kit` manifest against its own
// declarative structure: every workflow step must reference a skill declared by
// the kit, and each skill/agent/workflow/hook must be internally well-formed.
// Pure — operates on the already-decoded `Kit` schema, no disk I/O — so it is
// trivially unit-testable and reused by the `oc kit validate` CLI command.

import { Effect } from "effect"
import { Kit, KitSkill, KitAgent, Workflow, KitHook } from "./types"
import { indexKit, resolveFromKit } from "./resolver"

export interface ValidationIssue {
  readonly kind: "skill" | "agent" | "workflow" | "hook"
  readonly id: string
  readonly message: string
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly issues: ValidationIssue[] }

/**
 * Validate a decoded kit manifest. Returns `ok` when every declared id resolves
 * and every workflow step references a declared skill; otherwise lists the
 * typed issues (each carries a `kind` + `id` for precise surfacing).
 */
export const validateKit = Effect.fn("OCKit.validate")(function* (kit: Kit) {
  const index = indexKit(kit)
  const issues: ValidationIssue[] = []

  // Every skill/agent/workflow/hook id must be present (the index itself is the
  // source of truth — a missing entry means the kind array was malformed).
  for (const skill of kit.skills ?? []) {
    try {
      resolveFromKit(index, "skills", skill.id)
    } catch {
      issues.push({ kind: "skill", id: skill.id, message: `undeclared skill "${skill.id}"` })
    }
  }
  for (const agent of kit.agents ?? []) {
    try {
      resolveFromKit(index, "agents", agent.id)
    } catch {
      issues.push({ kind: "agent", id: agent.id, message: `undeclared agent "${agent.id}"` })
    }
  }
  for (const workflow of kit.workflows ?? []) {
    try {
      resolveFromKit(index, "workflows", workflow.id)
    } catch {
      issues.push({ kind: "workflow", id: workflow.id, message: `undeclared workflow "${workflow.id}"` })
    }
  }
  for (const hook of kit.hooks ?? []) {
    try {
      resolveFromKit(index, "hooks", hook.event)
    } catch {
      issues.push({ kind: "hook", id: hook.event, message: `undeclared hook "${hook.event}"` })
    }
  }

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

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true }
})

// Re-export the consumed schemas so callers build fixtures without reaching into
// `./types` directly. Not strictly required, but keeps the validator self-contained.
export { Kit, KitSkill, KitAgent, Workflow, KitHook }
