import { describe, expect, test } from "bun:test"
import { routeWorkflow, selectFallback } from "../../../src/ockit/orchestrator/router"
import { classifyIntent } from "../../../src/ockit/orchestrator/intent"
import { indexKit } from "../../../src/ockit/resolver"
import type { Kit } from "../../../src/ockit/types"

const BUGFIX_KIT: Kit = {
  id: "test-kit",
  name: "Test Kit",
  version: "1.0.0",
  skills: [
    { id: "fix-skill", description: "Fix bugs" },
    { id: "review-skill", description: "Review code" },
  ],
  workflows: [
    { id: "bug-fix", description: "Fix bugs and issues", steps: [{ skill: "fix-skill" }] },
    { id: "code-review", description: "Review code quality", steps: [{ skill: "review-skill" }] },
  ],
}

const SINGLE_WORKFLOW_KIT: Kit = {
  id: "single-kit",
  name: "Single Kit",
  version: "1.0.0",
  workflows: [
    { id: "only-workflow", steps: [{ skill: "s1" }] },
  ],
}

const EMPTY_KIT: Kit = {
  id: "empty-kit",
  name: "Empty Kit",
  version: "1.0.0",
}

describe("workflow router", () => {
  test("uses single workflow unconditionally", () => {
    const intent = classifyIntent("fix the bug")
    const index = indexKit(SINGLE_WORKFLOW_KIT)
    const result = routeWorkflow(intent, index)

    expect(result.workflow?.id).toBe("only-workflow")
    expect(result.reason).toBe("single-workflow")
  })

  test("routes bugfix intent to bug-fix workflow", () => {
    const intent = classifyIntent("fix the crash in payment")
    const index = indexKit(BUGFIX_KIT)
    const result = routeWorkflow(intent, index)

    expect(result.workflow?.id).toBe("bug-fix")
    expect(result.reason).toBe("best-match")
  })

  test("routes review intent to code-review workflow", () => {
    const intent = classifyIntent("review the pull request")
    const index = indexKit(BUGFIX_KIT)
    const result = routeWorkflow(intent, index)

    expect(result.workflow?.id).toBe("code-review")
  })

  test("returns no-match when no workflows exist", () => {
    const intent = classifyIntent("fix the bug")
    const index = indexKit(EMPTY_KIT)
    const result = routeWorkflow(intent, index)

    expect(result.workflow).toBeUndefined()
    expect(result.reason).toBe("no-match")
  })

  test("includes all candidate workflow ids", () => {
    const intent = classifyIntent("fix the bug")
    const index = indexKit(BUGFIX_KIT)
    const result = routeWorkflow(intent, index)

    expect(result.candidates).toContain("bug-fix")
    expect(result.candidates).toContain("code-review")
  })
})

describe("selectFallback", () => {
  test("returns first workflow when available", () => {
    const index = indexKit(BUGFIX_KIT)
    const fallback = selectFallback(index)
    expect(fallback?.id).toBe("bug-fix")
  })

  test("returns undefined for empty kit", () => {
    const index = indexKit(EMPTY_KIT)
    const fallback = selectFallback(index)
    expect(fallback).toBeUndefined()
  })
})
