import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import {
  resolveDependencies,
  detectConflicts,
  DependencyError,
  type DependencyDecl,
} from "../../src/ockit/dependencies"
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

const DEPS_A: DependencyDecl[] = [{ id: "kit-b", constraint: "^2.0.0" }]
const DEPS_C: DependencyDecl[] = [
  { id: "kit-a", constraint: "^1.0.0" },
  { id: "kit-b", constraint: "^2.0.0" },
]

describe("dependencies", () => {
  it.effect("resolveDependencies resolves simple dependency", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(DEPS_A, [KIT_A, KIT_B])
      expect(result).toHaveLength(1)
      expect(result[0].kitId).toBe("kit-b")
    }),
  )

  it.effect("resolveDependencies fails on missing dependency", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(DEPS_A, [KIT_A]).pipe(
        Effect.flip,
      )
      expect(result.kind).toBe("not-found")
    }),
  )

  it.effect("resolveDependencies fails on version conflict", () =>
    Effect.gen(function* () {
      const result = yield* resolveDependencies(
        [{ id: "kit-b", constraint: "^5.0.0" }],
        [KIT_B],
      ).pipe(Effect.flip)
      expect(result.kind).toBe("version-conflict")
    }),
  )

  test("detectConflicts finds version conflicts", () => {
    const conflicts = detectConflicts(
      [{ id: "kit-b", constraint: "^5.0.0" }],
      [KIT_B],
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toContain("does not satisfy")
  })

  test("detectConflicts finds missing dependencies", () => {
    const conflicts = detectConflicts(
      [{ id: "nonexistent", constraint: "^1.0.0" }],
      [],
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe("not found")
  })

  test("detectConflicts returns empty for valid dependencies", () => {
    const conflicts = detectConflicts(DEPS_A, [KIT_A, KIT_B])
    expect(conflicts).toHaveLength(0)
  })
})
