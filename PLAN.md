# cursor-plugin-cc — Implementation Plan

Claude Code plugin that delegates work to Cursor's AI agent via `@cursor/sdk`.
Mirrors [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) architecture.

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

### 2.2 `lib/workspace.mts` — Workspace Resolution

- [ ] Find git root from cwd (`git rev-parse --show-toplevel`)
- [ ] Generate stable workspace ID (SHA-256 of absolute git root path)
- [ ] Provide workspace metadata (branch, remote URL, dirty status)

### 2.3 `lib/state.mts` — Persistent State

Job and session state persisted to disk.

- [ ] State directory: `~/.claude/cursor-plugin/<workspace-hash>/`
- [ ] `state.json` — index of all jobs (last 50 retained)
- [ ] `<jobId>.json` — per-job result payload
- [ ] `<jobId>.log` — per-job streaming log
- [ ] `session.json` — current session metadata (session ID, agent IDs, start time)
- [ ] Atomic writes (write to tmp, rename) to prevent corruption
- [ ] Auto-prune: delete oldest jobs when exceeding 50

### 2.4 `lib/job-control.mts` — Job CRUD

- [ ] `createJob(type, prompt)` → jobId
- [ ] `updateJobStatus(jobId, status, result?)` — pending → running → completed/failed/cancelled
- [ ] `getJob(jobId)` → full job state
- [ ] `listJobs(filter?)` → summary table
- [ ] `cancelJob(jobId)` — calls `run.cancel()` on the Cursor SDK
- [ ] Background job tracking: maintain in-memory map of active runs for cancellation
- [ ] Job types: `task`, `review`, `adversarial-review`

### 2.5 `lib/git.mts` — Git Helpers

- [ ] `getDiff(options?)` — staged/unstaged diff for review
- [ ] `getStatus()` — working tree status summary
- [ ] `getRecentCommits(n)` — last N commit messages + hashes
- [ ] `getBranch()` — current branch name
- [ ] `getChangedFiles()` — list of modified/added/deleted files

### 2.6 `lib/render.mts` — Terminal Output

- [ ] `renderJobTable(jobs)` — formatted table of jobs with status, type, elapsed time
- [ ] `renderStreamEvent(event)` — format a single stream event for terminal display
- [ ] `renderReviewResult(review)` — format structured review output with severity colors
- [ ] `renderError(error)` — consistent error formatting

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

- [ ] Argument parsing (`lib/args.mts` — minimal, no heavy deps)
- [ ] Subcommand routing
- [ ] Global flags: `--model`, `--timeout`, `--json` (machine-readable output)
- [ ] Exit codes: 0 success, 1 error, 2 invalid args

### 3.2 `task` Subcommand

```bash
node cursor-companion.mjs task "Refactor the auth module" --write --model composer-2
```

- [ ] Create job via job-control
- [ ] Create Cursor agent via cursor-agent
- [ ] Send prompt with workspace context (branch, recent commits, changed files)
- [ ] Stream events to stdout in real-time
- [ ] On completion: persist result, update job status
- [ ] `--write` flag: allow file modifications (default: read-only analysis)
- [ ] `--resume-last` flag: resume most recent agent session
- [ ] `--background` flag: run in background, return job ID immediately

### 3.3 `review` Subcommand

```bash
node cursor-companion.mjs review [--staged] [--adversarial]
```

- [ ] Collect git diff (staged or all changes)
- [ ] Build review prompt with diff, file list, and project context
- [ ] Request structured output matching review schema
- [ ] Parse and validate Cursor's response against schema
- [ ] Output structured review (verdict, findings, next steps)
- [ ] `--adversarial` flag: switches prompt to challenge design decisions

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

- [ ] Check Node.js version (>= 18)
- [ ] Check `@cursor/sdk` installed
- [ ] Validate `CURSOR_API_KEY` — call `Cursor.me()` to verify auth
- [ ] List available models via `Cursor.models.list()`
- [ ] Report readiness status

### 3.5 `status`, `result`, `cancel` Subcommands

- [ ] `status` — read job index, render table. With `--job-id`, show single job detail
- [ ] `result <job-id>` — read persisted result, output verbatim
- [ ] `cancel <job-id>` — find active run, call cancel, update job status

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

For commands that just shell out: `disable-model-invocation: true` + `allowed-tools: Bash(node:*)`.

### 4.2 Subagent: `cursor-rescue`

`agents/cursor-rescue.md` — named subagent invoked via `Agent` tool with `subagent_type: "cursor:cursor-rescue"`.

Behavior:
- Receives a prompt (the hard problem)
- Builds one shell command: `node cursor-companion.mjs task "<prompt>" --write`
- Executes via Bash, returns stdout unchanged
- Never orchestrates, never inspects files itself
- Supports `$ARGUMENTS` for user input

### 4.3 Hooks

`hooks/hooks.json`:

| Hook | Event | Script | Timeout |
|------|-------|--------|---------|
| Session start | `SessionStart` | `session-lifecycle-hook.mjs SessionStart` | 5s |
| Session end | `SessionEnd` | `session-lifecycle-hook.mjs SessionEnd` | 5s |

