# ZOE-006 — Workspace Intelligence

## Status

Implemented for the Windows private preview. `src/core/workspace-intelligence.ts` is the sole project-discovery service used by the task path.

## Canonical context

`WorkspaceIntelligence` creates an immutable, versioned `WorkspaceContext`. It records root and project metadata, one canonical immutable Git context reference, deterministic framework/language/package-manager detection, directory inventory, important/config/dependency files, entry points, file hashes and modification metadata, and project statistics. `WorkspaceSummary` is a deterministic projection of that context; no model request, memory store, embedding, or external API is involved.

The service caches one context per workspace root. A task calls it once through `TaskOrchestrator`; the exact object reference is passed to conversational agent, planner, structured runtime and tool-call adapter, while the reviewer receives a projection from that same object. `context.ts` now renders project descriptions from this object and does not scan the filesystem.

## Detection and inventory

Detection uses package manifests, lockfiles and conventional files only. It recognises Node, TypeScript, JavaScript, Python, Go, Rust, PHP, Java, C#, Flutter/Dart, React, Next.js, Vue, Angular, Express, FastAPI, Laravel, Django, Supabase, InsForge and Docker where repository evidence exists.

Every indexed non-ignored file has its relative path, extension, detected language, byte size, SHA-256 hash, modification time, important flag and ignored flag. Ignored files/directories are recorded separately so large generated/binary trees are not indexed.

## Ignore policy

One policy covers `.gitignore` patterns plus `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.cache`, `target`, `vendor`, `.zoe`, generated/minified/map files, temporary files, binary/large media and files over 10 MiB. This is deliberately deterministic and local.

## Refresh and limitations

`refresh(changedPaths)` reuses the prior hash when a file's size and modification time are unchanged; supplied changed paths force only those hashes to be recomputed. Manifest, `.gitignore`, missing-path and directory changes trigger a full inventory because they can change discovery globally. Git is inspected once for each created/refreshed snapshot and never polled. Git ignore/status and Workspace inventory remain separate. File-system watching, full `.gitignore` negation semantics, monorepo package boundaries and a raw tool-level context parameter are deferred.

## Evidence

`test/workspace.test.ts` creates an isolated fixture that proves detection, ignores, important files, immutability, cache reuse, version increments, changed-file hash refresh and shared orchestrator context identity.
