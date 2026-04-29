---
name: cursor-rescue
description: Delegate a hard problem or second-opinion investigation to a Cursor agent. Use when Claude Code is stuck, wants an independent implementation pass, or needs a deeper root-cause analysis.
---

# When to use

- Claude Code has tried two or more reasonable approaches to a bug and is
  guessing.
- The user explicitly wants a second pair of hands or a different agent's
  take ("get a second opinion", "have Cursor try this").
- The work is well-scoped (one feature, one bug, one refactor target). For
  unscoped exploration, drive the work yourself.

# How to use

Invoke the `cursor-rescue` subagent (`subagent_type: "cursor:cursor-rescue"`)
with a single prompt. The subagent runs `cursor-companion.mjs task` and
returns Cursor's stdout unchanged.

# What to include in the prompt

- The concrete deliverable ("make the integration test pass", "rename
  `getCwd` to `getCurrentWorkingDirectory` everywhere")
- Any constraints or files to focus on
- Whether file modifications are wanted (`--write` is on by default in the
  subagent's invocation)

# What to avoid

- Don't paste the entire codebase — Cursor has its own workspace context.
- Don't ask for vague "improvements" — give Cursor a concrete success
  criterion.
- Don't stack tasks. One task per invocation.
