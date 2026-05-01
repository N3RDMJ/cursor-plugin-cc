---
description: Validate the cursor-plugin-cc runtime — Node, API key, account, models. Toggle the Stop review gate.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:setup

Run the plugin's self-check.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs setup $ARGUMENTS
```

Pass `--json` for machine-readable output. If anything fails (API key missing,
network error, model catalog empty), the exit code is non-zero and the failure
rows print on stdout. No further action needed — surface the output verbatim
to the user.

## Stop review gate

The Stop review gate is opt-in per workspace. When enabled, every time
Claude Code is about to stop, a Cursor agent reviews the working-tree diff
and may block the stop with `needs-attention` findings. Toggle it via:

- `--enable-gate` — turn the gate on for the current workspace
- `--disable-gate` — turn the gate off

The setup output's "Stop gate" row reports the current state.

## Default model

When `/cursor:task`, `/cursor:resume`, or any other command runs without an
explicit `--model <id>`, the plugin resolves a default in this order:

1. `--model <id>` flag on the command (per-invocation override)
2. `CURSOR_MODEL` environment variable
3. The persisted user-wide default (set via `--set-model`)
4. Built-in fallback (`composer-2`)

Manage the persisted default via `/cursor:setup`:

- `--set-model <id>` — validate `<id>` against the live catalog and persist
  it as the default for every workspace. Subsequent runs use it unless
  overridden.
- `--clear-model` — remove the persisted default and revert to the built-in
  fallback.

The setup output's "Default" row shows the active model id and where it
came from (`from --model`, `from CURSOR_MODEL env`, `from persisted default`,
or `built-in fallback`).
