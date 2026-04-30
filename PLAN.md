# cursor-plugin-cc — Implementation Plan

Claude Code plugin that delegates work to Cursor's AI agent via `@cursor/sdk`.
Mirrors [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) architecture.

### Reference: Cursor cookbook `coding-agent-cli`

We mine [`cursor/cookbook/sdk/coding-agent-cli`](https://github.com/cursor/cookbook/tree/main/sdk/coding-agent-cli)
for SDK-usage patterns. We do **not** vendor the project — it is Bun-only (OpenTUI via
`bun:ffi`) and is a standalone interactive CLI, not a plugin backend. Specific files we
lift patterns from:

| Cookbook file | What we take | Where it lands |
|--------------|--------------|----------------|
| `src/agent.ts` `emitSdkMessage` | SDKMessage → flat `AgentEvent` mapper | §2.6 `render.mts` (also exposed by 2.1) |
| `src/agent.ts` `buildPrompt` | System-instruction wrapper around user prompt | §2.1 `cursor-agent.mts` |
| `src/agent.ts` `detectCloudRepository` / `normalizeGitHubRemote` | Cloud-mode repo detection | §2.1 (cloud-mode follow-on) |
| `src/agent.ts` model dedupe / variant disambiguation | Model picker output for `setup` | §3.4 `setup` subcommand |
| `src/agent.ts` `cancelCurrentRun` (`run.supports("cancel")`) | Capability-checked cancel | §2.1 + §2.4 job-control |
| `src/agent.ts` `summarizeToolArgs` / `formatDuration` | Tool-call + duration formatting | §2.6 `render.mts` |
| `src/index.ts` `runPlainPrompt` / `renderPlainEvent` | Non-interactive streaming-to-stdout | §3.2 `task` subcommand |

Anything TUI/Bun/OpenTUI-related is intentionally ignored.

---

## Phase 1: Project Scaffolding

### 1.1 Repository Setup
- [x] `git init`
- [x] Create `.gitignore` (node_modules, dist, .env, CLAUDE.local.md, *.log)
- [x] `npm init` with correct metadata (name: `cursor-plugin-cc`, license, repo URL)
- [x] Install dependencies:
  - [x] `@cursor/sdk` — Cursor agent SDK
  - [x] `typescript` — compiler (dev)
  - [x] `vitest` — test runner (dev)
  - ~~`eslint` + `@typescript-eslint/*`~~ → replaced by `@biomejs/biome` (installed)
  - [x] `tsc` — build (dev) (chose plain `tsc` over `tsup`; no bundling needed)

### 1.2 TypeScript Config
- [x] `tsconfig.json`: target ES2022, module NodeNext, strict (typecheck-only, `noEmit`)
- [x] Source in `plugins/cursor/scripts/` → compiled to `plugins/cursor/scripts/dist/`
- [x] Separate `tsconfig.build.json` (sets `outDir`/`rootDir`, excludes tests)

### 1.3 Lint Config (Biome, replacing ESLint)
- [x] `biome.json` with lint + format rules (replaces `eslint.config.mjs`)
- [x] Rule: no `any`, no `@ts-ignore` (enforced via Biome + CLAUDE.md convention)
- [x] Husky pre-commit runs `biome check --staged`

### 1.4 Package Scripts
- [x] `build`, `typecheck`, `test`, `test:watch` wired up; `lint`/`format`/`check`/`check:fix` via Biome
```json
{
  "build": "tsc -p tsconfig.build.json",
  "typecheck": "tsc --noEmit",
  "lint": "biome lint .",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### 1.5 Plugin Manifest
- [x] `plugins/cursor/.claude-plugin/plugin.json`:
  ```json
  {
    "name": "cursor",
    "version": "0.1.0",
    "description": "Use Cursor from Claude Code to review code or delegate tasks.",
    "author": { "name": "cursor-plugin-cc" }
  }
  ```
- [x] `.claude-plugin/marketplace.json` (top-level, for plugin registry):
  ```json
  {
    "name": "cursor-plugin-cc",
    "owner": { "name": "cursor-plugin-cc" },
    "metadata": {
      "description": "Cursor plugin for Claude Code — delegation and code review.",
      "version": "0.1.0"
    },
    "plugins": [{
      "name": "cursor",
      "description": "Use Cursor from Claude Code to review code or delegate tasks.",
      "version": "0.1.0",
      "author": { "name": "cursor-plugin-cc" },
      "source": "./plugins/cursor"
    }]
  }
  ```

### 1.6 Directory Skeleton
- [x] Skeleton scaffolded with stubs for `cursor-companion.mts` and `session-lifecycle-hook.mts`
- [x] `vitest.config.mts` + smoke test in `tests/unit/scaffold.test.mts`
```
plugins/cursor/
├── .claude-plugin/plugin.json
├── commands/
├── agents/
├── hooks/hooks.json
├── skills/
├── scripts/
│   ├── cursor-companion.mts
│   ├── session-lifecycle-hook.mts
│   └── lib/
└── package.json
```

**Exit criteria**: `npm run build` succeeds, `npm run check` passes, `npm test` runs. ✅ (all green as of Phase 1 completion)

---

## Phase 2: Core SDK Integration Layer

The foundation. Everything else builds on this.

### 2.1 `lib/cursor-agent.mts` — Cursor Agent Wrapper

Wraps `@cursor/sdk` Agent with project-specific defaults and error handling.

```typescript
// Core responsibilities:
// - Create local agents scoped to cwd
// - Send prompts and stream results
// - Resume durable agents by ID
// - Cleanup/dispose agents
// - Structured output support (for reviews)

import type { ModelSelection, McpServerConfig } from "@cursor/sdk";

interface CursorAgentOptions {
  cwd: string;
  apiKey: string;
  model?: ModelSelection;   // default: { id: "composer-2" }
  mcpServers?: Record<string, McpServerConfig>;
  settingSources?: Array<"project" | "user" | "team" | "mdm" | "plugins">;
}

interface CursorRunResult {
  // Mirrors SDK RunResult.status (lowercase) + "expired" for stale local runs
  // surfaced via SDKStatusMessage.
  status: "finished" | "error" | "cancelled" | "expired";
  output: string;           // aggregated text output
  toolCalls: ToolCallEvent[];
  agentId: string;          // for resume
  durationMs?: number;
}
```

Key behaviors:
- [x] `createAgent(opts)` — `await Agent.create(...)` (async), validate API key
- [x] `sendTask(agent, prompt)` — send prompt, stream events, aggregate output
- ~~`streamEvents(run)` — async generator over `SDKMessage` (8 variants:
      `system | user | assistant | thinking | tool_call | status | task | request`)~~
      Dropped: a thin re-export added no value over `Run.stream()` directly. Callers that need raw events use the SDK iterator; consumers that want aggregated text/tool calls use `sendTask`.
- [x] `resumeAgent(agentId, opts)` — `await Agent.resume(...)` (async)
- [x] `oneShot(prompt, opts)` — thin wrapper over `Agent.prompt()` for setup
      smoke test and short stateless calls (review can use this)
- [x] `disposeAgent(agent)` — `await agent[Symbol.asyncDispose]()`
- [x] `listArtifacts(agent)` / `downloadArtifact(agent, path)` — expose SDK
      artifact API for `/cursor:result` to retrieve generated files
- [x] Status normalization: SDK `RunResult.status` is lowercase; status-message
      stream uses uppercase + extra `EXPIRED` state — wrapper presents one
      consistent enum to callers (`normalizeStreamStatus`)
- [x] API key validation: check `CURSOR_API_KEY` env var, clear error message if missing (`resolveApiKey`)
- [x] Model validation: call `Cursor.models.list()` to verify model exists (`validateModel`)
- [x] Timeout handling: cancel run if it exceeds configurable timeout (`SendTaskOptions.timeoutMs`)
- [x] Account helpers: `whoami` / `listModels` for `/cursor:setup`

Follow-on items (from cookbook absorption):
- [x] `buildPrompt(prompt, instructions?)` — wrap user prompt with default system
      instructions (mirrors cookbook `AGENT_INSTRUCTIONS`). Instructions
      overridable per-call.
- [x] Cloud execution mode: optional `mode: "local" | "cloud"` + `cloudRepo`
      on `CursorAgentOptions`; when `cloud`, pass `cloud: { repos: [...] }`
      to `Agent.create`. `detectCloudRepository` lives in `lib/git.mts` (§2.5).
- [x] `local.force` passthrough — `SendTaskOptions.force` maps to
      `agent.send(prompt, { local: { force: true } })`.
- [x] Capability-checked cancel: timeout path checks `run.supports("cancel")`
      before calling cancel; `cancelRun(run)` helper exposes the
      `{ cancelled, reason? }` result.
- ~~Token usage on `CursorRunResult`~~ — `RunResult` does not expose `usage`
      in the public type; the cookbook reads it via an unsafe cast. Skipped
      to honor our "no `as any` / `@ts-ignore`" rule.
- [x] Public `AgentEvent` discriminated union + `toAgentEvents(SDKMessage)`
      mapper. One message can yield multiple events (assistant text +
      tool_use blocks).

### 2.2 `lib/workspace.mts` — Workspace Resolution

Slim, single-purpose module. Mirrors codex-plugin-cc's `workspace.mjs`.

- [x] `resolveWorkspaceRoot(cwd)` — `git rev-parse --show-toplevel` with fallback to `cwd` when cwd is not inside a git repo (so the plugin still works in non-git scratch dirs).
- ~~Generate stable workspace ID (SHA-256 of absolute git root path)~~ → moved to **2.3 `state.mts`**: hashing is a state-dir concern, not a workspace concern. State derives `${slug}-${sha256(canonicalRoot)[:16]}` itself from the resolved root.
- ~~Provide workspace metadata (branch, remote URL, dirty status)~~ → moved to **2.5 `git.mts`**: branch/remote/dirty are git queries used for prompt context, not workspace identity.

### 2.3 `lib/state.mts` — Persistent State

Job and session state persisted to disk.

- [x] State directory: `~/.claude/cursor-plugin/<slug>-<workspace-hash>/` where the hash is `sha256(canonicalWorkspaceRoot).slice(0, 16)` and the slug is the sanitized basename (matches codex plugin layout). `CURSOR_PLUGIN_STATE_ROOT` overrides the root for tests/dev.
- [x] `state.json` — index of all jobs (last 50 retained)
- [x] `<jobId>.json` — per-job result payload
- [x] `<jobId>.log` — per-job streaming log (append-only)
- [x] `session.json` — current session metadata (session ID, agent IDs, start time)
- [x] Atomic writes (write to tmp, rename) to prevent corruption (`writeJsonAtomic`)
- [x] Auto-prune: delete oldest jobs when exceeding 50 (`pruneJobIndex`, ordered by `createdAt`; also removes the per-job json/log files)

### 2.4 `lib/job-control.mts` — Job CRUD

- [x] `createJob(input)` → JobRecord (returns full record, not just id)
- [x] State transitions: `markRunning` / `markFinished` / `markFailed` /
      `markCancelled`. `markFinished` maps CursorAgentStatus → JobStatus
      (`finished`→`completed`, `error`→`failed`, `expired`→`cancelled`+meta).
- [x] `getJob(jobId)` → full job state
- [x] `listJobs(filter?)` with type/status/limit filters
- [x] `cancelJob(jobId)` — capability-checked via `cancelRun` from §2.1
      (returns `{ cancelled, reason?, job? }` so callers can render a clean
      diagnostic). Marks pending+no-active-run as cancelled with
      reason="run-not-active".
- [x] Background job tracking: in-process `activeRuns` map keyed by jobId
      (`registerActiveRun` / `unregisterActiveRun` / `getActiveRun`).
- [x] Job types: `task`, `review`, `adversarial-review` (id prefix `adv-`).
- [x] `logJobLine` helper appends to per-job log file.

### 2.5 `lib/git.mts` — Git Helpers

- [x] `getDiff(options?)` — staged/unstaged diff for review
- [x] `getStatus()` — working tree status summary
- [x] `getRecentCommits(n)` — last N commit messages + hashes
- [x] `getBranch()` — current branch name
- [x] `getRemoteUrl()` — origin URL (for prompt context; absent when no remote)
- [x] `isDirty()` — boolean working-tree-dirty check (relocated from 2.2)
- [x] `getChangedFiles()` — list of modified/added/deleted files
- [x] `detectCloudRepository(cwd)` + `normalizeGitHubRemote(remote)` — port
      from cookbook `src/agent.ts` (SSH / `ssh://` / `https://` forms, strip
      `.git`). Used by §2.1 cloud-mode follow-on.

