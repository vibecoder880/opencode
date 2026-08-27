import { describe, expect, test } from "bun:test"
import { classifyIntent, scoreWorkflowAffinity } from "../../../src/ockit/orchestrator/intent"

describe("intent classifier", () => {
  test("classifies feature requests", () => {
    const intent = classifyIntent("add a new login feature")
    expect(intent.category).toBe("feature")
    expect(intent.confidence).toBeGreaterThan(0.5)
    expect(intent.keywords.length).toBeGreaterThan(0)
  })

  test("classifies bug fix requests", () => {
    const intent = classifyIntent("fix the crash in the payment module")
    expect(intent.category).toBe("bugfix")
    expect(intent.confidence).toBeGreaterThan(0.5)
  })

  test("classifies refactor requests", () => {
    const intent = classifyIntent("refactor the authentication code to simplify it")
    expect(intent.category).toBe("refactor")
    expect(intent.confidence).toBeGreaterThan(0.5)
  })

  test("classifies review requests", () => {
    const intent = classifyIntent("review the pull request for security issues")
    expect(intent.category).toBe("review")
  })

  test("classifies test requests", () => {
    const intent = classifyIntent("write unit tests for the new module")
    expect(intent.category).toBe("test")
  })

  test("classifies research requests", () => {
    const intent = classifyIntent("research the best caching strategy")
    expect(intent.category).toBe("research")
  })

  test("classifies docs requests", () => {
    const intent = classifyIntent("write documentation for the API")
    expect(intent.category).toBe("docs")
  })

  test("classifies security requests", () => {
    const intent = classifyIntent("audit the code for security vulnerabilities")
    expect(intent.category).toBe("security")
  })

  test("classifies optimize requests", () => {
    const intent = classifyIntent("optimize the query performance")
    expect(intent.category).toBe("optimize")
  })

  test("classifies bootstrap requests", () => {
    const intent = classifyIntent("set up a new project with TypeScript")
    expect(intent.category).toBe("bootstrap")
  })

  test("defaults to feature for ambiguous input", () => {
    const intent = classifyIntent("hello world")
    expect(intent.category).toBe("feature")
    expect(intent.confidence).toBeLessThan(0.5)
  })

  test("preserves raw request", () => {
    const request = "fix the login bug"
    const intent = classifyIntent(request)
    expect(intent.rawRequest).toBe(request)
  })
})

describe("workflow affinity scoring", () => {
  test("scores workflows by keyword overlap", () => {
    const intent = classifyIntent("fix the login bug")
    const workflows = [
      { id: "feature-dev", description: "Develop new features" },
      { id: "bug-fix", description: "Fix bugs and issues" },
      { id: "code-review", description: "Review code quality" },
    ]

    const scored = scoreWorkflowAffinity(intent, workflows)
    expect(scored[0].workflowId).toBe("bug-fix")
    expect(scored[0].score).toBeGreaterThan(0)
  })

  test("returns empty scores for no match", () => {
    const intent = classifyIntent("hello")
    const workflows = [
      { id: "deploy", description: "Deploy to production" },
    ]

    const scored = scoreWorkflowAffinity(intent, workflows)
    expect(scored[0].score).toBe(0)
  })
})
