// OC Kit core domain types. Every OC Kit primitive (Kit, Skill, Agent,
// Workflow, Hook, Artifact, Checkpoint, Ownership) is an Effect Schema so
// loaded kit manifests validate structurally and errors are typed.

import { Schema } from "effect"

/**
 * A workflow step references one capability (a skill) plus optional per-step
 * overrides. `run` names the skill; `as` is an optional local alias used when
 * the same skill is referenced more than once in a workflow.
 */
export const WorkflowStep = Schema.Struct({
  skill: Schema.String,
  as: Schema.optional(Schema.String),
})
export type WorkflowStep = Schema.Schema.Type<typeof WorkflowStep>

/** A workflow is an ordered sequence of skills with an optional failure handler. */
export const Workflow = Schema.Struct({
  id: Schema.String,
  description: Schema.optional(Schema.String),
  steps: Schema.Array(WorkflowStep),
  onFailure: Schema.optional(Schema.Array(Schema.String)),
})
export type Workflow = Schema.Schema.Type<typeof Workflow>

/** Skill capability declared by a kit. Maps onto OpenCode's SKILL.md format. */
export const KitSkill = Schema.Struct({
  id: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Array(Schema.String)),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["allow", "deny"]))),
  artifacts: Schema.optional(Schema.Array(Schema.String)),
})
export type KitSkill = Schema.Schema.Type<typeof KitSkill>

/** Agent profile declared by a kit. Maps onto OpenCode's agent md format. */
export const KitAgent = Schema.Struct({
  id: Schema.String,
  role: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  model: Schema.optional(
    Schema.Struct({
      preferred: Schema.String,
      fallback: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
export type KitAgent = Schema.Schema.Type<typeof KitAgent>

/** A lifecycle hook declared by a kit. `event` names the OC Kit event. */
export const KitHook = Schema.Struct({
  event: Schema.String,
  command: Schema.String,
})
export type KitHook = Schema.Schema.Type<typeof KitHook>

/** A kit manifest (`kit.yaml`) describing one workflow package. */
export const Kit = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  runtime: Schema.optional(Schema.Literal("opencode")),
  min_opencode: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(KitSkill)),
  agents: Schema.optional(Schema.Array(KitAgent)),
  workflows: Schema.optional(Schema.Array(Workflow)),
  hooks: Schema.optional(Schema.Array(KitHook)),
})
export type Kit = Schema.Schema.Type<typeof Kit>

/** OC Kit runtime modes (fast/normal/deep/autonomous). */
export const Mode = Schema.Literals(["fast", "normal", "deep", "autonomous"])
export type Mode = Schema.Schema.Type<typeof Mode>

/** Workflow lifecycle states. */
export const WorkflowState = Schema.Literals([
  "CREATED",
  "PLANNING",
  "IMPLEMENTING",
  "TESTING",
  "REVIEWING",
  "VERIFYING",
  "BLOCKED",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
])
export type WorkflowState = Schema.Schema.Type<typeof WorkflowState>

/** Session-scoped workflow run state. */
export const WorkflowRun = Schema.Struct({
  session_id: Schema.String,
  workflow_id: Schema.String,
  run_id: Schema.String,
  agent: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  state: WorkflowState,
})
export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>

/** Artifact produced by a workflow. */
export const Artifact = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  workflow_id: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  path: Schema.String,
  status: Schema.Literals(["created", "verified", "failed"]),
  checksum: Schema.optional(Schema.String),
})
export type Artifact = Schema.Schema.Type<typeof Artifact>

/** Checkpoint snapshot before a risky OC Kit operation. */
export const Checkpoint = Schema.Struct({
  kit: Schema.String,
  kit_version: Schema.String,
  operation: Schema.String,
  timestamp: Schema.String,
  session: Schema.optional(Schema.String),
  workflow: Schema.optional(Schema.String),
  files: Schema.Record(Schema.String, Schema.String), // path -> sha256
})
export type Checkpoint = Schema.Schema.Type<typeof Checkpoint>

/**
 * Ownership manifest entry: tracks which kit owns a managed file,
 * at which version, with the sha256 it shipped — so updates/rollbacks can
 * detect user edits and conflicting kits.
 */
export const OwnershipEntry = Schema.Struct({
  owner: Schema.Literal("oc-kit"),
  kit: Schema.String,
  version: Schema.String,
  sha256: Schema.String,
})
export type OwnershipEntry = Schema.Schema.Type<typeof OwnershipEntry>

export const OwnershipManifest = Schema.Struct({
  files: Schema.Record(Schema.String, OwnershipEntry),
})
export type OwnershipManifest = Schema.Schema.Type<typeof OwnershipManifest>

/** OC Kit config section (`oc_kit` in opencode.json). */
export const OCKitConfig = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable OC Kit" }),
  default_kit: Schema.optional(Schema.String).annotate({ description: "Kit used by default" }),
  default_mode: Schema.optional(Mode).annotate({ description: "Default workflow mode" }),
  auto_workflow: Schema.optional(Schema.Boolean).annotate({ description: "Auto-select a workflow from a task" }),
  auto_review: Schema.optional(Schema.Boolean).annotate({ description: "Review after implementation" }),
  auto_test: Schema.optional(Schema.Boolean).annotate({ description: "Test after implementation" }),
  checkpoint: Schema.optional(Schema.Boolean).annotate({ description: "Snapshot before risky updates" }),
  telemetry: Schema.optional(Schema.Boolean).annotate({ description: "Send anonymous operational metrics" }),
})
export type OCKitConfig = Schema.Schema.Type<typeof OCKitConfig>
