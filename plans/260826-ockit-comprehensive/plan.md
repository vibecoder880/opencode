---
title: "OC Kit Comprehensive Plan — Fix, Complete, Improve"
status: in-progress
created: 2026-08-26
branch: main
plan_dir: plans/260826-ockit-comprehensive
---

# OC Kit Comprehensive Plan

## Executive Summary

This plan addresses three critical gaps in the OC Kit development:

1. **PR #12 Fix** — 4 failing unit tests in the installer/updater pipeline (Phase 7-8)
2. **Phase 4 & 6 Implementation** — Missing workflow-session integration and kit packaging
3. **Feature Improvements** — 8 new capabilities to make OC Kit production-ready

## Current State

### Completed Phases (merged to `main`)
| Phase | Description | Status | Lines |
|-------|------------|--------|-------|
| 0 | Upstream freeze & audit | ✅ Done | — |
| 1 | Domain model (types, manifest, registry, resolver, ownership, checkpoint, config) | ✅ Done | 966 |
| 2 | CLI (`oc kit list`, `oc kit validate`) | ✅ Done | 213 |
| 3 | Workflow engine (graph, runner, scheduler, state) | ✅ Done | 538 |
| 5 | Hook dispatcher + artifact manager | ✅ Done | 444 |
| 7-8 | Installer, updater, registry client, doctor | ⚠️ PR #12 failing | ~1000 |

### Missing Phases
| Phase | Gap | Priority |
|-------|-----|----------|
| 4 | Workflow-Session integration | P1 |
| 6 | Kit packaging & distribution | P2 |

### PR #12 Test Failures
- **4 tests failing** in `packages/opencode/test/ockit/`
- Root cause: `update()` and `rollback()` calls missing `extract` mock seam
- Error: `tar -xzf` runs on stub data (`"v2-archive"`) that isn't gzip format

## Workflow Contract

- **No local build/npm i** — CI on GitHub Actions only
- **Light local testing** only
- **Detailed English commits**, conventional format
- **Commit email**: `qk08082009@gmail.com`
- **Push only when tests pass**
- Subagents with **file-conflict avoidance** (orchestration-protocol)
- Each agent monitors its own CI/CD

## Plan Phases

| Phase | Title | Priority | Depends On |
|-------|-------|----------|------------|
| A | Fix PR #12 test failures | P0 | None |
| B | Phase 4: Workflow-Session Integration | P1 | Phase 3 |
| C | Phase 6: Kit Packaging & Distribution | P2 | Phase 1 |
| D | Feature Improvements | P3 | All above |

## Phase Details

See individual phase files:
- `phase-A-pr12-fix.md`
- `phase-B-workflow-session.md`
- `phase-C-kit-packaging.md`
- `phase-D-feature-improvements.md`

## Risk Assessment

1. **PR #12 fix is low-risk** — only test seams need adjustment, no production code changes
2. **Phase 4 touches session core** — must preserve existing session behavior
3. **Phase 6 requires design decisions** — kit archive format, versioning strategy
4. **Feature improvements are additive** — no breaking changes to existing API

## Verification Strategy

1. Each phase gets its own feature branch
2. PR → CI (test.yml + typecheck.yml) → merge to main
3. Unit tests pass before push
4. Typecheck passes before push
5. No local build required — CI validates everything
