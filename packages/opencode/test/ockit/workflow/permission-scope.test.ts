import { describe, expect, test } from "bun:test"
import {
  resolveStepPermissions,
  isToolAllowed,
  isAgentAllowed,
  filterAllowedTools,
  filterAllowedAgents,
} from "../../../src/ockit/workflow/permission-scope"
import type { Kit, WorkflowStep } from "../../../src/ockit/types"

const BASE_KIT: Kit = {
  id: "test-kit",
  name: "Test Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [
    { id: "skill-a", description: "Skill A" },
    { id: "skill-b", description: "Skill B", permissions: { allowedTools: ["read", "write"], timeout: 30 } },
  ],
  agents: [],
  hooks: [],
}

const STEP_A: WorkflowStep = { run: "skill-a" }
const STEP_B: WorkflowStep = { run: "skill-b" }
const STEP_RESTRICTED: WorkflowStep = { run: "skill-a", allowedTools: ["read"], networkAccess: false }

describe("permission-scope", () => {
  test("resolveStepPermissions returns defaults when no permissions declared", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    expect(perms.allowedTools).toEqual([])
    expect(perms.allowedAgents).toEqual([])
    expect(perms.timeout).toBeUndefined()
    expect(perms.networkAccess).toBe(true)
  })

  test("resolveStepPermissions uses skill-level permissions", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(perms.allowedTools).toEqual(["read", "write"])
    expect(perms.timeout).toBe(30)
  })

  test("resolveStepPermissions allows step-level overrides", () => {
    const perms = resolveStepPermissions(STEP_RESTRICTED, BASE_KIT)
    expect(perms.allowedTools).toEqual(["read"])
    expect(perms.networkAccess).toBe(false)
  })

  test("isToolAllowed returns true when allowedTools is empty", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    expect(isToolAllowed("any-tool", perms)).toBe(true)
  })

  test("isToolAllowed returns true for listed tools", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(isToolAllowed("read", perms)).toBe(true)
    expect(isToolAllowed("write", perms)).toBe(true)
  })

  test("isToolAllowed returns false for unlisted tools", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(isToolAllowed("bash", perms)).toBe(false)
  })

  test("filterAllowedTools filters correctly", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    const filtered = filterAllowedTools(["read", "write", "bash", "edit"], perms)
    expect(filtered).toEqual(["read", "write"])
  })

  test("filterAllowedTools returns all when no restrictions", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    const filtered = filterAllowedTools(["read", "write", "bash"], perms)
    expect(filtered).toEqual(["read", "write", "bash"])
  })

  test("isAgentAllowed returns true when allowedAgents is empty", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    expect(isAgentAllowed("any-agent", perms)).toBe(true)
  })

  test("filterAllowedAgents filters correctly", () => {
    const perms: ReturnType<typeof resolveStepPermissions> = {
      allowedTools: [],
      allowedAgents: ["analyst"],
      timeout: undefined,
      networkAccess: true,
    }
    const filtered = filterAllowedAgents(["analyst", "researcher", "writer"], perms)
    expect(filtered).toEqual(["analyst"])
  })
})
