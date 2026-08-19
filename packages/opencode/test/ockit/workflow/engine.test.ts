import { describe, expect } from "bun:test"
import { it } from "../../lib/effect"
import { Cause, Effect } from "effect"
import type { Kit, Workflow } from "../../../src/ockit/types"
import { runWorkflow, runIdFor, type RunSummary } from "../../../src/ockit/workflow/engine"
import { WorkflowError } from "../../../src/ockit/workflow/graph"
import type { StepExecutor } from "../../../src/ockit/workflow/runner"

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

/** Executor that fails `skill` a fixed number of times then succeeds. */
function failTimes(skill: string, times: number): StepExecutor {
  let failures = times
  return (input) => {
    if (input.step.skill === skill && failures > 0) {
      failures -= 1
      return { ok: false, reason: `simulated failure of ${skill}` }
    }
    return { ok: true }
  }
}

describe("ockit workflow engine", () => {
  it.effect("returns a deterministic RunSummary for feature-development", () =>
    Effect.gen(function* () {
      const at = "2026-08-20T00:00:00.000Z"
      const summary = yield* runWorkflow({
        kit: KIT,
        workflow: FEATURE,
        sessionId: "s1",
        runId: "custom-run",
        at,
      })
      expect(summary).toMatchObject({
        workflowId: "feature-development",
        runId: "custom-run",
        state: "COMPLETED",
        recovered: false,
        startedAt: at,
        completedAt: at,
      })
      expect(summary).toHaveProperty("steps")
      expect(summary.steps.map((o) => o.skill)).toEqual(
        FEATURE.steps.map((s) => s.skill),
      )
    }))

  it.effect("runs bug-fix end-to-end to COMPLETED", () =>
    Effect.gen(function* () {
      const summary = yield* runWorkflow({ kit: KIT, workflow: BUGFIX, sessionId: "s1" })
      expect(summary.state).toBe("COMPLETED")
      expect(summary.recovered).toBe(false)
      expect(summary.steps).toHaveLength(7)
      expect(summary.steps[0]?.skill).toBe("reproduce")
      expect(summary.steps[6]?.skill).toBe("review")
    }))

  it.effect("recovers via onFailure and completes with recovered: true", () =>
    Effect.gen(function* () {
      const withRecovery = { ...FEATURE, onFailure: ["fix"] }
      const summary = yield* runWorkflow({
        kit: KIT,
        workflow: withRecovery,
        maxRetries: 1,
        executor: failTimes("test", 2), // exhausts the budget once
      })
      expect(summary.state).toBe("COMPLETED")
      expect(summary.recovered).toBe(true)
      const fix = summary.steps.find((o) => o.skill === "fix")
      expect(fix?.status).toBe("recovered")
    }))

  it.effect("ends FAILED when onFailure also fails", () =>
    Effect.gen(function* () {
      const withRecovery = { ...FEATURE, onFailure: ["fix"] }
      const alwaysFail: StepExecutor = (input) => ({
        ok: false,
        reason: `simulated failure of ${input.step.skill}`,
      })
      const summary = yield* runWorkflow({
        kit: KIT,
        workflow: withRecovery,
        maxRetries: 1,
        executor: alwaysFail,
      })
      expect(summary.state).toBe("FAILED")
      expect(summary.recovered).toBe(false)
    }))

  it.effect("fails with a typed WorkflowError on an unknown step", () =>
    Effect.gen(function* () {
      const broken: Workflow = { id: "broken", steps: [{ skill: "ghost-skill" }] }
      const exit = yield* runWorkflow({ kit: KIT, workflow: broken, sessionId: "s1" }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(WorkflowError)
        expect((error as WorkflowError).kind).toBe("unknown-step")
        expect((error as WorkflowError).workflowId).toBe("broken")
      }
    }))

  it.effect("derives a deterministic run id from the workflow", () =>
    Effect.sync(() => {
      expect(runIdFor(FEATURE)).toBe("feature-development-6")
      expect(runIdFor(BUGFIX)).toBe("bug-fix-7")
    }))

  it.effect("summary fields are stable across runs (deterministic)", () =>
    Effect.gen(function* () {
      const at = "2026-08-20T00:00:00.000Z"
      const a = yield* runWorkflow({ kit: KIT, workflow: FEATURE, sessionId: "s", runId: "r", at })
      const b = yield* runWorkflow({ kit: KIT, workflow: FEATURE, sessionId: "s", runId: "r", at })
      expect(a).toEqual(b)
      const _unused: RunSummary = a
    }))
})