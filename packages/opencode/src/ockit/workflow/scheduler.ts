// OC Kit workflow step scheduler. Deterministic FIFO ordering of skill steps
// with an optional max-concurrency bound: steps are dispatched in declaration
// order, oldest first, `concurrency` at a time. Pure — no I/O, no clock — so it
// is trivially unit-testable.

import type { WorkflowStep } from "../types"
import { stepKey } from "./state"

/** The resolved key of the first step the runner should attempt. */
export function peek(steps: ReadonlyArray<WorkflowStep>): string | undefined {
  const first = steps[0]
  return first ? stepKey(first) : undefined
}

/**
 * Deterministic FIFO dispatch plan for `steps` under `concurrency`: returns the
 * batches in release order, each holding the resolved step keys dispatched
 * together. A concurrency of 1 yields one step per batch (strict sequence);
 * higher values dispatch that many head-of-line steps per batch.
 */
export function planBatches(steps: ReadonlyArray<WorkflowStep>, concurrency: number): ReadonlyArray<ReadonlyArray<string>> {
  const limit = Math.max(1, concurrency)
  const batches: string[][] = []
  const queue = steps.map(stepKey)
  while (queue.length > 0) {
    batches.push(queue.splice(0, limit))
  }
  return batches
}

export * as Scheduler from "./scheduler"