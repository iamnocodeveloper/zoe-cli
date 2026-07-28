# ZOE-017 — Release Validation

## Candidate

- Package: `@nocodeveloper/zoe-cli`
- Version: `0.4.0-alpha.0`
- Channel: `alpha`
- Access: scoped public
- Platform validated: Windows
- Branch at baseline: `main`
- HEAD at baseline: `46140b4b23dfeffc278923c5a51ce83cd4378de7`
- Node.js: `v22.23.1`
- npm: `10.9.8`
- TypeScript: `6.0.3`
- Lockfile: npm lockfile v3
- Build: `npm.cmd run build`
- Test runner: `tsx test/workspace.test.ts`
- Binary: `zoe → dist/cli/index.js`

The worktree contained extensive owner changes before ZOE-017. They were preserved; no reset, clean, stash, checkout, commit, tag or push occurred.

## Automated gates

`npm.cmd ci`, tests, typecheck, build and `git diff --check` pass. `npm audit` initially found one high-severity transitive denial-of-service advisory in `brace-expansion@5.0.7`; the compatible lockfile-only correction installed `5.0.8`, after which audit reported zero vulnerabilities.

Both package and publication dry-runs pass. The candidate contains 131 files, is approximately 119.7 kB compressed and 464.6 kB unpacked. The executable, README, LICENSE, CHANGELOG and SECURITY policy are present. Tests, source, `.env`, internal docs, checkpoints, tarballs and source maps are excluded.

The real candidate tarball is:

The final `0.4.0-alpha.0` tarball must be generated and audited during ZOE-018.

It is temporary and must not be committed.

## Smoke matrix

| ID | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| A | CLI startup | PASS | Installed local/global Windows shims start |
| B | Help | PASS | `zoe --help` and `zoe help`, exit 0 |
| C | Version | PASS | `0.4.0-alpha.0`, exit 0 |
| D | Authentication entry/status | PASS | `login --help`; isolated `whoami` reports unauthenticated safely |
| E | Simple Inspect task, live model | BLOCKED | npm session/auth profile intentionally isolated; no live OAuth |
| F | Simple Ask task, live model | BLOCKED | npm session/auth profile intentionally isolated; no live OAuth |
| G | Preview behavior | PASS | Deterministic preview tests, including Git context |
| H | Permission denial | PASS | Automated permission-policy coverage |
| I | Permission approval | PASS | Automated one-action approval coverage |
| J | Cooperative cancellation | PASS | Deterministic cancellation suite; interactive Ctrl+C remains manual |
| K | Checkpoint creation | PASS | Real isolated checkpoint persisted |
| L | Checkpoint inventory/file | PASS | Isolated checkpoint JSON loaded and inspected |
| M | Workspace drift compatible | PASS | Real resume logged COMPATIBLE |
| N | Workspace drift incompatible | PASS | Added file produced fingerprint rejection |
| O | Safe Resume accepted | PASS | Explicit installed command completed checkpoint |
| P | Unsafe Resume rejected | PASS | Unsafe boundary rejected; file hash unchanged |
| Q | Non-Git workspace | PASS | Installed Git inspector returned NOT_A_REPOSITORY |
| R | Clean Git workspace | PASS | Disposable repository returned CLEAN |
| S | Dirty Git workspace | PASS | Staged, unstaged and untracked counts validated |
| T | Conflict resume rejection | PASS | Disposable merge conflict rejected resume |
| U | Detached HEAD | PASS | Disposable repository returned DETACHED_HEAD |
| V | Windows path with spaces | PASS | Local/global installation path contained spaces |
| W | Unicode path | PASS | Installation and execution passed in `Zoe Alpha Ünicode ...` |
| X | Nested workspace | PASS | Repository root above workspace detected |
| Y | Execution outside Zoe repository | PASS | Installed CLI executed from temporary workspaces |

## Authentication

Mocked tests cover valid, expired, malformed, rejected and refreshed sessions without exposing credentials. Live authenticated execution is BLOCKED pending owner login. `npm.cmd whoami` returned E401; publication is therefore blocked by npm authentication.

## Safe Resume evidence

The real installed CLI loaded an isolated READY checkpoint, built fresh workspace/Git contexts, reported compatible drift, revalidated permissions, issued a new runtime ID, continued from Rendering and stored COMPLETED. Completed tool-batch count remained `2`. An unsafe checkpoint and all drift scenarios were rejected without replay.

## Limitations

- Windows only; macOS/Linux unverified.
- Live model-backed Ask/Inspect and live authenticated OAuth were not run.
- Interactive terminal Ctrl+C remains an owner-run smoke test.
- npm ownership cannot be proven by the current unauthenticated session.
- The dirty Zoe worktree requires owner review before staging or tagging.
