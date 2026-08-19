// OC Kit hooks subsystem: lifecycle event definitions, the event matcher, and
// the dispatcher that runs a kit's hook commands for matching events.
//
// This index aggregates the three leaf modules AND self-exports the subsystem
// as the `Hook` namespace (same convention as `export * as Checkpoint from
// "./checkpoint"`), so integrators can `import { Hook } from "./hook"`.

export * from "./events"
export * from "./matcher"
export * from "./dispatcher"

export * as Hook from "./index"