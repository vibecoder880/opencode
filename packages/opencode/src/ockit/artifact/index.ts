// OC Kit artifact subsystem: typed artifact manager + persistent manifest index.
// This index aggregates the leaf modules AND self-exports the subsystem as the
// `Artifact` namespace, so integrators can `import { Artifact } from
// "./artifact"`.

export * from "./manager"
export * from "./manifest"

export * as Artifact from "./artifact"