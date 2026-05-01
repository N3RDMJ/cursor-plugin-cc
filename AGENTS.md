# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Code plugin that delegates work to Cursor's AI agent via `@cursor/sdk`. Mirrors the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but targets Cursor instead of Codex.

Requires `CURSOR_API_KEY` environment variable (Cursor subscription).

## Tech Stack

- TypeScript + ESM (`.mts` source → `.mjs` output)
- `@cursor/sdk` for programmatic Cursor agent interaction
- Vitest for testing
- Biome for linting + formatting
- Husky for pre-commit checks (runs `biome check --staged`)
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## Build & Test Commands

```bash
npm run build          # tsc
npm run typecheck      # tsc --noEmit
npm run lint           # biome lint
npm run format         # biome format --write
npm run check          # biome check (lint + format, read-only)
npm run check:fix      # biome check --write (lint + format, autofix)
npm run test           # vitest run
npm run test:watch     # vitest watch
```

## Plugin Structure

```
plugins/cursor/
├── .claude-plugin/plugin.json     # plugin manifest
├── commands/                       # /cursor:* slash commands (markdown)
├── agents/                         # subagent definitions (markdown)
├── hooks/hooks.json                # lifecycle hooks
├── skills/                         # context docs for Claude
├── scripts/                        # Node.js runtime
│   ├── cursor-companion.mts        # CLI entry point
│   ├── session-lifecycle-hook.mts  # SessionStart/SessionEnd handler
│   └── lib/
│       ├── cursor-agent.mts        # wraps @cursor/sdk Agent
│       ├── job-control.mts         # job CRUD, status tracking
│       ├── state.mts               # JSON persistence
│       ├── workspace.mts           # git-root resolution
│       ├── render.mts              # terminal output formatting
│       └── git.mts                 # git diff/status helpers
└── package.json
```

## @cursor/sdk Key Patterns

Verified against `@cursor/sdk@1.0.9` (public beta).

```typescript
import { Agent, Cursor } from "@cursor/sdk";
import type { SDKMessage, ModelSelection } from "@cursor/sdk";

// Agent.create / Agent.resume / Agent.prompt are all async — must await.
const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: "composer-2" } satisfies ModelSelection,
  local: { cwd: "/path/to/repo" },
});

const run = await agent.send("task description");
for await (const event of run.stream()) {
  // event is SDKMessage — discriminated union of 8 variants:
  // "system" | "user" | "assistant" | "thinking" | "tool_call"
  //   | "status" | "task" | "request"
}

const result = await run.wait();   // RunResult: { status, result?, durationMs?, ... }
// status is lowercase: "finished" | "error" | "cancelled"

// Resume durable agent by ID (also async).
const resumed = await Agent.resume("agent-<uuid>", { local: { cwd } });

// One-shot helper: create + send + close, returns RunResult.
const oneShot = await Agent.prompt("ping", { apiKey, model, local: { cwd } });

// Account / catalog operations (used by /cursor:setup):
await Cursor.me();              // verifies CURSOR_API_KEY
await Cursor.models.list();     // discovers valid ModelSelection ids

// Cleanup: agents implement Symbol.asyncDispose.
await agent[Symbol.asyncDispose]();
```

Status messages from `run.stream()` use uppercase + an extra `EXPIRED` state:
`"CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED"`.
The wrapper in `lib/cursor-agent.mts` normalizes these.

## Conventions

- Plugin slash commands are markdown docs in `commands/` — they are prompt instructions, not executable code
- All executable logic lives in `scripts/` as TypeScript
- Subagent definitions in `agents/` are pure forwarders — they build and execute one shell command and return stdout unchanged
- Job state persisted to `~/.claude/cursor-plugin/state.json` with per-job `.json` and `.log` files
- Never suppress type errors (`as any`, `@ts-ignore`, `@ts-expect-error`)