### 2.6 `lib/render.mts` — Terminal Output

- [x] `renderJobTable(jobs)` — aligned text table with derived ages
- [x] `renderStreamEvent(event)` — format a single `AgentEvent` (the flat
      shape from §2.1) for terminal display. Mirrors cookbook
      `renderPlainEvent`: assistant text → stdout; thinking/tool/status/task
      → annotated stderr lines. Returns `{stdout?, stderr?}` so the caller
      controls actual writes (testable).
- [x] `renderReviewResult(review)` — verdict, sorted findings, next steps
- [x] `renderError(error)` — consistent error formatting
- [x] `formatDuration(ms)` — lifted from cookbook
- [x] `summarizeToolArgs(toolName, args)` — keyed-lookup table for
      read/glob/grep/shell/edit, ported from cookbook `getToolSummaryKeys`.

**Exit criteria**: Unit tests for each module. `cursor-agent.mts` tested with mocked SDK (integration tests in Phase 5).

---

## Phase 3: CLI Entry Point & Commands

### 3.1 `cursor-companion.mts` — CLI Router

Single entry point, subcommand dispatch:

```bash
node cursor-companion.mjs <command> [args...] [flags]
```

| Subcommand | Description |
|------------|-------------|
| `task <prompt>` | Delegate implementation task to Cursor |
| `review` | Run code review on current diff |
| `adversarial-review` | Challenge design choices, not just defects |
| `status [job-id]` | Show job status table or single job detail |
| `result <job-id>` | Retrieve completed job output |
| `cancel <job-id>` | Cancel an active job |
| `setup` | Check dependencies, validate API key |

