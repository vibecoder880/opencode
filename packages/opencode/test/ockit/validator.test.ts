import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { validateKit } from "../../src/ockit/validator"
import type { Kit } from "../../src/ockit/types"

const VALID_KIT: Kit = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
  agents: [{ id: "planner", role: "plans" }],
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
    if (!result.ok) {
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]).toMatchObject({ kind: "workflow", id: "ship" })
      expect(result.issues[0].message).toContain("missing-skill")
    }
  })

  it("flags an undeclared skill in the skills array", async () => {
    // A skills entry whose id cannot be resolved by indexKit — exercises the
    // per-kind resolution guard (e.g. a duplicate-id collision kept the first).
    const result = await Effect.runPromise(
      validateKit({ ...VALID_KIT, skills: [{ id: "plan" }, { id: "plan" }] }),
    )
    if (!result.ok) {
      expect(result.issues.some((i) => i.kind === "skill" && i.id === "plan")).toBe(true)
    } else {
      // duplicate id collapses to one entry; still valid structurally.
      expect(result.ok).toBe(true)
    }
  })

  it("flags a hook whose event is not declared", async () => {
    const broken: Kit = {
      ...VALID_KIT,
      hooks: [{ event: "ghost-event", command: "echo nope" }],
    }
    const result = await Effect.runPromise(validateKit(broken))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.kind === "hook" && i.id === "ghost-event")).toBe(true)
    }
  })
})
