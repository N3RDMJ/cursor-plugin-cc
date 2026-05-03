---
description: Print a completed job's result text. Defaults to the most recent terminal job in the current workspace.
argument-hint: '[<job-id>] [--raw] [--log] [--json]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:result

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs result $ARGUMENTS
```

Without an argument, prints the most recent terminal (`completed` / `failed` /
`cancelled`) job for this workspace — the same shape codex-plugin-cc's
`/codex:result` uses. Pass a job id (from `/cursor:status`) to target a
specific job.

By default, task jobs render as a Markdown card with status, duration, agent
id, fenced output, and resume hints (so the output is self-describing).
Reviews keep their original structured formatting from the review command.

Flags:
- `--raw` — emit just the result text on stdout (no card / no header)
- `--log` — print the streaming event log captured while the run was alive
- `--json` — emit the full JobRecord

If the resolved job hasn't finished, exits 1. Return the command stdout
verbatim, exactly as-is. Do not paraphrase or rewrap.
