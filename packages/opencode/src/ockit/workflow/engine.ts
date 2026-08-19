// OC Kit workflow engine. Entry point that orchestrates the workflow pipeline:
// validate the graph against the kit index, create the run record, run the
// steps (state machine + runner + scheduler), and fold everything into a
// deterministic `RunSummary`. Pure Effect — no network, no disk I/O.

import { Effect } from "effect"
import type { Kit, Workflow, WorkflowState } from "../types"
import { indexKit } from "../resolver"
import { validateGraph, WorkflowError } from "./graph"
import { createRecord, type WorkflowRunRecord } from "./state"
import { runSteps, type StepOutcome, type StepExecutor } from "./runner"

/** Deterministic summary returned by `runWorkflow`. */
export interface RunSummary {
  readonly workflowId: string
  readonly runId: string
  readonly state: WorkflowState
  readonly steps: ReadonlyArray<StepOutcome>
  readonly recovered: boolean
  readonly startedAt: string
  readonly completedAt: string
}

export interface EngineRunOptions {
  readonly kit: Kit
  readonly workflow: Workflow
  readonly sessionId?: string
  readonly runId?: string
  readonly maxRetries?: number
  readonly concurrency?: number
  readonly executor?: StepExecutor
  readonly at?: string
}

/** Derive a deterministic run id from the workflow + step count. */
export function runIdFor(workflow: Workflow): string {
  return `${workflow.id}-${workflow.steps.length}`
}

/**
 * Run a workflow. Validates the graph first (a malformed workflow fails with a
 * typed `WorkflowError` before anything executes), then drives the state
 * machine over the declared steps. The result is deterministic and carries the
 * per-step trace, final state, and recovery flag.
 */
export const runWorkflow = Effect.fn("OCKit.workflow.runWorkflow")(function* (options: EngineRunOptions) {
  const at = options.at ?? new Date().toISOString()
  const runId = options.runId ?? runIdFor(options.workflow)
  const sessionId = options.sessionId ?? "session"

  const index = indexKit(options.kit)
  yield* validateGraph(options.workflow, index)

  const record: WorkflowRunRecord = createRecord({
    runId,
    workflowId: options.workflow.id,
    sessionId,
    at,
  })

  const result = yield* runSteps(record, {
    workflow: options.workflow,
    maxRetries: options.maxRetries,
    concurrency: options.concurrency,
    executor: options.executor,
    at,
  })

  const { record: final, trace } = result
  return {
    workflowId: final.workflowId,
    runId: final.runId,
    state: final.state,
    steps: trace,
    recovered: final.recovered,
    startedAt: final.startedAt,
    completedAt: final.completedAt ?? at,
  } satisfies RunSummary
})

export type { WorkflowError }

export * as WorkflowEngine from "./engine"