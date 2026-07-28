# ZOE-016 — Git Safety Context Integration

## Shared workspace snapshot

Each `WorkspaceContext` owns one immutable `GitRepositoryContext` reference. Preview, Task Orchestrator and checkpoint capture consume that exact reference. Workspace creation and explicit refresh inspect Git once; Safe Resume builds a fresh WorkspaceContext and therefore a fresh Git snapshot. There is no polling or watcher.

## Preview

The default preview shows one compact Git row: non-repository/unavailable state or branch, state, abbreviated HEAD and change counts. It never prints full changed-file lists and does not alter task classification or mode.

## Checkpoint schema v2

Git integration deliberately increments `CHECKPOINT_SCHEMA_VERSION` from 1 to 2. Version-1 files are rejected with `CheckpointVersionMismatch`; no migration occurs.

The sanitized snapshot contains repository presence, workspace-relative repository relationship, branch, detached state, HEAD, working-tree state, category counts, normalized changed paths/statuses and Git context version. It excludes remotes, credentials, helpers, config, author/email, commit messages, diffs, content, command output, environment and SSH metadata. Storage enforces an exact key allowlist.

## Drift and resume

Git comparison supplements the existing workspace fingerprint. Repository presence/relationship, HEAD, branch, detached state, working-tree state, conflicts and changed paths have typed drift reasons. A branch change with an identical HEAD is conservatively incompatible.

Safe Resume rejects changed repository identity, relationship, HEAD, branch, detached state, dirty metadata, conflicts and unavailable/ambiguous Git state. Matching dirty snapshots can resume when the existing workspace fingerprint and all other resume rules also match. Non-Git checkpoints remain compatible only with non-Git workspaces.

Git validation runs before permission revalidation and cannot weaken safe-boundary or no-replay rules. Existing direct-command permissions remain authoritative for every user-entered Git mutation command.

## Owner-run resume smoke tests

Using a disposable repository and disposable checkpoints:

1. Resume with unchanged Git state.
2. Reject after changing HEAD.
3. Reject after creating an untracked file.
4. Reject during a merge conflict.

Never clean, reset, stash, checkout or resolve the Zoe repository as part of validation.

ZOE-017 executed these scenarios only in disposable temporary repositories. Clean, dirty, staged, unstaged, untracked, nested, detached, local-upstream and conflict states passed; branch, HEAD and conflict drift rejected installed Safe Resume.
