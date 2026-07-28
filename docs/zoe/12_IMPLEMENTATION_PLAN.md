# Zoe CLI — Implementation Plan

## ZOE-001 — Current-state baseline

- Objective: establish a reproducible baseline and audit documentation.
- Motivation: stabilization requires evidence before behavior changes.
- Scope: install the lockfile dependencies; run test, typecheck and build; create `docs/zoe`.
- Files expected to change: `docs/zoe/*` only.
- Forbidden changes: production source, package configuration, runtime behavior.
- Automated tests: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`.
- Manual tests: inspect documentation against repository structure and worktree state.
- Acceptance criteria: all commands pass and documents identify facts, risks and pending decisions.
- Rollback plan: remove the documentation directory.
- Estimated risk: Low.
- Dependencies: none.
- Owner approval: Approved and completed.

## ZOE-002 — Authentication root-cause audit

- Objective: prove live OAuth, token expiry, refresh and 401 behavior.
- Motivation: active Cloud expiration is the highest reported reliability risk.
- Scope: diagnostics, isolated tests and auth documentation; no behavior change.
- Files expected to change: auth tests and `docs/zoe/05_AUTH_AND_SESSION.md`.
- Forbidden changes: token contract, OAuth provider, runtime flow.
- Automated tests: refresh response matrix and 401/error classification tests.
- Manual tests: login, restart, near-expiry and forced-401 scenario against approved Cloud environment.
- Acceptance criteria: one evidenced root cause and a safe ZOE-003 design.
- Rollback plan: remove diagnostics/tests only.
- Estimated risk: Low.
- Dependencies: ZOE-001.
- Owner approval: Approved and completed. Evidence: `15_AUTH_AUDIT.md`; baseline checks passed; live validation blocked pending owner test session.

## ZOE-003 — SessionManager

- Objective: unify valid-session checks, refresh, rotation, persistence and logout.
- Motivation: avoid stale profile metadata and duplicate expiry errors.
- Scope: migrate auth ownership with backward-compatible local-session migration; only unify token-based validity, typed refresh outcomes, atomic credential persistence, full logout cleanup and one task-scoped auth error.
- Files expected to change: `insforge.ts`, `auth.ts`, `config.ts`, auth tests and documentation.
- Forbidden changes: device-code flow, provider replacement, API-key storage.
- Automated tests: restart, refresh-before-expiry, 401 retry, failed refresh, rotation and logout.
- Manual tests: login then restart and simulate expired session.
- Acceptance criteria: one session source of truth and one actionable expiry surface.
- Rollback plan: retain readable legacy session and revert SessionManager adapter.
- Estimated risk: High.
- Dependencies: ZOE-002.
- Owner approval: Approved and completed. Live Cloud validation remains pending owner execution.

## ZOE-004 — Device-code authentication

- Objective: add device-code login only if later approved and backend-supported.
- Motivation: support non-browser environments.
- Scope: deferred discovery and implementation.
- Files expected to change: auth/CLI/tests if approved.
- Forbidden changes: replacing browser OAuth.
- Automated tests: device-code polling and timeout fixture.
- Manual tests: device-code login on supported Cloud backend.
- Acceptance criteria: browser OAuth remains the official v1 path.
- Rollback plan: disable the new command.
- Estimated risk: High.
- Dependencies: ZOE-003 and backend capability.
- Owner approval: Status: Pending owner decision.

## ZOE-005 — Canonical Task Orchestrator and Typed Runtime Outcomes

- Objective: runtime stabilization: one canonical task orchestrator and typed final outcome adapter.
- Motivation: make login recovery clear without noise.
- Scope: preserve Planner, Builder, Reviewer and tools behind one structured task entry/result boundary.
- Files expected to change: agent/runtime/chat entry adapters, tests/docs.
- Forbidden changes: auth protocol, tool replacement, cancellation, rollback and runtime rewrite.
- Automated tests: error deduplication and state-formatting tests.
- Manual tests: disconnected, expired, logged-out and connected terminal sessions.
- Acceptance criteria: one success/failure owner for structured AI tasks and no entry-point divergence.
- Rollback plan: revert presentation adapter.
- Estimated risk: Medium.
- Dependencies: ZOE-003.
- Owner approval: Approved and completed. Live validation remains owner-run.

## ZOE-006 — Workspace Intelligence & Incremental Project Context

- Objective: create one deterministic, reusable and versioned project context for each AI task.
- Motivation: planner and runtime must not receive independently scanned workspace snapshots.
- Scope: canonical discovery, ignore rules, file inventory, deterministic detection, incremental metadata refresh and task-orchestrator handoff.
- Files expected to change: workspace intelligence/context/agent/orchestrator adapters, tests and documentation.
- Forbidden changes: authentication, planner/runtime/reviewer/builder logic, UI, memory, embeddings and external APIs.
- Automated tests: detection, ignores, important files, cache reuse, versioning, refresh hash and shared-context identity.
- Manual tests: inspect a Node/TypeScript workspace and a fixture with ignored/generated trees.
- Acceptance criteria: one immutable WorkspaceContext per task is reused by planner and runtime without duplicate initial discovery.
- Rollback plan: revert the adapter and restore the prior context readers.
- Estimated risk: Medium.
- Dependencies: ZOE-005.
- Owner approval: Approved and completed.

## ZOE-007 — Direct Terminal Command Permission Boundary

- Objective: eliminate the direct-terminal bypass of Zoe's permission boundary.
- Motivation: package and destructive shell actions need deterministic per-command approval.
- Scope: parser, classification, workspace checks, confirmation adapter, typed outcomes, tests and documentation.
- Files expected to change: command policy, chat direct-command adapter, tests/docs.
- Forbidden changes: AI classification, sandboxing, auth, planner/builder/reviewer/runtime redesign and persistent approvals.
- Automated tests: command categories, package actions, destructive patterns, chains, redirection, remote pipes and workspace escape.
- Manual tests: approved read-only command, denied package install and reinforced destructive prompt.
- Acceptance criteria: direct commands cannot execute before policy classification and per-command permission resolution.
- Rollback plan: remove the direct-command adapter and policy module together.
- Estimated risk: Low.
- Dependencies: ZOE-006.
- Owner approval: Approved and completed.

## ZOE-008 — Task Intent Visibility & Execution Preview

- Objective: show Zoe's deterministic interpretation before conversational or structured execution begins.
- Motivation: users need Task ID, intent, pipeline, workspace and expected effects before work starts.
- Scope: immutable preview model, shared renderer and one approved read-only orchestrator lifecycle hook.
- Files expected to change: task preview model/renderer, orchestrator options, CLI adapters, tests/docs.
- Forbidden changes: new modes, Planner, RuntimeController, Builder, Reviewer, auth, permissions and memory.
- Automated tests: hook ordering, Task ID/workspace reuse, labels, complexity, isolation, deduplication and HIGH pause.
- Manual tests: Ask, Inspect, Build and HIGH structured task previews on Windows.
- Acceptance criteria: exactly one preview appears before execution and reuses the existing TaskContext.
- Rollback plan: remove the preview callback from adapters and the optional hook invocation.
- Estimated risk: Medium.
- Dependencies: ZOE-005 through ZOE-007.
- Owner approval: Approved and completed.

## ZOE-009 — Cooperative Task Cancellation

- Objective: stop future task stages safely after a user cancellation request.
- Motivation: active tasks need graceful Ctrl+C behavior without corrupting atomic work.
- Scope: per-task cancellation token, safe-boundary propagation, typed outcome, renderer, Ctrl+C adapter, tests/docs.
- Files expected to change: orchestrator/agent adapters, cancellation core, task renderer, chat signal adapter, tests/docs.
- Forbidden changes: rollback, persistence, resume, memory and Planner/Runtime/Reviewer algorithms.
- Automated tests: stage cancellation, propagation, token freshness, cleanup, duplicate request and renderer cases.
- Manual tests: Ctrl+C during planning/runtime and subsequent-task smoke test.
- Acceptance criteria: one cancellation outcome, no future stage scheduling and guaranteed token cleanup.
- Rollback plan: remove signal adapter and optional cancellation parameters, then remove the token module.
- Estimated risk: High.
- Dependencies: ZOE-005 through ZOE-008.
- Owner approval: Approved and completed.

## ZOE-010 — Task Checkpoint Model & Resume Safety Audit

- Objective: define the only safe, versioned checkpoint metadata and compatibility contract before persistence exists.
- Motivation: persistence and resume cannot be safe while workspace, permission, validation and review reuse remain ambiguous.
- Scope: immutable model, state machine, fingerprint representation, eligibility/invalidation rules and tests/docs.
- Files expected to change: checkpoint contract, deterministic tests and architecture/runtime/release documentation.
- Forbidden changes: persistence, resume, rollback, memory and Planner/Runtime/Reviewer/Builder behavior.
- Automated tests: creation, transitions, compatibility versions, workspace changes, permission expiry, immutability and sensitive metadata rejection.
- Manual tests: audit the contract against WorkspaceContext and TaskOutcome ownership.
- Acceptance criteria: incompatible checkpoints are deterministically ineligible and permission approval is never reusable.
- Rollback plan: remove the unused in-memory contract module and its tests/docs.
- Estimated risk: High.
- Dependencies: ZOE-006 and ZOE-009.
- Owner approval: Approved and completed.

## ZOE-011 — Checkpoint Persistence Engine

- Objective: durably store canonical checkpoint metadata without enabling resume.
- Motivation: the ZOE-010 contract needs one atomic, validated local repository before restoration can be considered.
- Scope: JSON save/load/list/delete/cleanup, version rejection, typed errors, atomic writes and tests/docs.
- Files expected to change: checkpoint storage module, deterministic fixture tests and architecture/runtime/release documentation.
- Forbidden changes: resume, restoration, rollback, migration, memory and execution subsystem behavior.
- Automated tests: save/load, atomicity, list, delete, cleanup, corruption, version mismatch, serialization and concurrent-save protection.
- Manual tests: inspect isolated JSON layout and failure behavior on Windows.
- Acceptance criteria: only validated canonical checkpoint metadata reaches durable local storage.
- Rollback plan: remove the unused repository module and any local checkpoint directory explicitly created by a future caller.
- Estimated risk: Medium.
- Dependencies: ZOE-010.
- Owner approval: Approved and completed.

## ZOE-012 — Checkpoint Lifecycle Capture Integration

- Objective: automatically persist canonical checkpoint replacements at safe task lifecycle boundaries.
- Motivation: durable storage must reflect execution deterministically before any resume capability is considered.
- Scope: capture coordinator, orchestrator ownership integration, metadata-only structured-stage callbacks, tests/docs.
- Files expected to change: checkpoint lifecycle, orchestrator/agent adapters, deterministic tests and architecture/runtime/release documentation.
- Forbidden changes: resume, restoration, replay, rollback, memory and execution algorithms.
- Automated tests: creation, stage updates, terminal states, deduplication, immutability and storage-failure isolation.
- Manual tests: inspect checkpoint replacement through success, cancellation and failure on Windows.
- Acceptance criteria: each accepted task produces ordered atomic checkpoint metadata without affecting execution results.
- Rollback plan: remove lifecycle capture construction and optional stage callbacks; leave model/storage available but unused.
- Estimated risk: High.
- Dependencies: ZOE-010 and ZOE-011.
- Owner approval: Approved and completed.

## ZOE-013 — Workspace Drift Detection

- Objective: deterministically decide whether checkpoint workspace metadata still matches the current project state.
- Motivation: future resume must not operate against an altered workspace.
- Scope: read-only analyzer, typed results/reasons, structural and critical-file comparison, tests/docs.
- Files expected to change: drift analyzer, deterministic tests and architecture/runtime/release documentation.
- Forbidden changes: checkpoint loading/mutation, resume, restoration, rollback, memory and execution behavior.
- Automated tests: identity, versions, schema, fingerprint, critical modification, add/remove/rename, ignored changes and unknown input.
- Manual tests: compare a checkpoint fingerprint before and after controlled fixture changes.
- Acceptance criteria: compatibility is deterministic and uses only the existing fingerprint contract.
- Rollback plan: remove the unused analyzer and its tests/docs.
- Estimated risk: High.
- Dependencies: ZOE-010 through ZOE-012.
- Owner approval: Approved and completed.

## ZOE-014 — Safe Resume Eligibility & Operator-Controlled Resume

- Objective: continue an eligible local checkpoint only after explicit operator intent and complete safety validation.
- Motivation: checkpoints become useful without introducing automatic recovery, replay or stale approvals.
- Scope: explicit CLI entry, validated load, drift enforcement, permission revalidation, post-tool continuation, lineage, tests/docs.
- Files expected to change: safe resume coordinator, resume CLI adapter, tests and checkpoint/runtime documentation.
- Forbidden changes: automatic/background resume, ToolExecution replay, rollback, memory, cloud sync and Planner/RuntimeController/Reviewer redesign.
- Automated tests: READY success; terminal rejection; incompatible/unknown workspace; permissions; Validation/Reviewer/Rendering boundaries; no tool replay; immutable rejection.
- Manual tests: inspect explicit command output and verify a rejected checkpoint file remains unchanged.
- Acceptance criteria: only compatible READY checkpoints beyond ToolExecution continue and every successful invocation has fresh permission/runtime state.
- Rollback plan: unregister the resume command and remove the isolated coordinator; checkpoint capture/storage remain compatible.
- Estimated risk: High.
- Dependencies: ZOE-010 through ZOE-013.
- Owner approval: Approved and completed.

## ZOE-015 — Read-Only Git Repository Awareness

- Objective: expose deterministic immutable repository, HEAD, branch and working-tree metadata without changing Git.
- Motivation: tasks need repository safety context before preview, checkpoint and resume decisions.
- Scope: one strict Git inspector, typed context/errors, local refs only, timeout and tests/docs.
- Files expected to change: Git awareness module, WorkspaceContext integration, tests/docs.
- Forbidden changes: Git mutation/network, remote integrations, generic shell API and expanded workspace boundaries.
- Automated tests: repository/non-repository, clean/dirty/conflict/detached, status categories, upstream, failures, timeout, paths and command allowlist.
- Manual tests: disposable repositories only.
- Acceptance criteria: immutable deterministic metadata with no network or mutations and isolated failures.
- Rollback plan: detach Git context and remove the isolated inspector.
- Estimated risk: Medium.
- Dependencies: ZOE-006 and ZOE-014.
- Owner approval: Approved and completed.

## ZOE-016 — Git Safety Context Integration

- Objective: share Git context through preview, checkpoint, drift and resume safety.
- Motivation: repository changes must become deterministic resume rejection signals.
- Scope: compact preview, schema-v2 sanitized snapshot, Git drift reasons and fresh resume inspection.
- Files expected to change: preview, checkpoint/storage, drift, safe resume, tests/docs.
- Forbidden changes: TaskOutcome redesign, permission bypass, replay, rollback and Planner/Runtime/Reviewer/auth changes.
- Automated tests: shared reference, preview states, sanitized persistence/versioning, Git drift matrix, conflict/ambiguity resume rejection and no tool replay.
- Manual tests: disposable clean/dirty/nested/detached/conflict and resume scenarios.
- Acceptance criteria: Git only adds conservative context/rejections while fingerprints and permissions remain authoritative.
- Rollback plan: reject schema-v2 checkpoints and remove Git projections/integration while retaining the inspector.
- Estimated risk: High.
- Dependencies: ZOE-015.
- Owner approval: Approved and completed.

## ZOE-017 — Packaging and upgrade flow

- Objective: validate installation, package content and upgrade strategy.
- Motivation: private-preview users need predictable distribution.
- Scope: package validation and release documentation.
- Files expected to change: package/release tests/docs only as approved.
- Forbidden changes: casual publishing-config changes.
- Automated tests: `npm pack` content and clean-install test.
- Manual tests: global install and `zoe version` on Windows.
- Acceptance criteria: executable package installs and identifies version correctly.
- Rollback plan: withhold publication.
- Estimated risk: Medium.
- Dependencies: ZOE-001.
- Owner approval: Approved and completed as Release Validation, Packaging & npm Alpha Publication preparation. Actual npm publication remains separately blocked and unapproved.

## ZOE-018 — Telemetry and diagnostics

- Objective: define opt-in diagnostics with redaction.
- Motivation: diagnose reliability without leaking code or secrets.
- Scope: policy, consent, redaction and local diagnostic export.
- Files expected to change: diagnostics modules/tests/docs.
- Forbidden changes: silent telemetry or provider-key collection.
- Automated tests: opt-in and secret-redaction tests.
- Manual tests: inspect generated diagnostic payload.
- Acceptance criteria: no collection before consent and no secret/source leakage.
- Rollback plan: disable diagnostics.
- Estimated risk: Medium.
- Dependencies: ZOE-017.
- Owner approval: Status: Pending owner decision.

## ZOE-019 — Full acceptance suite

- Objective: automate the private-preview behavior matrix.
- Motivation: release quality needs repeatable evidence.
- Scope: fixtures, E2E tests and Windows execution guidance.
- Files expected to change: tests/fixtures/CI/docs.
- Forbidden changes: feature work disguised as tests.
- Automated tests: all cases in `11_ACCEPTANCE_TESTS.md`.
- Manual tests: final interactive OAuth, interruption and UX review.
- Acceptance criteria: required matrix passes or documented blocker prevents release.
- Rollback plan: remove nonessential fixtures.
- Estimated risk: Medium.
- Dependencies: ZOE-002 through ZOE-018.
- Owner approval: Pending.

## ZOE-020 — Private preview release

- Objective: release only when the approved gate is evidenced.
- Motivation: avoid publishing an unreliable developer tool.
- Scope: release candidate, checklist and rollback readiness.
- Files expected to change: release docs/configuration as approved.
- Forbidden changes: automatic publication or unreviewed version changes.
- Automated tests: packaging and full acceptance suite.
- Manual tests: clean Windows install, login, task and recovery smoke test.
- Acceptance criteria: `14_RELEASE_CHECKLIST.md` is complete and known issues are disclosed.
- Rollback plan: stop release, unpublish only with explicit owner authorization.
- Estimated risk: High.
- Dependencies: ZOE-019.
- Owner approval: Pending.
