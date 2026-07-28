# ZOE-012 — Checkpoint Lifecycle Capture Integration

## Status and ownership

Implemented. The Task Orchestrator remains the sole execution owner. `CheckpointLifecycleCapture` converts lifecycle boundaries into immutable canonical checkpoint replacements, and `CheckpointStorage` remains the only filesystem writer. No checkpoint is loaded or executed, and resume, restoration, rollback, replay and memory remain absent.

## Lifecycle flow

Task acceptance immediately persists a CREATED checkpoint. Safe completed boundaries can then persist READY snapshots for Preview, Planning, Runtime, ToolExecution, Validation, Reviewer, Rendering and Cleanup. Successful execution ends with COMPLETED; cancellation ends with DISCARDED; execution failure ends with INVALID.

The structured runtime receives a metadata-only callback used after tool execution, validation and Reviewer boundaries. This callback does not change Planner, RuntimeController, Builder or Reviewer decisions.

## Immutability and replacement

Every update constructs a new frozen checkpoint from the canonical model and saves it through the existing atomic repository. Previous checkpoint objects are never mutated. The task file is replaced atomically by storage, while unrelated checkpoints are untouched.

## Duplicate suppression and performance

Capture records a state/stage key before queueing persistence. Repeating the same READY stage or terminal state is skipped. Writes are serialized per capture so lifecycle ordering is deterministic; no startup load or cleanup was added.

## Cancellation and failure

Cancellation persists DISCARDED metadata containing stage, reason and duration. Failures persist INVALID metadata containing safe category, stage, reason and timestamp without stack traces. Completed work is not rolled back.

## Storage failure isolation

Persistence errors are caught inside capture, converted to warnings and exposed with the TaskOutcome. Task execution, Planner, Runtime, validation and Reviewer results remain authoritative and continue normally. Debug logging records state/stage markers but never checkpoint payloads.

ZOE-016 capture uses the Git snapshot already attached to the task's WorkspaceContext. It never reinspects Git independently, preserving one shared context reference per task.
