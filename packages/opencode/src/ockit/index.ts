// OC Kit — workflow/agent engineering layer for OpenCode.
// Phase 1 scope: domain types + manifest/registry/resolver/ownership/checkpoint
// + config access. Workflow engine, hooks, artifact manager, CLI, registry
// backend, and installer arrive in later phases.

export * as OCKitTypes from "./types"
export * as OCKitManifest from "./manifest"
export * as OCKitRegistry from "./registry"
export * as OCKitResolver from "./resolver"
export * as OCKitOwnership from "./ownership"
export * as OCKitCheckpoint from "./checkpoint"
export * as OCKitConfigModule from "./config"

export {
  Kit,
  KitSkill,
  KitAgent,
  Workflow,
  WorkflowStep,
  KitHook,
  WorkflowRun,
  WorkflowState,
  Mode,
  Artifact,
  Checkpoint,
  OwnershipManifest,
  OwnershipEntry,
  OCKitConfig,
} from "./types"

export { Service as Registry, node as registryNode } from "./registry"
export * as OCKitCli from "./cli"
