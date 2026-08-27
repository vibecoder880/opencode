import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { orchestrate, preview, OrchestratorError } from "../../../src/ockit/orchestrator/orchestrator"
import type { Kit } from "../../../src/ockit/types"
import type { StepExecutor } from "../../../src/ockit/workflow/runner"

const SAMPLE_KIT: Kit = {
  id: "sample-kit",
  name: "Sample Kit",
  version: "1.0.0",
  skills: [
    { id: "code-skill", description: "Write code" },
    { id: "test-skill", description: "Run tests" },
  ],
  agents: [
    { id: "coder", role: "coder", skills: ["code-skill"] },
    { id: "tester", role: "tester", skills: ["test-skill"] },
  ],
  workflows: [
    {
      id: "bug-fix",
      description: "Fix bugs and issues",
      steps: [
        { skill: "code-skill", as: "fix" },
        { skill: "test-skill", as: "verify" },
      ],
    },
    {
      id: "feature-dev",
      description: "Develop new features",
      steps: [{ skill: "code-skill" }],
    },
  ],
}

const EMPTY_KIT: Kit = {
  id: "empty-kit",
  name: "Empty Kit",
  version: "1.0.0",
}

const SINGLE_WORKFLOW_KIT: Kit = {
  id: "single-kit",
  name: "Single Kit",
  version: "1.0.0",
  workflows: [
    { id: "only", steps: [{ skill: "s1" }] },
  ],
}

const noopExecutor: StepExecutor = () => ({ ok: true })

describe("orchestrator.preview", () => {
  test("returns intent, routing, agents, permissions", () => {
    const result = preview("fix the login bug", SAMPLE_KIT)

    expect(result.intent.category).toBe("bugfix")
    expect(result.routing.workflow?.id).toBe("bug-fix")
    expect(result.agents.size).toBe(2)
    expect(result.permissions.size).toBe(2)
  })

  test("routes feature intent to feature-dev workflow", () => {
    const result = preview("add a new search feature", SAMPLE_KIT)
    expect(result.routing.workflow?.id).toBe("feature-dev")
  })

  test("handles empty kit gracefully", () => {
    const result = preview("fix the bug", EMPTY_KIT)
    expect(result.routing.workflow).toBeUndefined()
    expect(result.agents.size).toBe(0)
  })

  test("uses single workflow unconditionally", () => {
    const result = preview("anything", SINGLE_WORKFLOW_KIT)
    expect(result.routing.workflow?.id).toBe("only")
    expect(result.routing.reason).toBe("single-workflow")
  })
})

describe("orchestrator.orchestrate", () => {
  test("executes workflow with noop executor", async () => {
    const result = await Effect.runPromise(
      orchestrate({
        request: "fix the login bug",
        kit: SAMPLE_KIT,
        executor: noopExecutor,
      }),
    )

    expect(result.intent.category).toBe("bugfix")
    expect(result.routing.workflow?.id).toBe("bug-fix")
    expect(result.run).toBeDefined()
    expect(result.run?.state).toBe("COMPLETED")
    expect(result.stepCount).toBe(2)
    expect(result.requestId).toMatch(/^req-/)
  })

  test("returns error for empty kit with no workflows", async () => {
    const exit = await Effect.runPromiseExit(
      orchestrate({
        request: "fix the bug",
        kit: EMPTY_KIT,
        executor: noopExecutor,
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(OrchestratorError)
      expect((error as OrchestratorError).kind).toBe("no-workflow")
    }
  })

  test("respects workflowId override", async () => {
    const result = await Effect.runPromise(
      orchestrate({
        request: "anything",
        kit: SAMPLE_KIT,
        workflowId: "feature-dev",
        executor: noopExecutor,
      }),
    )

    expect(result.routing.workflow?.id).toBe("feature-dev")
  })

  test("respects category override", async () => {
    const result = await Effect.runPromise(
      orchestrate({
        request: "anything",
        kit: SAMPLE_KIT,
        category: "security",
        executor: noopExecutor,
      }),
    )

    expect(result.intent.category).toBe("security")
    expect(result.intent.confidence).toBe(1)
  })

  test("assigns correct agents", async () => {
    const result = await Effect.runPromise(
      orchestrate({
        request: "fix the login bug",
        kit: SAMPLE_KIT,
        executor: noopExecutor,
      }),
    )

    const fixAgent = result.agents.get("fix")
    expect(fixAgent?.agentId).toBe("coder")

    const verifyAgent = result.agents.get("verify")
    expect(verifyAgent?.agentId).toBe("tester")
  })
})