- [x] Argument parsing (`lib/args.mts` — minimal, no heavy deps)
- [x] Subcommand routing (handlers live in `commands/<name>.mts`)
- [x] Subcommand-local flags: `--model`, `--timeout`, `--json`, `--help`
- [x] Exit codes: 0 success, 1 error, 2 invalid args
- [x] CLI takes a `CommandIO` (stdout/stderr/cwd/env) so tests can inject
      sinks instead of writing to the real process streams.

### 3.2 `task` Subcommand

```bash
node cursor-companion.mjs task "Refactor the auth module" --write --model composer-2
```

- [x] Create job via job-control
- [x] Create Cursor agent via cursor-agent
- [x] Send prompt with workspace context (branch, recent commits, changed files)
- [x] Stream events to stdout in real-time (`renderStreamEvent` over the
      `AgentEvent` mapper from §2.1 — same shape as cookbook `runPlainPrompt`)
- [x] On completion: persist result, update job status
- [x] `--write` flag: allow file modifications (default: read-only analysis)
- [x] `--resume-last` flag: resume most recent agent session
- [x] `--background` flag: run in background, return job ID immediately
- [x] `--force` flag: pass `local.force` through (recover stuck local run)
- [x] `--cloud` flag: run on Cursor cloud against detected repo origin

