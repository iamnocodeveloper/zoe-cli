# Zoe CLI

Zoe is a terminal coding assistant that inspects a workspace, previews task intent, requests permission for consequential actions, and reports validation results.

> [!WARNING]
> Zoe is currently an alpha release. Commands, checkpoint schemas, configuration and behavior may change. Review previews and permission requests before allowing modifications. Use disposable or version-controlled projects while evaluating the CLI.

## Platform status

Windows 10/11 with PowerShell is the supported platform for this alpha. macOS and Linux have not been release-validated.

Prerequisites:

- Node.js 18 or newer
- npm
- Git when read-only repository awareness is desired
- A browser for GitHub OAuth

## Installation

After the alpha is published:

```powershell
npm.cmd install --global @nocodeveloper/zoe-cli@alpha
zoe --version
```

To evaluate a local release tarball, replace the package name with its absolute `.tgz` path.

## First command and authentication

Zoe v1 uses the InsForge GitHub browser OAuth flow:

```powershell
zoe login
```

The browser flow is the official alpha authentication method. Device-code authentication is deferred. Session credentials are stored locally under the Zoe user-data directory; do not copy them into bug reports.

Check status without changing credentials:

```powershell
zoe whoami
zoe doctor
```

## Usage

Start an interactive session:

```powershell
zoe
```

Run a direct task:

```powershell
zoe "Inspect this project for release blockers"
```

Useful commands:

```text
zoe --help
zoe --version
zoe login
zoe logout
zoe whoami
zoe scan
zoe summary
zoe doctor
zoe resume <taskId>
```

## Permissions

Read-only inspection may run automatically. Workspace writes and terminal commands pass through Zoe's permission boundary. Package installation is a distinct action and requires its own explicit confirmation. Destructive or ambiguous commands are not silently approved.

Permission prompts are safety controls, not a complete sandbox. Review commands and paths before approving them.

## Checkpoints and Safe Resume

Accepted tasks create local metadata-only checkpoints under `~/.zoe/checkpoints`. Checkpoints exclude prompts, source contents, command output and credentials.

Safe Resume is deliberately limited:

- It requires `zoe resume <taskId>`.
- Only compatible `READY` checkpoints after the ToolExecution boundary are eligible.
- Workspace and Git drift reject resume.
- Previous permissions are never reused.
- Completed tool batches are never replayed.
- A pending Reviewer cannot currently be reconstructed from persisted metadata.
- Checkpoint schema v2 is alpha and may change.

## Read-only Git awareness

Zoe can report repository presence, branch or detached HEAD, commit, clean/dirty/conflicted state, staged/unstaged/untracked counts and locally available upstream metadata.

Git awareness:

- performs no fetch, pull, push or other network operation;
- performs no add, commit, checkout, reset, clean, stash, merge or rebase;
- does not expand workspace write boundaries;
- blocks Safe Resume when Git state is conflicting, unavailable or changed.

## Privacy and security

- Workspace memory, summaries and checkpoints are local-first.
- Only context required for model execution should be sent to the configured service.
- OAuth and model credentials must never be committed or included in release packages.
- `ZOE_DEBUG=true` enables diagnostic markers. Debug output is designed to omit credentials and checkpoint payloads, but should still be reviewed before sharing.
- Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

## Known limitations

- Alpha APIs, commands and checkpoint formats are unstable.
- Windows is the only release-validated platform.
- Safe Resume supports only post-tool safe boundaries.
- Git ahead/behind counts use existing local refs and may be stale.
- Git awareness is metadata inspection, not repository management.
- Live authentication and model execution require the configured cloud service and network access.
- Rollback, automatic resume, connectors and project-memory expansion are not included.

## Troubleshooting

- Run `zoe doctor` to inspect the local environment and authentication status.
- If `zoe` is not found, confirm the npm global prefix is on `PATH`.
- If browser login fails, retry `zoe login` and verify that Node.js is allowed to open the local OAuth callback.
- Use `ZOE_DEBUG=true` only for temporary diagnostics.
- Include Zoe version, Node version, Windows version, shell and redacted error output when filing an issue.

Report product issues at [github.com/iamnocodeveloper/zoe-cli/issues](https://github.com/iamnocodeveloper/zoe-cli/issues).

## Development

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

## License

[MIT](./LICENSE) © 2026 Joel Araujo.
