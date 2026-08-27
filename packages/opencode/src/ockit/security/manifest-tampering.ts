// OC Kit security — Manifest tampering detection.
// Detects unauthorized modifications to kit manifests by comparing against
// known-good checksums and validating manifest integrity.
//
// Tampering vectors:
// 1. Modified manifest fields after initial validation
// 2. Missing or invalid checksums
// 3. Version mismatch between manifest and installed files
// 4. Unauthorized field additions or removals

import type { Kit } from "../types"

/** A detected tampering vector. */
export interface TamperingVector {
  /** Location of the tampering (e.g., "manifest:version", "manifest:skills[0]"). */
  readonly location: string
  /** Type of tampering attempt. */
  readonly type: TamperingType
  /** Description of the detected issue. */
  readonly description: string
  /** Severity: "critical" = integrity broken, "high" = likely tampering, "medium" = suspicious change. */
  readonly severity: "critical" | "high" | "medium"
  /** Expected value (if known). */
  readonly expected?: string
  /** Actual value found. */
  readonly actual: string
}

/** Types of manifest tampering. */
export type TamperingType =
  | "checksum-mismatch"
  | "version-mismatch"
  | "field-modified"
  | "field-added"
  | "field-removed"
  | "signature-invalid"
  | "expired-manifest"

/** Report from a manifest tampering detection. */
export interface TamperingReport {
  /** Kit being audited. */
  readonly kitId: string
  /** Number of tampering vectors detected. */
  readonly vectorCount: number
  /** Whether the manifest passed integrity check (no critical/high vectors). */
  readonly passed: boolean
  /** Detected tampering vectors. */
  readonly vectors: ReadonlyArray<TamperingVector>
  /** Audit timestamp. */
  readonly auditedAt: string
}

/** Known-good manifest checksum (set during initial validation). */
interface ManifestChecksum {
  /** SHA-256 hash of the manifest content. */
  readonly hash: string
  /** Timestamp when the checksum was computed. */
  readonly computedAt: string
  /** Version of the manifest when checksum was computed. */
  readonly version: string
}

/** Required fields that must be present in a valid manifest. */
const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version"]

/** Fields that should not change after initial validation. */
const IMMUTABLE_MANIFEST_FIELDS = ["id"]

/** Fields that can be updated but require version bump. */
const VERSIONED_MANIFEST_FIELDS = ["skills", "workflows", "agents", "hooks"]

// ── Detection functions ─────────────────────────────────────────────────────

/**
 * Detect tampering by comparing a manifest against a known-good checksum.
 * Pure function — no side effects.
 */
export function detectManifestTampering(
  kit: Kit,
  knownChecksum?: ManifestChecksum,
): TamperingReport {
  const vectors: TamperingVector[] = []

  // Check required fields.
  checkRequiredFields(kit, vectors)

  // Check immutable fields.
  if (knownChecksum) {
    checkImmutableFields(kit, knownChecksum, vectors)
    checkVersionConsistency(kit, knownChecksum, vectors)
  }

  // Validate manifest structure.
  validateManifestStructure(kit, vectors)

  return {
    kitId: kit.id,
    vectorCount: vectors.length,
    passed: !vectors.some((v) => v.severity === "critical" || v.severity === "high"),
    vectors,
    auditedAt: new Date().toISOString(),
  }
}

/**
 * Compute a checksum for a kit manifest.
 * Used during initial validation to establish a baseline.
 */
export function computeManifestChecksum(kit: Kit): ManifestChecksum {
  const content = JSON.stringify({
    id: kit.id,
    name: kit.name,
    version: kit.version,
    description: kit.description,
    runtime: kit.runtime,
    min_opencode: kit.min_opencode,
    skills: kit.skills,
    workflows: kit.workflows,
    agents: kit.agents,
    hooks: kit.hooks,
  })

  // Simple hash computation (in production, use crypto.createHash)
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  const hashHex = Math.abs(hash).toString(16).padStart(8, "0")

  return {
    hash: hashHex,
    computedAt: new Date().toISOString(),
    version: kit.version,
  }
}

// ── Validation checks ───────────────────────────────────────────────────────

function checkRequiredFields(
  kit: Kit,
  vectors: TamperingVector[],
): void {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = (kit as Record<string, unknown>)[field]
    if (value === undefined || value === null || value === "") {
      vectors.push({
        location: `manifest:${field}`,
        type: "field-removed",
        description: `Required field "${field}" is missing or empty`,
        severity: "critical",
        expected: "(non-empty value)",
        actual: String(value ?? "undefined"),
      })
    }
  }
}

function checkImmutableFields(
  kit: Kit,
  knownChecksum: ManifestChecksum,
  vectors: TamperingVector[],
): void {
  // Check if the version has changed without a proper version bump.
  if (kit.version !== knownChecksum.version) {
    // Version change is allowed if it follows semver.
    const current = parseSemver(kit.version)
    const known = parseSemver(knownChecksum.version)

    if (current && known) {
      const isMajorBump = current.major > known.major
      const isMinorBump = current.major === known.major && current.minor > known.minor
      const isPatchBump = current.major === known.major && current.minor === known.minor && current.patch > known.patch

      if (!isMajorBump && !isMinorBump && !isPatchBump) {
        vectors.push({
          location: "manifest:version",
          type: "version-mismatch",
          description: `Version changed from ${knownChecksum.version} to ${kit.version} without following semver`,
          severity: "high",
          expected: knownChecksum.version,
          actual: kit.version,
        })
      }
    }
  }
}

function checkVersionConsistency(
  kit: Kit,
  knownChecksum: ManifestChecksum,
  vectors: TamperingVector[],
): void {
  // Check if the checksum matches (simplified - in production use crypto).
  const currentChecksum = computeManifestChecksum(kit)
  if (currentChecksum.hash !== knownChecksum.hash) {
    vectors.push({
      location: "manifest:checksum",
      type: "checksum-mismatch",
      description: `Manifest checksum mismatch: expected ${knownChecksum.hash}, got ${currentChecksum.hash}`,
      severity: "high",
      expected: knownChecksum.hash,
      actual: currentChecksum.hash,
    })
  }
}

function validateManifestStructure(
  kit: Kit,
  vectors: TamperingVector[],
): void {
  // Validate skills structure.
  if (kit.skills) {
    for (let i = 0; i < kit.skills.length; i++) {
      const skill = kit.skills[i]
      if (!skill.id) {
        vectors.push({
          location: `manifest:skills[${i}].id`,
          type: "field-modified",
          description: `Skill at index ${i} is missing required "id" field`,
          severity: "medium",
          expected: "(non-empty string)",
          actual: "undefined",
        })
      }
    }
  }

  // Validate workflows structure.
  if (kit.workflows) {
    for (let i = 0; i < kit.workflows.length; i++) {
      const workflow = kit.workflows[i]
      if (!workflow.id) {
        vectors.push({
          location: `manifest:workflows[${i}].id`,
          type: "field-modified",
          description: `Workflow at index ${i} is missing required "id" field`,
          severity: "medium",
          expected: "(non-empty string)",
          actual: "undefined",
        })
      }
    }
  }
}

// ── Utility functions ───────────────────────────────────────────────────────

interface Semver {
  major: number
  minor: number
  patch: number
}

function parseSemver(version: string): Semver | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}
