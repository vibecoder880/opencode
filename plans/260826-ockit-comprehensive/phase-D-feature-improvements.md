---
phase: D
title: "Feature Improvements for OC Kit"
status: pending
priority: P3
effort: "5d"
dependencies: ["Phase A", "Phase B", "Phase C"]
---

# Phase D: Feature Improvements for OC Kit

## Overview

Eight new capabilities to make OC Kit production-ready. Each feature is independent and can be implemented in parallel by different agents.

## Feature 1: Kit Dependencies

**Problem**: Kits can't depend on other kits.
**Solution**: Add `dependencies` field to Kit manifest with semver range support.

```yaml
# kit.json
{
  "id": "advanced-research",
  "dependencies": {
    "oc-research-base": "^1.0.0",
    "oc-analysis-tools": "~2.1.0"
  }
}
```

**Files**:
- Modify: `packages/opencode/src/ockit/types.ts` (add `dependencies` to Kit schema)
- Modify: `packages/opencode/src/ockit/resolver.ts` (add dependency resolution)
- Create: `packages/opencode/test/ockit/dependency-resolution.test.ts`

## Feature 2: Sandboxed Hook Execution

**Problem**: Hooks run with full system access.
**Solution**: Run hooks in sandboxed environment with restricted permissions.

```yaml
# kit.json hooks section
{
  "hooks": [
    {
      "event": "pre-commit",
      "command": "validate-kit.sh",
      "sandbox": {
        "network": false,
        "filesystem": ["./skills", "./agents"],
        "timeout": 30
      }
    }
  ]
}
```

**Files**:
- Modify: `packages/opencode/src/ockit/hook/dispatcher.ts` (add sandbox support)
- Create: `packages/opencode/src/ockit/hook/sandbox.ts`
- Create: `packages/opencode/test/ockit/hook/sandbox.test.ts`

## Feature 3: Kit Marketplace

**Problem**: No discovery mechanism for kits.
**Solution**: Add `oc kit search` command that queries a kit registry.

```bash
oc kit search "research"
# Found 3 kits:
# 1. oc-research-base (1.0.0) - Base research toolkit
# 2. advanced-research (2.1.0) - Advanced research capabilities
# 3. quick-research (0.5.0) - Fast research scripts
```

**Files**:
- Create: `packages/opencode/src/ockit/marketplace.ts`
- Modify: `packages/opencode/src/ockit/cli.ts` (add search command)
- Create: `packages/opencode/test/ockit/marketplace.test.ts`

## Feature 4: Kit Testing Framework

**Problem**: No way to test kits before publishing.
**Solution**: Add `oc kit test` command that validates kit structure and runs tests.

```bash
oc kit test ./my-kit
# Validating manifest... OK
# Checking skill files... OK
# Running kit tests... 5/5 passed
# Package ready for publishing
```

**Files**:
- Create: `packages/opencode/src/ockit/tester.ts`
- Modify: `packages/opencode/src/ockit/cli.ts` (add test command)
- Create: `packages/opencode/test/ockit/tester.test.ts`

## Feature 5: Runtime Metrics

**Problem**: No visibility into kit execution performance.
**Solution**: Track and report kit execution metrics.

```typescript
interface KitMetrics {
  readonly executions: number
  readonly avgDuration: number
  readonly errorRate: number
  readonly lastExecuted: string
}
```

**Files**:
- Create: `packages/opencode/src/ockit/metrics.ts`
- Modify: `packages/opencode/src/ockit/workflow/engine.ts` (instrument execution)
- Create: `packages/opencode/test/ockit/metrics.test.ts`

## Feature 6: Multi-Kit Orchestration

**Problem**: Can't run workflows across multiple kits.
**Solution**: Add orchestration layer that coordinates multi-kit workflows.

```yaml
# orchestration.yaml
{
  "name": "full-research-pipeline",
  "kits": [
    { "kit": "oc-research-base", "workflow": "gather" },
    { "kit": "oc-analysis-tools", "workflow": "analyze" },
    { "kit": "oc-report-gen", "workflow": "report" }
  ]
}
```

**Files**:
- Create: `packages/opencode/src/ockit/orchestrator.ts`
- Modify: `packages/opencode/src/ockit/workflow/engine.ts` (add orchestration support)
- Create: `packages/opencode/test/ockit/orchestrator.test.ts`

## Feature 7: Kit Templates

**Problem**: Creating kits from scratch is tedious.
**Solution**: Add `oc kit init` command with templates.

```bash
oc kit init --template research
# Created kit structure:
#   kit.json
#   skills/
#     research.md
#   agents/
#     researcher.md
#   workflows/
#     research.yaml
```

**Files**:
- Create: `packages/opencode/src/ockit/templates/`
- Modify: `packages/opencode/src/ockit/cli.ts` (add init command)
- Create: `packages/opencode/test/ockit/templates.test.ts`

## Feature 8: Hot Reload for Development

**Problem**: Kit changes require restart.
**Solution**: Watch kit files and reload on change.

```bash
oc kit dev ./my-kit
# Watching for changes...
# [12:00:01] skills/plan.md changed, reloading...
# [12:00:02] Kit reloaded successfully
```

**Files**:
- Create: `packages/opencode/src/ockit/dev-server.ts`
- Modify: `packages/opencode/src/ockit/cli.ts` (add dev command)
- Create: `packages/opencode/test/ockit/dev-server.test.ts`

## Implementation Strategy

### Parallel Execution
Features 1-8 are independent. Assign to subagents:

| Agent | Feature | Files |
|-------|---------|-------|
| Agent 1 | Kit Dependencies | types.ts, resolver.ts |
| Agent 2 | Sandboxed Hooks | hook/dispatcher.ts, hook/sandbox.ts |
| Agent 3 | Kit Marketplace | marketplace.ts, cli.ts |
| Agent 4 | Kit Testing | tester.ts, cli.ts |
| Agent 5 | Runtime Metrics | metrics.ts, workflow/engine.ts |
| Agent 6 | Multi-Kit Orchestration | orchestrator.ts |
| Agent 7 | Kit Templates | templates/, cli.ts |
| Agent 8 | Hot Reload | dev-server.ts, cli.ts |

### File Conflict Avoidance
- Agents 3, 4, 7, 8 all modify `cli.ts` → serialize these changes
- Agent 5 modifies `workflow/engine.ts` → coordinate with Phase B
- All other files are unique per feature

### CI/CD Strategy
- Each feature gets its own PR
- PR → CI (test.yml + typecheck.yml) → merge to main
- No local build required

## Success Criteria

- [ ] All 8 features implemented with tests
- [ ] No breaking changes to existing API
- [ ] All unit tests pass
- [ ] Typecheck passes
- [ ] Documentation updated

## Risk Assessment

- **Risk**: Feature interactions cause unexpected behavior
- **Mitigation**: Each feature is isolated; integration tests in Phase E
- **Risk**: Too many features overwhelm users
- **Mitigation**: Start with features 1-4 (core); features 5-8 are enhancements
- **Risk**: Performance overhead from metrics/sandboxing
- **Mitigation**: Make metrics opt-in; sandboxing only for untrusted kits
