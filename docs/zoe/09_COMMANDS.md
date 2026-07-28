# Zoe CLI — Commands

Current commands: `zoe`, `zoe "<task>"`, `zoe login`, `zoe logout`, `zoe whoami`, `zoe models`, `zoe use <model>`, `zoe scan`, `zoe doctor`, `zoe summary`, and `zoe version`. In chat, `/paste`, `/scan`, `/model`, `/help`, `exit`, and `quit` are documented.

`zoe logout` is the sole registered logout command and clears local authentication state even when Cloud revocation cannot be confirmed. `zoe whoami` now requires a valid credential session; config display metadata alone reports not logged in.

Proposed only when supported by an approved task: `zoe auth status` (diagnose token/session), `zoe resume` (recover a checkpoint), `zoe config` (inspect safe local settings), and `/clear` (clear local conversation). `zoe init` is not currently justified; project creation is performed from a task. `/mode` remains unnecessary for v1 because mode is inferred and displayed.

ZOE-004: `zoe run` exists as an unregistered legacy command module and bypasses the structured task pipeline; it must not be promoted before ZOE-005 resolves entry-point ownership.

ZOE-005: the legacy unregistered `run` module now delegates to the Task Orchestrator if used programmatically. Registered chat/direct AI prompts also delegate to it.
# ZOE-007 direct terminal commands

Recognized terminal commands are classified before execution. Read-only commands run directly; package changes, unknown commands, network operations, scripts and modifying commands require per-command approval. Destructive external commands are blocked. Slash commands remain Zoe commands.

## ZOE-008 AI task preview

Natural-language AI tasks show Task ID, intent label, pipeline, workspace, expected changes, validation, permissions, complexity and expected output before execution. HIGH-complexity structured tasks may pause for ENTER; this is not a permission approval.
# Alpha release commands

The published executable is `zoe`, mapped to `dist/cli/index.js`.

- `zoe --help` and `zoe help` show command help.
- `zoe --version` prints the package version without requiring authentication.
- `zoe login`, `logout` and `whoami` manage the existing browser OAuth session.
- `zoe resume <taskId>` explicitly attempts Safe Resume.
- Unknown options fail with a non-zero exit code.
- A free positional string is intentionally treated as a task prompt rather than an unknown subcommand.

Windows validation uses the generated `zoe.cmd` shim.
