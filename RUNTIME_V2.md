# Zoe CLI — Runtime V2

## 1. End-to-end lifecycle

```text
User Prompt
    ↓
Understand
    ↓
Project Snapshot
    ↓
Structured Plan
    ↓
Runtime Execution
    ↓
Tool Calls
    ↓
Verification
    ↓
Repair
    ↓
Final State
```

1. **User Prompt** — Zoe receives the task and preserves the original constraints.
2. **Understand** — The LLM identifies intent, expected outcome, restrictions and ambiguities.
3. **Project Snapshot** — The Runtime records the real workspace: root, framework, language, package manager, files, scripts and configuration.
4. **Structured Plan** — The LLM proposes JSON matching the plan schema. The Runtime validates it against the snapshot and user constraints.
5. **Runtime Execution** — The Runtime selects the next approved action. It does not execute arbitrary items from model prose.
6. **Tool Calls** — File actions, commands and reads execute through validated tools with permissions.
7. **Verification** — Requirements, files, command exit codes and validation commands are checked independently.
8. **Repair** — Failed requirements produce focused repair attempts, bounded by a strict limit.
9. **Final State** — The Runtime returns `SUCCESS`, `FAILED`, `NEEDS_USER_INPUT` or `CANCELLED`.

## 2. Responsibility matrix

| Responsibility | LLM | Runtime |
|---|---:|---:|
| Understand user intent | Proposes interpretation | Preserves prompt and constraints |
| Detect framework | Suggests from snapshot | Detects and confirms from files |
| Select relevant files | Proposes candidates | Validates existence, scope and permissions |
| Validate paths | Never authoritative | Canonicalizes and rejects unsafe paths |
| Execute commands | Requests commands | Executes approved commands with exact `cwd` |
| Check requirements | Explains implementation | Verifies each requirement with evidence |
| Run build/tests | Requests validation | Runs available mandatory validations |
| Retry failed steps | Suggests focused repair | Counts attempts and controls retry policy |
| Declare final success | Never | Sole authority |

Core rule: **the LLM never decides that a task is complete. The Runtime decides completion.**

The LLM reasons, proposes and explains. The Runtime owns state, ordering, permissions, execution, verification, retries and final status.

## 3. Required data structures

### ProjectSnapshot

Purpose: describe the real project before planning.

Required fields: `root`, `framework`, `language`, `packageManager`, `sourceDir`, `entryFile`, `appFile`, `styleFile`, `scripts`, `configFiles`, `hasPackageJson`, `isEmpty`.

Created by: Runtime. Validated by: Runtime filesystem checks. Consumed by: planner, plan validator and executor.

### ExecutionPlan

Purpose: define an executable contract, not a narrative.

Required fields: `summary`, `framework`, `packageManager`, `files`, `commands`, `requirements`, `validationCommands`, `userConstraints`, `risks`, `estimatedMinutes`.

Created by: LLM. Validated by: Runtime schema and constraint validation. Consumed by: Runtime executor and verifier.

### ExecutionState

Purpose: represent the authoritative progress of one task.

Required fields: `currentPlan`, `completedSteps`, `pendingSteps`, `filesCreated`, `filesModified`, `validationResults`, `repairAttempts`, `status`.

Created and updated by: Runtime only. Validated by: Runtime invariants. Consumed by: tools, UI and final result generation.

### FileAction

Purpose: describe one file operation.

Required fields: `path`, `action` (`create` or `modify`), `purpose`.

Created by: LLM. Validated by: Runtime path, language and user-constraint checks. Consumed by: file tools and requirement verification.

### CommandAction

Purpose: describe one shell operation.

Required fields: `command`, `cwd`, `purpose`, `required`.

Created by: LLM or Runtime validation policy. Validated by: Runtime permissions, workspace boundary and dependency policy. Consumed by: shell executor.

### Requirement

Purpose: express an observable outcome.

Required fields: `id`, `description`, `verification`.

Verification must be one of: `file_exists`, `file_contains` or `command_succeeds`.

Created by: LLM. Validated and consumed by: Runtime verifier.

### ValidationResult

Purpose: record objective validation evidence.

Required fields: `command`, `passed`, `output`, `exitCode` or equivalent error information.

Created by: Runtime. Validated by: Runtime based on exit status and policy. Consumed by: repair loop and final result.

### RepairAttempt

Purpose: record one focused attempt to resolve a failed requirement or validation.

Required fields: `attemptNumber`, `target`, `failure`, `requestedAction`, `result`.

