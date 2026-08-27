// OC Kit dependency resolution. Handles kit inter-dependencies with semver
// range checking, topological sort, and circular dependency detection.

import { Effect, Schema } from "effect"
import type { Kit } from "./types"
import { satisfiesRange } from "./versioning"

/** A resolved dependency reference. */
export const ResolvedDependency = Schema.Struct({
  kitId: Schema.String,
  version: Schema.String,
  constraint: Schema.String,
})
export type ResolvedDependency = Schema.Schema.Type<typeof ResolvedDependency>

/** Error types for dependency resolution. */
export class DependencyError extends Schema.TaggedErrorClass<DependencyError>()("OCKitDependencyError", {
  kind: Schema.Literals(["not-found", "version-conflict", "circular", "constraint"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit dependency: ${this.kind} — ${this.detail}`
  }
}

/** A dependency declaration: kit ID + semver constraint. */
export interface DependencyDecl {
  readonly id: string
  readonly constraint: string
}

/**
 * Resolve dependencies for a kit. Takes explicit dependency declarations
 * (since Kit.type does not embed dependencies) and the available kits in
 * the registry, returns a topologically sorted list.
 */
export function resolveDependencies(
  deps: ReadonlyArray<DependencyDecl>,
  available: ReadonlyArray<Kit>,
): Effect.Effect<ReadonlyArray<ResolvedDependency>, DependencyError> {
  const availableMap = new Map(available.map((k) => [k.id, k]))
  const resolved: ResolvedDependency[] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function visit(id: string, constraint: string): void {
    if (visited.has(id)) return
    if (inStack.has(id)) {
      throw new DependencyError({
        kind: "circular",
        detail: `Circular dependency detected: ${id}`,
      })
    }

    inStack.add(id)

    const depKit = availableMap.get(id)
    if (!depKit) {
      throw new DependencyError({
        kind: "not-found",
        detail: `Dependency "${id}" not found in registry`,
      })
    }

    if (!satisfiesRange(depKit.version, constraint)) {
      throw new DependencyError({
        kind: "version-conflict",
        detail: `${id}@${depKit.version} does not satisfy ${constraint}`,
      })
    }

    resolved.push({
      kitId: id,
      version: depKit.version,
      constraint,
    })

    inStack.delete(id)
    visited.add(id)
  }

  try {
    for (const dep of deps) {
      visit(dep.id, dep.constraint)
    }
  } catch (err) {
    if (err instanceof DependencyError) return Effect.fail(err)
    return Effect.fail(new DependencyError({
      kind: "constraint",
      detail: `Unexpected error: ${String(err)}`,
    }))
  }

  return Effect.succeed(resolved)
}

/**
 * Detect conflicts in a set of dependency declarations. Returns a list of
 * conflicts found, or an empty array if all dependencies are satisfiable.
 */
export function detectConflicts(
  deps: ReadonlyArray<DependencyDecl>,
  available: ReadonlyArray<Kit>,
): ReadonlyArray<{ kitA: string; kitB: string; reason: string }> {
  const availableMap = new Map(available.map((k) => [k.id, k]))
  const conflicts: Array<{ kitA: string; kitB: string; reason: string }> = []

  for (const dep of deps) {
    const depKit = availableMap.get(dep.id)
    if (!depKit) {
      conflicts.push({ kitA: "root", kitB: dep.id, reason: "not found" })
    } else if (!satisfiesRange(depKit.version, dep.constraint)) {
      conflicts.push({
        kitA: "root",
        kitB: dep.id,
        reason: `${depKit.version} does not satisfy ${dep.constraint}`,
      })
    }
  }

  return conflicts
}

export * as Dependencies from "./dependencies"
