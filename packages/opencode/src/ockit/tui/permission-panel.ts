// OC Kit TUI — Permission panel.
// Displays the current permission scope for a workflow step: which tools and
// agents are allowed/denied. Helps users understand what a kit can do at each
// stage of execution.

import type { Kit, Workflow, WorkflowStep } from "../types"
import type { StepPermissions } from "../workflow/permission-scope"

/** Permission status for a single tool or agent. */
export interface PermissionEntry {
  /** Tool or agent id. */
  readonly id: string
  /** "allow" = permitted, "deny" = blocked. */
  readonly access: "allow" | "deny"
  /** Source of this permission (kit skill declaration, step override, default). */
  readonly source: "skill" | "step-override" | "default"
}

/** Snapshot of permissions for a workflow step. */
export interface PermissionSnapshot {
  /** Kit metadata. */
  readonly kit: { readonly id: string; readonly name: string; readonly version: string }
  /** Workflow metadata. */
  readonly workflow: { readonly id: string; readonly name: string }
  /** Step key this snapshot applies to. */
  readonly stepKey: string
  /** Skill id for this step. */
  readonly skill: string
  /** Tool permissions. */
  readonly tools: ReadonlyArray<PermissionEntry>
  /** Agent permissions (which agents can execute this step). */
  readonly agents: ReadonlyArray<PermissionEntry>
  /** Number of allowed tools. */
  readonly allowedToolCount: number
  /** Number of denied tools. */
  readonly deniedToolCount: number
  /** Whether all tools are allowed (empty permission map). */
  readonly allToolsAllowed: boolean
}

/**
 * Build a permission snapshot from a step, its permissions, and the kit.
 * Pure function — no side effects.
 */
export function buildPermissionSnapshot(
  kit: Kit,
  workflow: Workflow,
  step: WorkflowStep,
  permissions: StepPermissions,
): PermissionSnapshot {
  // Build tool permission entries from the step's skill declaration + overrides.
  const skill = kit.skills?.find((s) => s.id === step.skill)
  const skillToolPerms = skill?.permissions ?? {}

  const toolEntries: PermissionEntry[] = []
  const allToolIds = new Set<string>()

  // Collect all known tool ids from skill permissions and step overrides.
  for (const [toolId, access] of Object.entries(skillToolPerms)) {
    allToolIds.add(toolId)
    const stepAccess = permissions.toolPermissions[toolId]
    if (stepAccess) {
      // Step override takes precedence.
      toolEntries.push({ id: toolId, access: stepAccess, source: "step-override" })
    } else {
      toolEntries.push({ id: toolId, access, source: "skill" })
    }
  }

  // Add step-only overrides not in skill declaration.
  for (const [toolId, access] of Object.entries(permissions.toolPermissions)) {
    if (!allToolIds.has(toolId)) {
      toolEntries.push({ id: toolId, access, source: "step-override" })
    }
  }

  // Sort: allows first, then denies.
  toolEntries.sort((a, b) => {
    if (a.access !== b.access) return a.access === "allow" ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  // Agent permissions: check if the step has agent restrictions.
  const agentEntries: PermissionEntry[] = []
  if (step.agents && step.agents.length > 0) {
    for (const agentId of step.agents) {
      agentEntries.push({ id: agentId, access: "allow", source: "step-override" })
    }
  }

  const allowedToolCount = toolEntries.filter((e) => e.access === "allow").length
  const deniedToolCount = toolEntries.filter((e) => e.access === "deny").length
  const allToolsAllowed = Object.keys(permissions.toolPermissions).length === 0

  return {
    kit: { id: kit.id, name: kit.name, version: kit.version },
    workflow: { id: workflow.id, name: workflow.name },
    stepKey: step.as ?? step.skill,
    skill: step.skill,
    tools: toolEntries,
    agents: agentEntries,
    allowedToolCount,
    deniedToolCount,
    allToolsAllowed,
  }
}

/** Format a permission snapshot as a human-readable string. */
export function formatPermissions(snapshot: PermissionSnapshot): string {
  const lines: string[] = []
  const { kit, workflow, stepKey, skill, tools, agents, allToolsAllowed } = snapshot

  lines.push(`Kit: ${kit.name}@${kit.version}`)
  lines.push(`Workflow: ${workflow.name}`)
  lines.push(`Step: ${stepKey} [${skill}]`)
  lines.push("")

  // Tools section.
  if (allToolsAllowed) {
    lines.push("  Tools: all allowed (no restrictions)")
  } else {
    lines.push(`  Tools (${snapshot.allowedToolCount} allowed, ${snapshot.deniedToolCount} denied):`)
    for (const entry of tools) {
      const icon = entry.access === "allow" ? "✓" : "✗"
      const sourceTag = entry.source !== "default" ? ` [${entry.source}]` : ""
      lines.push(`    ${icon} ${entry.id}${sourceTag}`)
    }
  }

  lines.push("")

  // Agents section.
  if (agents.length === 0) {
    lines.push("  Agents: any agent can execute this step")
  } else {
    lines.push(`  Agents (${agents.length} allowed):`)
    for (const entry of agents) {
      lines.push(`    ✓ ${entry.id}`)
    }
  }

  return lines.join("\n")
}
