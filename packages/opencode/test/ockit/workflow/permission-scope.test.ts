import { describe, expect, test } from "bun:test"
import {
  resolveStepPermissions,
  isToolAllowed,
  filterAllowedTools,
} from "../../../src/ockit/workflow/permission-scope"
import type { Kit, WorkflowStep } from "../../../src/ockit/types"

const BASE_KIT: Kit = {
  id: "test-kit",
  name: "Test Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [
    { id: "skill-a", description: "Skill A" },
    { id: "skill-b", description: "Skill B", permissions: { read: "allow", write: "allow" } },
  ],
  agents: [],
  hooks: [],
}

const STEP_A: WorkflowStep = { skill: "skill-a" }
const STEP_B: WorkflowStep = { skill: "skill-b" }
const STEP_RESTRICTED: WorkflowStep = { skill: "skill-a" }

describe("permission-scope", () => {
  test("resolveStepPermissions returns empty permissions when no skill permissions declared", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    expect(perms.toolPermissions).toEqual({})
  })

  test("resolveStepPermissions uses skill-level permissions", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(perms.toolPermissions).toEqual({ read: "allow", write: "allow" })
  })

  test("isToolAllowed returns true when toolPermissions is empty", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    expect(isToolAllowed("any-tool", perms)).toBe(true)
  })

  test("isToolAllowed returns true for allowed tools", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(isToolAllowed("read", perms)).toBe(true)
    expect(isToolAllowed("write", perms)).toBe(true)
  })

  test("isToolAllowed returns true for unlisted tools (not explicitly denied)", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    expect(isToolAllowed("bash", perms)).toBe(true)
  })

  test("isToolAllowed returns false for denied tools", () => {
    const kitWithDeny: Kit = {
      id: "test-kit",
      name: "Test Kit",
      version: "1.0.0",
      runtime: "opencode",
      skills: [
        { id: "skill-c", permissions: { bash: "deny" } },
      ],
    }
    const step: WorkflowStep = { skill: "skill-c" }
    const perms = resolveStepPermissions(step, kitWithDeny)
    expect(isToolAllowed("bash", perms)).toBe(false)
  })

  test("filterAllowedTools filters correctly", () => {
    const perms = resolveStepPermissions(STEP_B, BASE_KIT)
    const filtered = filterAllowedTools(["read", "write", "bash", "edit"], perms)
    expect(filtered).toEqual(["read", "write", "bash", "edit"])
  })

  test("filterAllowedTools returns all when no restrictions", () => {
    const perms = resolveStepPermissions(STEP_A, BASE_KIT)
    const filtered = filterAllowedTools(["read", "write", "bash"], perms)
    expect(filtered).toEqual(["read", "write", "bash"])
  })

  test("resolveStepPermissions handles missing skills gracefully", () => {
    const step: WorkflowStep = { skill: "nonexistent" }
    const perms = resolveStepPermissions(step, BASE_KIT)
    expect(perms.toolPermissions).toEqual({})
  })
})
