// OC Kit lifecycle events. Each event is an Effect Schema so dispatch payloads
// validate structurally before the hook bus forwards them. Events carry only the
// data a hook command needs to observe the lifecycle moment — never handles to
// elevate permission or bypass OpenCode's security system.

import { Schema } from "effect"

const KitInstalled = Schema.Struct({
  _tag: Schema.Literal("kit:install"),
  kit: Schema.String,
  version: Schema.String,
  timestamp: Schema.String,
})

const KitUpdated = Schema.Struct({
  _tag: Schema.Literal("kit:update"),
  kit: Schema.String,
  from: Schema.String,
  to: Schema.String,
  timestamp: Schema.String,
})

const KitRemoved = Schema.Struct({
  _tag: Schema.Literal("kit:remove"),
  kit: Schema.String,
  timestamp: Schema.String,
})

const SessionStarted = Schema.Struct({
  _tag: Schema.Literal("session:start"),
  session_id: Schema.String,
  timestamp: Schema.String,
})

const SessionEnded = Schema.Struct({
  _tag: Schema.Literal("session:end"),
  session_id: Schema.String,
  timestamp: Schema.String,
})

const WorkflowStarted = Schema.Struct({
  _tag: Schema.Literal("workflow:start"),
  workflow_id: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const WorkflowEnded = Schema.Struct({
  _tag: Schema.Literal("workflow:end"),
  workflow_id: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const SkillBefore = Schema.Struct({
  _tag: Schema.Literal("skill:before"),
  skill: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const SkillAfter = Schema.Struct({
  _tag: Schema.Literal("skill:after"),
  skill: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const ToolBefore = Schema.Struct({
  _tag: Schema.Literal("tool:before"),
  tool: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const ToolAfter = Schema.Struct({
  _tag: Schema.Literal("tool:after"),
  tool: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const PermissionRequested = Schema.Struct({
  _tag: Schema.Literal("permission:request"),
  action: Schema.String,
  resource: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const ArtifactCreated = Schema.Struct({
  _tag: Schema.Literal("artifact:created"),
  artifact_id: Schema.String,
  artifact_type: Schema.String,
  session_id: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const CheckpointCreated = Schema.Struct({
  _tag: Schema.Literal("checkpoint:created"),
  checkpoint_id: Schema.String,
  kit: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const VerificationFailed = Schema.Struct({
  _tag: Schema.Literal("verification:failed"),
  artifact_id: Schema.String,
  reason: Schema.optional(Schema.String),
  timestamp: Schema.String,
})

const VerificationPassed = Schema.Struct({
  _tag: Schema.Literal("verification:passed"),
  artifact_id: Schema.String,
  timestamp: Schema.String,
})

/** Union of every OC Kit lifecycle event (discriminated by the `_tag` name). */
export const OCEvent = Schema.Union([
  KitInstalled,
  KitUpdated,
  KitRemoved,
  SessionStarted,
  SessionEnded,
  WorkflowStarted,
  WorkflowEnded,
  SkillBefore,
  SkillAfter,
  ToolBefore,
  ToolAfter,
  PermissionRequested,
  ArtifactCreated,
  CheckpointCreated,
  VerificationFailed,
  VerificationPassed,
]).annotate({ discriminator: "_tag", identifier: "OCEvent" })

export type OCEvent = Schema.Schema.Type<typeof OCEvent>

/** Event name string ("kit:install", "session:start", …). */
export type OCEventName = OCEvent["_tag"]

/** The canonical set of lifecycle event names. */
export const EVENT_NAMES: readonly OCEventName[] = [
  "kit:install",
  "kit:update",
  "kit:remove",
  "session:start",
  "session:end",
  "workflow:start",
  "workflow:end",
  "skill:before",
  "skill:after",
  "tool:before",
  "tool:after",
  "permission:request",
  "artifact:created",
  "checkpoint:created",
  "verification:failed",
  "verification:passed",
]