import { describe, expect, test } from "bun:test"
import { selectAgentForSkill, assignAgents } from "../../../src/ockit/orchestrator/selector"
import { indexKit } from "../../../src/ockit/resolver"
import type { Kit } from "../../../src/ockit/types"

const KIT_WITH_AGENTS: Kit = {
  id: "test-kit",
  name: "Test Kit",
  version: "1.0.0",
  skills: [
    { id: "code-skill", description: "Write code", agent: "coder-agent" },
    { id: "debug-skill", description: "Debug issues" },
    { id: "test-skill", description: "Run tests" },
  ],
  agents: [
    { id: "coder-agent", role: "coder", skills: ["code-skill"] },
    { id: "debugger-agent", role: "debugger", skills: ["debug-skill"] },
    { id: "tester-agent", role: "tester", skills: ["test-skill"] },
  ],
  workflows: [
    {
      id: "main-workflow",
      steps: [
        { skill: "code-skill" },
        { skill: "debug-skill" },
        { skill: "test-skill" },
      ],
    },
  ],
}

const KIT_NO_AGENTS: Kit = {
  id: "no-agent-kit",
  name: "No Agent Kit",
  version: "1.0.0",
  skills: [
    { id: "s1", description: "Some skill" },
  ],
  workflows: [
    { id: "w1", steps: [{ skill: "s1" }] },
  ],
}

describe("agent selector", () => {
  test("uses skill-declared agent when available", () => {
    const kitIndex = indexKit(KIT_WITH_AGENTS)
    const skill = kitIndex.skills.get("code-skill")!
    const assignment = selectAgentForSkill(skill, kitIndex)

    expect(assignment.agentId).toBe("coder-agent")
    expect(assignment.source).toBe("skill-declaration")
  })

  test("falls back to role-match for undeclared skills", () => {
    const kitIndex = indexKit(KIT_WITH_AGENTS)
    const skill = kitIndex.skills.get("debug-skill")!
    const assignment = selectAgentForSkill(skill, kitIndex)

    expect(assignment.agentId).toBe("debugger-agent")
    expect(assignment.source).toBe("role-match")
  })

  test("falls back to kit-default when no match", () => {
    const kitIndex = indexKit(KIT_WITH_AGENTS)
    // Create a skill with no matching agent
    const skill = { id: "mystery-skill", description: "Do something unknown" }
    const assignment = selectAgentForSkill(skill, kitIndex)

    expect(assignment.agentId).toBeDefined()
    expect(assignment.source).toBe("kit-default")
  })

  test("returns none when kit has no agents", () => {
    const kitIndex = indexKit(KIT_NO_AGENTS)
    const skill = kitIndex.skills.get("s1")!
    const assignment = selectAgentForSkill(skill, kitIndex)

    expect(assignment.agentId).toBeUndefined()
    expect(assignment.source).toBe("none")
  })

  test("assigns agents to all workflow steps", () => {
    const kitIndex = indexKit(KIT_WITH_AGENTS)
    const workflow = kitIndex.workflows.get("main-workflow")!
    const assignments = assignAgents(workflow, kitIndex)

    expect(assignments.size).toBe(3)
    expect(assignments.get("code-skill")?.agentId).toBe("coder-agent")
    expect(assignments.get("debug-skill")?.agentId).toBe("debugger-agent")
    expect(assignments.get("test-skill")?.agentId).toBe("tester-agent")
  })
})
