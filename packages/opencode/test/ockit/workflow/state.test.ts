import { describe, expect } from "bun:test"
import { it } from "../../lib/effect"
import { Effect } from "effect"
import type { WorkflowStep } from "../../../src/ockit/types"
import {
  transition,
  applyEvent,
  createRecord,
  stepKey,
  IllegalTransitionError,
} from "../../../src/ockit/workflow/state"

describe("ockit workflow state", () => {
  describe("transition", () => {
    it.effect("starts CREATED -> PLANNING", () =>
      Effect.sync(() => {
        expect(transition("CREATED", "start")).toBe("PLANNING")
      }))

    it.effect("advances the activity phases on step-ok", () =>
      Effect.sync(() => {
        let state = transition("CREATED", "start")
        expect(state).toBe("PLANNING")
        state = transition(state, "step-ok")
        expect(state).toBe("IMPLEMENTING")
        state = transition(state, "step-ok")
        expect(state).toBe("TESTING")
        state = transition(state, "step-ok")
        expect(state).toBe("REVIEWING")
        state = transition(state, "step-ok")
        expect(state).toBe("VERIFYING")
        // Beyond the distinct phase labels, VERIFYING self-loops.
        state = transition(state, "step-ok")
        expect(state).toBe("VERIFYING")
      }))

    it.effect("blocks on step-fail and retries in place", () =>
      Effect.sync(() => {
        expect(transition("PLANNING", "step-fail")).toBe("BLOCKED")
        expect(transition("BLOCKED", "retry")).toBe("PLANNING")
        expect(transition("IMPLEMENTING", "step-fail")).toBe("BLOCKED")
        expect(transition("IMPLEMENTING", "retry")).toBe("IMPLEMENTING")
      }))

    it.effect("closes terminal states", () =>
      Effect.sync(() => {
        expect(transition("VERIFYING", "complete")).toBe("COMPLETED")
        expect(transition("BLOCKED", "complete")).toBe("COMPLETED")
        expect(transition("BLOCKED", "fail")).toBe("FAILED")
        expect(transition("PLANNING", "fail")).toBe("FAILED")
        expect(transition("CREATED", "cancel")).toBe("CANCELLED")
      }))

    it.effect("throws a typed error on an illegal transition", () =>
      Effect.sync(() => {
        expect(() => transition("CREATED", "step-ok")).toThrow(IllegalTransitionError)
        expect(() => transition("COMPLETED", "start")).toThrow("Illegal workflow transition")
        expect(() => transition("FAILED", "retry")).toThrow(IllegalTransitionError)
      }))
  })

  describe("applyEvent / createRecord", () => {
    it.effect("creates a record in CREATED with the given ids", () =>
      Effect.sync(() => {
        const record = createRecord({ runId: "wf-1", workflowId: "feature-development", sessionId: "s1", at: "2026-08-20T00:00:00.000Z" })
        expect(record.state).toBe("CREATED")
        expect(record.stepIndex).toBe(0)
        expect(record.recovered).toBe(false)
        expect(record.startedAt).toBe("2026-08-20T00:00:00.000Z")
      }))

    it.effect("bumps stepIndex only on step-ok", () =>
      Effect.sync(() => {
        let record = applyEvent(createRecord({ runId: "r", workflowId: "w", sessionId: "s", at: "t" }), "start")
        record = applyEvent(record, "step-ok")
        expect(record.stepIndex).toBe(1)
        record = applyEvent(record, "step-fail")
        expect(record.stepIndex).toBe(1) // failure does not advance
        record = applyEvent(record, "retry")
        expect(record.stepIndex).toBe(1)
      }))

    it.effect("stamps completedAt on terminal completion", () =>
      Effect.sync(() => {
        let record = applyEvent(createRecord({ runId: "r", workflowId: "w", sessionId: "s", at: "t0" }), "start")
        record = applyEvent(record, "complete")
        expect(record.state).toBe("COMPLETED")
        expect(record.completedAt).toBeDefined()
      }))
  })

  describe("stepKey", () => {
    it.effect("uses the as alias when present, else the skill", () =>
      Effect.sync(() => {
        const aliased: WorkflowStep = { skill: "plan", as: "planner" }
        const plain: WorkflowStep = { skill: "test" }
        expect(stepKey(aliased)).toBe("planner")
        expect(stepKey(plain)).toBe("test")
      }))
  })
})