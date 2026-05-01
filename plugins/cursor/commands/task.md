---
description: Delegate a coding task to a Cursor agent.
argument-hint: <prompt>
---

# /cursor:task

Hand off a coding task to a Cursor agent. Use this when the work is
well-scoped and you want a second pair of hands rather than driving the
implementation yourself.

Invoke the `cursor-rescue` subagent with the task description. The subagent
forwards the prompt to `cursor-companion.mjs task` and returns whatever
Cursor produces, unchanged.

Default invocation:

> Use the cursor-rescue subagent with: `$ARGUMENTS`

If the user passed `--write`, `--cloud`, `--background`, `--force`,
`--model`, or `--prompt-file <path>`, include them verbatim in the prompt
to the subagent. `--prompt-file` is useful when the task description is
long enough to be cumbersome inline.

Model resolution: `--model` flag > `CURSOR_MODEL` env > persisted default
(set via `/cursor:setup --set-model <id>`) > built-in fallback.

When the result comes back, follow `cursor-result-handling/SKILL.md` —
present the deliverables and any caveats clearly, do not silently accept
the output.