### 3.3 `review` Subcommand

```bash
node cursor-companion.mjs review [--staged] [--adversarial]
```

- [x] Collect git diff (staged or all changes)
- [x] Build review prompt with diff, file list, and project context
- [x] Request structured output matching review schema
- [x] Parse and validate Cursor's response against schema (tolerant fence
      stripping; verdict/summary/findings/next_steps shape checks)
- [x] Output structured review (verdict, findings, next steps)
- [x] `adversarial-review` subcommand uses challenge-the-design instructions

Review output schema (matches codex plugin):
```typescript
interface ReviewOutput {
  verdict: "approve" | "needs-attention";
  summary: string;
  findings: Array<{
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    body: string;
    file: string;
    line_start: number;
    line_end: number;
    confidence: number;  // 0.0–1.0
    recommendation: string;
  }>;
  next_steps: string[];
}
```

### 3.4 `setup` Subcommand

```bash
node cursor-companion.mjs setup
```

- [x] Check Node.js version (>= 18)
- ~~Check `@cursor/sdk` installed~~ (implicit at import-time; if it's missing
      the CLI fails to load before this check runs)
- [x] Validate `CURSOR_API_KEY` — call `Cursor.me()` to verify auth
- [x] List available models via `Cursor.models.list()` — apply cookbook
      `modelToChoices`-style flattening so multi-variant models render as one
      row per concrete `ModelSelection`
- [x] Report readiness status (text + `--json` machine-readable)

### 3.5 `status`, `result`, `cancel` Subcommands

- [x] `status` — read job index, render table. Positional `<job-id>` shows
      detail. Filters: `--type`, `--status`, `--limit`, `--json`.
- [x] `result <job-id>` — read persisted result; `--log` reads streaming log;
      `--json` emits the full JobRecord
- [x] `cancel <job-id>` — capability-checked cancel via `cancelJob`
      (returns 1 + reason when not cancellable)

**Exit criteria**: Each subcommand works end-to-end from CLI. Manual test: `node cursor-companion.mjs setup` succeeds with valid API key.

---

## Phase 4: Plugin Integration (Commands, Agents, Hooks)

Wire the CLI into Claude Code's plugin system.

