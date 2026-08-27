// OC Kit workflow permission scoping. Controls which tools are available
// during each workflow step, based on the kit's declared skill permissions.
// This is a pure computation — no side effects.

import type { Kit, WorkflowStep } from "../types"

/** Permission scope for a single workflow step. */
export interface StepPermissions {
  /** Tool permissions: tool ID → "allow" | "deny". Empty = all tools allowed. */
  readonly toolPermissions: Record<string, "allow" | "deny">
}

/** Default permissions: everything allowed. */
const DEFAULT_PERMISSIONS: StepPermissions = {
  toolPermissions: {},
}

/**
 * Resolve the permission scope for a workflow step. Looks up the skill's
 * declared permissions from the kit.
 */
export function resolveStepPermissions(
  step: WorkflowStep,
  kit: Kit,
): StepPermissions {
  const skills = kit.skills ?? []
  const skill = skills.find((s) => s.id === step.skill)

  return {
    toolPermissions: skill?.permissions ?? DEFAULT_PERMISSIONS.toolPermissions,
  }
}

/**
 * Check if a specific tool is allowed in the current step context.
 * An empty toolPermissions map means all tools are permitted.
 */
export function isToolAllowed(toolId: string, permissions: StepPermissions): boolean {
  const perm = permissions.toolPermissions[toolId]
  if (perm === undefined) return true
  return perm === "allow"
}

/**
 * Filter a list of tool IDs to only those allowed by the current permissions.
 */
export function filterAllowedTools(
  tools: ReadonlyArray<string>,
  permissions: StepPermissions,
): ReadonlyArray<string> {
  return tools.filter((t) => isToolAllowed(t, permissions))
}

/**
 * Check if a specific agent is allowed in the current step context.
 * An empty agentPermissions map means all agents are permitted.
 */
export function isAgentAllowed(agentId: string, permissions: StepPermissions): boolean {
  // Agent permissions are not yet implemented in the StepPermissions interface.
  // For now, all agents are allowed.
  return true
}

/**
 * Filter a list of agent IDs to only those allowed by the current permissions.
 */
export function filterAllowedAgents(
  agents: ReadonlyArray<string>,
  permissions: StepPermissions,
): ReadonlyArray<string> {
  return agents.filter((a) => isAgentAllowed(a, permissions))
}

export * as PermissionScope from "./permission-scope"
