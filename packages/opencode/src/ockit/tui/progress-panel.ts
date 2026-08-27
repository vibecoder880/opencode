// OC Kit TUI — Workflow progress panel.
// Displays the real-time status of a running workflow: current step, overall
// progress, and step outcomes. Designed to be rendered by the TUI layer via
// a lightweight data model (no React/Ink dependency at this layer).

import type { Kit, Workflow, WorkflowStep } from "../types"
import type { StepOutcome, WorkflowRunRecord } from "../workflow"
import type { WorkflowState } from "../types"

/** Snapshot of the workflow progress for rendering. */
export interface ProgressSnapshot {
  /** The kit this workflow belongs to. */
  readonly kit: { readonly id: string; readonly name: string; readonly version: string }
  /** Workflow metadata. */
  readonly workflow: { readonly id: string; readonly description: string }
  /** Current run state. */
  readonly state: WorkflowState
  /** Total number of steps in the workflow. */
  readonly totalSteps: number
  /** Number of completed steps (ok + recovered). */
  readonly completedSteps: number
  /** Number of failed steps. */
  readonly failedSteps: number
  /** Percentage complete (0–100). */
  readonly percent: number
  /** The currently running step (undefined when idle or finished). */
  readonly currentStep?: StepProgress
  /** Per-step progress entries. */
  readonly steps: ReadonlyArray<StepProgress>
  /** Run start time (ISO string). */
  readonly startedAt?: string
  /** Run completion time (ISO string, undefined if still running). */
  readonly completedAt?: string
}

/** Progress for a single step. */
export interface StepProgress {
  /** Step key (e.g., "step-0"). */
  readonly key: string
  /** Skill id for this step. */
  readonly skill: string
  /** Step status. */
  readonly status: "pending" | "running" | "ok" | "recovered" | "failed" | "skipped"
  /** Attempt number (1-based). */
  readonly attempt: number
  /** Maximum retry attempts. */
  readonly maxAttempts: number
}

/**
 * Build a progress snapshot from a workflow run record and step outcomes.
 * Pure function — no side effects.
 */
export function buildProgressSnapshot(
  kit: Kit,
  workflow: Workflow,
  record: WorkflowRunRecord,
  steps: ReadonlyArray<StepOutcome>,
): ProgressSnapshot {
  const totalSteps = workflow.steps.length
  const completedSteps = steps.filter(
    (s) => s.status === "ok" || s.status === "recovered",
  ).length
  const failedSteps = steps.filter((s) => s.status === "failed").length

  const stateMap = new Map<string, StepOutcome>()
  for (const step of steps) {
    stateMap.set(step.key, step)
  }

  const stepProgresses: StepProgress[] = workflow.steps.map((ws) => {
    const outcome = stateMap.get(stepKey(ws))
    const status = outcome
      ? outcome.status === "ok" || outcome.status === "recovered"
        ? outcome.status
        : outcome.status === "failed"
          ? "failed"
          : "ok" // shouldn't happen, but exhaustive
      : record.startedAt && !record.completedAt
        ? "pending"
        : "skipped"

    return {
      key: stepKey(ws),
      skill: ws.skill,
      status: status as StepProgress["status"],
      attempt: outcome ? 1 : 0, // simplified; real attempt count from runner
      maxAttempts: 1,
    }
  })

  const currentStep = stepProgresses.find((s) => s.status === "pending")
  const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

  return {
    kit: { id: kit.id, name: kit.name, version: kit.version },
    workflow: { id: workflow.id, description: workflow.description ?? workflow.id },
    state: record.state ?? "blocked",
    totalSteps,
    completedSteps,
    failedSteps,
    percent,
    currentStep,
    steps: stepProgresses,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  }
}

/** Format a progress snapshot as a human-readable string. */
export function formatProgress(snapshot: ProgressSnapshot): string {
  const lines: string[] = []
  const { kit, workflow, state, percent, completedSteps, failedSteps, totalSteps, steps } = snapshot

  lines.push(`Kit: ${kit.name}@${kit.version}`)
  lines.push(`Workflow: ${workflow.description}`)
  lines.push(`State: ${state}`)
  lines.push(`Progress: ${percent}% (${completedSteps}/${totalSteps} steps, ${failedSteps} failed)`)
  lines.push("")

  for (const step of steps) {
    const icon =
      step.status === "ok" ? "✓" :
      step.status === "recovered" ? "↺" :
      step.status === "failed" ? "✗" :
      step.status === "running" ? "⟳" :
      "○"
    lines.push(`  ${icon} ${step.key} [${step.skill}]`)
  }

  return lines.join("\n")
}

/** Derive the step key from a WorkflowStep (matches the runner's stepKey). */
function stepKey(step: WorkflowStep): string {
  return step.as ?? step.skill
}
