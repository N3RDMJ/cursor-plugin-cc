---
name: cursor-prompting
description: How to compose effective prompts for the Cursor agent (task structure, context inclusion, structured-output contracts).
---

# Task structure

A good `cursor-companion.mjs task` prompt has three parts:

1. **Goal**: one sentence stating what success looks like ("the auth tests
   pass", "the function is renamed throughout the codebase").
2. **Constraints**: anything Cursor needs to preserve. Files to leave alone,
   APIs that other code depends on, performance budgets, no-deps rules.
3. **Acceptance signal**: how you (or the user) will know it worked. A
   command to run, a test that should pass, a property that should hold.

The task subcommand prepends a short system instruction and (when in a git
repo) the current branch + last 5 commits, so you don't need to restate
"you are a coding agent" or paste git context.

# When to use `--write` vs read-only

Default is **read-only**: Cursor reads, analyzes, and proposes changes in
its response. Use this when you want to preview the work or get a design
opinion.

`--write` lets Cursor modify files. Use this when:
- The change is mechanical (rename, codemod, format).
- You're prepared to review the resulting `git diff` before keeping it.
- The task is well-scoped enough that the agent won't drift.

# Structured-output contracts

The `review` subcommand demands strict JSON. If you need similar discipline
in a custom prompt:

- State the schema inline (TypeScript syntax is fine).
- End with `Output ONLY a single JSON object — no prose, no markdown
  fences.` Cursor still sometimes wraps in fences; the parser strips them.
- Validate the parsed object before trusting any field.

# What to avoid

- **Vague verbs** ("improve", "clean up", "refactor as needed"). Replace
  with a concrete goal.
- **Pasting whole files**. Cursor has the workspace; reference paths
  instead.
- **Stacking unrelated tasks**. One prompt = one task. Use multiple jobs
  if you need to.
- **Telling Cursor what tools to use**. Let it choose its tools.
