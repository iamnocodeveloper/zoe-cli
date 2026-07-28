# ZOE-011 — Checkpoint Persistence Engine

## Status and ownership

Implemented. `checkpoint-storage.ts` is the only component authorized to read or write checkpoint files. The Task Orchestrator remains the task owner, and `task-checkpoint.ts` remains the immutable metadata contract. No resume, restoration, rollback or Cloud synchronization exists.

## Storage layout

Production storage defaults to `~/.zoe/checkpoints/`. Each checkpoint is an independent `<taskId>.checkpoint.json` file. Task IDs are restricted to filesystem-safe characters so a checkpoint cannot escape the storage directory. Tests inject a temporary storage directory and never touch the real home location.

## Atomic writes and concurrency

Save validates the canonical object, creates the directory, writes a uniquely named same-directory temporary file with owner-only mode where supported, flushes it, closes it and renames it over only the target task file. Temporary files are removed after failures. A second concurrent save for the same Task ID fails with a typed write error; unrelated task files are never overwritten.

## Loading and version validation

Load parses JSON, validates required fields, numeric and collection types, lifecycle state, fingerprint and permission contracts, and requires the current checkpoint schema version. Corruption and incompatible versions are explicit typed errors. Migration is not attempted.

## Listing and cleanup

`list()` reads lightweight summary fields without constructing full checkpoint objects. Summaries contain Task ID, creation/update time, workspace, state, eligibility and schema version. `delete()` is idempotent. Cleanup is explicit—not a startup side effect—and removes only COMPLETED, DISCARDED, OBSOLETE or INVALID checkpoints at or beyond a configurable age.

## Error model

Typed codes cover not found, corruption, version mismatch, permission denial, read/write failure, and serialization/deserialization failure.

## Security contract

Only canonical checkpoint metadata is serializable. Functions, promises/runtime instances by structure, undefined values, symbols, bigints and circular references are rejected. Sensitive field names covering keys, OAuth/tokens, passwords, secrets, credentials, authorization, environment data, prompts, conversation history, command output and terminal history are rejected. Debug output logs operation markers and storage path, never checkpoint content.

Schema v2 additionally validates Git snapshot structure with exact key allowlists. Remote URLs, Git config/helpers, identities, messages, diffs, content, raw output, environment and SSH metadata cannot be persisted. Older schema versions return the existing typed version mismatch.
