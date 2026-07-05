# FAQ

Frequently asked questions about Zoe CLI. Don't see your question? Open a [GitHub discussion](https://github.com/zoe-cli/zoe-cli/discussions).

## General

### What is Zoe?

Zoe is a terminal-native AI coding assistant. It analyses your project before writing code, so it can read existing files, understand your dependencies, and make targeted edits instead of regenerating files from scratch.

### Is Zoe free?

Zoe is open source (MIT licensed). You provide your own account on the InsForge backend, which has a free tier. The cost of AI inference is metered by the model provider you connect through InsForge.

### Is Zoe open source?

Yes. The CLI is MIT-licensed. The only thing you need to bring is an InsForge account — the part that talks to AI providers is the user's, not ours.

### How is Zoe different from other AI coding CLIs?

| | Zoe | Other CLIs |
| --- | --- | --- |
| Authentication | GitHub OAuth, one command | API keys, env files |
| Project context | Scans before every task | On-demand |
| Edits | Targeted (`edit_file`) | Often rewrites whole files |
| Auth tokens | Stored in your private InsForge workspace | Local config files |
| Open source | MIT | Varies |

## Setup

### Do I need an API key?

No. Zoe uses your InsForge account to route requests to the AI provider. You never touch API keys, env vars, or model credentials.

### What is InsForge?

[InsForge](https://insforge.dev) is the backend that hosts your Zoe session, secrets, and the AI gateway. It also handles GitHub OAuth. Zoe Cloud is a thin layer on top of it.

### Does it work on Windows / macOS / Linux?

Yes. Zoe is a Node.js CLI and works on any OS that runs Node 18+.

### Can I use Zoe without an internet connection?

No. Zoe needs network access to talk to the InsForge backend and the AI gateway. Offline mode is on the long-term roadmap but not a v0.1 feature.

## Usage

### Which models does Zoe support?

Any model available through the AI gateway configured in your InsForge workspace. By default Zoe uses `deepseek/deepseek-v4-flash`, but you can switch to other providers (Claude, GPT, Gemini, etc.) with the `/model` command inside chat, or `zoe use <model>` from your terminal.

### Can I bring my own OpenRouter / Anthropic / OpenAI key?

Not in v0.1. The AI gateway in your InsForge workspace holds the keys, and Zoe talks only to the gateway. Self-hosted mode is on the roadmap.

### How does Zoe decide what to change?

Every task goes through the **plan → build → review** pipeline. Zoe scans your project first, then proposes a plan, then makes the changes, then reviews the result. You see each step.

### Will Zoe overwrite my files?

Only if you ask it to. The `edit_file` tool makes targeted patches and refuses if the target text is ambiguous. For brand-new files, `write_file` creates them. Destructive operations prompt for confirmation.

### Where is my data stored?

- **Auth tokens** → `~/.insforge/auth.json`
- **Zoe preferences** → `~/.zoe/config.json`
- **Chat history** → `.zoe/session.json` in the project directory
- **Per-project metadata in the cloud** → your private InsForge workspace

## Troubleshooting

### `zoe login` says it cannot reach the OAuth endpoint

Make sure `~/.insforge/project.json` contains the correct project URL (`oss_host` and `project_id`). Run `npx @insforge/cli current --json` to verify.

### The AI responses are slow or empty

- Check the model: `/model <name>` to switch to a different one.
- Confirm the AI gateway has a key configured in your InsForge workspace.
- Run `zoe doctor` for a self-diagnosis (coming in v0.2).

### I get "Could not connect to AI provider" with a fresh token

Re-run `zoe login` — your previous session may have been overwritten or expired.

## Community

### How can I help?

- Report bugs and request features on [GitHub Issues](https://github.com/zoe-cli/zoe-cli/issues)
- Improve docs — even typo fixes are welcome
- Share your projects and feedback on [X / Twitter](https://x.com/zoecli)
- Star the [GitHub repo](https://github.com/zoe-cli/zoe-cli) — it helps others find Zoe

### How do I report a security issue?

See [SECURITY.md](./SECURITY.md) — please **do not** open a public GitHub issue.

### Is there a Discord?

Not yet. Watch the [Roadmap](./ROADMAP.md) for community channels.
