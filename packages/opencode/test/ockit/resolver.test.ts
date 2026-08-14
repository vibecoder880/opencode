import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../lib/effect"
import type { Kit } from "../../src/ockit/types"
import { indexKit, resolveFromKit, resolveAcross } from "../../src/ockit/resolver"

const kit: Kit = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
  agents: [{ id: "reviewer", role: "reviewer", tools: { write: false } }],
  workflows: [{ id: "feature-development", steps: [{ skill: "plan" }] }],
  hooks: [{ event: "workflow:start", command: "echo start" }],
}

describe("ockit resolver", () => {
  it.effect("indexes kit declarations by name", () =>
    Effect.sync(() => {
      const index = indexKit(kit)
      expect(index.skills.get("plan")?.description).toBe("Create an implementation plan")
      expect(index.agents.get("reviewer")?.role).toBe("reviewer")
      expect(index.workflows.get("feature-development")?.steps[0]?.skill).toBe("plan")
      expect(index.hooks.get("workflow:start")?.command).toBe("echo start")
    }))

  it.effect("resolves an existing declaration", () =>
    Effect.sync(() => {
      const index = indexKit(kit)
      expect(resolveFromKit(index, "skills", "plan")?.id).toBe("plan")
    }))

  it.effect("throws ResolveError for a missing declaration", () =>
    Effect.sync(() => {
      const index = indexKit(kit)
      expect(() => resolveFromKit(index, "skills", "missing")).toThrow("no skill \"missing\"")
    }))

  it.effect("resolves across multiple kits, first match wins", () =>
    Effect.gen(function* () {
      const other: Kit = {
        id: "security",
        name: "OC Security Kit",
        version: "1.0.0",
        skills: [{ id: "security", description: "Audit" }],
      }
      const found = yield* Effect.promise(() => resolveAcross([other, kit], "skills", "security"))
      expect(found?.kit.id).toBe("security")
      const plan = yield* Effect.promise(() => resolveAcross([other, kit], "workflows", "feature-development"))
      expect(plan?.kit.id).toBe("engineer")
    }))

  it.effect("returns undefined when no kit declares the id", () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => resolveAcross([kit], "skills", "nope"))
      expect(result).toBeUndefined()
    }))
})
