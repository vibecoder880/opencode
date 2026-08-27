// OC Kit workflow engine — module entry. Self-exports so consumers can
// `import * as Workflow from "./workflow"` (or re-export it from src/ockit/index).
// Contains no other logic: the engine, state machine, runner, scheduler, and
// graph validator each live in their own kebab-case module.

export * as Graph from "./graph"
export * as State from "./state"
export * as Runner from "./runner"
export * as Scheduler from "./scheduler"
export { WorkflowEngine, runWorkflow, runIdFor, type RunSummary } from "./engine"
export { WorkflowError, validateGraph, type GraphValidation } from "./graph"
export {
  createRecord,
  applyEvent,
  stepKey,
  transition,
  IllegalTransitionError,
  type StateEvent,
  type WorkflowRunRecord,
} from "./state"
export {
  runSteps,
  defaultExecutor,
  type StepOutcome,
  type StepExecutor,
  type StepExecResult,
  type RunOptions,
  type RunResult,
} from "./runner"
export {
  triggerWorkflow,
  triggerAndReport,
  getSessionRuns,
  getSessionRun,
  clearSessionRuns,
  SessionBridgeError,
  type SessionWorkflowRun,
} from "./session-bridge"
export * as PermissionScope from "./permission-scope"
export {
  resolveStepPermissions,
  isToolAllowed,
  isAgentAllowed,
  filterAllowedTools,
  filterAllowedAgents,
  type StepPermissions,
} from "./permission-scope"
