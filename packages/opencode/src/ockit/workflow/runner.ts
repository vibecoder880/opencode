// OC Kit workflow step runner. Executes a workflow's steps — simulated/scheduled,
// since live agent execution lands in a later phase — by driving the state
// machine in `state.ts`: each successful step advances one activity phase, a
// failed step within its retry budget is retried in place, and a step failing
// past its budget routes to the workflow's `onFailure` handlers. Records a
// deterministic per-step trace (`StepOutcome`) and returns the final run record.

import { Effect } from "effect"
import type { Workflow, WorkflowStep } from "../types"
import { applyEvent, stepKey, type WorkflowRunRecord } from "./state"
import { planBatches } from "./scheduler"

/** Per-step run outcome recorded in the run trace. */
export interface StepOutcome {
  readonly key: string
  readonly skill: string
  readonly status: "ok" | "recovered" | "failed"
  readonly attempts: number
}

/** Deterministic simulated result of executing one skill step. */
export interface StepExecResult {
  readonly ok: boolean
  readonly reason?: string
}

/** Executes one skill step (simulated; a later phase wires live execution). */
export type StepExecutor = (input: { readonly step: WorkflowStep; readonly attempt: number }) => StepExecResult

/** Default simulated executor: every step succeeds on its first attempt. */
export const defaultExecutor: StepExecutor = () => ({ ok: true })

export interface RunOptions {
  readonly workflow: Workflow
  readonly maxRetries?: number
  readonly concurrency?: number
  readonly executor?: StepExecutor
  /** Deterministic timestamp stamped when the run terminates. */
  readonly at?: string
}

export interface RunResult {
  readonly record: WorkflowRunRecord
  readonly trace: ReadonlyArray<StepOutcome>
}

type RunnerDeps = Required<Pick<RunOptions, "maxRetries" | "executor">>

/**
 * Run one workflow step (record is in an activity phase) with its retry budget.
 * A step that succeeds within budget moves the run one activity phase forward
 * (`step-ok`); a failure within budget is retried in place (`retry` keeps the
 * phase); a step failing past its budget leaves the run in `BLOCKED`.
 */
function runStep(
  record: WorkflowRunRecord,
  step: WorkflowStep,
  run: RunnerDeps,
): { record: WorkflowRunRecord; outcome: StepOutcome } {
  let current = record
  let attempt = 0
  while (true) {
    const result = run.executor({ step, attempt })
    if (result.ok) {
      // Retries never advanced the phase (each was a `retry` event); a step
      // that eventually succeeds moves the run exactly one phase forward.
      return {
        record: applyEvent(current, "step-ok"),
        outcome: { key: stepKey(step), skill: step.skill, status: "ok", attempts: attempt + 1 },
      }
    }
    if (attempt < run.maxRetries) {
      current = applyEvent(current, "retry") // stays in the same activity phase
      attempt += 1
      continue
    }
    return {
      record: applyEvent(current, "step-fail"),
      outcome: { key: stepKey(step), skill: step.skill, status: "failed", attempts: attempt + 1 },
    }
  }
}

/**
 * Attempt one `onFailure` handler (`record` is BLOCKED). Unlike a normal step,
 * recovery attempts do not move the phase — the run stays BLOCKED while the
 * handler is retried so a later handler can still recover it.
 */
function runRecoveryStep(
  record: WorkflowRunRecord,
  skill: string,
  run: RunnerDeps,
): { record: WorkflowRunRecord; ok: boolean; outcome: StepOutcome } {
  let attempt = 0
  while (true) {
    const result = run.executor({ step: { skill }, attempt })
    if (result.ok) {
      return { record, ok: true, outcome: { key: skill, skill, status: "recovered", attempts: attempt + 1 } }
    }
    if (attempt < run.maxRetries) {
      attempt += 1
      continue
    }
    return { record, ok: false, outcome: { key: skill, skill, status: "failed", attempts: attempt + 1 } }
  }
}

/**
 * Run the `onFailure` handlers in order until one succeeds. A succeeded handler
 * completes the blocked run with `recovered: true`; if every handler fails the
 * run ends `FAILED`. Each handler executed earns one trace entry.
 */
function runRecovery(
  record: WorkflowRunRecord,
  onFailure: ReadonlyArray<string>,
  run: RunnerDeps,
  at?: string,
): { record: WorkflowRunRecord; trace: ReadonlyArray<StepOutcome> } {
  const trace: StepOutcome[] = []
  let current = record // BLOCKED
  for (const skill of onFailure) {
    const handled = runRecoveryStep(current, skill, run)
    trace.push(handled.outcome)
    if (handled.ok) {
      current = applyEvent(current, "complete", at) // BLOCKED -> COMPLETED
      return { record: { ...current, recovered: true }, trace }
    }
    // Handler failed; try the next. The state stays BLOCKED between handlers.
  }
  current = applyEvent(current, "fail", at) // BLOCKED -> FAILED
  return { record: current, trace }
}

/**
 * Run a workflow end-to-end over its declared steps in FIFO order (a scheduler
 * plan with `concurrency` bounds the dispatch shape). Each successful step
 * advances one activity phase; on a step failing past its retries the run
 * routes to `onFailure`. Returns the final run record plus the per-step trace.
 */
export const runSteps = Effect.fn("OCKit.workflow.run")(function* (record: WorkflowRunRecord, options: RunOptions) {
  const run: RunnerDeps = {
    maxRetries: options.maxRetries ?? 1,
    executor: options.executor ?? defaultExecutor,
  }
  const trace: StepOutcome[] = []
  let current = applyEvent(record, "start") // CREATED -> PLANNING

  // FIFO dispatch: the scheduler plan orders step keys by release batch (one
  // step per batch at concurrency 1). The simulated core executes batches in
  // order, members sequentially; a live executor could dispatch a batch
  // concurrently while keeping the trace order deterministic.
  const ordered = planBatches(options.workflow.steps, options.concurrency ?? 1).flat()
  const byKey = new Map(options.workflow.steps.map((step) => [stepKey(step), step] as const))
  const orderedSteps = ordered.map((key) => byKey.get(key)).filter((step): step is WorkflowStep => step !== undefined)

  const at = options.at
  for (const step of orderedSteps) {
    const attempt = runStep(current, step, run)
    trace.push(attempt.outcome)
    current = attempt.record
    if (attempt.outcome.status === "failed") {
      const onFailure = options.workflow.onFailure ?? []
      if (onFailure.length === 0) {
        current = applyEvent(current, "fail", at) // BLOCKED -> FAILED
        break
      }
      const recovery = runRecovery(current, onFailure, run, at)
      trace.push(...recovery.trace)
      current = recovery.record
      break
    }
  }

  // All steps succeeded but no `complete` event fired yet (the last `step-ok`
  // leaves the run in the final activity phase) — close it out.
  if (current.state !== "COMPLETED" && current.state !== "FAILED") {
    current = applyEvent(current, "complete", at)
  }
  return { record: current, trace }
})

export * as Runner from "./runner"