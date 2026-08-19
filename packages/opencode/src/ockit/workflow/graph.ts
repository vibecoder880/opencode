// OC Kit workflow graph validation. A workflow's ordered `steps` must each
// resolve to a skill declared by the kit (via the resolver index), must use
// unique `as` aliases, must not form a cycle, and its `onFailure` identifiers
// must also resolve to declared skills. Pure — operates on the decoded `Workflow`
// and `KitIndex`, no I/O — so it is trivially unit-testable and is invoked before
// any run.

import { Effect, Schema } from "effect"
import type { Workflow } from "../types"
import type { KitIndex } from "../resolver"
import { stepKey } from "./state"

export class WorkflowError extends Schema.TaggedErrorClass<WorkflowError>()("OCKit.WorkflowError", {
  kind: Schema.Literals(["unknown-step", "unknown-onfailure", "duplicate-alias", "cycle"]),
  workflowId: Schema.String,
  step: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit workflow: ${this.workflowId}${this.step ? ` step "${this.step}"` : ""}${this.message ? ` — ${this.message}` : ""}`
  }
}

/**
 * Validate a workflow graph against a kit's resolved index.
 *
 * Checks:
 *   - every `steps[].skill` resolves to a declared skill
 *   - every `onFailure` identifier resolves to a declared skill
 *   - `as` aliases are unique within the workflow (a duplicate alias would make
 *     the run trace ambiguous)
 *   - no step key equals the workflow's own id (that would re-enter the
 *     workflow itself — the only cycle the linear step model can express)
 */
export const validateGraph = Effect.fn("OCKit.workflow.validate")(function* (workflow: Workflow, index: KitIndex) {
  for (const step of workflow.steps) {
    if (!index.skills.has(step.skill)) {
      return yield* new WorkflowError({ kind: "unknown-step", workflowId: workflow.id, step: stepKey(step) })
    }
  }

  for (const id of workflow.onFailure ?? []) {
    if (!index.skills.has(id)) {
      return yield* new WorkflowError({ kind: "unknown-onfailure", workflowId: workflow.id, step: id })
    }
  }

  const seen = new Set<string>()
  for (const step of workflow.steps) {
    const key = stepKey(step)
    if (seen.has(key)) {
      return yield* new WorkflowError({
        kind: "duplicate-alias",
        workflowId: workflow.id,
        step: key,
        message: `duplicate alias "${key}"`,
      })
    }
    // A step keyed by the workflow's own id would re-enter the workflow itself —
    // the only cycle the linear step model can express. (`as ?? skill` equals
    // the workflow id, e.g. `{ skill: "plan", as: "ship" }` in workflow "ship".)
    if (key === workflow.id) {
      return yield* new WorkflowError({ kind: "cycle", workflowId: workflow.id, step: key })
    }
    seen.add(key)
  }

  return { ok: true }
})

export type GraphValidation = { readonly ok: true }

export * as Graph from "./graph"