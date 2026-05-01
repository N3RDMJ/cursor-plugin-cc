<task>
Claude Code is about to stop and return control to the user.
Independently review the working-tree diff for issues that would be unsafe to merge as-is.
</task>

<review_method>
Be conservative: do NOT flag style nits, refactors, or speculative concerns.
Set verdict='needs-attention' ONLY when there is at least one finding with severity 'critical' or 'high'.
Otherwise set verdict='approve'.
Cite file:line for each finding so Claude can locate it.
</review_method>

<structured_output_contract>
Output ONLY a single JSON object matching the schema below — no prose, no markdown fences.

{{SCHEMA}}
</structured_output_contract>

<review_input>
Working-tree status:
{{STATUS}}

Diff to review:
{{DIFF}}
</review_input>
