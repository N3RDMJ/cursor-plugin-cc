# Cursor Prompt Recipes

End-to-end templates for composer-2 task prompts. Copy the smallest
recipe that fits, then trim anything you do not need. In `cursor-rescue`,
prefer write-capable runs unless the user explicitly asked for read-only.

## Diagnosis (read-only)

```xml
<task>
Diagnose why the failing test or command is breaking in this repository.
Use the available repository context and tools to identify the most
likely root cause.
</task>

<compact_output_contract>
Return:
1. most likely root cause
2. evidence (file:line)
3. smallest safe next step
</compact_output_contract>

<default_follow_through_policy>
Keep going until you have enough evidence to identify the root cause
confidently. Stop to ask only when a missing detail changes correctness
materially.
</default_follow_through_policy>

<verification_loop>
Before finalizing, verify the proposed root cause matches the observed
evidence.
</verification_loop>

<missing_context_gating>
Do not guess missing repository facts. State exactly what remains unknown.
</missing_context_gating>
```

## Narrow fix (write)

```xml
<task>
Implement the smallest safe fix for the identified issue.
Preserve existing behavior outside the failing path.
</task>

<structured_output_contract>
Return:
1. summary of the fix
2. touched files
3. verification performed
4. residual risks or follow-ups
</structured_output_contract>

<default_follow_through_policy>
Default to the most reasonable low-risk interpretation and keep going.
</default_follow_through_policy>

<completeness_contract>
Resolve the task fully before stopping. Don't stop after identifying the
issue without applying the fix.
</completeness_contract>

<verification_loop>
Before finalizing, verify the fix matches the task and that the changed
code is coherent.
</verification_loop>

<action_safety>
Keep changes tightly scoped. Avoid unrelated refactors or cleanup.
</action_safety>
```

## Root-cause review (read-only)

```xml
<task>
Analyze this change for the most likely correctness or regression issues.
Focus on the provided repository context only.
</task>

<structured_output_contract>
Return:
1. findings ordered by severity
2. supporting evidence for each finding (file:line)
3. brief next steps
</structured_output_contract>

<grounding_rules>
Ground every claim in repository context or tool outputs.
If a point is an inference, label it.
</grounding_rules>

<dig_deeper_nudge>
Check for second-order failures, empty-state handling, retries, stale
state, and rollback paths before finalizing.
</dig_deeper_nudge>

<verification_loop>
Before finalizing, verify each finding is material and actionable.
</verification_loop>
```

## Research or recommendation

```xml
<task>
Research the available options and recommend the best path for this task.
</task>

<structured_output_contract>
Return:
1. observed facts
2. reasoned recommendation
3. tradeoffs
4. open questions
</structured_output_contract>

<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Breadth first; go deeper only where the evidence changes the recommendation.
</research_mode>

<grounding_rules>
Ground every claim in the source you inspected. Prefer primary sources.
</grounding_rules>
```

## Codemod / mechanical refactor (write)

```xml
<task>
Apply this mechanical change across the repository: <describe transform>.
Preserve all behavior outside the transformed code paths.
</task>

<structured_output_contract>
Return:
1. summary of the transform
2. touched files (count + list)
3. any sites the transform skipped, with reason
</structured_output_contract>

<completeness_contract>
Apply the transform everywhere it should apply, not just the obvious sites.
Search for less-obvious occurrences (string templates, dynamic imports,
test fixtures) before stopping.
</completeness_contract>

<action_safety>
Do not change behavior outside the transform.
No formatting churn, no incidental refactors.
</action_safety>

<verification_loop>
Before finalizing, scan for missed sites and verify nothing else changed.
</verification_loop>
```

## Prompt patching

```xml
<task>
Diagnose why this existing prompt is underperforming and propose the
smallest high-leverage changes to improve it for Cursor / composer-2.
</task>

<structured_output_contract>
Return:
1. failure modes
2. root causes in the current prompt
3. a revised prompt
4. why the revision should work better
</structured_output_contract>

<grounding_rules>
Base your diagnosis on the prompt text and the failure examples provided.
Do not invent failure modes the examples don't support.
</grounding_rules>

<verification_loop>
Before finalizing, confirm the revised prompt resolves the cited failure
modes without introducing contradictions.
</verification_loop>
```
