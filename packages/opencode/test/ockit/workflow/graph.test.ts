import { describe, expect } from "bun:test"
import { it } from "../../lib/effect"
import { Cause, Effect } from "effect"
import type { Kit, Workflow } from "../../../src/ockit/types"
import { indexKit } from "../../../src/ockit/resolver"
import { validateGraph, WorkflowError } from "../../../src/ockit/workflow/graph"

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
    { id: "fix", description: "Fix the defect" },
  ],
  workflows: [],
}

/** Validate a workflow against the fixture index, returning its Exit. */
function validateExit(workflow: Workflow) {
  return validateGraph(workflow, indexKit(KIT)).pipe(Effect.exit)
}

describe("ockit workflow graph", () => {
  it.effect("accepts a workflow whose steps all resolve", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({ id: "feature-development", steps: (KIT.skills ?? []).map((s) => ({ skill: s.id })) })
      expect(exit._tag).toBe("Success")
    }))

  it.effect("rejects a step that references an undeclared skill", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({ id: "ship", steps: [{ skill: "plan" }, { skill: "ghost-skill" }] })
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(WorkflowError)
        expect((error as WorkflowError).kind).toBe("unknown-step")
        expect((error as WorkflowError).workflowId).toBe("ship")
        expect((error as WorkflowError).step).toBe("ghost-skill")
      }
    }))

  it.effect("rejects an onFailure id that resolves to no declared skill", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({
        id: "ship",
        steps: [{ skill: "plan" }],
        onFailure: ["fix", "missing-handler"],
      })
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(WorkflowError)
        expect((error as WorkflowError).kind).toBe("unknown-onfailure")
        expect((error as WorkflowError).step).toBe("missing-handler")
      }
    }))

  it.effect("rejects duplicate as aliases within one workflow", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({
        id: "ship",
        steps: [
          { skill: "plan", as: "step-one" },
          { skill: "implement", as: "step-one" },
        ],
      })
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(WorkflowError)
        expect((error as WorkflowError).kind).toBe("duplicate-alias")
        expect((error as WorkflowError).step).toBe("step-one")
      }
    }))

  it.effect("rejects a step that would re-enter the workflow itself", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({ id: "ship", steps: [{ skill: "plan", as: "ship" }] })
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(WorkflowError)
        expect((error as WorkflowError).kind).toBe("cycle")
      }
    }))

  it.effect("same skill used twice with distinct aliases is allowed", () =>
    Effect.gen(function* () {
      const exit = yield* validateExit({
        id: "double",
        steps: [
          { skill: "test", as: "unit" },
          { skill: "test", as: "integration" },
        ],
      })
      expect(exit._tag).toBe("Success")
    }))
})