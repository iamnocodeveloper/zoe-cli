# Zoe CLI — Current State

Baseline recorded: 2026-07-25. Runtime: Node.js 18+; package manager: npm (`package-lock.json`); language: TypeScript ESM.

| Capability | Status | Evidence | Relevant files | Current limitations / technical debt | Confidence | Next implementation task |
|---|---|---|---|---|---|---|
| Installable CLI | Working | `npm.cmd install`, `npm.cmd run build` pass | `package.json`, `src/cli/index.ts` | Windows PowerShell requires `npm.cmd` where script execution is restricted | High | ZOE-017 |
| Interactive and one-shot prompts | Working | Commander default action dispatches to chat | `src/cli/index.ts`, `src/cli/commands/chat.ts` | CLI options are declared but not all are passed into chat | Medium | ZOE-016 |
| Multiline input | Working | `/paste` + `.done`; test passed | `chat.ts`, `test/workspace.test.ts` | Headless behavior needs E2E coverage | High | ZOE-019 |
| GitHub OAuth | Partial | Browser callback and session persistence exist | `insforge.ts`, `login.ts` | Live production flow not exercised in baseline | Medium | ZOE-002 |
| Refresh and 401 retry | Partial | Token-expiry refresh, single-flight retry tests pass | `insforge.ts`, `workspace.test.ts` | Two overlapping session stores and live SDK response remain unverified | Medium | ZOE-003 |
| Project scan | Working | Scanner saves project intelligence | `intelligence.ts`, `scan.ts` | No fixture coverage for varied repositories | Medium | ZOE-019 |
| Planner / builder / reviewer | Partial | Structured plans, policy checks, validation and reviewer exist; tests pass | `agent.ts`, `execution-plan.ts`, `execution-runtime.ts` | E2E semantic completion remains limited | Medium | ZOE-012 |
| Exact change preservation | Partial | Intent extraction and exact headline tests pass | `user-intent.ts`, `agent.ts`, tests | Coverage is narrowly focused on headline changes | Medium | ZOE-011 |
| Workspace safety | Working | Outside-workspace access test passes | `workspace.ts`, `tools.ts` | Command policy is coarse | High | ZOE-013 |
| Permissions | Partial | Read/write/shell/destructive prompt exists | `permissions.ts` | Package installation is not a separate permission yet | High | ZOE-013 |
| Conversation memory | Partial | Local JSON session persistence exists | `memory.ts`, `session.ts` | Two session representations; no checkpoint/resume contract | Medium | ZOE-008 |
| Task resume / interruption | Unverified | No `zoe resume` command found | `chat.ts`, `memory.ts`, `session.ts` | ESC and durable recovery are not demonstrated | Low | ZOE-009 |
| Model selection | Working | Catalog fallback, `models` and `use` commands exist | `insforge.ts`, `models.ts` | Tier/Cloud authorization needs live validation | Medium | ZOE-002 |
| UI status / timeline | Partial | Phase display and renderer exist | `ui/*`, `runtime-controller.ts` | Persistent Cloud, inferred mode and timeline presentation are incomplete | Medium | ZOE-006 |

## Baseline checks

| Check | Result | Evidence |
|---|---|---|
| `npm.cmd install` | Passed | Installed lockfile-defined dependencies; npm reported one high-severity dependency vulnerability |
| `npm.cmd test` | Passed | Existing deterministic workspace/runtime/auth/tool tests passed |
| `npm.cmd run typecheck` | Passed | `tsc --noEmit` completed |
| `npm.cmd run build` | Passed | TypeScript build completed |

## Components to preserve

Commander entry points, workspace path checks, targeted edit safeguards, structured execution-plan schema, runtime success guard, local-first memory, and the authenticated request helper are the stability foundation.

## Safe refactor candidates

The duplicate configuration/session representations and duplicate memory/session modules may be consolidated only through approved migration tasks. Terminal rendering can be refined after an event-model task.

## Known baseline risks

- The worktree contained pre-existing modified, deleted and untracked files before ZOE-001; they are not attributable to this task.
- `npm install` reported one high-severity dependency vulnerability. Status: Pending owner decision on remediation scope.
- Production OAuth/refresh behavior has not been tested against Zoe Cloud.

## ZOE-002 update

Authentication refresh helper tests now pass for malformed refresh responses, refresh network failures and continuation of an active callback after successful refresh. The audit confirmed a stale config-only authentication state, split logout behavior and refresh-error misclassification. See `15_AUTH_AUDIT.md`; live Cloud validation is blocked pending an owner-authorized test session. Next implementation task: ZOE-003.

## ZOE-003 update

Authentication is now credential-session based: `auth.json` is the sole Cloud credential authority, while config metadata is display-only. Typed outcomes preserve credentials for Cloud/network failures, clear invalid credentials on rejected refresh, and use canonical logout cleanup. Automated validation passes; live OAuth validation remains pending owner execution.

## ZOE-004 update

The runtime audit found structured task and unstructured chat/run paths, duplicate completion state, a direct-terminal permission bypass, and no cancellation/rollback contract. See `16_RUNTIME_AUDIT.md`. Next implementation task: ZOE-005.

## ZOE-005 update

AI tasks now enter `task-orchestrator.ts`, receive a fresh context and return typed outcomes through one final renderer. Structured RuntimeController gates remain intact; conversational results are explicitly unverified. See `17_TASK_ORCHESTRATOR.md`.
