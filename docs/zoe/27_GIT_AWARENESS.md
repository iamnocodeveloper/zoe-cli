# ZOE-015 — Read-Only Git Repository Awareness

## Status and ownership

Implemented. `git-awareness.ts` is the only internal authority that invokes Git for metadata inspection. It exposes an immutable `GitRepositoryContext`; no raw porcelain output or generic command executor escapes the module.

## Read-only command policy

The fixed command set is limited to Git version, repository root/worktree detection, HEAD, symbolic branch, porcelain-v1 status, local upstream name and local ahead/behind counts. Execution uses `spawnSync` without a shell, a three-second default timeout, hidden windows and `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=Never` and `GIT_OPTIONAL_LOCKS=0`.

No fetch, pull, push, credential lookup or other network operation is used. No add, commit, checkout, reset, clean, stash, merge, rebase or repository mutation exists.

## Context and state precedence

The context records repository/workspace roots, containment, branch or detached HEAD, commit, normalized changed paths, staged/unstaged/untracked/conflicted sets, local upstream availability and counts, Git version, timestamp, version and typed failure.

State precedence is:

`UNAVAILABLE → UNKNOWN → NOT_A_REPOSITORY → CONFLICTED → DETACHED_HEAD → DIRTY → CLEAN`

A non-Git workspace is valid and returns `NOT_A_REPOSITORY`. Missing Git, timeouts, permissions, malformed porcelain and unexpected adapter failures become unavailable/unknown metadata and never fail a normal task.

## Path and boundary safety

Git paths use forward-slash repository-relative normalization. A repository root may be above the workspace; this relationship is recorded but never expands Workspace Intelligence write boundaries or overrides ignore rules.

## Manual smoke tests

Use only disposable repositories:

1. Clean repository.
2. Dirty repository.
3. Nested workspace with repository root above it.
4. Non-Git directory.
5. Detached HEAD.
6. Mixed staged and unstaged changes.

Do not run these scenarios by mutating the Zoe repository.
