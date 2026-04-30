---
description: Independent code review of the working-tree diff via Cursor.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:review

Run a Cursor-driven structured review of the current diff.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs review $ARGUMENTS
```

Useful flags:
- `--staged` — review staged changes only
- `--scope <auto|working-tree|branch>` — review scope. `auto` (default) picks
  working-tree when the tree is dirty, otherwise diffs against the detected
  default branch (`main`/`master`/`trunk`).
- `--base <ref>` — diff against a specific ref. Implies branch scope.
- `--json` — emit the structured ReviewOutput JSON unchanged

The CLI prints a verdict (`approve` / `needs-attention`), a summary, and
per-finding entries with severity, file:line, and a recommendation. Exit code
is 0 on `approve`, 1 on `needs-attention` or any failure.

Pass the output through to the user. Do not summarize away severity or file
locations — they are the high-signal bits.
