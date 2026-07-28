# ZOE-010 — Task Checkpoint Model and Resume Safety Audit

## Status and boundary

The canonical checkpoint contract is implemented in `task-checkpoint.ts`. This stage creates immutable in-memory metadata models and deterministic compatibility rules only. It does not write checkpoint files, use a database, resume execution, persist memory or roll back completed work.

## Ownership and lifecycle

The Task Orchestrator remains the future owner of checkpoint creation and consumption. The checkpoint model owns metadata definitions only and does not replace `TaskOutcome`, which remains the final execution result.

Checkpoint states are NOT_CREATED, CREATED, READY, INVALID, OBSOLETE, RESUMED, COMPLETED and DISCARDED. Legal transitions are explicit and return new frozen objects; terminal states cannot be changed. Checkpoint-safe pipeline stages are Preview, Planning, Runtime, ToolExecution, Validation, Reviewer, Rendering and Cleanup.

## Workspace fingerprint contract

Workspace Intelligence supplies the input. Fingerprint format version 1 contains the normalized workspace root, context version and a sorted immutable list of each indexed file's relative path, existing SHA-256 content hash and size. The checkpoint layer does not create a separate persistence digest. Resume eligibility requires both compatible workspace version and matching fingerprint.

## Compatibility and invalidation

Eligibility requires a resumable checkpoint state, matching checkpoint schema, Planner version, Runtime version, workspace version and fingerprint, plus non-expired permission metadata. Deterministic invalidation reasons cover schema, Planner, Runtime, permissions, workspace version/fingerprint, obsolete/invalid state, missing metadata and corruption.

Schema, Planner and Runtime compatibility versions are explicit constants. Future code must migrate or reject incompatible versions; it must never silently reinterpret them.

ZOE-016 deliberately advances checkpoint schema to version 2. It adds a sanitized Git snapshot containing only repository relationship, branch/detached/HEAD state, working-tree category counts and normalized changed-path status metadata. Version 1 is rejected; no migration is attempted.

## Permission contract

Permission approvals never survive resume. A checkpoint may record only whether approval previously existed and when that metadata expires. `revalidationRequired` is always true, and every future resumed action must pass through the current permission policy again.

## Validation and review contracts

Validation and Reviewer status may be reused only when all compatibility checks pass and the workspace fingerprint matches. Any workspace change invalidates reuse and requires those stages to run again.

## Tool metadata and forbidden content

Allowed tool metadata is limited to completed batch count, non-sensitive tool names and timings. Checkpoint metadata rejects fields whose names indicate API keys, tokens, passwords, secrets, credentials, authorization, prompts or environment data. Model prompts, source content, command output, credentials and private environment values must never be persisted.
