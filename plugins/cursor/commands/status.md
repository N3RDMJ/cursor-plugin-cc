---
description: Show cursor-plugin-cc job table for the current workspace.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:status

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs status $ARGUMENTS
```

With no arguments: prints a table of recent jobs (id, type, status, age,
summary). With a job id positional: prints the full job detail.

Filters available: `--type <task|review|adversarial-review>`,
`--status <pending|running|completed|failed|cancelled>`, `--limit <n>`.
`--json` emits machine-readable output.

When passing a `<job-id>`, `--wait` blocks until the job reaches a terminal
state (`completed`/`failed`/`cancelled`). Tune with `--timeout-ms <ms>`
(default 240000) and `--poll-ms <ms>` (default 1000). On timeout, exit code
is 1 and the last-known job state is still printed.

Surface the output verbatim.
