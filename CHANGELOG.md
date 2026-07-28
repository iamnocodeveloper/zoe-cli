# Changelog

All notable changes are documented here. Zoe follows Semantic Versioning, including prerelease identifiers.

## 0.4.0-alpha.0 — 2026-07-28

First public alpha candidate.

### Added

- Canonical task orchestration and typed outcomes.
- Deterministic workspace intelligence shared across task stages.
- Direct-command and package-install permission boundaries.
- Task intent and execution preview.
- Cooperative task cancellation.
- Immutable checkpoint model, local atomic persistence and lifecycle capture.
- Workspace fingerprint drift detection.
- Explicit, limited Safe Resume for supported post-tool boundaries.
- Read-only Git awareness integrated into preview, checkpoints, drift and resume safety.
- Scoped public npm packaging and Windows-first release validation.

### Security

- Checkpoints exclude prompts, source content, command output and credentials.
- Previous approvals never survive resume.
- Git inspection is timeout-bounded, non-interactive, local and read-only.
- Package contents use an explicit allowlist.

### Known limitations

- Windows is the only release-validated platform.
- Checkpoint schema v2 and CLI behavior may change during alpha.
- Safe Resume cannot reconstruct unfinished ToolExecution or a pending Reviewer.
- Git ahead/behind metadata uses local refs and may be stale.
- Live OAuth and model-backed task execution require service availability.
- Rollback, automatic resume, connectors and expanded project memory are not implemented.
