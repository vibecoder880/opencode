# OC Kit — Phase 0 + Phase 1

## Context

This fork (`vibecoder880/opencode`, based on `anomalyco/opencode`) aims to build **OC Kit**: a workflow/agent engineering layer native to OpenCode, turning it into an Agent Runtime + Workflow OS. The full vision is in `OC-Kit_OpenCode_Integration_Plan.md` (Kit → Skill → Agent → Workflow → Hook → Artifact → Checkpoint, plus CLI, registry, installer).

This plan covers the first two phases only (per user decision):

- **Phase 0** — Upstream freeze & codebase audit: verify the vanilla fork builds/tests on CI, pin upstream context, create `UPSTREAM.md`.
- **Phase 1** — OC Kit domain model: `Kit` / `Skill` / `Agent` / `Workflow` / `Hook` / `Artifact` / `Checkpoint` / `Ownership` types + schemas + validators + storage. Exit criteria: load & validate a complete local kit.

## Workflow contract (user-set, persisted in memory)

- No local build / `npm i` / project run. Test + build happen on **GitHub Actions CI**.
- Light tests only locally (and locally we lack `bun`, so verification is CI-first).
- Commit each finished unit with **detailed English** messages; one language (English).
- Commit email: `cavangcute478@gmail.com` (already set for this repo).
- Push only when tests pass.

## Branch strategy (user decision)

- Work on a **feature branch** (per AGENTS.md: ≤3 words, no `feat/` prefix) and open a **PR into `main`** (updated 2026-08-14: user asked to target `main` directly).
- CI (`test.yml`, `typecheck.yml`) triggers on pushes to the base branch and on PRs — so the PR itself is the CI gate.
- NOTE: `origin/main` is an orphan root (`2b5f70e`) unrelated to local history (`1862432`, which `dev` uses). Feature branches must be rebased onto `origin/main` for GitHub to accept PRs.

## Findings from audit (Phase 0)

- Repo is a monorepo; OpenCode runtime lives in `packages/opencode` (version 1.18.18).
- `AGENTS.md` governs style: no aliased imports, no star imports, `@/*` → `./src/*`, `@test/*` → `./test/*`, Effect Schema everywhere, kebab-case names, self-export pattern in `src/config/*`.
- CLI commands: yargs `CommandModule` via `effectCmd` (packages/opencode/src/cli/effect-cmd.ts), registered in `src/index.ts` via `.command(X)`.
- Skill system: `packages/opencode/src/skill/index.ts` — loads `SKILL.md` via `ConfigMarkdown.parse`, exposes `Skill.Service` with `get/require/all/available`. Built-in skill `customize-opencode`. Skills also surface as slash commands in `command/index.ts`.
- Agent system: `src/agent/agent.ts` + `src/config/agent.ts`; agents are `.md` files with frontmatter in `.opencode/agent`.
- Config: `ConfigV1.Info` (packages/core/src/v1/config/config.ts) is an `Effect.Schema.Struct`; new sections are added there + a self-export module in `src/config/`.
- Tool registry: `src/tool/registry.ts` — builtins registered via `Tool.init(...)`, custom from plugins/`.opencode/tool`.
- Tests: `bun:test` in `packages/opencode/test/`, `testEffect(layer)` helper (test/lib/effect.ts), fixtures in `test/fixture/fixture.ts`. CI runs `bun turbo test`.
- Upstream reachable (`anomalyco/opencode`); local fork tracks a different line (1.18.18) than upstream main (has `2.0` branch). We do NOT re-pin to upstream in this phase — document the divergence in `UPSTREAM.md`.

## Deliverables

### Phase 0
- [x] `UPSTREAM.md` at repo root — upstream repo URL, fork divergence notes, custom-patch policy.
- [ ] `dev` branch created from `main` and pushed to origin (so PRs can target it). — note: superseded; PRs now target `main` directly.
- [ ] First feature branch pushed + a trivial PR into `main` runs CI green (baseline).

### Phase 1 — `packages/opencode/src/ockit/`
- [ ] `types.ts` — Effect Schema for Kit/Skill/Agent/Workflow/Hook/Artifact/Checkpoint/Ownership.
- [ ] `manifest.ts` — kit manifest parse/validate (`kit.yaml` → typed Kit).
- [ ] `registry.ts` — registry of installed kits + kit metadata index.
- [ ] `resolver.ts` — resolve a skill/agent/workflow by name from an installed kit.
- [ ] `ownership.ts` — ownership manifest (`files → {owner, kit, version, sha256}`), conflict detection.
- [ ] `checkpoint.ts` — checkpoint records (before/after hashes, operation, session).
- [ ] `config.ts` — `oc_kit` config schema (enabled, default_kit, default_mode, auto_workflow, checkpoint, telemetry).
- [ ] `index.ts` — export surface + `ockit` namespace.
- [ ] Unit tests in `packages/opencode/test/ockit/` (manifest, registry, resolver, ownership, checkpoint, config).

Note: workflow engine, hook dispatcher, artifact manager, CLI, installer, registry backend are later phases — NOT in scope here (YAGNI).

## Files to create

```
packages/opencode/src/ockit/{index,types,manifest,registry,resolver,ownership,checkpoint,config}.ts
packages/opencode/test/ockit/*.test.ts
UPSTREAM.md
```

## Verification (CI-first)

1. Feature branch → push → open PR into `main`.
2. GitHub Actions `test.yml` runs `bun turbo test` (unit tests incl. new `ockit` tests) on the PR.
3. `typecheck.yml` runs `bun typecheck`.
4. Only merge PR (to `main`) when both are green.
5. Commit messages: English, conventional format, email `cavangcute478@gmail.com`.

## Risks / rollback

- `origin/main` is an orphan root unrelated to local history; rebasing feature branches onto `origin/main` is required for GitHub to accept PRs.
- CI is currently blocked: every test/typecheck workflow uses `blacksmith-*` self-hosted runner labels that are not registered on this standalone repo. Unblock requires registering runners (or switching CI to GitHub-hosted runners).
- Adding `oc_kit` to `ConfigV1.Info` touches the shared config schema — keep it strictly optional so existing projects are unaffected (plan §40 compatibility).
- No runtime wiring yet (no workflow engine / hooks) — no risk to existing OpenCode behavior in this phase.
