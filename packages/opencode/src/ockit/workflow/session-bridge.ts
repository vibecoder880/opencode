// OC Kit workflow-session bridge. Connects the workflow engine to OpenCode's
// session system so workflows can be triggered from within sessions, their
// runs tracked per-session, and their results fed back into session history.

import { Effect, Schema } from "effect"
import type { Kit, Workflow, WorkflowState } from "../types"
import { runWorkflow, type RunSummary, type EngineRunOptions } from "./engine"

/** A workflow run record scoped to a session. */
export const SessionWorkflowRun = Schema.Struct({
  runId: Schema.String,
  workflowId: Schema.String,
  sessionId: Schema.String,
  kitId: Schema.String,
  state: Schema.String as Schema.Schema<WorkflowState>,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
})
export type SessionWorkflowRun = Schema.Schema.Type<typeof SessionWorkflowRun>

/** Error types for session bridge operations. */
export class SessionBridgeError extends Schema.TaggedErrorClass<SessionBridgeError>()("OCKitSessionBridgeError", {
  kind: Schema.Literals(["not-found", "permission", "execution"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit session bridge: ${this.kind} — ${this.detail}`
  }
}

/** In-memory store for session-scoped workflow runs. */
const sessionRuns = new Map<string, SessionWorkflowRun[]>()

/** Get all workflow runs for a session. */
export function getSessionRuns(sessionId: string): ReadonlyArray<SessionWorkflowRun> {
  return sessionRuns.get(sessionId) ?? []
}

/** Get a specific workflow run by ID within a session. */
export function getSessionRun(sessionId: string, runId: string): SessionWorkflowRun | undefined {
  const runs = sessionRuns.get(sessionId) ?? []
  return runs.find((r) => r.runId === runId)
}

/** Clear all runs for a session (e.g., on session disposal). */
export function clearSessionRuns(sessionId: string): void {
  sessionRuns.delete(sessionId)
}

/** Record a workflow run in the session store. */
function recordRun(run: SessionWorkflowRun): void {
  const existing = sessionRuns.get(run.sessionId) ?? []
  existing.push(run)
  sessionRuns.set(run.sessionId, existing)
}

/** Update an existing run's state and completion time. */
function updateRun(sessionId: string, runId: string, state: WorkflowState, completedAt?: string): void {
  const runs = sessionRuns.get(sessionId) ?? []
  const idx = runs.findIndex((r) => r.runId === runId)
  if (idx >= 0) {
    runs[idx] = { ...runs[idx], state, completedAt }
  }
}

/**
 * Trigger a workflow from within a session. Creates a run record, executes the
 * workflow through the engine, and tracks the result per-session.
 */
export const triggerWorkflow = Effect.fn("OCKit.session.triggerWorkflow")(function* (
  sessionId: string,
  kit: Kit,
  workflow: Workflow,
  options?: Partial<EngineRunOptions>,
) {
  const runId = options?.runId ?? `${workflow.id}-${Date.now()}`
  const at = options?.at ?? new Date().toISOString()

  // Record the run as PENDING before execution starts.
  const pendingRun: SessionWorkflowRun = {
    runId,
    workflowId: workflow.id,
    sessionId,
    kitId: kit.id,
    state: "PENDING",
    startedAt: at,
  }
  recordRun(pendingRun)

  // Execute the workflow through the engine.
  const summary: RunSummary = yield* runWorkflow({
    kit,
    workflow,
    sessionId,
    runId,
    ...options,
    at,
  }).pipe(
    Effect.mapError((err) => new SessionBridgeError({
      kind: "execution",
      detail: `Workflow "${workflow.id}" failed: ${String(err)}`,
    })),
  )

  // Update the run record with the final state.
  updateRun(sessionId, runId, summary.state, summary.completedAt)

  return summary
})

/**
 * Trigger a workflow and produce a session-visible message describing the
 * outcome. Use this when you want the result appended to session history.
 */
export const triggerAndReport = Effect.fn("OCKit.session.triggerAndReport")(function* (
  sessionId: string,
  kit: Kit,
  workflow: Workflow,
  options?: Partial<EngineRunOptions>,
) {
  const summary = yield* triggerWorkflow(sessionId, kit, workflow, options)

  const statusEmoji = summary.state === "COMPLETED" ? "✅"
    : summary.state === "FAILED" ? "❌"
    : summary.state === "RECOVERED" ? "🔄"
    : "⏳"

  return {
    summary,
    message: `${statusEmoji} Workflow "${workflow.id}" (${summary.state}): ${summary.steps.length} steps, ${summary.recovered ? "recovered" : "direct"}`,
  }
})

export * as SessionBridge from "./session-bridge"
