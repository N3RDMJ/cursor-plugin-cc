# Prompt Blocks

Reusable XML blocks for Cursor (composer-2) prompts. Wrap each block in
the tag shown in its heading. Compose only the blocks the task needs —
extra blocks are noise.

## Core wrapper

### `task`

Use in every prompt. Keep to 1–3 sentences.

```xml
<task>
State the concrete job, the relevant file or failure context, and the end
state that counts as done.
</task>
```

## Output and format

### `structured_output_contract`

Use when the response shape matters (review, JSON, structured report).

```xml
<structured_output_contract>
Return exactly the requested shape and nothing else.
Highest-value findings first; no preamble.
</structured_output_contract>
```

### `compact_output_contract`

Use when you want concise prose, not a schema.

```xml
<compact_output_contract>
Keep the answer compact and structured.
No long scene-setting, no recap of the prompt.
</compact_output_contract>
```

## Follow-through

### `default_follow_through_policy`

Use when Cursor should keep going on its own judgement instead of pausing
to ask routine questions.

```xml
<default_follow_through_policy>
Default to the most reasonable low-risk interpretation and keep going.
Stop to ask only when a missing detail changes correctness, safety, or
an irreversible action.
</default_follow_through_policy>
```

### `completeness_contract`

Use for multi-step implementation or fix work that should not stop early.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check for follow-on fixes, edge cases, and cleanup that the change implies.
</completeness_contract>
```

### `verification_loop`

Use whenever correctness matters.

```xml
<verification_loop>
Before finalizing, verify the result against the task and the changed
files or tool outputs. If a check fails, revise instead of reporting the
first draft.
</verification_loop>
```

## Grounding

### `missing_context_gating`

Use when Cursor might otherwise guess.

```xml
<missing_context_gating>
Do not guess missing repository facts.
If required context is absent, retrieve it with tools or state exactly
what remains unknown.
</missing_context_gating>
```

### `grounding_rules`

Use for review, root-cause analysis, or any task where unsupported claims
would hurt quality.

```xml
<grounding_rules>
Ground every claim in the provided context or your tool outputs.
Do not present inferences as facts. Label hypotheses as hypotheses.
</grounding_rules>
```

## Safety and scope

### `action_safety`

Use for write-capable or potentially broad tasks.

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
No unrelated refactors, renames, or cleanup unless required for correctness.
Call out any risky or irreversible action before taking it.
</action_safety>
```

### `tool_persistence_rules`

Use for long-running tool-heavy work where Cursor might bail too early.

```xml
<tool_persistence_rules>
Keep using tools until you have enough evidence to finish confidently.
Don't abandon the workflow after a partial read when another targeted
check would change the answer.
</tool_persistence_rules>
```

## Task-specific

### `dig_deeper_nudge`

Use for review and adversarial inspection.

```xml
<dig_deeper_nudge>
After the first plausible issue, check for second-order failures,
empty-state behavior, retries, stale state, and rollback paths before
finalizing.
</dig_deeper_nudge>
```

### `research_mode`

Use for exploration, comparisons, or recommendations.

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Breadth first; go deeper only where the evidence changes the recommendation.
</research_mode>
```

### `progress_updates`

Use for long runs where silence reads as stuck.

```xml
<progress_updates>
Keep progress updates brief and outcome-based.
Mention only major phase changes or blockers.
</progress_updates>
```
