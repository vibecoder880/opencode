import { describe, expect } from "bun:test"
import { it } from "../../lib/effect"
import { Effect } from "effect"
import type { Kit, Workflow } from "../../../src/ockit/types"
import { createRecord } from "../../../src/ockit/workflow/state"
import { runSteps, defaultExecutor, type StepExecutor } from "../../../src/ockit/workflow/runner"
import { indexKit } from "../../../src/ockit/resolver"
import { validateGraph } from "../../../src/ockit/workflow/graph"

const KIT: Kit = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [
    { id: "ask", description: "Clarify requirements" },
    { id: "plan", description: "Create a plan" },
    { id: "implement", description: "Write code" },
    { id: "test", description: "Run tests" },
    { id: "review", description: "Review changes" },
    { id: "verify", description: "Verify the outcome" },
    { id: "reproduce", description: "Reproduce a bug" },
    { id: "diagnose", description: "Diagnose a bug" },
    { id: "root-cause", description: "Root-cause analysis" },
    { id: "patch", description: "Patch the defect" },
    { id: "regression-check", description: "Check for regressions" },
    { id: "fix", description: "Apply a fix" },
  ],
  workflows: [],
}

const FEATURE: Workflow = {
  id: "feature-development",
  steps: [
    { skill: "ask" },
    { skill: "plan" },
    { skill: "implement" },
    { skill: "test" },
    { skill: "review" },
    { skill: "verify" },
  ],
}

const BUGFIX: Workflow = {
  id: "bug-fix",
  steps: [
    { skill: "reproduce" },
    { skill: "diagnose" },
    { skill: "root-cause" },
    { skill: "patch" },
    { skill: "test" },
    { skill: "regression-check" },
    { skill: "review" },
  ],
}

function record(workflow: Workflow) {
  return createRecord({ runId: "r", workflowId: workflow.id, sessionId: "s", at: "2026-08-20T00:00:00.000Z" })
}

/** Executor that fails `skill` the first `times` attempts, then succeeds. */
function failing(skill: string, times: number): StepExecutor {
  let failures = times
  return (input) => {
    if (input.step.skill === skill && failures > 0) {
      failures -= 1
      return { ok: false, reason: `simulated failure of ${skill}` }
    }
    return { ok: true }
  }
}

/** Executor that always fails the named skill; others succeed. */
function neverSucceeds(skill: string): StepExecutor {
  return (input) =>
    input.step.skill === skill
      ? { ok: false, reason: `simulated failure of ${skill}` }
      : { ok: true }
}

describe("ockit workflow runner", () => {
  it.effect("runs feature-development to COMPLETED with a per-step trace", () =>
    Effect.gen(function* () {
      const result = yield* runSteps(record(FEATURE), { workflow: FEATURE })
      expect(result.record.state).toBe("COMPLETED")
      expect(result.record.recovered).toBe(false)
      expect(result.trace.map((o) => o.skill)).toEqual(["ask", "plan", "implement", "test", "review", "verify"])
      for (const outcome of result.trace) {
        expect(outcome.status).toBe("ok")
        expect(outcome.attempts).toBe(1)
      }
    }))

  it.effect("runs bug-fix to COMPLETED with a per-step trace", () =>
    Effect.gen(function* () {
      const result = yield* runSteps(record(BUGFIX), { workflow: BUGFIX })
      expect(result.record.state).toBe("COMPLETED")
      expect(result.trace.map((o) => o.skill)).toEqual([
        "reproduce",
        "diagnose",
        "root-cause",
        "patch",
        "test",
        "regression-check",
        "review",
      ])
      expect(result.trace.every((o) => o.status === "ok")).toBe(true)
    }))

  it.effect("retries a step within its budget and records attempts", () =>
    Effect.gen(function* () {
      // The executor fails "plan" exactly once (attempt 0), then succeeds.
      const result = yield* runSteps(record(FEATURE), {
        workflow: FEATURE,
        maxRetries: 2,
        executor: failing("plan", 1),
      })
      expect(result.record.state).toBe("COMPLETED")
      const plan = result.trace.find((o) => o.skill === "plan")
      expect(plan?.status).toBe("ok")
      expect(plan?.attempts).toBe(2)
    }))

  it.effect("fails the run without an onFailure handler", () =>
    Effect.gen(function* () {
      const result = yield* runSteps(record(FEATURE), {
        workflow: FEATURE,
        maxRetries: 1,
        executor: neverSucceeds("implement"),
      })
      expect(result.record.state).toBe("FAILED")
      const implement = result.trace.find((o) => o.skill === "implement")
      expect(implement?.status).toBe("failed")
      expect(implement?.attempts).toBe(2) // original attempt + one retry
    }))

  it.effect("routes to onFailure and recovers when the handler succeeds", () =>
    Effect.gen(function* () {
      const withRecovery = { ...FEATURE, onFailure: ["fix"] }
      // `validateGraph` is the caller's job; the runner trusts its input.
      yield* validateGraph(withRecovery, indexKit(KIT))
      const result = yield* runSteps(record(withRecovery), {
        workflow: withRecovery,
        maxRetries: 1,
        executor: failing("implement", 99),
      })
      expect(result.record.state).toBe("COMPLETED")
      expect(result.record.recovered).toBe(true)
      const fix = result.trace.find((o) => o.skill === "fix")
      expect(fix?.status).toBe("recovered")
    }))

  it.effect("ends FAILED when onFailure also fails", () =>
    Effect.gen(function* () {
      const withRecovery = { ...FEATURE, onFailure: ["fix"] }
      yield* validateGraph(withRecovery, indexKit(KIT))
      const alwaysFail: StepExecutor = () => ({ ok: false, reason: "always fails" })
      const result = yield* runSteps(record(withRecovery), {
        workflow: withRecovery,
        maxRetries: 1,
        executor: alwaysFail,
      })
      expect(result.record.state).toBe("FAILED")
      expect(result.record.recovered).toBe(false)
      const last = result.trace[result.trace.length - 1]
      expect(last?.status).toBe("failed")
    }))

  it.effect("runs steps with the default executor (all succeed)", () =>
    Effect.gen(function* () {
      expect(defaultExecutor({ step: { skill: "anything" }, attempt: 0 })).toEqual({ ok: true })
      const result = yield* runSteps(record(FEATURE), { workflow: FEATURE })
      expect(result.record.state).toBe("COMPLETED")
    }))

  it.effect("preserves deterministic FIFO order under concurrency > 1", () =>
    Effect.gen(function* () {
      const result = yield* runSteps(record(FEATURE), { workflow: FEATURE, concurrency: 3 })
      expect(result.trace.map((o) => o.skill)).toEqual(["ask", "plan", "implement", "test", "review", "verify"])
    }))
})