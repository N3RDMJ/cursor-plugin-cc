---
name: cursor-prompting
description: How to compose effective prompts for Cursor (composer-2). Block-based recipes for tasks, reviews, diagnosis, and research, plus anti-patterns to avoid.
---

# Cursor Prompting

Use this skill when `cursor-rescue` (or any custom call to
`cursor-companion task`) needs to ask Cursor for help.

Prompt Cursor like an operator, not a collaborator. Keep prompts compact
and block-structured with XML tags. State the task, the output contract,
the follow-through default, and the small set of extra constraints that
matter for this run.

## Core rules

- One clear task per run. Split unrelated asks into separate runs.
- Tell Cursor what done looks like. Don't assume it will infer the end state.
- Add explicit grounding for any task where unsupported guesses would hurt.
- Prefer better prompt contracts over raising reasoning or pasting more text.
- Use stable XML tag names so the prompt has reliable internal structure.

## Default prompt recipe

- `<task>` — the concrete job and the relevant repository or failure context.
- `<structured_output_contract>` or `<compact_output_contract>` — exact
  shape, ordering, and brevity requirements.
- `<default_follow_through_policy>` — what Cursor should do by default
  instead of asking routine questions.
- `<verification_loop>` or `<completeness_contract>` — required for
  debugging, implementation, or risky fixes.
- `<grounding_rules>` or `<missing_context_gating>` — required for review,
  research, or anything that could drift into unsupported claims.

## When to add which blocks

- Coding or debugging: `completeness_contract`, `verification_loop`,
  `missing_context_gating`.
- Review or adversarial review: `grounding_rules`,
  `structured_output_contract`, `dig_deeper_nudge`.
- Research or recommendation: `research_mode`, `grounding_rules`.
- Write-capable tasks: `action_safety` so Cursor stays narrow and avoids
  unrelated refactors.

## How to choose prompt shape

- Use built-in `review` or `adversarial-review` commands when the job is
  reviewing local git changes — those prompts already carry the contract.
- Use `task` when the job is diagnosis, planning, research, or
  implementation and you need direct control of the prompt.
- Use `task --resume-last` for follow-up instructions on the same
  Cursor thread. Send only the delta instruction unless the direction
  has changed materially.

## Working rules

- Prefer explicit prompt contracts over vague nudges.
- Use the tag names from [references/prompt-blocks.md](references/prompt-blocks.md).
- Don't raise reasoning or complexity first. Tighten the prompt and
  verification rules before escalating.
- Keep claims anchored to observed evidence. If something is a hypothesis,
  say so.
- Don't paste whole files — Cursor has the workspace. Reference paths.
- Don't tell Cursor which tools to use. State the goal and let it choose.

## Prompt assembly checklist

1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Cursor should keep going by default or stop on missing
   high-risk details.
4. Add verification, grounding, and safety blocks only where the task needs them.
5. Remove redundant instructions before sending.

Reusable blocks: [references/prompt-blocks.md](references/prompt-blocks.md).
End-to-end templates: [references/cursor-prompt-recipes.md](references/cursor-prompt-recipes.md).
Common failure modes: [references/cursor-prompt-antipatterns.md](references/cursor-prompt-antipatterns.md).
