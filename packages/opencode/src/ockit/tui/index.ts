// OC Kit TUI panels — module entry. Provides the data models and formatters
// for the three TUI panels: workflow progress, artifact viewer, and
// permission panel.
//
// These are pure data models with no React/Ink dependency. The TUI layer
// (plugin/tui or cli/tui) imports these and renders them using whatever
// UI framework is active.

export {
  buildProgressSnapshot,
  formatProgress,
  type ProgressSnapshot,
  type StepProgress,
} from "./progress-panel"

export {
  buildArtifactSnapshot,
  formatArtifacts,
  type ArtifactSnapshot,
  type Artifact,
  type ArtifactType,
} from "./artifact-panel"

export {
  buildPermissionSnapshot,
  formatPermissions,
  type PermissionSnapshot,
  type PermissionEntry,
} from "./permission-panel"
