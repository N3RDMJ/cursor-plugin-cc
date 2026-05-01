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
node ${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs adversarial-review $ARGUMENTS
```

Same output shape and flags as `/cursor:review`, plus free-form positional
**focus text** that becomes the priority axis for the reviewer (e.g.
`/cursor:adversarial-review concurrency and atomicity` or
`--scope branch -- security`).

If the change is genuinely simple and correct, the review will say so —
adversarial framing is not "always find fault." Surface the output verbatim
to the user.