`session-lifecycle-hook.mts`:
- **SessionStart**: Read session ID from stdin JSON. Write session metadata to state dir. Export env vars (`CURSOR_SESSION_ID`, `CURSOR_PLUGIN_ROOT`).
- **SessionEnd**: Read active agent IDs from session state. Dispose each via `agent[Symbol.asyncDispose]()`. Clean up temp files. Update session state.

### 4.4 Skills (Already Created in /init)

- `cursor-rescue` — delegation instructions
- `cursor-result-handling` — output presentation rules

Additional skill to create:
- [ ] `cursor-prompting/SKILL.md` — how to compose effective prompts for Cursor agent (task structure, context inclusion, structured output contracts)

**Exit criteria**: Install plugin locally (`/plugin install /path/to/cursor-plugin-cc`), all slash commands appear, `/cursor:setup` works.

---

## Phase 5: Testing

### 5.1 Unit Tests (`tests/unit/`)

| Module | Test Coverage |
|--------|--------------|
| `lib/workspace.mts` | Git root resolution, workspace ID generation, edge cases (no git, nested repos) |
| `lib/state.mts` | Read/write/prune jobs, atomic writes, corruption recovery |
| `lib/job-control.mts` | Job lifecycle (create → running → completed/failed/cancelled), listing, filtering |
| `lib/git.mts` | Diff parsing, status parsing, empty repo handling |
| `lib/render.mts` | Table formatting, event rendering, review formatting |
| `lib/args.mts` | Argument parsing, flag extraction, validation |

### 5.2 Integration Tests (`tests/integration/`)

| Scenario | What it validates |
|----------|-------------------|
| Agent create + send + stream | SDK integration works end-to-end (requires `CURSOR_API_KEY`) |
| Agent resume | Durable session persists and resumes correctly |
| Review with structured output | Review schema parsing and validation |
| Task with `--write` | File modifications actually land |
| Job background + cancel | Background job starts, cancel terminates it |
| Session lifecycle | Start/end hooks manage agent state correctly |

Integration tests gated behind `CURSOR_API_KEY` env var — skip if not set (CI-friendly).

### 5.3 CLI Tests (`tests/cli/`)

| Command | Test |
|---------|------|
| `setup` | Reports correct status with/without API key |
| `task` | Sends prompt, receives output |
| `review` | Produces valid review schema from a test diff |
| `status` | Lists jobs correctly |
| `result` | Retrieves persisted result |
| `cancel` | Cancels active job |

### 5.4 Test Infrastructure

- [ ] Vitest config with test path aliases
- [ ] Mock factory for `@cursor/sdk` Agent (unit tests don't hit real API)
- [ ] Test fixtures: sample diffs, review outputs, job state files
- [ ] CI workflow (GitHub Actions): lint → typecheck → build → unit tests → integration tests (if API key in secrets)

**Exit criteria**: >80% line coverage on `lib/`. All unit tests pass without API key. Integration tests pass with API key.

---

## Phase 6: Review Gate Hook (v2)

After core delegation is solid, add the auto-review gate.

### 6.1 Stop Hook

`hooks/hooks.json` addition:

| Hook | Event | Script | Timeout |
|------|-------|--------|---------|
| Review gate | `Stop` | `stop-review-gate-hook.mjs` | 900s |

Behavior:
- Fires when Claude Code is about to stop
- Collects diff of changes Claude made this turn
- Sends to Cursor agent for independent review
- Returns JSON: `{ "decision": "block" | "allow", "reason": "..." }`
- If blocked: Claude sees the review findings and must address them before stopping

### 6.2 Enable/Disable via Setup

- [ ] `/cursor:setup` gains a toggle: "Enable review gate?" → writes/removes the Stop hook
- [ ] Gate is opt-in, not default — it adds latency to every stop

**Exit criteria**: Claude Code is blocked from stopping when Cursor finds critical issues. Gate can be toggled on/off.

---

## Phase 7: Polish & Publish

### 7.1 Documentation

- [ ] `README.md` — what it does, installation, configuration, commands, examples
- [ ] `CONTRIBUTING.md` — dev setup, testing, PR conventions
- [ ] Inline JSDoc on public API surfaces (module-level only, not every function)

### 7.2 CI/CD

- [ ] GitHub Actions workflow:
  - PR checks: lint → typecheck → build → unit tests
  - Main branch: + integration tests (with API key secret)
  - Release: npm publish on tag push
- [ ] Commitlint + husky for conventional commit enforcement
- [ ] Dependabot or Renovate for dependency updates

### 7.3 Plugin Registry

- [ ] Publish to Claude Code plugin marketplace
- [ ] Installation: `/plugin install cursor-plugin-cc`
- [ ] Verify clean install experience: setup wizard, API key prompt, first review

### 7.4 Hardening

- [ ] Graceful degradation when Cursor API is down or rate-limited
- [ ] Retry logic with exponential backoff for transient failures
- [ ] Timeout enforcement on all SDK calls
- [ ] Secure API key handling (never logged, never in job state files)
- [ ] Memory leak prevention: ensure all agents are disposed, streams are consumed

**Exit criteria**: Plugin installable from marketplace, README covers all commands, CI green on main.

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
