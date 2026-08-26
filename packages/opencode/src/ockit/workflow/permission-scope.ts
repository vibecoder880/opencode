// OC Kit workflow permission scoping. Controls which tools and agents are
// available during each workflow step, based on the kit's declared permissions
// and per-step overrides. This is a pure computation — no side effects.

import { Effect } from "effect"
import type { Kit, KitSkill, WorkflowStep } from "../types"

/** Permission scope for a single workflow step. */
export interface StepPermissions {
  /** Tools allowed for this step (empty = all tools). */
  readonly allowedTools: ReadonlyArray<string>
  /** Agents allowed for this step (empty = all agents). */
  readonly allowedAgents: ReadonlyArray<string>
  /** Maximum execution time in seconds (undefined = no limit). */
  readonly timeout: number | undefined
  /** Whether this step can access the network. */
  readonly networkAccess: boolean
}

/** Default permissions: everything allowed. */
const DEFAULT_PERMISSIONS: StepPermissions = {
  allowedTools: [],
  allowedAgents: [],
  timeout: undefined,
  networkAccess: true,
}

/**
 * Resolve the permission scope for a workflow step. Kit-level defaults are
 * overridden by step-level overrides when present.
 */
export function resolveStepPermissions(
  step: WorkflowStep,
  kit: Kit,
): StepPermissions {
  const skill = kit.skills.find((s) => s.id === step.run)
  const kitPerms = skill?.permissions ?? kit.permissions ?? {}

  return {
    allowedTools: step.allowedTools ?? kitPerms.allowedTools ?? DEFAULT_PERMISSIONS.allowedTools,
    allowedAgents: step.allowedAgents ?? kitPerms.allowedAgents ?? DEFAULT_PERMISSIONS.allowedAgents,
    timeout: step.timeout ?? kitPerms.timeout ?? DEFAULT_PERMISSIONS.timeout,
    networkAccess: step.networkAccess ?? kitPerms.networkAccess ?? DEFAULT_PERMISSIONS.networkAccess,
  }
}

/**
 * Check if a specific tool is allowed in the current step context.
 * An empty allowedTools list means all tools are permitted.
 */
export function isToolAllowed(toolId: string, permissions: StepPermissions): boolean {
  if (permissions.allowedTools.length === 0) return true
  return permissions.allowedTools.includes(toolId)
}

/**
 * Check if a specific agent is allowed in the current step context.
 * An empty allowedAgents list means all agents are permitted.
 */
export function isAgentAllowed(agentId: string, permissions: StepPermissions): boolean {
  if (permissions.allowedAgents.length === 0) return true
  return permissions.allowedAgents.includes(agentId)
}

/**
 * Filter a list of tool IDs to only those allowed by the current permissions.
 */
export function filterAllowedTools(
  tools: ReadonlyArray<string>,
  permissions: StepPermissions,
): ReadonlyArray<string> {
  if (permissions.allowedTools.length === 0) return tools
  return tools.filter((t) => permissions.allowedTools.includes(t))
}

/**
 * Filter a list of agent IDs to only those allowed by the current permissions.
 */
export function filterAllowedAgents(
  agents: ReadonlyArray<string>,
  permissions: StepPermissions,
): ReadonlyArray<string> {
  if (permissions.allowedAgents.length === 0) return agents
  return agents.filter((a) => permissions.allowedAgents.includes(a))
}

export * as PermissionScope from "./permission-scope"
