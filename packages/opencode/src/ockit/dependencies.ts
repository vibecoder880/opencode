// OC Kit dependency resolution. Handles kit inter-dependencies with semver
// range checking, topological sort, and circular dependency detection.

import { Schema } from "effect"
import type { Kit } from "./types"
import { parseVersion, compareVersions, satisfiesRange } from "./versioning"

/** A resolved dependency reference. */
export const ResolvedDependency = Schema.Struct({
  kitId: Schema.String,
  version: Schema.String,
  constraint: Schema.String,
})
export type ResolvedDependency = Schema.Schema.Type<typeof ResolvedDependency>

/** Dependency graph node. */
interface DepNode {
  id: string
  version: string
  dependencies: Array<{ id: string; constraint: string }>
}

/** Error types for dependency resolution. */
export class DependencyError extends Schema.TaggedErrorClass<DependencyError>()("OCKitDependencyError", {
  kind: Schema.Literals(["not-found", "version-conflict", "circular", "constraint"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit dependency: ${this.kind} — ${this.detail}`
  }
}

/**
 * Resolve dependencies for a kit. Takes the kit's dependency declarations
 * and the available kits in the registry, returns a topologically sorted list.
 */
export function resolveDependencies(
  kit: Kit,
  available: ReadonlyArray<Kit>,
): Effect.Effect<ReadonlyArray<ResolvedDependency>, DependencyError> {
  const availableMap = new Map(available.map((k) => [k.id, k]))
  const resolved: ResolvedDependency[] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function visit(node: DepNode): void {
    if (visited.has(node.id)) return
    if (inStack.has(node.id)) {
      throw new DependencyError({
        kind: "circular",
        detail: `Circular dependency detected: ${node.id}`,
      })
    }

    inStack.add(node.id)

    for (const dep of node.dependencies) {
      const depKit = availableMap.get(dep.id)
      if (!depKit) {
        throw new DependencyError({
          kind: "not-found",
          detail: `Dependency "${dep.id}" not found in registry`,
        })
      }

      if (!satisfiesRange(depKit.version, dep.constraint)) {
        throw new DependencyError({
          kind: "version-conflict",
          detail: `${dep.id}@${depKit.version} does not satisfy ${dep.constraint}`,
        })
      }

      visit({
        id: depKit.id,
        version: depKit.version,
        dependencies: depKit.dependencies?.map((d) => ({
          id: typeof d === "string" ? d : d.kitId,
          constraint: typeof d === "string" ? "*" : d.constraint,
        })) ?? [],
      })

      resolved.push({
        kitId: dep.id,
        version: depKit.version,
        constraint: dep.constraint,
      })
    }

    inStack.delete(node.id)
    visited.add(node.id)
  }

  try {
    visit({
      id: kit.id,
      version: kit.version,
      dependencies: kit.dependencies?.map((d) => ({
        id: typeof d === "string" ? d : d.kitId,
        constraint: typeof d === "string" ? "*" : d.constraint,
      })) ?? [],
    })
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
 * Check if a dependency set has any conflicts. Returns a list of conflicts
 * found, or an empty array if all dependencies are satisfied.
 */
export function detectConflicts(
  available: ReadonlyArray<Kit>,
): ReadonlyArray<{ kitA: string; kitB: string; reason: string }> {
  const conflicts: Array<{ kitA: string; kitB: string; reason: string }> = []

  for (const kit of available) {
    for (const dep of kit.dependencies ?? []) {
      const depId = typeof dep === "string" ? dep : dep.kitId
      const constraint = typeof dep === "string" ? "*" : dep.constraint
      const depKit = available.find((k) => k.id === depId)

      if (!depKit) {
        conflicts.push({ kitA: kit.id, kitB: depId, reason: "not found" })
      } else if (!satisfiesRange(depKit.version, constraint)) {
        conflicts.push({
          kitA: kit.id,
          kitB: depId,
          reason: `${depKit.version} does not satisfy ${constraint}`,
        })
      }
    }
  }

  return conflicts
}

export * as Dependencies from "./dependencies"