Created by: Runtime, with repair instructions proposed by the LLM. Validated by: Runtime. Consumed by: retry policy and final report.

### FinalResult

Purpose: expose the authoritative outcome.

Required fields: `status`, `filesCreated`, `filesModified`, `completedRequirements`, `validationResults`, `repairAttempts`, `errors`, `warnings`.

Created by: Runtime. Validated by: completion contract. Consumed by: CLI UI, logs and caller.

## 4. Runtime state machine

Allowed states:

```text
IDLE
  → ANALYZING
  → PLANNING
  → AWAITING_APPROVAL
  → EXECUTING
  → VERIFYING
  → REPAIRING
  → SUCCESS | FAILED | NEEDS_USER_INPUT | CANCELLED
```

Valid transitions:

- `IDLE → ANALYZING`: a task is received.
- `ANALYZING → PLANNING`: snapshot is complete.
- `PLANNING → AWAITING_APPROVAL`: plan is valid and requires approval.
- `PLANNING → EXECUTING`: plan is valid and approval is not required.
- `PLANNING → NEEDS_USER_INPUT`: plan is invalid, contradictory or ambiguous after one repair.
- `AWAITING_APPROVAL → EXECUTING`: user approves.
- `AWAITING_APPROVAL → CANCELLED`: user rejects or cancels.
- `EXECUTING → VERIFYING`: an action category or step finishes.
- `VERIFYING → EXECUTING`: pending approved work remains.
- `VERIFYING → REPAIRING`: a repairable requirement or validation fails.
- `VERIFYING → SUCCESS`: completion contract passes.
- `VERIFYING → FAILED`: an unrecoverable failure occurs.
- `REPAIRING → EXECUTING`: a focused repair is approved and scheduled.
- `REPAIRING → VERIFYING`: repair is applied and must be rechecked.
- `REPAIRING → FAILED`: retry limit is reached or repair cannot execute.

No transition may skip validation before `SUCCESS`.

## 5. Completion contract

`SUCCESS` is allowed only when all conditions are true:

- every planned file action completed successfully;
- every required file exists at its canonical path;
- every requirement has passed its declared verification;
- every mandatory command succeeded;
- every validation command passed;
- no pending steps remain;
- no unresolved repair attempt remains;
- no user constraint was violated.

The model's words, including “done”, “completed” or “finished”, are not completion evidence.

## 6. Failure and repair rules

- Maximum: **3 repair attempts per failed requirement**.
- Retry only when the failure is actionable and the Runtime can identify the affected file, command or requirement.
- A repair request must contain the exact failure evidence and a focused target.
- Re-run the affected verification after every repair.
- Do not regenerate the entire project for a local failure.
- Return `NEEDS_USER_INPUT` when the plan is contradictory, required permission is denied, a requested file is outside scope, or the task requires an unstated product decision.
- Return `FAILED` when execution or validation cannot succeed after the retry limit, when a required command fails irreparably, or when the environment is unavailable.
- Return `CANCELLED` only when the user cancels or rejects an approval.

## 7. Golden-path example

Scenario: existing React + Vite + TypeScript project.

User request:

> Create a complete responsive landing page with Navbar, Hero, Features, CTA and Footer. Modify only src/App.tsx and src/App.css. Do not install dependencies. Run npm run build.

### ProjectSnapshot

```json
{
  "root": "C:/project",
  "framework": "react-vite",
  "language": "typescript",
  "packageManager": "npm",
  "sourceDir": "src",
  "entryFile": "src/main.tsx",
  "appFile": "src/App.tsx",
  "styleFile": "src/App.css",
  "scripts": { "build": "vite build" },
  "configFiles": ["vite.config.ts", "tsconfig.json"],
  "hasPackageJson": true,
  "isEmpty": false
}
```

### Structured ExecutionPlan

```json
{
  "summary": "Build the landing page in the existing React application.",
  "framework": "react-vite",
  "packageManager": "npm",
  "files": [
    {"path":"src/App.tsx","action":"modify","purpose":"Implement all landing page sections."},
    {"path":"src/App.css","action":"modify","purpose":"Implement dark responsive purple-accent styling."}
  ],
  "commands": [],
  "requirements": [
    {"id":"navbar","description":"Sticky Navbar with logo, links and CTA","verification":{"type":"file_contains","path":"src/App.tsx","patterns":["Navbar","nav"]}},
    {"id":"hero","description":"Hero with headline, subtitle and two CTAs","verification":{"type":"file_contains","path":"src/App.tsx","patterns":["Hero","Get started"]}},
    {"id":"features","description":"Features section with six cards","verification":{"type":"file_contains","path":"src/App.tsx","patterns":["Features"]}},
    {"id":"cta-footer","description":"CTA and Footer sections exist","verification":{"type":"file_contains","path":"src/App.tsx","patterns":["CTA","Footer"]}},
    {"id":"responsive","description":"Responsive styling exists","verification":{"type":"file_contains","path":"src/App.css","patterns":["@media"]}}
  ],
  "validationCommands": [
    {"command":"npm run build","cwd":".","purpose":"Verify production build","required":true}
  ],
  "userConstraints":{"allowedFiles":["src/App.tsx","src/App.css"],"forbiddenFiles":[],"allowDependencyInstall":false,"allowNewFiles":false},
  "risks":[],
  "estimatedMinutes":5
}
```