### 4.1 Slash Commands (Markdown)

Each file in `commands/` is a prompt document Claude reads when the user invokes the command.

| File | Command | Behavior |
|------|---------|----------|
| `setup.md` | `/cursor:setup` | Run `cursor-companion.mjs setup`, report results |
| `review.md` | `/cursor:review` | Run review on current diff, present findings |
| `adversarial-review.md` | `/cursor:adversarial-review` | Challenge design choices |
| `task.md` | `/cursor:task <prompt>` | Delegate task via rescue subagent |
| `status.md` | `/cursor:status [job-id]` | Show job table |
| `result.md` | `/cursor:result <job-id>` | Retrieve job output |
| `cancel.md` | `/cursor:cancel <job-id>` | Cancel active job |

For commands that just shell out: `disable-model-invocation: true` + `allowed-tools: Bash(node:*)`. ✅ All seven slash command markdown files implemented.

### 4.2 Subagent: `cursor-rescue`

`agents/cursor-rescue.md` — named subagent invoked via `Agent` tool with `subagent_type: "cursor:cursor-rescue"`.

Behavior:
- [x] Receives a prompt (the hard problem)
- [x] Builds one shell command: `node cursor-companion.mjs task "<prompt>" --write`
- [x] Executes via Bash, returns stdout unchanged
- [x] Never orchestrates, never inspects files itself
- [x] Supports `$ARGUMENTS` for user input

### 4.3 Hooks

`hooks/hooks.json`:

| Hook | Event | Script | Timeout |
|------|-------|--------|---------|
| Session start | `SessionStart` | `session-lifecycle-hook.mjs SessionStart` | 5s |
| Session end | `SessionEnd` | `session-lifecycle-hook.mjs SessionEnd` | 5s |

`session-lifecycle-hook.mts`:
- [x] **SessionStart**: read session id from stdin JSON, write session
      metadata into state dir
- [x] **SessionEnd**: clear the session marker. Agents are not disposed
      because background runs may still be using them — disposal is the
      caller's responsibility, and the SDK manages durable agent lifecycle.
      A future enhancement could iterate `agentIds` and dispose any that
      are still attached.

### 4.4 Skills

- [x] `cursor-rescue/SKILL.md` — when to delegate, what to include
- [x] `cursor-result-handling/SKILL.md` — output presentation rules
- [x] `cursor-prompting/SKILL.md` — task structure, `--write` policy,
      structured-output contracts

**Exit criteria**: Install plugin locally (`/plugin install /path/to/cursor-plugin-cc`), all slash commands appear, `/cursor:setup` works.

---

## Phase 5: Testing

### 5.1 Unit Tests (`tests/unit/`)

| Module | Test Coverage | Status |
|--------|---------------|--------|
| `lib/workspace.mts` | Git root resolution, workspace ID generation, edge cases (no git, nested repos) | ✅ |
| `lib/state.mts` | Read/write/prune jobs, atomic writes, corruption recovery | ✅ |
| `lib/job-control.mts` | Job lifecycle (create → running → completed/failed/cancelled), listing, filtering | ✅ |
| `lib/git.mts` | Diff parsing, status parsing, empty repo handling, GitHub remote normalization | ✅ |
| `lib/render.mts` | Table formatting, event rendering, review formatting, tool-arg summarizer | ✅ |
| `lib/args.mts` | Argument parsing, flag extraction, validation | ✅ |
| `lib/cursor-agent.mts` | Mocked SDK: createAgent / sendTask / oneShot / cancel / cloud-mode / force / AgentEvent mapper | ✅ |
| `commands/review.mts` | JSON extraction (fence-stripping), shape validation | ✅ |
| `cursor-companion.mts` | Router smoke (help, unknown, status empty, --help, missing-id, setup-no-key) | ✅ |
| `session-lifecycle-hook.mts` | SessionStart writes session.json, SessionEnd clears it | ✅ |

### 5.2 Integration Tests (`tests/integration/`)

