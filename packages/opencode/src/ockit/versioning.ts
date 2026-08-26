// OC Kit versioning utilities. Simple semver helpers for version comparison
// and constraint satisfaction. Uses basic semver (major.minor.patch) only.

/** Parse a version string into numeric components. */
export function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split(".")
  return {
    major: parseInt(parts[0] ?? "0", 10),
    minor: parseInt(parts[1] ?? "0", 10),
    patch: parseInt(parts[2] ?? "0", 10),
  }
}

/** Compare two semver strings. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

/**
 * Check if a version satisfies a constraint.
 * Supports: "*", "^1.0.0", "~1.0.0", "1.0.0".
 */
export function satisfiesRange(version: string, constraint: string): boolean {
  if (constraint === "*") return true

  const v = parseVersion(version)

  if (constraint.startsWith("^")) {
    const target = parseVersion(constraint.slice(1))
    if (v.major !== target.major) return false
    if (v.major > target.major) return true
    if (v.minor > target.minor) return true
    if (v.minor === target.minor && v.patch >= target.patch) return true
    return false
  }

  if (constraint.startsWith("~")) {
    const target = parseVersion(constraint.slice(1))
    if (v.major !== target.major) return false
    if (v.minor !== target.minor) return false
    return v.patch >= target.patch
  }

  return version === constraint
}
