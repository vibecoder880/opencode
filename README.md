<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent with OC Kit support.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/vibecoder880/opencode/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/vibecoder880/opencode/typecheck.yml?style=flat-square&branch=main" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

## About

This is a fork of [OpenCode](https://github.com/anomalyco/opencode) with **OC Kit** support added. OC Kit is a package management system for AI coding agents, enabling you to install, update, and manage reusable skill packages.

### What's New in This Fork

- **OC Kit Package Manager** - Install, update, validate, and manage AI agent skill packages
- **Kit Packaging & Publishing** - Create and distribute your own OC Kits
- **Workflow Engine** - Define and execute multi-step AI workflows
- **Hook System** - Run custom scripts on lifecycle events
- **Dependency Resolution** - Kits can depend on other kits
- **Sandboxed Execution** - Run untrusted hooks in sandboxed environments

---

## Installation

### OpenCode

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### OC Kit (This Fork)

OC Kit is built into this fork. After installing OpenCode, you can use the `oc kit` commands directly.

#### Quick Start

```bash
# List installed kits
oc kit list

# Install a kit from GitHub
oc kit install <kit-id>

# Search for kits on marketplace
oc kit search <query>

# Validate a kit manifest
oc kit validate <kit-dir-or-id>

# Get health report
oc kit doctor
```

#### Single-Command Install (Sh)

```bash
# Install OC Kit (macOS / Linux / WSL)
curl -fsSL https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.sh | bash

# Install specific kit
OCKIT_KIT_VERSION=1.0.0 curl -fsSL https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.sh | bash -s -- engineer
```

#### Single-Command Install (PowerShell)

```powershell
# Install OC Kit (Windows)
irm https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.ps1 | iex
```

#### Installation Directory

The installer respects the following priority order:

1. `$OCKIT_INSTALL_DIR` - Custom installation directory
2. `$HOME/.opencode-kits/<kit-id>` - Default location

```bash
# Custom install directory
OCKIT_INSTALL_DIR=/usr/local/lib/oc-kits curl -fsSL https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.sh | bash
```

---

## OC Kit Commands

| Command | Description |
|---------|-------------|
| `oc kit list` | List all installed kits |
| `oc kit validate <target>` | Validate a kit manifest |
| `oc kit install <source>` | Install a kit from a local directory |
| `oc kit update <kit-id>` | Update an installed kit |
| `oc kit rollback <kit-id>` | Rollback to previous version |
| `oc kit doctor` | Health check for installed kits |
| `oc kit pack <source>` | Create a kit archive (.tar.gz) |
| `oc kit publish <archive>` | Publish kit to GitHub release |
| `oc kit search <query>` | Search marketplace for kits |
| `oc kit test <kit-id>` | Test kit before publishing |
| `oc kit init` | Initialize a new kit from template |
| `oc kit dev` | Hot reload for kit development |

### Kit Manifest Structure

```json
{
  "id": "my-kit",
  "name": "My Kit",
  "version": "1.0.0",
  "description": "A custom AI agent kit",
  "min_opencode": "0.1.0",
  "skills": ["plan", "research"],
  "agents": ["analyst"],
  "workflows": ["research-flow"],
  "hooks": {
    "pre-commit": ["validate.sh"]
  },
  "dependencies": {
    "base-kit": "^1.0.0"
  }
}
```

### Kit Directory Layout

```
my-kit/
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

---

## Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg` |
| macOS (Intel) | `opencode-desktop-mac-x64.dmg` |
| Windows | `opencode-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, or `.AppImage` |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

---

## Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

---

## Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### OC Kit Documentation

- [Kit Manifest Reference](./packages/opencode/src/ockit/manifest.ts)
- [Kit Types](./packages/opencode/src/ockit/types.ts)
- [CLI Implementation](./packages/opencode/src/ockit/cli.ts)
- [Workflow Engine](./packages/opencode/src/ockit/workflow/)

---

## Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
