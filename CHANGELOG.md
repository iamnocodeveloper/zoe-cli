# Changelog

All notable changes to Zoe CLI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on versioning**
> The npm `latest` tag is currently `2.5.3` (internal development build). The public release cadence uses milestone tags — the first public preview is `v0.1.0-preview`. See the [Roadmap](./ROADMAP.md) for the next milestones.

---

## Public Preview

### v0.1.0-preview — Initial public preview milestone

First release of Zoe CLI as a public preview. Inviting early users, contributors, and feedback.

#### Added

- **GitHub Login** — one-command OAuth setup via the browser. No tokens to copy.
- **Zoe Cloud** — your session, memory and secrets live in your private workspace.
- **DeepSeek Integration** — powered by the AI gateway configured for your account.
- **Project Analysis** — automatic scan of files, tech stack, dependencies and configuration.
- **AI Chat** — streaming responses in the terminal with conversation memory per project.
- **File Editing** — three primitives: `read_file`, `write_file`, `edit_file` (the last one is a targeted patch that fails fast on ambiguous text).
- **Execution Planning** — every task produces a plan, lists affected files, and asks for confirmation on destructive changes.
- **Slash Commands** — `/model`, `/scan`, `/help` while in chat.
- **Tool System** — file operations, glob, grep, shell execution, project context.
- **Session Persistence** — chat history saved automatically per project.
- **npm Package** — install via `npm install -g @nocodeveloper/zoe-cli`.
- **Landing Page** — [getzoe.cloud](https://getzoe.cloud) with full documentation.

#### Internals

- AI inference flows through the InsForge AI gateway.
- Authentication uses the InsForge SDK with GitHub OAuth (PKCE).
- Local configuration is stored under `~/.zoe/` and `~/.insforge/`.
- Project configuration is read from `~/.insforge/project.json`.

---

## Previous internal builds

> These versions were published to npm under the `preview` and `beta` dist-tags during the closed development phase. They are superseded by the milestone above. The current npm `latest` is `2.5.3`.

- `2.5.3` — `edit_file` tool, feedback loop in execution, improved terminal state handling.
- `2.5.0` — AI Gateway migration, OAuth-based login, prompt normalization, project URL auto-resolution.
- `2.4.x` — Project URL resolution from local config, OAuth callback hardening.
- `0.2.0-preview.8` — First self-contained preview (no external InsForge CLI required).
- `0.1.4` — Early preview builds during initial design.
