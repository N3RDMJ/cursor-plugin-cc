# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Claude Code plugin that delegates work to Cursor's AI agent via `@cursor/sdk`. Mirrors the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but targets Cursor instead of Codex.

Requires `CURSOR_API_KEY` environment variable (Cursor subscription).

## Tech Stack

- TypeScript + ESM (`.mts` source → `.mjs` output)
- `@cursor/sdk` for programmatic Cursor agent interaction
- Vitest for testing
- ESLint for linting
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## Build & Test Commands

```bash
npm run build          # tsc
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
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

```typescript
import { Agent } from "@cursor/sdk/agent";

// Create local agent scoped to working directory
const agent = Agent.create({
  apiKey: process.env.CURSOR_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: "/path/to/repo" },
});

// Send prompt and stream results
const run = await agent.send("task description");
for await (const event of run.stream()) {
  // event.type: "assistant" | "thinking" | "tool_call" | "status" | "task"
}

// Resume durable agent by ID
const resumed = Agent.resume("agent-<uuid>", { ...opts });
```

## Conventions

- Plugin slash commands are markdown docs in `commands/` — they are prompt instructions, not executable code
- All executable logic lives in `scripts/` as TypeScript
- Subagent definitions in `agents/` are pure forwarders — they build and execute one shell command and return stdout unchanged
- Job state persisted to `~/.claude/cursor-plugin/state.json` with per-job `.json` and `.log` files
- Never suppress type errors (`as any`, `@ts-ignore`, `@ts-expect-error`)
