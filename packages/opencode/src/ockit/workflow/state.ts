// OC Kit workflow run state. A pure state machine over the shared `WorkflowState`
// literals: a deterministic `(state, event) -> state` transition function that
// throws a typed `IllegalTransitionError` on any transition the machine does not
// define. Also defines the run record the engine carries through a run and the
// canonical per-step key (`as ?? skill`) shared by the graph validator and runner.

import type { WorkflowStep, WorkflowState } from "../types"

/** Events the state machine accepts. */
export type StateEvent = "start" | "step-ok" | "step-fail" | "retry" | "complete" | "fail" | "cancel"

/** Typed error raised on an illegal (undefined) transition. */
export class IllegalTransitionError extends Error {
  readonly _tag = "WorkflowIllegalTransition" as const
  constructor(
    readonly from: WorkflowState,
    readonly event: StateEvent,
  ) {
    super(`Illegal workflow transition: ${from} --${event}--> ?`)
  }
}

/**
 * Transition table: which `(state, event)` pairs are legal, and where they lead.
 * The activity phases (`PLANNING` → `VERIFYING`) are walked one `step-ok` at a
 * time; once a workflow has more steps than distinct phase labels the final
 * activity state (`VERIFYING`) self-loops until the run completes. The exact
 * phase labels carry no execution semantics — the runner drives them purely
 * from the declared steps.
 */
const NEXT: Record<WorkflowState, Partial<Record<StateEvent, WorkflowState>>> = {
  CREATED: { start: "PLANNING", cancel: "CANCELLED", fail: "FAILED" },
  PLANNING: {
    "step-ok": "IMPLEMENTING",
    "step-fail": "BLOCKED",
    retry: "PLANNING",
    complete: "COMPLETED",
    fail: "FAILED",
    cancel: "CANCELLED",
  },
  IMPLEMENTING: {
    "step-ok": "TESTING",
    "step-fail": "BLOCKED",
    retry: "IMPLEMENTING",
    complete: "COMPLETED",
    fail: "FAILED",
    cancel: "CANCELLED",
  },
  TESTING: {
    "step-ok": "REVIEWING",
    "step-fail": "BLOCKED",
    retry: "TESTING",
    complete: "COMPLETED",
    fail: "FAILED",
    cancel: "CANCELLED",
  },
  REVIEWING: {
    "step-ok": "VERIFYING",
    "step-fail": "BLOCKED",
    retry: "REVIEWING",
    complete: "COMPLETED",
    fail: "FAILED",
    cancel: "CANCELLED",
  },
  // Steps beyond the distinct phase labels keep the run in `VERIFYING`; the
  // engine finishes with `complete`.
  VERIFYING: {
    "step-ok": "VERIFYING",
    "step-fail": "BLOCKED",
    retry: "VERIFYING",
    complete: "COMPLETED",
    fail: "FAILED",
    cancel: "CANCELLED",
  },
  // The run is blocked waiting for recovery (onFailure) or an explicit retry.
  BLOCKED: { retry: "PLANNING", complete: "COMPLETED", fail: "FAILED", cancel: "CANCELLED" },
  COMPLETED: {},
  FAILED: {},
  CANCELLED: {},
}

/**
 * Pure reducer: `(state, event) -> next state`. Throws `IllegalTransitionError`
 * when the machine defines no transition for the pair. Side-effect-free.
 */
export function transition<const S extends WorkflowState>(state: S, event: StateEvent): WorkflowState {
  const next = NEXT[state][event as StateEvent]
  if (next === undefined) throw new IllegalTransitionError(state, event)
  return next
}

/** The canonical key a step is traced under: its `as` alias, else its skill id. */
export function stepKey(step: WorkflowStep): string {
  return step.as ?? step.skill
}

/** Run record carried through a workflow run (extends, rather than changes, `types.ts`). */
export interface WorkflowRunRecord {
  readonly runId: string
  readonly workflowId: string
  readonly sessionId: string
  readonly stepIndex: number
  readonly state: WorkflowState
  readonly recovered: boolean
  readonly startedAt: string
  readonly completedAt?: string
}

/** Create a run record in its initial `CREATED` state. */
export function createRecord(input: {
  readonly runId: string
  readonly workflowId: string
  readonly sessionId: string
  readonly at?: string
}): WorkflowRunRecord {
  return {
    runId: input.runId,
    workflowId: input.workflowId,
    sessionId: input.sessionId,
    stepIndex: 0,
    state: "CREATED",
    recovered: false,
    startedAt: input.at ?? new Date().toISOString(),
  }
}

/**
 * Apply an event to a run record: advances the state via `transition`, bumps
 * `stepIndex` on `step-ok`, and stamps `completedAt` on a terminal state.
 * Pure; throws `IllegalTransitionError` on illegal events. `at` is the optional
 * deterministic timestamp to stamp when the run terminates (defaults to the
 * wall clock so callers that never pass a clock still get an ISO timestamp).
 */
export function applyEvent(record: WorkflowRunRecord, event: StateEvent, at?: string): WorkflowRunRecord {
  const state = transition(record.state, event)
  const stepIndex = event === "step-ok" ? record.stepIndex + 1 : record.stepIndex
  const terminal = state === "COMPLETED" || state === "FAILED" || state === "CANCELLED"
  return {
    ...record,
    state,
    stepIndex,
    completedAt: terminal ? record.completedAt ?? at ?? new Date().toISOString() : record.completedAt,
  }
}

export * as State from "./state"