| Scenario | What it validates | Status |
|----------|-------------------|--------|
| Agent create + send + stream | SDK integration works end-to-end (requires `CURSOR_API_KEY`) | ✅ `oneShot` smoke test in `sdk-live.test.mts` |
| `Cursor.me` / `Cursor.models.list` | Account + catalog endpoints work with the configured key | ✅ |
| ~~Agent resume~~ | ~~Durable session persists and resumes correctly~~ | Deferred — covered by unit-level mock; live test would race the SDK's session-cleanup window |
| ~~Review with structured output~~ | ~~Review schema parsing and validation~~ | Covered by `tests/cli/review.test.mts` (mocked SDK exercises the full parse path); a live variant would just re-test the model |
| ~~Task with `--write`~~ | ~~File modifications actually land~~ | Covered by `tests/cli/task.test.mts` (`--write` flag); deferred for live until we have a deterministic prompt |
| ~~Job background + cancel~~ | ~~Background job starts, cancel terminates it~~ | Covered by `tests/cli/cancel.test.mts` (in-process cancel path) |
| ~~Session lifecycle~~ | ~~Start/end hooks manage agent state correctly~~ | Covered by `tests/unit/lifecycle-hook.test.mts` |

Integration tests gated behind `CURSOR_API_KEY` env var — skip if not set (CI-friendly). The current scaffold (`tests/integration/sdk-live.test.mts`) auto-skips via `describe.skip` when the env var is empty so CI without the secret stays green.

### 5.3 CLI Tests (`tests/cli/`)

| Command | Test | Status |
|---------|------|--------|
| `setup` | Reports correct status with/without API key | ✅ covered in `tests/unit/cli/companion.test.mts` (no-key diagnostic) |
| `task` | Sends prompt, receives output, marks job completed; `--write` flips policy; `--background` returns job id; non-finished status → exit 1 | ✅ `tests/cli/task.test.mts` |
| `review` | Approve/needs-attention verdicts, fence-stripping, non-JSON failure path, empty-diff short-circuit, `adversarial-review` instruction switch | ✅ `tests/cli/review.test.mts` |
| `status` | Lists jobs correctly, filter validation | ✅ covered in `tests/unit/cli/companion.test.mts` |
| `result` | Retrieves persisted result | ✅ missing-id case in `tests/unit/cli/companion.test.mts` |
| `cancel` | Cancels active running job; refuses completed job; `--json` payload | ✅ `tests/cli/cancel.test.mts` |

### 5.4 Test Infrastructure

- [x] Vitest config with test path aliases (`@plugin/*`, `@test/*`) — wired in `vitest.config.mts` and `tsconfig.json`
- [x] Mock factory for `@cursor/sdk` Agent (`tests/helpers/sdk-mock.mts`: `makeRun`, `fakeAgent`, `assistantText`, `toolCallEvent`)
- [x] Test fixtures: `tests/fixtures/diffs.mts`, `tests/fixtures/reviews.mts`, `tests/fixtures/jobs.mts`
- [x] CI workflow (`.github/workflows/ci.yml`): PR/push runs `check → typecheck → build → test` on Node 22; `integration` job runs the live SDK suite on main when `CURSOR_API_KEY` secret is present

**Exit criteria**: >80% line coverage on `lib/`. All unit tests pass without API key. Integration tests pass with API key. ✅ (178 tests pass; 3 live-integration tests auto-skip without `CURSOR_API_KEY`).

---

## Phase 6: Review Gate Hook (v2)

After core delegation is solid, add the auto-review gate.

### 6.1 Stop Hook

`hooks/hooks.json` addition:

| Hook | Event | Script | Timeout |
|------|-------|--------|---------|
| Review gate | `Stop` | `stop-review-gate-hook.mjs` | 900s |

Behavior:
- [x] Fires when Claude Code is about to stop (always-installed hook;
      short-circuits to "allow" when the per-workspace gate config is off)
- [x] Collects working-tree diff of changes Claude made this turn
      (`getDiff(workspaceRoot)`)
- [x] Sends to Cursor agent for independent review using a strict
      structured-output contract (same schema as `/cursor:review`)
- [x] Outputs JSON `{ "decision": "block", "reason": "<formatted findings>" }`
      on `needs-attention`; emits nothing (allow) on `approve`
- [x] If blocked: Claude sees `formatBlockReason(review)` (verdict + sorted
      findings + next steps) and must address them before stopping
- [x] Honors `stop_hook_active: true` — never blocks on the second stop in
      the same turn (no infinite loops)
- [x] Fail-open on every infrastructure failure (SDK throw, non-finished
      run, unparseable JSON) — surfaces a `cursor-plugin-cc gate:` warning
      to stderr but always allows

### 6.2 Enable/Disable via Setup

- [x] `/cursor:setup` gains `--enable-gate` / `--disable-gate` flags that
      mutate `gate.json` in the workspace state dir. The Stop hook itself
      stays in `hooks/hooks.json` always — the per-workspace config is the
      kill switch, so we don't have to mutate the user's settings.json.
