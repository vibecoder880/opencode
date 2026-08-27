// OC Kit security — Prompt injection audit.
// Detects attempts to override system instructions or inject malicious prompts
// through kit manifests, workflow steps, or skill definitions.
//
// Prompt injection vectors:
// 1. System instruction overrides in skill prompts
// 2. Hidden instructions in workflow step definitions
// 3. Manipulated agent prompts that bypass safety checks
// 4. Encoded/obfuscated malicious content in descriptions

import type { Kit, Skill, Workflow, WorkflowStep } from "../types"

/** A detected prompt injection vector. */
export interface PromptInjectionVector {
  /** Location of the vector (e.g., "skill:code-gen.prompt", "step:review.instruction"). */
  readonly location: string
  /** Type of injection attempt. */
  readonly type: PromptInjectionType
  /** Description of the detected issue. */
  readonly description: string
  /** Severity: "critical" = immediate risk, "high" = likely risk, "medium" = potential risk. */
  readonly severity: "critical" | "high" | "medium"
  /** The suspicious content (truncated if long). */
  readonly content: string
}

/** Types of prompt injection attempts. */
export type PromptInjectionType =
  | "system-override"
  | "instruction-override"
  | "role-manipulation"
  | "encoded-payload"
  | "nested-instruction"
  | "delimiter-escape"

/** Report from a prompt injection audit. */
export interface PromptInjectionReport {
  /** Kit being audited. */
  readonly kitId: string
  /** Number of vectors detected. */
  readonly vectorCount: number
  /** Whether the kit passed the audit (no critical/high vectors). */
  readonly passed: boolean
  /** Detected vectors. */
  readonly vectors: ReadonlyArray<PromptInjectionVector>
  /** Audit timestamp. */
  readonly auditedAt: string
}

// ── Detection patterns ──────────────────────────────────────────────────────

/** Patterns that indicate system instruction overrides. */
const SYSTEM_OVERRIDE_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /new\s+(system\s+)?(instruction|prompt|role|persona)/i,
  /disregard\s+(all\s+)?(previous|prior|your)\s+/i,
  /override\s+(system|your|all)\s+(instructions?|rules?|prompts?)/i,
  /forget\s+(everything|all|your)\s+(you|were|have)\s+(been|been\s+told)/i,
  /act\s+as\s+if\s+you\s+(have|are|were)\s+no\s+(restrictions?|limits?|rules?)/i,
]

/** Patterns that indicate role manipulation. */
const ROLE_MANIPULATION_PATTERNS = [
  /you\s+are\s+no\s+longer\s+(a|an|the)\s+/i,
  /your\s+new\s+(role|job|purpose|function)\s+is\s+to/i,
  /from\s+now\s+on\s+you\s+will/i,
  /your\s+only\s+purpose\s+is\s+to/i,
  /you\s+must\s+always\s+(obey|follow|comply\s+with)\s+(my|the)\s+(instructions?|commands?)/i,
]

/** Patterns that indicate encoded/obfuscated content. */
const ENCODED_PAYLOAD_PATTERNS = [
  /\bbase64\s*[:=]/i,
  /\bhex\s*[:=]/i,
  /\brot13\s*[:=]/i,
  /\bunicode\s+escape/i,
  /\\u[0-9a-f]{4}/i,
  /&#\d{2,4};/,
]

/** Patterns that indicate delimiter escape attempts. */
const DELIMITER_ESCAPE_PATTERNS = [
  /---+\s*(END|SYSTEM|INSTRUCTION|PROMPT)\s*---+/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<\s*(SYS|SYSTEM|INSTRUCTION)\s*>>/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
]

// ── Audit functions ─────────────────────────────────────────────────────────

/**
 * Audit a kit for prompt injection vectors.
 * Pure function — no side effects.
 */
export function auditPromptInjection(kit: Kit): PromptInjectionReport {
  const vectors: PromptInjectionVector[] = []

  // Audit skill prompts.
  for (const skill of kit.skills ?? []) {
    auditSkillPrompt(kit.id, skill, vectors)
  }

  // Audit workflow steps.
  for (const workflow of kit.workflows ?? []) {
    auditWorkflowSteps(kit.id, workflow, vectors)
  }

  return {
    kitId: kit.id,
    vectorCount: vectors.length,
    passed: !vectors.some((v) => v.severity === "critical" || v.severity === "high"),
    vectors,
    auditedAt: new Date().toISOString(),
  }
}

