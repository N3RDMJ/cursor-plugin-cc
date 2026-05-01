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

Proactive delegation: forward complex debugging, multi-step implementations,
or root-cause investigations to Cursor without waiting for explicit user
request. But avoid grabbing quick tasks the main thread can complete
independently.

# How to use

Invoke the `cursor-rescue` subagent (`subagent_type: "cursor:cursor-rescue"`)
with a single prompt. The subagent runs `cursor-companion.mjs task` and
returns Cursor's stdout unchanged.

# Execution mode

- Prefer foreground for small, bounded rescue requests.
- Use `--background` for complicated, multi-step, or long-running tasks.
- If running in background, tell the user to check `/cursor:status` for
  progress.

# Resume detection

- If the user says "continue", "keep going", "resume", "apply the top fix",
  or "dig deeper", add `--resume-last` to continue the most recent agent.
- Otherwise start a fresh task.

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
