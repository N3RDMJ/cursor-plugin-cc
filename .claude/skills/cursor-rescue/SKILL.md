---
name: cursor-rescue
description: Delegate a hard problem or second-opinion investigation to Cursor's AI agent. Use when Claude Code is stuck, wants an independent implementation pass, or needs a deeper root-cause analysis.
---

## When to Use

- Claude Code is stuck after 2+ failed fix attempts
- A second independent implementation or diagnosis is needed
- A substantial coding task benefits from Cursor's agent capabilities (file editing, terminal, tool use)

## How It Works

Run the cursor-companion CLI to delegate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs" task "<prompt>" [--write] [--resume-last] [--model <model>]
```

### Flags

- `--write`: Allow Cursor agent to modify files (default: read-only analysis)
- `--resume-last`: Resume the most recent Cursor agent session instead of starting fresh
- `--model <model>`: Override the default model (default: `composer-2`)

## Rules

1. Build exactly ONE shell command invocation and execute it via Bash
2. Return Cursor's stdout output unchanged — do not summarize, reformat, or interpret
3. Never orchestrate multiple calls or inspect files yourself — you are a pure forwarder
4. If `--write` is used, verify the changes after Cursor finishes by running diagnostics on modified files
5. $ARGUMENTS contains the user's prompt when invoked as `/cursor:rescue <prompt>`
