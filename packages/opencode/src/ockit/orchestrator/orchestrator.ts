// OC Kit orchestrator. The top-level entry point that takes a user's natural
// language request and drives the full pipeline:
//
//   user request
//   → classify intent
//   → route to workflow
//   → select agents per step
//   → resolve permissions
//   → execute workflow (via engine)
//   → return orchestrated result
//
// The orchestrator is the brain that turns "fix the login bug" into a
// structured, tracked, artifact-producing workflow run. It composes the
// intent classifier, workflow router, agent selector, permission scope,
// and workflow engine into a single Effect pipeline.

import { Effect, Schema } from "effect"
import type { Kit, Workflow, Mode } from "../types"
import { indexKit, type KitIndex } from "../resolver"
import { classifyIntent, type Intent } from "./intent"
import { routeWorkflow, selectFallback, type RouterResult } from "./router"
import { assignAgents, type AgentAssignment } from "./selector"
import { resolveStepPermissions, type StepPermissions } from "../workflow/permission-scope"
import { runWorkflow, type RunSummary, type EngineRunOptions } from "../workflow/engine"

// ---------------------------------------------------------------------------
// Orchestrator errors
// ---------------------------------------------------------------------------

export class OrchestratorError extends Schema.TaggedErrorClass<OrchestratorError>()("OCKit.OrchestratorError", {
  kind: Schema.Literals([
    "no-workflow",
    "no-kit",
    "intent-failed",
    "routing-failed",
    "execution-failed",
  ]),
  detail: Schema.String,
  requestId: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit orchestrator: ${this.kind} — ${this.detail}`
  }
}

// ---------------------------------------------------------------------------
// Orchestrator options
// ---------------------------------------------------------------------------

export interface OrchestrateOptions {
  /** The user's natural language request. */
  readonly request: string
  /** The kit to orchestrate against. */
  readonly kit: Kit
  /** Session ID for tracking. */
  readonly sessionId?: string
  /** Runtime mode. */
  readonly mode?: Mode
  /** Skip intent classification and use this workflow directly. */
  readonly workflowId?: string
  /** Skip intent classification and use this category directly. */
  readonly category?: Intent["category"]
  /** Custom executor for workflow steps. */
  readonly executor?: EngineRunOptions["executor"]
}

// ---------------------------------------------------------------------------
// Orchestrator result
// ---------------------------------------------------------------------------

export interface OrchestrateResult {
  /** The classified intent. */
  readonly intent: Intent
  /** The routing decision. */
  readonly routing: RouterResult
  /** Agent assignments per step. */
  readonly agents: Map<string, AgentAssignment>
  /** Permission scopes per step. */
  readonly permissions: Map<string, StepPermissions>
  /** The workflow execution result (undefined when routing failed). */
  readonly run: RunSummary | undefined
  /** Total steps in the workflow. */
  readonly stepCount: number
  /** Request ID for tracking. */
  readonly requestId: string
}

// ---------------------------------------------------------------------------
// Main orchestration pipeline
// ---------------------------------------------------------------------------

/**
 * Orchestrate a user request against a kit. This is the single entry point
 * that drives the full intent → workflow → agent → execution pipeline.
 *
 * Returns an `OrchestrateResult` with the classified intent, routing decision,
 * agent assignments, permission scopes, and workflow run summary.
 */
export const orchestrate = Effect.fn("OCKit.orchestrator.orchestrate")(function* (
  options: OrchestrateOptions,
) {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const kitIndex = indexKit(options.kit)

  // ── Step 1: Classify intent ──────────────────────────────────────────
  let intent: Intent
  if (options.category) {
    // User provided category directly — skip classification.
    intent = {
      category: options.category,
      confidence: 1,
      keywords: [],
      rawRequest: options.request,
    }
  } else {
    intent = classifyIntent(options.request)
  }

  // ── Step 2: Route to workflow ────────────────────────────────────────
  let routing: RouterResult

  if (options.workflowId) {
    // User provided workflow directly — skip routing.
    const wf = kitIndex.workflows.get(options.workflowId)
    routing = {
      workflow: wf,
      candidates: Array.from(kitIndex.workflows.keys()),
      reason: wf ? "best-match" : "no-match",
      intent,
    }
  } else {
    routing = routeWorkflow(intent, kitIndex)
  }

  // Fallback if no match.
  if (!routing.workflow) {
    const fallback = selectFallback(kitIndex)
    if (fallback) {
      routing = {
        workflow: fallback,
        candidates: routing.candidates,
        reason: "default-fallback",
        intent,
      }
    } else {
      return yield* new OrchestratorError({
        kind: "no-workflow",
        detail: `No workflow found for intent "${intent.category}" in kit "${options.kit.id}"`,
        requestId,
      })
    }
  }

  const workflow = routing.workflow

  // ── Step 3: Assign agents per step ───────────────────────────────────
  const agents = assignAgents(workflow, kitIndex)

  // ── Step 4: Resolve permissions per step ─────────────────────────────
  const permissions = new Map<string, StepPermissions>()
  for (const step of workflow.steps) {
    const key = step.as ?? step.skill
    permissions.set(key, resolveStepPermissions(step, options.kit))
  }

  // ── Step 5: Execute workflow ─────────────────────────────────────────
  const runResult = yield* runWorkflow({
    kit: options.kit,
    workflow,
    sessionId: options.sessionId,
    executor: options.executor,
  }).pipe(
    Effect.mapError(
      (err) =>
        new OrchestratorError({
          kind: "execution-failed",
          detail: String(err),
          requestId,
        }),
    ),
  )

  return {
    intent,
    routing,
    agents,
    permissions,
    run: runResult,
    stepCount: workflow.steps.length,
    requestId,
  } satisfies OrchestrateResult
})

/**
 * Lightweight orchestration: classify + route only, no execution.
 * Useful for previewing what the orchestrator would do without committing
 * to a workflow run.
 */
export function preview(request: string, kit: Kit): {
  intent: Intent
  routing: RouterResult
  agents: Map<string, AgentAssignment>
  permissions: Map<string, StepPermissions>
} {
  const kitIndex = indexKit(kit)
  const intent = classifyIntent(request)
  const routing = routeWorkflow(intent, kitIndex)

  const workflow = routing.workflow
  const agents = workflow ? assignAgents(workflow, kitIndex) : new Map()
  const permissions = new Map<string, StepPermissions>()

  if (workflow) {
    for (const step of workflow.steps) {
      const key = step.as ?? step.skill
      permissions.set(key, resolveStepPermissions(step, kit))
    }
  }

  return { intent, routing, agents, permissions }
}

export * as Orchestrator from "./orchestrator"
