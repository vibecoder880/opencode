import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { validateKit } from "../../src/ockit/validator"
import type { Kit } from "../../src/ockit/types"

const VALID_KIT: Kit = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
  agents: [{ id: "planner", role: "plans", skills: ["plan"] }],
  workflows: [
    { id: "ship", steps: [{ skill: "plan" }] },
  ],
  hooks: [{ event: "post-edit", command: "echo ok" }],
}

describe("ockit validator", () => {
  it("passes a well-formed kit", async () => {
    const result = await Effect.runPromise(validateKit(VALID_KIT))
    expect(result.ok).toBe(true)
  })

  it("flags a workflow step that references an undeclared skill", async () => {
    const broken: Kit = {
      ...VALID_KIT,
      workflows: [{ id: "ship", steps: [{ skill: "missing-skill" }] }],
    }
    const result = await Effect.runPromise(validateKit(broken))
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ kind: "workflow", id: "ship" })
    expect(result.issues[0].message).toContain("missing-skill")
  })

  it("flags a duplicate skill id", async () => {
    const result = await Effect.runPromise(
      validateKit({ ...VALID_KIT, skills: [{ id: "plan" }, { id: "plan" }] }),
    )
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.kind === "skill" && i.id === "plan")).toBe(true)
  })

  it("flags an agent that references an undeclared skill", async () => {
    const broken: Kit = {
      ...VALID_KIT,
      agents: [{ id: "planner", role: "plans", skills: ["ghost-skill"] }],
    }
    const result = await Effect.runPromise(validateKit(broken))
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.kind === "agent" && i.id === "planner")).toBe(true)
  })

  it("flags a skill that references an undeclared agent", async () => {
    const broken: Kit = {
      ...VALID_KIT,
      skills: [{ id: "plan", description: "Plan", agent: "ghost-agent" }],
    }
    const result = await Effect.runPromise(validateKit(broken))
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.kind === "skill" && i.id === "plan")).toBe(true)
  })
})
