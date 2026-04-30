---
description: Validate the cursor-plugin-cc runtime — Node, API key, account, models.
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
