# ZOE-014 — Safe Resume Eligibility & Operator-Controlled Resume

## Status and boundary

Implemented. Resume exists only behind the explicit `zoe resume <taskId>` operator command. There is no startup scan, timer, background worker, rollback, replay or automatic resume.

`safe-resume.ts` is the canonical coordinator. Task Orchestrator remains the owner of normal task execution, Checkpoint Storage owns loading and atomic replacement, and Workspace Drift owns compatibility. Resume composes those authorities without changing Planner, RuntimeController, Builder or Reviewer algorithms.

Before compatibility, Safe Resume now builds a fresh WorkspaceContext and therefore refreshes the Git snapshot once. Git drift and conflicts reject before permission revalidation. This only adds rejection signals; it cannot relax READY, post-ToolExecution, permission or no-replay restrictions.

## Safe lifecycle

The coordinator loads exactly the requested task checkpoint, requires state `READY`, always invokes Workspace Drift, derives the next safe post-tool boundary and revalidates permissions with an empty approval state. Only then does it execute injected stage adapters.

Resume is deliberately limited to checkpoints that already completed `ToolExecution`. Earlier boundaries are rejected because the checkpoint contains metadata rather than executable prompt/plan payloads, and reconstructing them would require replay. Completed tool batches and names are copied unchanged and no tool-execution adapter exists in resume.

Eligible continuation order is:

`Validation → Reviewer → Rendering → Cleanup → COMPLETED`

A passed Validation or Reviewer result may be reused only after the workspace reports `COMPATIBLE`. Failed or pending results are executed again. Each resumed invocation receives a new runtime identifier while checkpoint ID and task ID remain unchanged.

## Permissions and validation

Previous approvals are cleared in the in-memory resume context. Permission revalidation is mandatory even when the next stage has no shell command. The CLI requires `--approve-validation` before it can execute stored validation command names. It also restricts those names to commands currently discovered by the existing validation-command policy.

Rejection before completion does not write the stored checkpoint. Successful continuation constructs new immutable snapshots in memory and atomically replaces the existing task checkpoint only with the final `COMPLETED` state. No duplicate checkpoint is created.

## Outcomes and observability

Outcomes are immutable and return `RESUMED` or `RESUME_REJECTED`, checkpoint/task/runtime identity, resume stage, workspace status, permission status, validation status, review status and a typed rejection code.

With `ZOE_DEBUG=true`, safe metadata logs cover the request, load, workspace result, permission result, acceptance/rejection and current stage. Checkpoint payloads are never logged.

## Limitations

The persisted contract intentionally excludes prompts, plans, tool outputs and reviewer inputs. Therefore the default CLI can rerun allowlisted validation commands and finish already-reviewed checkpoints, but it cannot reconstruct a pending Reviewer. A product-level Reviewer adapter may be supplied later without changing the resume safety contract. CREATED checkpoints and all pre-ToolExecution boundaries remain ineligible. Rollback is not implemented.

ZOE-017 exercised the installed CLI against an isolated real checkpoint. Compatible post-tool continuation completed with a new runtime ID and no batch replay; unsafe, workspace-drift, branch, HEAD and conflict cases rejected deterministically.
