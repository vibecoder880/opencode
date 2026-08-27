// OC Kit agent selector. Given a workflow and a kit index, selects the best
// agent to execute each step. Strategy:
//   1. If the skill declares a preferred agent → use it.
//   2. If the kit has a matching agent by role → use it.
//   3. Fall back to the kit's first agent, or undefined.
// Pure — no I/O, no side effects.

import type { Kit, KitSkill, KitAgent, Workflow } from "../types"
import type { KitIndex } from "../resolver"

/** Agent assignment for a workflow step. */
export interface AgentAssignment {
  readonly stepSkill: string
  readonly agentId: string | undefined
  readonly agent: KitAgent | undefined
  readonly source: "skill-declaration" | "role-match" | "kit-default" | "none"
}

/** Map a role string to a set of keywords for fuzzy matching. */
const ROLE_KEYWORDS: Record<string, ReadonlyArray<string>> = {
  coder: ["code", "implement", "build", "write", "feature"],
  debugger: ["debug", "fix", "error", "crash", "issue"],
  reviewer: ["review", "check", "audit", "inspect"],
  tester: ["test", "spec", "coverage", "e2e"],
  researcher: ["research", "investigate", "explore", "compare"],
  planner: ["plan", "design", "architect", "strategy"],
  security: ["security", "vulnerability", "auth", "harden"],
  docs: ["doc", "documentation", "readme", "comment"],
  orchestrator: ["orchestrate", "coordinate", "manage"],
  architect: ["architect", "structure", "design", "refactor"],
  performance: ["optimize", "performance", "speed", "cache"],
}

/**
 * Find the best agent for a skill. Checks the skill's declared agent first,
 * then fuzzy-matches agent roles, then falls back to kit default.
 */
export function selectAgentForSkill(
  skill: KitSkill,
  kitIndex: KitIndex,
): AgentAssignment {
  const agents = Array.from(kitIndex.agents.values())

  // 1. Skill declares a preferred agent.
  if (skill.agent) {
    const agent = kitIndex.agents.get(skill.agent)
    if (agent) {
      return {
        stepSkill: skill.id,
        agentId: agent.id,
        agent,
        source: "skill-declaration",
      }
    }
  }

  // 2. Fuzzy match by role keywords against the skill's description.
  const skillDesc = (skill.description ?? "").toLowerCase()
  let bestAgent: KitAgent | undefined
  let bestScore = 0

  for (const agent of agents) {
    const role = (agent.role ?? "").toLowerCase()
    const keywords = ROLE_KEYWORDS[role] ?? []
    let score = 0

    for (const kw of keywords) {
      if (skillDesc.includes(kw)) {
        score++
      }
    }

    // Bonus: if the agent declares this skill in its skills list.
    if (agent.skills?.includes(skill.id)) {
      score += 2
    }

    if (score > bestScore) {
      bestScore = score
      bestAgent = agent
    }
  }

  if (bestAgent && bestScore > 0) {
    return {
      stepSkill: skill.id,
      agentId: bestAgent.id,
      agent: bestAgent,
      source: "role-match",
    }
  }

  // 3. Kit default: first agent.
  if (agents.length > 0) {
    const defaultAgent = agents[0]
    return {
      stepSkill: skill.id,
      agentId: defaultAgent.id,
      agent: defaultAgent,
      source: "kit-default",
    }
  }

  return {
    stepSkill: skill.id,
    agentId: undefined,
    agent: undefined,
    source: "none",
  }
}

/**
 * Assign agents to all steps in a workflow. Returns a map from step key
 * (as ?? skill) to agent assignment.
 */
export function assignAgents(
  workflow: Workflow,
  kitIndex: KitIndex,
): Map<string, AgentAssignment> {
  const assignments = new Map<string, AgentAssignment>()

  for (const step of workflow.steps) {
    const skill = kitIndex.skills.get(step.skill)
    if (skill) {
      const key = step.as ?? step.skill
      assignments.set(key, selectAgentForSkill(skill, kitIndex))
    }
  }

  return assignments
}

export * as AgentSelector from "./selector"
