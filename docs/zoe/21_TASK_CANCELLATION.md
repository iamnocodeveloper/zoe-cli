# ZOE-009 — Cooperative Task Cancellation

## Status

Implemented. Every orchestrated task receives a fresh `TaskCancellationToken`; the token is active only for that task and is cleared in the orchestrator's `finally` cleanup.

## Model and lifecycle

The token exposes task identity, state, stage, cancellation reason/time, completed/skipped stages, `cancel()`, `isCancelled()` and `throwIfCancelled()`. Lifecycle states are CREATED, PREVIEW, RUNNING, CANCELLING, CANCELLED, COMPLETED and FAILED. Only the orchestrator publishes the final typed outcome.

Cancellation propagates through preview, conversational execution, Planner, Runtime, tool-call batches, validation and Reviewer. Each stage checks before it begins. Long batches check between tool operations. An active model request, file write, shell command, serialization, permission prompt or cleanup operation is allowed to reach its next safe boundary before cancellation propagates.

## CLI behavior

Ctrl+C cancels the active task. A repeated Ctrl+C while cancellation is already pending is ignored and does not create another outcome. Ctrl+C with no active task retains the normal exit behavior.

## Outcome and cleanup

Cancellation returns `CANCELLED_BY_USER` with Task ID, reason, stage, duration, completed/skipped stages, workspace and `rollback: false`. The renderer states clearly that completed work remains. Cleanup always unregisters the task token, including failures.

## Explicit limitation

Cancellation is cooperative, not process termination. It cannot stop an atomic operation already in progress, and rollback, persistence and resume are not implemented.
