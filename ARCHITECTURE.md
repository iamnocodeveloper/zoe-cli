# Architecture

This document explains how Zoe CLI is organised. It is aimed at contributors who want to navigate the codebase or extend it.

> **Status:** this document reflects the v0.1 Public Preview codebase. As the project grows, the architecture will evolve. If something here has drifted from the code, open an issue or a PR to fix it.

## Bird's-eye view

```
┌────────────────────────────────────────────────────────────────┐
│                           zoe CLI                              │
│                                                                │
│   src/cli/           command-line interface (commander)        │
│       │                                                        │
│       ▼                                                        │
│   src/core/          agent, prompts, tools, config              │
│       │                                                        │
│       ├─► src/tools/  file read / write / edit / shell         │
│       │                                                        │
│       ▼                                                        │
│   src/ui/            terminal display, logo, spinner            │
│                                                                │
│   ───────────────────────────  ──────────────────────────      │
│                                │                               │
│                                ▼                               │
│                  InsForge SDK  →  InsForge Cloud                │
│                                │                               │
│                                ▼                               │
│                          AI gateway (DeepSeek, Claude…)        │
└────────────────────────────────────────────────────────────────┘
```

## Directory map

```
src/
├── cli/
│   ├── index.ts              # entry point, registers commands
│   └── commands/             # one file per command
│       ├── chat.ts           # interactive chat
│       ├── login.ts          # `zoe login`
│       ├── logout.ts
│       ├── run.ts            # one-shot task
│       ├── scan.ts           # re-scan project
│       ├── models.ts         # list models
│       ├── use.ts            # select model
│       ├── whoami.ts         # show current user
│       ├── doctor.ts         # health check
│       └── summary.ts
│
├── core/
│   ├── agent.ts              # agent loop, plan/execute/review pipeline
│   ├── config.ts             # user config (~/.zoe/config.json)
│   ├── context.ts            # project context builder
│   ├── insforge.ts           # InsForge client + OAuth + AI gateway
│   ├── intelligence.ts       # project scanner
│   ├── memory.ts             # per-project chat memory
│   ├── prompt.ts             # system prompts
│   ├── session.ts            # session helpers
│   └── tools.ts              # tool registry
│
├── tools/                    # individual tool implementations
│   ├── file-read.ts
│   ├── file-write.ts
│   ├── file-edit.ts
│   ├── glob.ts
│   ├── grep.ts
│   ├── list-dir.ts
│   └── shell.ts
│
└── ui/                       # presentation
    ├── banner.ts
    ├── commands.ts
    ├── display.ts
    ├── input-styles.ts
    ├── loader.ts
    ├── logo.ts
    ├── renderer.ts
    ├── styles.ts
    └── terminal-bg.ts
```

## Key flows

### 1. Authentication flow

`zoe login` opens the browser to the InsForge OAuth endpoint (GitHub provider). A local HTTP server on port `3456` receives the callback with the auth code, exchanges it for a session, and persists the session to `~/.insforge/auth.json`. Subsequent runs restore the session from disk — no re-login required until the token expires.

```
zoe login
  │
  ▼
signInWithOAuth("github")  ───►  opens browser
  │                                  │
  ▼                                  ▼
local server on :3456  ◄─── GitHub callback with code
  │
  ▼
exchangeOAuthCode(code)  ───►  InsForge  ───►  returns accessToken
  │
  ▼
persist to ~/.insforge/auth.json
```

### 2. Task execution flow

For natural-language tasks, Zoe runs a four-phase pipeline:

1. **Plan** — read project context, ask the model for an execution plan.
2. **Confirm** — surface the plan, ask for confirmation on destructive changes.
3. **Execute** — model emits `<function_calls>` blocks; we run the tools.
4. **Review** — second pass that scans the result for incomplete code or broken references.

For casual chat, the same agent loop is used without the planning phase.

### 3. AI gateway

We do not call model providers directly from the CLI. All inference flows through the InsForge AI gateway, which is configured with the project owner's credentials. This means:

- Users do not need to manage API keys.
- The CLI never holds long-lived model-provider credentials.
- New models can be enabled in the InsForge dashboard without changing Zoe.

### 4. Configuration files

| Path | Purpose |
| --- | --- |
| `~/.insforge/project.json` | Linked project metadata (URL, ID, region) |
| `~/.insforge/auth.json` | Persisted OAuth session (token, refresh token) |
| `~/.zoe/config.json` | Zoe preferences (model, display options, session) |
| `.zoe/session.json` | Per-project chat history |

## Extension points

- **Add a tool** — drop a file in `src/tools/`, register it in `src/core/tools.ts`, and the agent will see it in the available tools list.
- **Add a command** — drop a file in `src/cli/commands/` and register it in `src/cli/index.ts`.
- **Change the AI behaviour** — edit the system prompts in `src/core/prompt.ts`.
- **Change the UI** — edit the components in `src/ui/`.

## Design principles

1. **Transparency** — every action goes through a tool that the user can read.
2. **Local-first** — sessions, memory and configs are stored on the user's machine first; the cloud is a sync target, not a source of truth.
3. **No magic** — prompts, tools and pipelines are code, in this repository, reviewable by anyone.
4. **Small surface** — we resist adding new commands or flags until they are needed.

## Open questions

These are things we are still figuring out:

- How should multiple projects be handled in a single terminal session?
- Where does the boundary between Zoe and the IDE live long-term?
- How do we keep prompts portable across model providers?

If any of these interests you, open an issue — contributions welcome.