### Runtime steps

1. Validate that both planned files are allowed and already exist.
2. Request approval if policy requires it.
3. Ask the LLM for an `App.tsx` modification only.
4. Apply the modification and record the file action.
5. Ask the LLM for an `App.css` modification only.
6. Apply the modification and record the file action.
7. Verify each requirement from its declared evidence rule.
8. Run `npm run build` from `C:/project`.
9. If a requirement or build fails, perform a focused repair, up to three times.
10. Confirm no pending steps and produce the final result.

### Verification result

```text
src/App.tsx: modified
src/App.css: modified
Navbar: PASS
Hero: PASS
Features: PASS
CTA: PASS
Footer: PASS
Responsive styling: PASS
npm run build: PASS (exit code 0)
Pending steps: 0
```

### FinalResult

```json
{
  "status":"SUCCESS",
  "filesCreated":[],
  "filesModified":["src/App.tsx","src/App.css"],
  "completedRequirements":["navbar","hero","features","cta-footer","responsive"],
  "validationResults":[{"command":"npm run build","passed":true}],
  "repairAttempts":0,
  "errors":[],
  "warnings":[]
}
```

## 8. Migration plan

### Phase 1 — Structured types and validation

Introduce the plan schema, snapshot model, path normalization and constraint validation. Keep the legacy executor available but do not allow invalid structured plans to reach it.

### Phase 2 — One golden-path task

Route only the existing React/Vite/TypeScript landing-page scenario through Runtime V2. Compare files, commands, requirements and final status with the acceptance contract.

### Phase 3 — Disable legacy text-plan fallback

Remove Markdown plan parsing and all heuristics that classify bullets as files, commands or requirements. Invalid JSON must return `NEEDS_USER_INPUT` after one planner repair attempt.

### Phase 4 — Repair loop

Add requirement-level repair attempts. Pass only the failure evidence and relevant target to the LLM, then re-run the affected verification.

### Phase 5 — Broader tests

Add tests for empty projects, existing projects, path restrictions, package-manager detection, command cwd, build failures, denied permissions, cancellation, malformed plans and package installation.

## 9. Risks

- **Plan/schema drift:** keep one versioned schema and reject unknown or incomplete shapes.
- **Unsafe paths:** canonicalize paths and resolve symlinks before file access.
- **Command side effects:** require explicit policy checks, exact cwd and approval for risky commands.
- **False success:** make the Runtime, not model text, the only source of final status.
- **Incomplete verification:** require every plan requirement to have an observable verification rule.
- **Repair loops:** cap attempts and preserve failure evidence to prevent repetition.
- **Existing-project damage:** compare the snapshot with the plan and reject recreation of existing files.
- **Monorepo ambiguity:** store cwd on every command and resolve project roots explicitly.
- **Legacy compatibility:** migrate one task at a time and remove fallback only after acceptance tests pass.

## 10. Final recommendation

Build first:

1. ProjectSnapshot and canonical path handling.
2. Zod-validated ExecutionPlan.
3. ExecutionState with explicit transitions.
4. Requirement and validation verification.
5. Golden-path integration test.

Do not build yet:

- Skills;
- MCP;
- multi-agent orchestration;
- UI redesign;
- new models;
- memory, plugins or unrelated features.

Before expanding implementation, Zoe must demonstrate that the golden-path task:

- produces valid JSON-only planning;
- modifies only `src/App.tsx` and `src/App.css`;
- creates no `App.jsx`, `main.jsx`, `package.json` or other files;
- runs no dependency installation;
- runs `npm run build` successfully;
- verifies every requirement;
- performs bounded repair when needed;
- returns `SUCCESS` only with zero pending steps;
- returns `FAILED`, `NEEDS_USER_INPUT` or `CANCELLED` correctly in negative cases.
