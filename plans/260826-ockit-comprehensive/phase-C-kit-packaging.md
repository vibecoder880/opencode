---
phase: C
title: "Phase 6: Kit Packaging & Distribution"
status: pending
priority: P2
effort: "2d"
dependencies: ["Phase 1"]
---

# Phase C: Kit Packaging & Distribution

## Overview

Enable kit creators to package, version, and distribute OC Kits. This phase adds kit archive creation, version management, and publishing workflows.

## Requirements

- Create kit archives (tar.gz) from kit directories
- Semantic versioning for kits
- Checksum verification for downloaded kits
- Kit publishing to GitHub releases
- Kit dependency resolution

## Architecture

### Current State
- **Installer** (`installer.ts`): Downloads and extracts kits from GitHub releases
- **Registry** (`registry-remote.ts`): Resolves kit versions from GitHub API
- **Gap**: No tooling to CREATE kit archives or manage versions

### Target State
```
Kit Creator → oc kit pack → kit-1.0.0.tar.gz
  → oc kit publish → GitHub Release
    → oc kit install → Downloads & extracts
      → oc kit update → Checks for updates
```

### Archive Format
```
kit-1.0.0.tar.gz
├── kit.json              # Manifest (required)
├── skills/               # Skill definitions
│   ├── plan.md
│   └── research.md
├── agents/               # Agent profiles
│   └── analyst.md
├── workflows/            # Workflow definitions
│   └── research.yaml
├── hooks/                # Hook scripts
│   └── pre-commit.sh
└── artifacts/            # Static artifacts
    └── templates/
```

## Related Code Files

- Create: `packages/opencode/src/ockit/packager.ts`
- Create: `packages/opencode/src/ockit/versioning.ts`
- Create: `packages/opencode/src/ockit/publisher.ts`
- Modify: `packages/opencode/src/ockit/cli.ts` (add pack/publish commands)
- Create: `packages/opencode/test/ockit/packager.test.ts`
- Create: `packages/opencode/test/ockit/versioning.test.ts`
- Create: `packages/opencode/test/ockit/publisher.test.ts`

## Implementation Steps

### Step 1: Packager (`packager.ts`)

Create kit archives from directories:

```typescript
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export interface PackOptions {
  readonly sourceDir: string
  readonly outputPath?: string
  readonly version?: string
}

export interface PackResult {
  readonly archivePath: string
  readonly version: string
  readonly checksum: string
  readonly fileCount: number
}

/** Pack a kit directory into a tar.gz archive. */
export const pack = Effect.fn("OCKit.packager.pack")(function* (opts: PackOptions) {
  const fsutil = yield* FSUtil.Service
  
  // 1. Load and validate manifest
  const manifest = yield* loadManifest(opts.sourceDir)
  
  // 2. Determine version
  const version = opts.version ?? manifest.version
  
  // 3. Create archive
  const archivePath = opts.outputPath ?? `${manifest.id}-${version}.tar.gz`
  yield* createArchive(opts.sourceDir, archivePath)
  
  // 4. Compute checksum
  const checksum = yield* computeChecksum(archivePath)
  
  return { archivePath, version, checksum, fileCount: await countFiles(archivePath) }
})
```

### Step 2: Versioning (`versioning.ts`)

Manage semantic versions:

```typescript
import { Effect } from "effect"

export interface VersionInfo {
  readonly current: string
  readonly latest: string
  readonly isUpdatable: boolean
}

/** Parse semantic version. */
export function parseVersion(version: string): {
  major: number
  minor: number
  patch: number
} {
  const [major, minor, patch] = version.split(".").map(Number)
  return { major, minor, patch }
}

/** Compare two versions. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

/** Check if version is compatible (same major). */
export function isCompatible(current: string, target: string): boolean {
  return parseVersion(current).major === parseVersion(target).major
}
```

### Step 3: Publisher (`publisher.ts`)

Publish kits to GitHub releases:

```typescript
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"

export interface PublishOptions {
  readonly owner: string
  readonly repo: string
  readonly archivePath: string
  readonly version: string
  readonly changelog?: string
}

export interface PublishResult {
  readonly releaseUrl: string
  readonly version: string
}

/** Publish a kit archive to a GitHub release. */
export const publish = Effect.fn("OCKit.publisher.publish")(function* (opts: PublishOptions) {
  const http = yield* HttpClient.HttpClient
  
  // 1. Create release
  const release = yield* createRelease(http, opts.owner, opts.repo, opts.version)
  
  // 2. Upload archive
  yield* uploadAsset(http, release.uploadUrl, opts.archivePath)
  
  // 3. Upload checksums
  yield* uploadChecksums(http, release.uploadUrl, opts.archivePath)
  
  return { releaseUrl: release.htmlUrl, version: opts.version }
})
```

### Step 4: CLI Commands

Add to `cli.ts`:

```typescript
// oc kit pack <source-dir> [--output <path>] [--version <ver>]
// oc kit publish <archive> --owner <owner> --repo <repo>
// oc kit version <kit-id> [--bump major|minor|patch]
```

### Step 5: Dependency Resolution

Add to `resolver.ts`:

```typescript
export interface KitDependency {
  readonly id: string
  readonly version: string
  readonly range: string // semver range
}

/** Resolve kit dependencies. */
export const resolveDependencies = Effect.fn("OCKit.resolver.resolveDeps")(function* (
  kit: Kit,
  registry: Registry,
) {
  const deps = kit.dependencies ?? []
  const resolved: Array<{ id: string; version: string }> = []
  
  for (const dep of deps) {
    const version = yield* resolveVersion(registry, dep.id, dep.range)
    resolved.push({ id: dep.id, version })
  }
  
  return resolved
})
```

## Success Criteria

- [ ] `oc kit pack` creates valid tar.gz archives
- [ ] `oc kit publish` uploads to GitHub releases
- [ ] Version comparison works correctly
- [ ] Dependency resolution handles semver ranges
- [ ] Checksums are computed and verified
- [ ] Unit tests pass for packager, versioning, publisher
- [ ] Typecheck passes

## Risk Assessment

- **Risk**: Archive format changes break existing installs
- **Mitigation**: Version the archive format; installer handles both v1 and v2
- **Risk**: GitHub API rate limiting during publish
- **Mitigation**: Implement retry with exponential backoff
- **Risk**: Dependency resolution complexity
- **Mitigation**: Start with simple linear dependencies; no cycles
