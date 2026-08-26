---
phase: A
title: "Fix PR #12 Test Failures"
status: pending
priority: P0
effort: "1h"
dependencies: []
---

# Phase A: Fix PR #12 Test Failures

## Overview

Fix 4 failing unit tests in the OC Kit installer/updater pipeline (PR #12). The tests fail because `update()` and `rollback()` calls don't pass the `extract` mock seam, causing real `tar -xzf` to run on stub data.

## Requirements

- All 4 failing tests pass on CI
- No production code changes — only test file modifications
- Tests remain meaningful (not just skipping the extract step)

## Root Cause Analysis

### Failing Tests
1. `ockit registry-remote > treats an incompatible min_opencode as not-found when scanning`
2. `ockit updater > update with --dry-run previews without mutating`
3. `ockit updater > update replaces owned-unmodified files and preserves user edits`
4. `ockit updater > rollback restores the previous bytes from the latest checkpoint`

### Error Pattern
```
ProcessRunFailedError: Command failed with code 2: tar -xzf /tmp/ockit-upd-xxx/.oc/state/update-engineer-xxx/.stage-xxx -C /tmp/ockit-upd-xxx/.oc/state/update-engineer-xxx
gzip: stdin: not in gzip format
```

### Root Cause
The test's `installedV1()` function correctly passes `extract: fakeExtract(KIT_V1_FILES)` to `install()`. However, subsequent `update()` and `rollback()` calls do NOT pass an `extract` option, so the production `extractArchive` function runs `tar -xzf` on stub data (`"v2-archive"`) that isn't gzip format.

## Architecture

### Current Flow (Broken)
```
test calls update("engineer", { source, root })
  → updater calls downloadAndExtract({ ... })
    → downloadAndExtract calls extract(archive, staging)
      → extract is undefined → falls back to extractArchive
        → extractArchive runs tar -xzf on stub bytes
          → FAIL: not gzip format
```

### Fixed Flow
```
test calls update("engineer", { source, root, extract: fakeExtract(KIT_V2_FILES) })
  → updater calls downloadAndExtract({ ..., extract: fakeExtract(KIT_V2_FILES) })
    → downloadAndExtract calls extract(archive, staging)
      → extract is fakeExtract → writes files directly
        → SUCCESS
```

## Related Code Files

- Modify: `packages/opencode/test/ockit/updater.test.ts`
- Modify: `packages/opencode/test/ockit/registry-remote.test.ts` (if applicable)
- Reference: `packages/opencode/src/ockit/updater.ts` (line 37: `extract` option)
- Reference: `packages/opencode/src/ockit/installer.ts` (line 50-51: `extract` seam)

## Implementation Steps

### Step 1: Fix updater.test.ts

Add `extract` mock to all `update()` and `rollback()` calls that trigger extraction:

```typescript
// Line ~133: dry-run test
update("engineer", { source: SOURCE, root, dryRun: true, extract: fakeExtract(KIT_V2_FILES) })

// Line ~156: replace test
update("engineer", { source: SOURCE, root, extract: fakeExtract(KIT_V2_FILES) })

// Line ~188: rollback test
update("engineer", { source: SOURCE, root, extract: fakeExtract(KIT_V2_FILES) })
```

### Step 2: Check registry-remote.test.ts

The `registry-remote` test failure may be a cascade from the same issue. Verify if it calls `install()` or `update()` without the extract seam.

### Step 3: Verify locally

```bash
cd packages/opencode && bun test test/ockit/updater.test.ts
cd packages/opencode && bun test test/ockit/registry-remote.test.ts
```

### Step 4: Commit and push

```bash
git checkout feature/oc-kit-installer
# Make fixes
git add -A
git commit -m "fix(opencode): pass extract mock seam in ockit updater tests

The update() and rollback() calls in updater.test.ts were missing the
extract option, causing the real extractArchive to run tar -xzf on stub
data that isn't gzip format. Pass fakeExtract(KIT_V2_FILES) to all calls
that trigger archive extraction.

Fixes 4 failing tests in PR #12."
git push origin feature/oc-kit-installer
```

## Success Criteria

- [ ] All 4 tests pass in `packages/opencode/test/ockit/updater.test.ts`
- [ ] All tests pass in `packages/opencode/test/ockit/registry-remote.test.ts`
- [ ] `bun turbo test` passes on CI
- [ ] `bun typecheck` passes on CI
- [ ] PR #12 shows all checks green

## Risk Assessment

- **Risk**: Test becomes too shallow (mocking extraction hides real bugs)
- **Mitigation**: The `installer.test.ts` already tests real extraction. Updater tests focus on update logic, not extraction.
- **Risk**: Registry-remote test has a different root cause
- **Mitigation**: Investigate separately if fixing updater tests doesn't resolve it
