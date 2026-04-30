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
