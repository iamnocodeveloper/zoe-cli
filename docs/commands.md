# Commands

Zoe exposes a small set of terminal commands and in-chat shortcuts. This page is the reference.

## Top-level commands

### `zoe`

Start an interactive chat in the current project directory.

```bash
zoe
```

If you are not signed in, Zoe will trigger `zoe login` automatically.

You can also pass a single message to run a task and exit:

```bash
zoe "create a landing page with HTML, CSS and JS"
```

If the message looks like a task (e.g. starts with `create`, `build`, `edit`, `fix`, `add`, or is a connector like `si …`, `por favor …`, `please …`), Zoe runs the full **plan → build → review** pipeline. Otherwise it goes through casual chat.

### `zoe login`

Start the GitHub OAuth flow. Opens a browser window; session is persisted on success.

```bash
zoe login
```

### `zoe logout`

Sign out and clear the local session.

```bash
zoe logout
```

### `zoe whoami`

Show the currently signed-in user.

```bash
zoe whoami
```

### `zoe use <model>`

Set the default AI model for the current project (and globally if no project-level override).

```bash
zoe use anthropic/claude-sonnet-4-5
zoe use deepseek/deepseek-v4-pro
```

### `zoe models`

List models available through the AI gateway configured for your account.

```bash
zoe models
```

### `zoe scan`

Re-scan the current project and update the project intelligence cache.

```bash
zoe scan
```

### `zoe summary`

Print a one-page summary of the current project.

```bash
zoe summary
```

### `zoe doctor`

Self-diagnose Zoe's environment: version, login state, project link, AI gateway, etc.

```bash
zoe doctor
```

## In-chat shortcuts

These work while you are inside an interactive `zoe` session.

| Command | What it does |
| --- | --- |
| `/model <name>` | Switch the model for this conversation (and the next). |
| `/scan` | Re-scan the project and inject the new context. |
| `/help` | Show the in-chat help. |
| `exit` / `quit` | End the conversation. |

## Natural-language tasks

Zoe recognises natural-language tasks. Common patterns:

- `create a landing page with HTML CSS JS`
- `add a login form to index.html`
- `fix the bug in script.js`
- `explain what package.json does`
- `editala y coloca fondo rojo` (Spanish connectors are recognised too)

For tasks that affect critical files (config, package.json, tsconfig.json), Zoe prompts for confirmation before writing.

## Environment variables

Zoe does not require any environment variables. Authentication is handled by InsForge. If you need to override defaults, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | General error |
| `2` | Not authenticated — run `zoe login` |
| `3` | Project not linked |
| `4` | Resource not found |
| `5` | Permission denied |
