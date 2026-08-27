// OC Kit versioning. Semantic version parsing, comparison, and compatibility
// checking for kit versions.

import { Schema } from "effect"

/** Parsed semantic version. */
export const SemVer = Schema.Struct({
  major: Schema.Number,
  minor: Schema.Number,
  patch: Schema.Number,
})
export type SemVer = Schema.Schema.Type<typeof SemVer>

/** Parse a semantic version string (e.g., "1.2.3" or "v1.2.3"). */
export function parseVersion(version: string): SemVer {
  const cleaned = version.startsWith("v") ? version.slice(1) : version
  const [major, minor, patch] = cleaned.split(".").map(Number)
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    throw new Error(`Invalid semver: ${version}`)
  }
  return { major, minor, patch }
}

/** Compare two versions. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

/** Check if two versions are compatible (same major version). */
export function isCompatible(current: string, target: string): boolean {
  return parseVersion(current).major === parseVersion(target).major
}

/** Check if a version satisfies a semver range (simple: ^major.minor.patch). */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version)
  const cleaned = range.startsWith("^") ? range.slice(1) : range
  const r = parseVersion(cleaned)

  // ^x.y.z means >= x.y.z and < (x+1).0.0
  if (range.startsWith("^")) {
    return v.major === r.major &&
      (v.minor > r.minor || (v.minor === r.minor && v.patch >= r.patch))
  }

  // ~x.y.z means >= x.y.z and < x.(y+1).0
  if (range.startsWith("~")) {
    return v.major === r.major && v.minor === r.minor && v.patch >= r.patch
  }

  // Exact match
  return compareVersions(version, range) === 0
}

/** Bump a version by the given release type. */
export function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const v = parseVersion(version)
  switch (type) {
    case "major":
      return `${v.major + 1}.0.0`
    case "minor":
      return `${v.major}.${v.minor + 1}.0`
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`
  }
}
