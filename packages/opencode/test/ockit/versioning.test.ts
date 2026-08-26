import { describe, expect, test } from "bun:test"
import {
  parseVersion,
  compareVersions,
  isCompatible,
  satisfiesRange,
  bumpVersion,
} from "../../src/ockit/versioning"

describe("versioning", () => {
  test("parseVersion parses standard versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test("parseVersion strips leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test("parseVersion throws on invalid input", () => {
    expect(() => parseVersion("not-a-version")).toThrow("Invalid semver")
  })

  test("compareVersions returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
  })

  test("compareVersions orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1)
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1)
    expect(compareVersions("1.1.0", "1.2.0")).toBe(-1)
    expect(compareVersions("1.2.1", "1.2.0")).toBe(1)
  })

  test("isCompatible checks same major version", () => {
    expect(isCompatible("1.0.0", "1.9.9")).toBe(true)
    expect(isCompatible("1.0.0", "2.0.0")).toBe(false)
  })

  test("satisfiesRange handles ^ ranges", () => {
    expect(satisfiesRange("1.2.3", "^1.2.0")).toBe(true)
    expect(satisfiesRange("1.9.0", "^1.2.0")).toBe(true)
    expect(satisfiesRange("2.0.0", "^1.2.0")).toBe(false)
    expect(satisfiesRange("1.1.0", "^1.2.0")).toBe(false)
  })

  test("satisfiesRange handles ~ ranges", () => {
    expect(satisfiesRange("1.2.3", "~1.2.0")).toBe(true)
    expect(satisfiesRange("1.2.9", "~1.2.0")).toBe(true)
    expect(satisfiesRange("1.3.0", "~1.2.0")).toBe(false)
  })

  test("satisfiesRange handles exact versions", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true)
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false)
  })

  test("bumpVersion increments correctly", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4")
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0")
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0")
  })
})
