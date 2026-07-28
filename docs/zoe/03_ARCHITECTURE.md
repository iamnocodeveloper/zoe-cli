# Zoe CLI — Architecture

## CURRENT

`src/cli/index.ts` uses Commander to dispatch commands. `chat.ts` captures input, routes task requests to `agent.ts`, displays plans, and invokes execution. `agent.ts` builds a structured plan, calls Zoe Cloud through `insforge.ts`, processes tools from `tools.ts`, then uses execution-plan/runtime modules plus a reviewer to determine status.

Workspace boundaries are enforced by `workspace.ts`; permission prompts are in `permissions.ts`; file backups are in `backups.ts`. `intelligence.ts` writes project scan data under `.zoe`; `memory.ts` stores local conversation state, while `session.ts` provides JSONL helpers. Cloud configuration and session material are split between `config.ts` and `insforge.ts`.

## TARGET

Retain the current boundaries, but establish one SessionManager ownership path, one task/checkpoint model, a typed runtime event stream rendered by the terminal, and an explicit permission capability taxonomy. Preserve local-first memory and the Cloud API boundary.

## Risks

The parallel auth and memory persistence paths can diverge. The planner/builder/runtime must not be replaced together; improvements must proceed as isolated, tested tasks.

## ZOE-002 authentication flow map

Cloud requests through the shared helper are AI streaming (`agent.ts`), `getCurrentUser()` and model-catalog reads. Login bootstrap/exchange intentionally bypasses it; no other Zoe Cloud request bypass was found. `config.json` is authoritative to chat/command gating while `auth.json` is authoritative to Cloud requests, creating a split-brain state. The installed SDK v1.4.3 supports the CLI's camel-case refresh response and server/mobile refresh-token request form. See `15_AUTH_AUDIT.md`.

## ZOE-003 session ownership

`insforge.ts` now owns status, credential application, expiry, refresh, retry and logout. `auth.ts` gates access through `getAuthSessionStatus()` rather than config metadata. The CLI registers only `commands/logout.ts`; it delegates to the core canonical logout service. Chat routes task failures through one shared typed-error renderer.

## ZOE-004 runtime finding

The structured task pipeline is `chat → createPlan → executeRuntimeV2 → tools/validation/reviewer → RuntimeController`; conversational `runAgent` is a separate path. `16_RUNTIME_AUDIT.md` is the authoritative execution map.

## ZOE-005 orchestration

Chat and legacy run adapters now call `taskOrchestrator.run()`. The orchestrator owns context, classification and final typed outcome; `task-result-renderer.ts` owns final rendering. Existing pipeline internals remain adapters.

## ZOE-006 workspace intelligence

`workspace-intelligence.ts` is the canonical owner of deterministic repository discovery. At task start, `TaskOrchestrator` obtains one immutable `WorkspaceContext` and passes the same object to the conversational adapter, planner and structured runtime. `context.ts` renders prompt fragments from that context, while `createProjectSnapshotFromWorkspace()` adapts it for existing plan validation without another scan. See `18_WORKSPACE_INTELLIGENCE.md`.

## ZOE-007 direct command boundary

`chat.ts` routes recognized direct terminal input through `command-permission-policy.ts` before invoking the existing shell executor. The policy is deterministic, uses WorkspaceContext for path-risk signals, and grants confirmation only to one command execution. It is a policy boundary rather than a sandbox. See `19_DIRECT_COMMAND_PERMISSIONS.md`.

## ZOE-008 task preview

After TaskContext creation, the orchestrator invokes one read-only `onPreview` lifecycle callback before either pipeline executes. `task-preview.ts` deterministically derives presentation metadata from the existing classification and canonical WorkspaceContext; `task-preview-renderer.ts` renders it for chat and run adapters. No new execution modes or ownership paths were introduced. See `20_TASK_PREVIEW.md`.

## ZOE-009 cooperative cancellation

The canonical orchestrator creates and owns one `TaskCancellationToken` per task. The token propagates through pipeline adapters and is checked at safe stage and operation boundaries. The active-token registration exists only for Ctrl+C routing and is always cleared during orchestrator cleanup. See `21_TASK_CANCELLATION.md`.

## ZOE-010 checkpoint contract

`task-checkpoint.ts` is the sole checkpoint schema and compatibility authority. It defines immutable metadata, legal lifecycle transitions, Workspace Intelligence fingerprint representation and future resume eligibility without implementing storage or resume execution. TaskOutcome ownership is unchanged. See `22_TASK_CHECKPOINT_MODEL.md`.

## ZOE-011 checkpoint persistence

`checkpoint-storage.ts` exclusively owns local checkpoint JSON I/O under `~/.zoe/checkpoints`. It provides atomic save, validated load, lightweight listing, idempotent delete and explicit cleanup while rejecting incompatible versions. It does not restore or execute checkpoints. See `23_CHECKPOINT_PERSISTENCE.md`.

## ZOE-012 lifecycle capture

The Task Orchestrator creates one `CheckpointLifecycleCapture` for each accepted task. Capture writes canonical immutable snapshots through CheckpointStorage at safe boundaries and terminal outcomes; metadata-only runtime callbacks report completed tool, validation and review boundaries. Persistence failures become warnings and never redirect execution. See `24_CHECKPOINT_LIFECYCLE.md`.

## ZOE-013 workspace drift

`workspace-drift.ts` compares checkpoint workspace metadata with the current canonical WorkspaceContext. It reuses the checkpoint fingerprint contract, returns immutable compatibility details and never mutates or loads checkpoints. See `25_WORKSPACE_DRIFT.md`.

## ZOE-014 safe resume

`safe-resume.ts` coordinates an explicitly requested continuation by composing Checkpoint Storage, Workspace Drift and injected post-tool stage adapters. It cannot execute ToolExecution, clears prior approvals, preserves checkpoint/task lineage and creates a new runtime identity. Successful completion atomically replaces the existing checkpoint; rejection leaves storage unchanged. See `26_SAFE_RESUME.md`.

## ZOE-015/ZOE-016 Git safety context

`git-awareness.ts` is the sole read-only Git inspection authority. Workspace Intelligence attaches one immutable snapshot shared by preview and checkpoint capture. Checkpoint schema v2 stores a strict sanitized projection; Workspace Drift and Safe Resume add conservative Git compatibility without replacing fingerprints or permission boundaries. See `27_GIT_AWARENESS.md` and `28_GIT_SAFETY_CONTEXT.md`.

## ZOE-017 release boundary

The npm package is a compiled CLI distribution: `zoe` maps to `dist/cli/index.js`. The explicit package allowlist includes compiled JS/declarations plus README, LICENSE, CHANGELOG and SECURITY; it excludes sources, tests, internal docs, environment files and source maps. Release validation changes packaging and documentation only, not product ownership boundaries. See `29_RELEASE_VALIDATION.md` and `30_NPM_ALPHA_RELEASE.md`.
