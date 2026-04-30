---
description: Adversarial review — challenge design choices in the current diff.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:adversarial-review

Run a deliberately challenging review. Where `/cursor:review` hunts for
defects, this prompt pushes back on premature abstractions, hidden coupling,
unnecessary state, and brittle assumptions.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs adversarial-review $ARGUMENTS
```

Same output shape as `/cursor:review`. If the change is genuinely simple and
correct, the review will say so — adversarial framing is not "always find
fault." Surface the output verbatim to the user.
