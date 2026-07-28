# ZOE-013 — Workspace Drift Detection

## Status and boundary

Implemented. `workspace-drift.ts` is the single read-only authority for comparing one checkpoint's stored workspace metadata with a current WorkspaceContext. It never loads checkpoints, modifies them, restores execution, resumes tasks or rolls back files.

## Comparison model

The analyzer first validates usable inputs and checkpoint schema, then compares workspace root and context version. A workspace version mismatch is immediately incompatible. When those gates pass, it uses the existing ZOE-010 `createWorkspaceFingerprint()` and `workspaceFingerprintsMatch()` helpers; no second fingerprint algorithm exists.

Fingerprint differences are expanded deterministically into added, removed, modified and detectable renamed files. Rename detection pairs a removed path with an added path only when their stored hash and size match. Ignored files are absent from the canonical WorkspaceContext inventory and therefore do not participate.

## Results and reasons

Results are immutable and have status COMPATIBLE, INCOMPATIBLE or UNKNOWN plus `resumePossible`. Typed reasons include the existing workspace reasons plus GitRepositoryChanged, GitRepositoryRootChanged, GitHeadChanged, GitBranchChanged, GitDetachedHeadChanged, GitWorkingTreeChanged, GitConflictDetected and GitContextUnavailable.

Comparison errors or unusable workspace metadata return UNKNOWN/UnknownWorkspace without changing checkpoint state.

## Critical files

The policy detects changes without parsing dependencies. Critical files include package manifests and semantic configuration such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `composer.json`, `requirements.txt`, `tsconfig.json`, and common npm/pnpm/yarn/bun, Rust, Go, Composer and Poetry lockfiles.

## Git supplement

The existing fingerprint always runs and remains authoritative for indexed files. Git adds repository identity/relationship, HEAD, branch, detached state, conflicts and exact normalized dirty-path metadata. Ambiguous or unavailable Git context returns UNKNOWN; conflicts are incompatible. Matching non-Git and matching dirty snapshots remain valid.

## Limitations

Workspace rename detection is content-signature based and cannot prove user intent. Git rename metadata is repository-reported and separately normalized. An ignored-file-only change can still be incompatible when Git reports it as a changed path. Git awareness supplements rather than replaces the workspace fingerprint.
