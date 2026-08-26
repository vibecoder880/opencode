---
phase: B
title: "Phase 4: Workflow-Session Integration"
status: pending
priority: P1
effort: "3d"
dependencies: ["Phase 3"]
---

# Phase B: Workflow-Session Integration

## Overview

Bridge the OC Kit workflow engine with OpenCode's session system. This phase enables workflows to execute within sessions, manages agent permissions during workflow runs, and integrates workflow-specific tool access.

## Requirements

- Workflows can be triggered from within a session
- Workflow runs are tracked per-session
- Agent permissions are scoped to workflow steps
- Workflow state persists across session interruptions
- Tool access is controlled per-workflow-step

## Architecture

### Current State
- **Workflow engine** (`workflow/engine.ts`): Validates graphs, runs steps, produces `RunSummary`
- **Session system** (`session/`): Manages durable conversation history, provider turns
- **Gap**: No connection between workflows and sessions

### Target State
```
Session → triggers workflow → WorkflowEngine.run()
  → Each step runs in session context
  → Agent permissions scoped per step
  → Tool results fed back to session
  → Workflow state persisted in session
```

### Data Flow
1. User invokes workflow in session (via slash command or agent)
2. Session creates `WorkflowRun` record
3. Workflow engine executes steps sequentially
4. Each step's agent/tool access is scoped by workflow config
5. Step results are appended to session history
6. Workflow completion updates session state

## Related Code Files

- Create: `packages/opencode/src/ockit/workflow/session-bridge.ts`
- Create: `packages/opencode/src/ockit/workflow/permission-scope.ts`
- Modify: `packages/opencode/src/ockit/workflow/engine.ts` (add session integration)
- Modify: `packages/opencode/src/ockit/workflow/runner.ts` (add permission scoping)
- Create: `packages/opencode/test/ockit/workflow/session-bridge.test.ts`
- Create: `packages/opencode/test/ockit/workflow/permission-scope.test.ts`

## Implementation Steps

### Step 1: Session Bridge (`session-bridge.ts`)

Create a bridge between sessions and workflows:

```typescript
import { Effect } from "effect"
import type { Kit, Workflow } from "../types"
import type { RunSummary } from "./engine"

export interface WorkflowSessionBridge {
  /** Trigger a workflow from within a session. */
  trigger(sessionId: string, kit: Kit, workflow: Workflow): Effect.Effect<RunSummary>
  
  /** Get all workflow runs for a session. */
  runs(sessionId: string): Effect.Effect<ReadonlyArray<WorkflowRun>>
  
  /** Get a specific workflow run. */
  run(sessionId: string, runId: string): Effect.Effect<WorkflowRun | undefined>
}

export interface WorkflowRun {
  readonly runId: string
  readonly workflowId: string
  readonly sessionId: string
  readonly state: WorkflowState
  readonly startedAt: string
  readonly completedAt: string | undefined
}
```

### Step 2: Permission Scope (`permission-scope.ts`)

Scope agent permissions per workflow step:

```typescript
import { Effect } from "effect"
import type { Kit, WorkflowStep } from "../types"

export interface PermissionScope {
  /** Get allowed tools for a workflow step. */
  allowedTools(step: WorkflowStep, kit: Kit): Effect.Effect<ReadonlyArray<string>>
  
  /** Check if an agent is allowed for a step. */
  agentAllowed(agentId: string, step: WorkflowStep, kit: Kit): Effect.Effect<boolean>
}
```

### Step 3: Integrate with Engine

Modify `engine.ts` to accept session context:

```typescript
export interface EngineRunOptions {
  // ... existing fields
  readonly sessionId?: string
  readonly permissionScope?: PermissionScope
}
```

### Step 4: Integrate with Runner

Modify `runner.ts` to apply permission scoping:

```typescript
// In runStep(), before executing:
const allowedTools = yield* permissionScope.allowedTools(step, kit)
// Filter tool registry to only allowed tools
```

### Step 5: Persist Workflow State

Store workflow runs in session history:

```typescript
// After workflow completion:
yield* session.appendMessage(sessionId, {
  role: "system",
  content: `Workflow ${workflow.id} completed: ${summary.state}`,
})
```

### Step 6: CLI Integration

Add workflow trigger to CLI:

```bash
oc kit run <workflow-id> --session <session-id>
```

## Success Criteria

- [ ] Workflows can be triggered from sessions
- [ ] Workflow runs are tracked per-session
- [ ] Agent permissions are scoped per step
- [ ] Tool access is controlled per-workflow-step
- [ ] Workflow state persists across interruptions
- [ ] Unit tests pass for session-bridge and permission-scope
- [ ] Typecheck passes

## Risk Assessment

- **Risk**: Session system changes could break existing behavior
- **Mitigation**: Bridge is additive; no changes to core session logic
- **Risk**: Permission scoping too restrictive
- **Mitigation**: Default to full permissions; scope only when kit declares restrictions
- **Risk**: Workflow state persistence adds complexity
- **Mitigation**: Use existing checkpoint system for state snapshots
