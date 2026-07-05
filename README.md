# ZOE CLI

**Understand your project before AI does.**

Zoe analyzes your project before generating code.
It helps developers understand, plan and safely build software directly from the terminal.

[![npm](https://img.shields.io/npm/v/@nocodeveloper/zoe-cli.svg)](https://www.npmjs.com/package/@nocodeveloper/zoe-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/iamnocodeveloper/zoe-cli.svg)](https://github.com/iamnocodeveloper/zoe-cli/stargazers)
[![Issues](https://img.shields.io/github/issues/iamnocodeveloper/zoe-cli.svg)](https://github.com/iamnocodeveloper/zoe-cli/issues)
[![Last Commit](https://img.shields.io/github/last-commit/iamnocodeveloper/zoe-cli.svg)](https://github.com/iamnocodeveloper/zoe-cli/commits/main)

**Status:** Public Preview
**Current npm `latest`:** 2.5.3
**Project milestone:** v0.1 Public Preview

[Website](https://getzoe.cloud) · [Docs](./docs/installation.md) · [Roadmap](./ROADMAP.md) · [Changelog](./CHANGELOG.md)

---

## Installation

```bash
npm install -g @nocodeveloper/zoe-cli
```

## Quick Start

```bash
cd my-project
```

```bash
zoe
```

1. **Login with GitHub** — one-time OAuth setup
2. **Start building** — chat or run tasks

---

## Features

- **GitHub Login** — one command, no tokens to copy
- **No API Keys** — OpenRouter, AI gateway, secrets all handled by Zoe Cloud
- **Project Intelligence** — scans structure, language, and dependencies automatically
- **Execution Planning** — every task gets a plan before code is written
- **AI Chat** — streaming responses in the terminal
- **Create Files** — full content generated and saved
- **Edit Existing Code** — targeted edits that preserve the rest of the file
- **Safe File Editing** — `edit_file` fails fast if your target text is ambiguous
- **Zoe Cloud** — your session, memory and secrets live in your private cloud
- **Built in Public** — every release is shipped from a public, traceable commit

---

## How Zoe Works

```
Understand    Read your project: files, stack, dependencies
     ↓
Plan          Generate an execution plan, with risks and steps
     ↓
Build         Write and edit code, run commands, apply changes
     ↓
Review        Verify the result and surface any warnings
```

You see every step. Zoe never edits a file without telling you first.

---

## Example

```bash
$ zoe
```

```text
Welcome back, Joel. You are signed in to your project.
Model: deepseek/deepseek-v4-flash

> Analyze this project
```

```text
Reading workspace...
Planning...
  ✓ Scanned 47 files, 12 dependencies
  ✓ Identified: TypeScript, Node, Express
  ✓ Detected 2 critical config files (package.json, tsconfig.json)

Building...
  ✓ Created src/routes/api.ts
  ✓ Edited src/server.ts (added 12 lines)
  ✓ Created tests/api.test.ts

Reviewing...
  ✓ All imports valid
  ✓ No TODOs / placeholders

Completed in 14s. 3 files changed.
```

---

## Roadmap

- ✅ **v0.1 Public Preview** — current
- 🟡 **v0.2 Better Terminal UI** — interactive TUI, inline diffs, multi-pane
- 🟡 **v0.3 Project Intelligence** — semantic search, dependency graph, hotspots
- 🟡 **v0.4 Zoe Cloud** — sessions, history, shareable workspaces
- ⚪ **v1.0 Stable** — API freeze, plugin SDK, enterprise auth

See the full breakdown in [ROADMAP.md](./ROADMAP.md).

---

## Building in Public

Zoe is being developed in public. Every commit, every decision, every failed experiment is part of the journey. If that resonates with you, follow along:

- 🌐 [getzoe.cloud](https://getzoe.cloud)
- 💻 [github.com/iamnocodeveloper/zoe-cli](https://github.com/iamnocodeveloper/zoe-cli)
- 🐦 [@nocodeveloper](https://x.com/nocodeveloper) on X
- 📺 [NoCodeveloper](https://youtube.com/@NoCodeveloper)

---

## Contributing

We welcome issues, feedback, and pull requests. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, coding style, and how to submit a PR.

For community standards, see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

## Security

Found a vulnerability? Please report it privately — see [SECURITY.md](./SECURITY.md).

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Joel Araujo

---

<sub>Zoe is an independent open-source project. AI inference is powered by [InsForge](https://insforge.dev) and routed through the AI gateway configured for your account.</sub>
