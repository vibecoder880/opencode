// OC Kit testing framework. Validates kit structure, runs skill tests,
// and provides assertion helpers for kit development.

import { Effect, Schema } from "effect"
import type { Kit, KitSkill } from "./types"
import { validateKit } from "./validator"

/** Test result for a single test case. */
export class TestCaseResult extends Schema.Class<TestCaseResult>("OCKit.TestCaseResult")({
  name: Schema.String,
  passed: Schema.Boolean,
  duration: Schema.Number,
  error: Schema.optional(Schema.String),
}) {}

/** Test suite result. */
export class TestSuiteResult extends Schema.Class<TestSuiteResult>("OCKit.TestSuiteResult")({
  kitId: Schema.String,
  totalTests: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  skipped: Schema.Number,
  duration: Schema.Number,
  results: Schema.Array(TestCaseResult),
}) {}

/** Error types for test operations. */
export class TestError extends Schema.TaggedErrorClass<TestError>()("OCKitTestError", {
  kind: Schema.Literals(["validation", "execution", "assertion", "timeout"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit test: ${this.kind} — ${this.detail}`
  }
}

/** Test case definition. */
export interface TestCase {
  readonly name: string
  readonly fn: () => boolean | Promise<boolean>
  readonly timeout?: number
}

/** Test suite definition. */
export interface TestSuite {
  readonly kitId: string
  readonly tests: ReadonlyArray<TestCase>
}

/**
 * Validate a kit's structure and return any issues found.
 * This is the first step before running kit tests.
 */
export function validateKitStructure(kit: Kit): Effect.Effect<void, TestError> {
  return Effect.gen(function* () {
    const result = yield* validateKit(kit)

    if (!result.ok) {
      const issues = result.issues.map((i) => i.message).join(", ")
      return yield* Effect.fail(new TestError({
        kind: "validation",
        detail: `Kit "${kit.id}" validation failed: ${issues}`,
      }))
    }
  })
}

/**
 * Run a test suite and collect results. Each test is executed with its
 * specified timeout (default: 5 seconds).
 */
export const runTestSuite = Effect.fn("OCKit.testing.runSuite")(function* (suite: TestSuite) {
  const startTime = Date.now()
  const results: TestCaseResult[] = []
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const test of suite.tests) {
    const testStart = Date.now()
    const timeout = test.timeout ?? 5000

    try {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const fn = test.fn()
          if (fn instanceof Promise) {
            return await Promise.race([
              fn,
              new Promise<boolean>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), timeout),
              ),
            ])
          }
          return fn
        },
        catch: (err) => {
          if (String(err).includes("timeout")) {
            return false
          }
          throw err
        },
      })

      const duration = (Date.now() - testStart) / 1000

      if (result) {
        passed++
        results.push(new TestCaseResult({
          name: test.name,
          passed: true,
          duration,
        }))
      } else {
        failed++
        results.push(new TestCaseResult({
          name: test.name,
          passed: false,
          duration,
          error: "Test returned false",
        }))
      }
    } catch (err) {
      const duration = (Date.now() - testStart) / 1000
      failed++
      results.push(new TestCaseResult({
        name: test.name,
        passed: false,
        duration,
        error: String(err),
      }))
    }
  }

  return new TestSuiteResult({
    kitId: suite.kitId,
    totalTests: suite.tests.length,
    passed,
    failed,
    skipped,
    duration: (Date.now() - startTime) / 1000,
    results,
  })
})

/** Assert that a condition is true. Throws if not. */
export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

/** Assert that two values are equal. */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

/** Assert that a value is defined (not undefined or null). */
export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message ?? "Expected value to be defined")
  }
}

/** Assert that an array contains a specific element. */
export function assertContains<T>(array: ReadonlyArray<T>, element: T, message?: string): void {
  if (!array.includes(element)) {
    throw new Error(
      message ?? `Expected array to contain ${JSON.stringify(element)}`,
    )
  }
}

/** Assert that an array is empty. */
export function assertEmpty<T>(array: ReadonlyArray<T>, message?: string): void {
  if (array.length > 0) {
    throw new Error(message ?? `Expected array to be empty, got ${array.length} elements`)
  }
}

/** Assert that a number is within a range. */
export function assertRange(value: number, min: number, max: number, message?: string): void {
  if (value < min || value > max) {
    throw new Error(
      message ?? `Expected ${value} to be between ${min} and ${max}`,
    )
  }
}

export * as Testing from "./testing"