function auditSkillPrompt(
  kitId: string,
  skill: Skill,
  vectors: PromptInjectionVector[],
): void {
  const fields = [
    { name: "prompt", value: skill.prompt },
    { name: "instruction", value: skill.instruction },
    { name: "description", value: skill.description },
  ]

  for (const field of fields) {
    if (!field.value) continue
    const location = `skill:${skill.id}.${field.name}`

    checkSystemOverride(location, field.value, vectors)
    checkRoleManipulation(location, field.value, vectors)
    checkEncodedPayload(location, field.value, vectors)
    checkDelimiterEscape(location, field.value, vectors)
    checkNestedInstruction(location, field.value, vectors)
  }
}

function auditWorkflowSteps(
  kitId: string,
  workflow: Workflow,
  vectors: PromptInjectionVector[],
): void {
  for (const step of workflow.steps) {
    const stepKey = step.as ?? step.skill
    const location = `step:${workflow.id}.${stepKey}`

    // Check step-level instruction overrides.
    if (step.instruction) {
      checkSystemOverride(location, step.instruction, vectors)
      checkRoleManipulation(location, step.instruction, vectors)
      checkEncodedPayload(location, step.instruction, vectors)
      checkDelimiterEscape(location, step.instruction, vectors)
    }
  }
}

// ── Pattern checkers ────────────────────────────────────────────────────────

function checkSystemOverride(
  location: string,
  content: string,
  vectors: PromptInjectionVector[],
): void {
  for (const pattern of SYSTEM_OVERRIDE_PATTERNS) {
    if (pattern.test(content)) {
      vectors.push({
        location,
        type: "system-override",
        description: `Content contains system instruction override pattern: ${pattern.source}`,
        severity: "critical",
        content: truncate(content, 200),
      })
      return // One vector per location per type is enough.
    }
  }
}

function checkRoleManipulation(
  location: string,
  content: string,
  vectors: PromptInjectionVector[],
): void {
  for (const pattern of ROLE_MANIPULATION_PATTERNS) {
    if (pattern.test(content)) {
      vectors.push({
        location,
        type: "role-manipulation",
        description: `Content contains role manipulation pattern: ${pattern.source}`,
        severity: "high",
        content: truncate(content, 200),
      })
      return
    }
  }
}

function checkEncodedPayload(
  location: string,
  content: string,
  vectors: PromptInjectionVector[],
): void {
  for (const pattern of ENCODED_PAYLOAD_PATTERNS) {
    if (pattern.test(content)) {
      vectors.push({
        location,
        type: "encoded-payload",
        description: `Content contains potentially encoded/obfuscated payload: ${pattern.source}`,
        severity: "medium",
        content: truncate(content, 200),
      })
      return
    }
  }
}

function checkDelimiterEscape(
  location: string,
  content: string,
  vectors: PromptInjectionVector[],
): void {
  for (const pattern of DELIMITER_ESCAPE_PATTERNS) {
    if (pattern.test(content)) {
      vectors.push({
        location,
        type: "delimiter-escape",
        description: `Content contains delimiter escape attempt: ${pattern.source}`,
        severity: "high",
        content: truncate(content, 200),
      })
      return
    }
  }
}

function checkNestedInstruction(
  location: string,
  content: string,
  vectors: PromptInjectionVector[],
): void {
  // Check for nested instruction blocks that might contain hidden directives.
  const nestedPatterns = [
    /\[INST\].*\[\/INST\]/is,
    /<instructions?>.*<\/instructions?>/is,
    /\{\{.*system.*\}\}/is,
  ]

  for (const pattern of nestedPatterns) {
    if (pattern.test(content)) {
      vectors.push({
        location,
        type: "nested-instruction",
        description: `Content contains nested instruction block: ${pattern.source}`,
        severity: "high",
        content: truncate(content, 200),
      })
      return
    }
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + "..."
}
