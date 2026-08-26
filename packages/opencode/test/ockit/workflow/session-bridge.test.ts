import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import {
  triggerWorkflow,
  triggerAndReport,
  getSessionRuns,
  getSessionRun,
  clearSessionRuns,
  SessionBridgeError,
} from "../../../src/ockit/workflow/session-bridge"
import type { Kit, Workflow } from "../../../src/ockit/types"

const it = testEffect(Layer.empty)

const KIT: Kit = {
  id: "test-kit",
  name: "Test Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "skill-a", name: "Skill A", description: "Skill A" }],
  agents: [],
  hooks: [],
}

const WORKFLOW: Workflow = {
  id: "test-workflow",
  name: "Test Workflow",
  steps: [{ skill: "skill-a" }],
}

describe("session-bridge", () => {
  test("getSessionRuns returns empty array for unknown session", () => {
    expect(getSessionRuns("nonexistent")).toEqual([])
  })

  test("getSessionRun returns undefined for unknown run", () => {
    expect(getSessionRun("session-1", "nonexistent")).toBeUndefined()
  })

  it.effect("triggerWorkflow records a run and executes the workflow", () =>
    Effect.gen(function* () {
      const summary = yield* triggerWorkflow("session-1", KIT, WORKFLOW, {
        runId: "run-1",
        at: "2026-08-26T00:00:00Z",
      })

      expect(summary.workflowId).toBe("test-workflow")
      expect(summary.runId).toBe("run-1")
      expect(summary.state).toBe("COMPLETED")
      expect(summary.steps).toHaveLength(1)

      const runs = getSessionRuns("session-1")
      expect(runs).toHaveLength(1)
      expect(runs[0].runId).toBe("run-1")
      expect(runs[0].state).toBe("COMPLETED")
    }),
  )

  it.effect("triggerAndReport returns summary and message", () =>
    Effect.gen(function* () {
      const result = yield* triggerAndReport("session-2", KIT, WORKFLOW, {
        runId: "run-2",
        at: "2026-08-26T00:00:00Z",
      })

      expect(result.summary.state).toBe("COMPLETED")
      expect(result.message).toContain("✅")
      expect(result.message).toContain("test-workflow")
    }),
  )

  test("clearSessionRuns removes all runs for a session", () => {
    clearSessionRuns("session-1")
    expect(getSessionRuns("session-1")).toEqual([])
  })
})
