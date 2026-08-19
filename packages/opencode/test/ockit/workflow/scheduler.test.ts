import { describe, expect } from "bun:test"
import type { WorkflowStep } from "../../../src/ockit/types"
import { planBatches, peek } from "../../../src/ockit/workflow/scheduler"

const steps: ReadonlyArray<WorkflowStep> = [
  { skill: "a" },
  { skill: "b", as: "bee" },
  { skill: "c" },
]

describe("ockit workflow scheduler", () => {
  it("plans strict FIFO (one step per batch) at concurrency 1", () => {
    expect(planBatches(steps, 1)).toEqual([["a"], ["bee"], ["c"]])
  })

  it("groups head-of-line steps under higher concurrency", () => {
    expect(planBatches(steps, 2)).toEqual([["a", "bee"], ["c"]])
    expect(planBatches(steps, 10)).toEqual([["a", "bee", "c"]])
  })

  it("clamps concurrency to at least 1", () => {
    expect(planBatches(steps, 0)).toEqual(planBatches(steps, 1))
  })

  it("preserves declaration order regardless of batch width", () => {
    for (const concurrency of [1, 2, 3, 10]) {
      expect(planBatches(steps, concurrency).flat()).toEqual(["a", "bee", "c"])
    }
  })

  it("peeks the first step key", () => {
    expect(peek(steps)).toBe("a")
    expect(peek([])).toBeUndefined()
  })
})