- [x] Setup report (text + `--json`) includes the current gate state +
      workspace root.
- [x] Gate is opt-in, not default — it adds latency to every stop. Default
      `gate.json` is `{ enabled: false }`.

### 6.3 Tests

- [x] `tests/unit/lib/gate.test.mts` — read/write/round-trip, malformed
      payload, negative timeout, non-boolean enabled coercion
- [x] `tests/cli/stop-review-gate.test.mts` — gate disabled allows; empty
      diff allows; `stop_hook_active=true` allows; approve allows;
      needs-attention emits structured `{ decision: "block", reason }`;
      SDK throw / non-finished run / non-JSON output all fail-open with
      stderr warning
- [x] `tests/cli/setup.test.mts` — gate state in default report;
      `--enable-gate` / `--disable-gate` persist `gate.json`; mutually
      exclusive flags rejected with exit 2; `--json` includes `gate`

**Exit criteria**: Claude Code is blocked from stopping when Cursor finds critical issues. Gate can be toggled on/off. ✅ (197 tests pass; 3 live-integration tests auto-skip without `CURSOR_API_KEY`).

---

## Phase 7: Polish & Publish

### 7.1 Documentation

- [x] `README.md` — what it does, installation, configuration, commands, examples
- [x] `CONTRIBUTING.md` — dev setup, testing, PR conventions, release process
- [x] Module-level JSDoc on public API surfaces — already in place across `lib/`
      (cursor-agent, render, state, job-control, git, gate, retry, redact);
      Phase 7 just added headers on the new modules.

### 7.2 CI/CD

- [x] GitHub Actions workflow:
  - [x] PR checks: lint → typecheck → build → unit tests (existing `check` job)
  - [x] Main branch: integration tests when `CURSOR_API_KEY` secret is set
  - ~~Release: npm publish on tag push~~ — N/A. The package is `private: true`
        and ships via `.claude-plugin/marketplace.json`, not npm. Release
        process documented in `CONTRIBUTING.md`.
