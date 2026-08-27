// OC Kit workflow router. Takes a classified intent and a kit's resolved
// index, then selects the best matching workflow. When the kit declares
// exactly one workflow it is used unconditionally; when multiple workflows
// exist the router scores them by keyword/category affinity and picks the
// highest. Returns a typed RouterResult so the orchestrator can decide
// whether to fall back to a default workflow or abort. Pure — no I/O.

import type { Kit, Workflow } from "../types"
import type { KitIndex } from "../resolver"
import type { Intent } from "./intent"
import { scoreWorkflowAffinity } from "./intent"

/** Result of workflow routing. */
export interface RouterResult {
  /** The selected workflow (undefined when no match and no default). */
  readonly workflow: Workflow | undefined
  /** All candidate workflows considered. */
  readonly candidates: ReadonlyArray<string>
  /** Routing decision reason. */
  readonly reason: "single-workflow" | "best-match" | "default-fallback" | "no-match"
  /** The intent that was routed. */
  readonly intent: Intent
}

/**
 * Route a classified intent to the best workflow in a kit.
 *
 * Strategy:
 *   1. If the kit has exactly one workflow → use it (single-workflow).
 *   2. If multiple workflows → score by affinity, pick the best if score > 0.
 *   3. If no workflow matches → return undefined with "no-match".
 */
export function routeWorkflow(
  intent: Intent,
  index: KitIndex,
): RouterResult {
  const allWorkflows = Array.from(index.workflows.values())
  const candidateIds = allWorkflows.map((w) => w.id)

  // Single workflow: use it unconditionally.
  if (allWorkflows.length === 1) {
    return {
      workflow: allWorkflows[0],
      candidates: candidateIds,
      reason: "single-workflow",
      intent,
    }
  }

  // Multiple workflows: score and pick the best.
  if (allWorkflows.length > 1) {
    const scored = scoreWorkflowAffinity(intent, allWorkflows)
    const best = scored[0]

    if (best && best.score > 0) {
      const wf = index.workflows.get(best.workflowId)
      return {
        workflow: wf,
        candidates: candidateIds,
        reason: "best-match",
        intent,
      }
    }
  }

  // No match.
  return {
    workflow: undefined,
    candidates: candidateIds,
    reason: "no-match",
    intent,
  }
}

/**
 * Select a fallback workflow when routing fails. Uses the kit's first
 * workflow as a safe default, or returns undefined if the kit has none.
 */
export function selectFallback(index: KitIndex): Workflow | undefined {
  const allWorkflows = Array.from(index.workflows.values())
  return allWorkflows[0]
}

export * as WorkflowRouter from "./router"
