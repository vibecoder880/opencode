// OC Kit TUI — Artifact viewer panel.
// Displays artifacts produced by a workflow run. Artifacts are the tangible
// outputs of kit execution: files, reports, generated code, etc.
// Designed as a pure data model — the TUI layer renders it.

import type { Kit, Workflow } from "../types"

/** A single artifact produced by a workflow run. */
export interface Artifact {
  /** Unique artifact id. */
  readonly id: string
  /** Artifact name (human-readable). */
  readonly name: string
  /** Artifact type: file, report, code, config, etc. */
  readonly type: ArtifactType
  /** File path relative to the project root (for file-type artifacts). */
  readonly path?: string
  /** Content summary (first few lines or description). */
  readonly summary?: string
  /** Size in bytes (if known). */
  readonly size?: number
  /** Step that produced this artifact. */
  readonly producedByStep?: string
  /** ISO timestamp of creation. */
  readonly createdAt: string
  /** MIME type if known. */
  readonly mimeType?: string
}

/** Artifact type categories. */
export type ArtifactType = "file" | "report" | "code" | "config" | "log" | "other"

/** Snapshot of all artifacts for a workflow run. */
export interface ArtifactSnapshot {
  /** Kit metadata. */
  readonly kit: { readonly id: string; readonly name: string; readonly version: string }
  /** Workflow metadata. */
  readonly workflow: { readonly id: string; readonly name: string }
  /** Run id. */
  readonly runId: string
  /** All artifacts. */
  readonly artifacts: ReadonlyArray<Artifact>
  /** Artifacts grouped by type. */
  readonly byType: ReadonlyMap<ArtifactType, ReadonlyArray<Artifact>>
  /** Total artifact count. */
  readonly totalCount: number
  /** Total size in bytes (if known). */
  readonly totalSize: number
}

/**
 * Build an artifact snapshot from a list of artifacts.
 * Pure function — no side effects.
 */
export function buildArtifactSnapshot(
  kit: Kit,
  workflow: Workflow,
  runId: string,
  artifacts: ReadonlyArray<Artifact>,
): ArtifactSnapshot {
  const byType = new Map<ArtifactType, Artifact[]>()
  for (const artifact of artifacts) {
    const list = byType.get(artifact.type) ?? []
    list.push(artifact)
    byType.set(artifact.type, list)
  }

  const totalSize = artifacts.reduce((sum, a) => sum + (a.size ?? 0), 0)

  return {
    kit: { id: kit.id, name: kit.name, version: kit.version },
    workflow: { id: workflow.id, name: workflow.name },
    runId,
    artifacts,
    byType: byType as ReadonlyMap<ArtifactType, ReadonlyArray<Artifact>>,
    totalCount: artifacts.length,
    totalSize,
  }
}

/** Format an artifact snapshot as a human-readable string. */
export function formatArtifacts(snapshot: ArtifactSnapshot): string {
  const lines: string[] = []
  const { kit, workflow, artifacts, totalCount, totalSize } = snapshot

  lines.push(`Kit: ${kit.name}@${kit.version}`)
  lines.push(`Workflow: ${workflow.name}`)
  lines.push(`Run: ${workflow.id}`)
  lines.push(`Artifacts: ${totalCount} (${formatSize(totalSize)})`)
  lines.push("")

  if (artifacts.length === 0) {
    lines.push("  (no artifacts produced)")
    return lines.join("\n")
  }

  for (const artifact of artifacts) {
    const icon = artifactIcon(artifact.type)
    const sizeStr = artifact.size !== undefined ? ` (${formatSize(artifact.size)})` : ""
    const pathStr = artifact.path ? ` → ${artifact.path}` : ""
    lines.push(`  ${icon} ${artifact.name}${sizeStr}${pathStr}`)
    if (artifact.summary) {
      lines.push(`    ${artifact.summary}`)
    }
  }

  return lines.join("\n")
}

function artifactIcon(type: ArtifactType): string {
  switch (type) {
    case "file":
      return "📄"
    case "report":
      return "📊"
    case "code":
      return "💻"
    case "config":
      return "⚙️"
    case "log":
      return "📋"
    default:
      return "📦"
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
