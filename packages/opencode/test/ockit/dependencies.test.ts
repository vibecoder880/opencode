import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { resolveDependencies, detectConflicts, DependencyError } from "../../src/ockit/dependencies"
import type { Kit } from "../../src/ockit/types"

const it = testEffect(Layer.empty)

const KIT_A: Kit = {
  id: "kit-a",
  name: "Kit A",
  version: "1.0.0",
  runtime: "opencode",
  skills: [],
  agents: [],
  hooks: [],
  dependencies: ["kit-b"],
}

const KIT_B: Kit = {
  id: "kit-b",
  name: "Kit B",
  version: "2.0.0",
  runtime: "opencode",
  skills: [],
  agents: [],
  hooks: [],
}

const KIT_C: Kit = {
  id: "kit-c",
  name: "Kit C",
  version: "3.0.0",
  runtime: "opencode",
  skills: [],
  agents: [],
  hooks: [],
  dependencies: ["kit-a"],
}

describe("dependencies", () => {
  it.effect("resolveDependencies resolves simple dependency", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(KIT_A, [KIT_A, KIT_B])
      expect(result).toHaveLength(1)
      expect(result[0].kitId).toBe("kit-b")
    }),
  )

  it.effect("resolveDependencies handles transitive dependencies", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(KIT_C, [KIT_A, KIT_B, KIT_C])
      expect(result).toHaveLength(2) // kit-a and kit-b
      expect(result[0].kitId).toBe("kit-b")
      expect(result[1].kitId).toBe("kit-a")
    }),
  )

  it.effect("resolveDependencies fails on missing dependency", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(KIT_A, [KIT_A]).pipe(
        Effect.flip,
      )
      expect(result.kind).toBe("not-found")
    }),
  )

  test("detectConflicts finds version conflicts", () => {
    const kitWithBadDep: Kit = {
      id: "kit-d",
      name: "Kit D",
      version: "1.0.0",
      runtime: "opencode",
      skills: [],
      agents: [],
      hooks: [],
      dependencies: [{ kitId: "kit-b", constraint: "^5.0.0" }],
    }

    const conflicts = detectConflicts([kitWithBadDep, KIT_B])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toContain("does not satisfy")
  })

  test("detectConflicts finds missing dependencies", () => {
    const kitWithMissing: Kit = {
      id: "kit-e",
      name: "Kit E",
      version: "1.0.0",
      runtime: "opencode",
      skills: [],
      agents: [],
      hooks: [],
      dependencies: ["nonexistent"],
    }

    const conflicts = detectConflicts([kitWithMissing])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe("not found")
  })

  test("detectConflicts returns empty for valid dependencies", () => {
    const conflicts = detectConflicts([KIT_A, KIT_B])
    expect(conflicts).toHaveLength(0)
  })
})
