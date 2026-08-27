// OC Kit security — Path traversal audit.
// Detects attempts to escape the kit directory through file operations,
// imports, or other path-based references.
//
// Path traversal vectors:
// 1. Relative path references that escape the kit root (../)
// 2. Absolute path references outside the kit directory
// 3. Symlink attacks that point outside the kit
// 4. URL-based file access that bypasses directory restrictions

import type { Kit, KitSkill, Workflow, WorkflowStep } from "../types"

/** A detected path traversal vector. */
export interface PathTraversalVector {
  /** Location of the vector (e.g., "skill:code-gen.agent", "step:build.skill"). */
  readonly location: string
  /** Type of traversal attempt. */
  readonly type: PathTraversalType
  /** Description of the detected issue. */
  readonly description: string
  /** Severity: "critical" = escape confirmed, "high" = likely escape, "medium" = suspicious. */
  readonly severity: "critical" | "high" | "medium"
  /** The suspicious path. */
  readonly path: string
}

/** Types of path traversal attempts. */
export type PathTraversalType =
  | "relative-escape"
  | "absolute-escape"
  | "symlink-escape"
  | "url-access"
  | "encoded-separator"
  | "null-byte"

/** Report from a path traversal audit. */
export interface PathTraversalReport {
  /** Kit being audited. */
  readonly kitId: string
  /** Number of vectors detected. */
  readonly vectorCount: number
  /** Whether the kit passed the audit (no critical/high vectors). */
  readonly passed: boolean
  /** Detected vectors. */
  readonly vectors: ReadonlyArray<PathTraversalVector>
  /** Audit timestamp. */
  readonly auditedAt: string
}

// ── Detection patterns ──────────────────────────────────────────────────────

/** Patterns that indicate relative path escapes. */
const RELATIVE_ESCAPE_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /\.\.%2[fF]/,
  /\.\.%5[cC]/,
]

/** Patterns that indicate absolute path references. */
const ABSOLUTE_ESCAPE_PATTERNS = [
  /^\/[a-zA-Z]/,  // Unix absolute path
  /^[a-zA-Z]:\\/,  // Windows absolute path
  /^\\\\/,  // UNC path
]

/** Patterns that indicate URL-based file access. */
const URL_ACCESS_PATTERNS = [
  /^file:\/\//i,
  /^https?:\/\//i,
  /^ftp:\/\//i,
]

/** Patterns that indicate encoded path separators. */
const ENCODED_SEPARATOR_PATTERNS = [
  /%2[fF]/,
  /%5[cC]/,
  /%2[eE]%2[eE]%2[fF]/,
]

/** Patterns that indicate null byte injection. */
const NULL_BYTE_PATTERNS = [
  /\x00/,
  /%00/,
]

// ── Audit functions ─────────────────────────────────────────────────────────

/**
 * Audit a kit for path traversal vectors.
 * Pure function — no side effects.
 */
export function auditPathTraversal(kit: Kit): PathTraversalReport {
  const vectors: PathTraversalVector[] = []

  // Audit skill paths.
  for (const skill of kit.skills ?? []) {
    auditSkillPaths(kit.id, skill, vectors)
  }

  // Audit workflow step paths.
  for (const workflow of kit.workflows ?? []) {
    auditWorkflowPaths(kit.id, workflow, vectors)
  }

  return {
    kitId: kit.id,
    vectorCount: vectors.length,
    passed: !vectors.some((v) => v.severity === "critical" || v.severity === "high"),
    vectors,
    auditedAt: new Date().toISOString(),
  }
}

function auditSkillPaths(
  kitId: string,
  skill: KitSkill,
  vectors: PathTraversalVector[],
): void {
  // Audit the skill agent reference (could reference a file path).
  if (skill.agent) {
    checkPath(`skill:${skill.id}.agent`, skill.agent, vectors)
  }

  // Audit tool references for path-like strings.
  for (const tool of skill.tools ?? []) {
    checkPath(`skill:${skill.id}.tools`, tool, vectors)
  }

  // Audit artifact paths.
  for (const artifact of skill.artifacts ?? []) {
    checkPath(`skill:${skill.id}.artifacts`, artifact, vectors)
  }
}

function auditWorkflowPaths(
  kitId: string,
  workflow: Workflow,
  vectors: PathTraversalVector[],
): void {
  for (const step of workflow.steps) {
    const stepKey = step.as ?? step.skill

    // Audit the skill reference name for path-like strings.
    checkPath(`step:${workflow.id}.${stepKey}.skill`, step.skill, vectors)

    // Audit the step alias for path-like strings.
    if (step.as) {
      checkPath(`step:${workflow.id}.${stepKey}.as`, step.as, vectors)
    }
  }
}

// ── Pattern checkers ────────────────────────────────────────────────────────

function checkPath(
  location: string,
  path: string,
  vectors: PathTraversalVector[],
): void {
  // Check for relative path escapes.
  for (const pattern of RELATIVE_ESCAPE_PATTERNS) {
    if (pattern.test(path)) {
      vectors.push({
        location,
        type: "relative-escape",
        description: `Path contains relative directory traversal: ${pattern.source}`,
        severity: "critical",
        path,
      })
      return
    }
  }

  // Check for absolute path references.
  for (const pattern of ABSOLUTE_ESCAPE_PATTERNS) {
    if (pattern.test(path)) {
      vectors.push({
        location,
        type: "absolute-escape",
        description: `Path references absolute location outside kit: ${pattern.source}`,
        severity: "high",
        path,
      })
      return
    }
  }

  // Check for URL-based file access.
  for (const pattern of URL_ACCESS_PATTERNS) {
    if (pattern.test(path)) {
      vectors.push({
        location,
        type: "url-access",
        description: `Path uses URL-based file access: ${pattern.source}`,
        severity: "medium",
        path,
      })
      return
    }
  }

  // Check for encoded path separators.
  for (const pattern of ENCODED_SEPARATOR_PATTERNS) {
    if (pattern.test(path)) {
      vectors.push({
        location,
        type: "encoded-separator",
        description: `Path contains encoded directory separator: ${pattern.source}`,
        severity: "high",
        path,
      })
      return
    }
  }

  // Check for null byte injection.
  for (const pattern of NULL_BYTE_PATTERNS) {
    if (pattern.test(path)) {
      vectors.push({
        location,
        type: "null-byte",
        description: `Path contains null byte injection: ${pattern.source}`,
        severity: "critical",
        path,
      })
      return
    }
  }
}
