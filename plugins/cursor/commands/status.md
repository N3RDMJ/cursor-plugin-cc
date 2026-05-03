---
description: Show active and recent Cursor jobs for this workspace, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--json]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" status $ARGUMENTS
```

The script renders Markdown server-side (a job table without a job id, a
detail view with one). Surface the output verbatim — do not paraphrase,
re-table, summarize, or condense it.

Filters available: `--type <task|review|adversarial-review>`,
`--status <pending|running|completed|failed|cancelled>`, `--limit <n>`.
`--json` emits machine-readable output.

When passing a `<job-id>`, `--wait` blocks until the job reaches a terminal
state (`completed`/`failed`/`cancelled`). Tune with `--timeout-ms <ms>`
(default 240000) and `--poll-ms <ms>` (default 1000). On timeout, exit code
is 1 and the last-known job state is still printed.