- [x] Conventional-commit enforcement via husky `commit-msg` hook (inline regex,
      no commitlint dep — mirrors the project's lean toolchain choice)
- [x] Dependabot config (`.github/dependabot.yml`) — weekly npm + monthly
      github-actions, dev-deps grouped, `chore`/`ci` commit prefixes

### 7.3 Plugin Registry

- [x] Marketplace manifest (`.claude-plugin/marketplace.json`) ready for
      `/plugin marketplace add` + `/plugin install cursor@cursor-plugin-cc`
- [x] Install + first-run flow documented in `README.md` (export key →
      `/cursor:setup` → first task/review)
- [ ] Publish to a public Claude Code plugin registry — out of scope for an
      automated change; tag a release per `CONTRIBUTING.md` and the install
      command above resolves from the tagged ref.

### 7.4 Hardening

- [x] Graceful degradation when Cursor API is down or rate-limited — short
      account/catalog calls go through `withRetry` (3 attempts, exponential
      backoff, capped at 4s)
- [x] Retry logic with exponential backoff for transient failures — `lib/retry.mts`,
      keys off `error.isRetryable` (the SDK's transient marker)
- [x] Timeout enforcement on all SDK calls — `sendTask` / `oneShot` honor
      `timeoutMs`; `whoami` / `listModels` / `validateModel` are wrapped in
      retry (their own per-attempt deadline lives in the SDK)
- [x] Secure API key handling — `lib/redact.mts` scrubs `CURSOR_API_KEY` from
      `renderError` (stderr), `markFailed` (persisted job json), and
      `logJobLine` (per-job .log files). Never written to disk by design.
- [x] Memory leak prevention — every agent path disposes via `Symbol.asyncDispose`
      in a `finally` block (`task.runTask`, `task.detachBackgroundRun`,
      `oneShot`); streams are fully consumed before `run.wait()` resolves so
      no dangling iterators

**Exit criteria**: Plugin installable from marketplace, README covers all commands, CI green on main. ✅ (all Phase 7 implementation items complete; 217 tests pass + 3 live-integration tests auto-skip without `CURSOR_API_KEY`; final marketplace publish pending a release tag).

---

## Phase 8: `/cursor:resume` Command

Surface `Agent.resume()` as a first-class slash command. Until Phase 8, the
durable-agent capability was reachable only through `task --resume-last` —
which always picked the most recent agent and offered no discovery story.

### 8.1 Job-control discovery helper

- [x] `findRecentTaskAgents(stateDir, limit?, lookahead?)` in `lib/job-control.mts`
      returns `{ jobId, agentId, createdAt, summary? }[]` for the most-recent
      task jobs that have a stamped `agentId`. Reads at most `lookahead` job
      json files to find `limit` results.
- [x] `task --resume-last` rewired to use the new helper (drops its inline
      `findResumeAgentId`).

### 8.2 `resume` Subcommand

```bash
cursor-companion resume <agent-id> <prompt> [flags]
cursor-companion resume --last <prompt> [flags]
cursor-companion resume --list [--limit <n>] [--json]
```

- [x] `commands/resume.mts` handler with parser that accepts either a
      positional `<agent-id> <prompt>` pair, `--last <prompt>`, or
      `--list` (no prompt; returns and exits)
- [x] `--list` reads `findRecentTaskAgents(stateDir, limit)` and renders
      either a fixed-width table (`AGENT-ID / JOB-ID / CREATED / SUMMARY`)
      or a JSON array via `--json`
- [x] Run path mirrors `task` (write policy, `buildPrompt`, streaming via
      `toAgentEvents` + `renderStreamEvent`, job tracking via `markRunning`/
      `markFinished`/`markFailed`, agent dispose in `finally`)
- [x] Inherits `--write` / `--background` / `--force` / `--cloud` /
      `--model` / `--timeout` / `--json` from the task surface
- [x] Stamps `metadata: { resumed: true, resumedAgentId }` on the new job
      record so `/cursor:status <id>` shows the resume lineage
- [x] `Agent.resume` failures are recorded via `markFailed` before re-throw
      so the job record reflects the failed attempt

### 8.3 Plugin Wiring

- [x] `cursor-companion.mts` router routes `resume` → `runResume` and adds
      it to the help banner
- [x] `commands/resume.md` slash command markdown (`disable-model-invocation:
      true`, `allowed-tools: Bash(node:*)`) shells out and surfaces output
      verbatim — same pattern as `/cursor:status`, `/cursor:cancel`,
      `/cursor:result`
- [x] `--list` is the discovery surface; `/cursor:status` table left
      unchanged (no `agentId` column) to avoid a schema migration on
      `JobIndexEntry`

### 8.4 Tests

- [x] `tests/unit/lib/job-control.test.mts` — `findRecentTaskAgents`:
      empty / no agentId, ordering newest-first, `limit` cap, ignores
      non-task types
- [x] `tests/cli/resume.test.mts` — explicit agent-id, `--last`,
      `--last` with no agents, `--list` (text + json + empty), `--write`,
      `--background`, missing positional, missing prompt, conflicting
      `--list --last`, `--limit` without `--list`, non-finished exit code,
      `Agent.resume` rejection persisting a failed job
- [x] `tests/unit/cli/companion.test.mts` — router help/usage smoke tests
      for the new subcommand

### 8.5 Documentation

- [x] `README.md` commands table + a new `resume` flags table
- [x] `PLAN.md` — this section

**Exit criteria**: `/cursor:resume` discovers and reattaches to durable
agents from any prior session in the workspace; tests cover the full flag
surface and the failure paths.

---

## Implementation Order

```
Phase 1 (scaffolding)     ██░░░░░░░░  ~2 hours
Phase 2 (core SDK)        ████░░░░░░  ~4 hours
Phase 3 (CLI + commands)  ██████░░░░  ~4 hours
Phase 4 (plugin wiring)   ████████░░  ~3 hours
Phase 5 (testing)         ██████████  ~4 hours
Phase 6 (review gate)     ██████████  ~2 hours (v2)
Phase 7 (polish/publish)  ██████████  ~3 hours
Phase 8 (resume command)  ██████████  ~1 hour
```

Phases 1–4 are the critical path. Phase 5 runs alongside 3–4 (write tests as you build). Phase 6 is a clean follow-up. Phase 7 is final polish.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SDK vs CLI | `@cursor/sdk` | CLI has zero AI capabilities; SDK is the only programmatic agent interface |
| Build tool | `tsc` (plain) | No bundling needed for a CLI plugin; tsc is simplest |
| Job persistence | Filesystem JSON | Matches codex plugin pattern; no DB dependency; human-readable |
| Broker pattern | Skip for v1 | SDK handles concurrency internally; add if we hit issues |
| Review gate | v2 (opt-in) | Core delegation must work first; gate adds complexity |
| Model default | `composer-2` | Best available Cursor model; overridable per-command |
