# Upstream Tracking

This file records the relationship between this fork and the upstream OpenCode
repository, per the OC Kit integration plan (Phase 0: upstream freeze & audit).

## Upstream

- Repository: `https://github.com/anomalyco/opencode`
- License: MIT

## Fork status

- Local fork: `vibecoder880/opencode`
- Local `packages/opencode/package.json` version: `1.18.18`
- Upstream main has moved beyond this line (upstream exposes a `2.0` branch);
  this fork is a snapshot of the `1.18.x` line and does NOT track upstream main.

## Divergence policy

- OC Kit is designed to extend OpenCode through existing extension points
  (skills, agents, commands, plugins, config, tools) rather than invasive core
  patches.
- We do not re-pin to upstream in Phase 0/1. Re-evaluate upstream sync when a
  concrete merge target is agreed.
- Custom patches to core OpenCode files are documented inline at each patch
  site and summarized in this file.

## Commit conventions

- Conventional commit style: `type(scope): summary`.
- Commit author email: `cavangcute478@gmail.com`.
- Verified via GitHub Actions CI (`test.yml`, `typecheck.yml`) on PRs into `main`.
