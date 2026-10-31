---
name: doctor
description: Check that Worklog is healthy - hooks firing, capture, background tick and scheduler, runtime copy, model budget and recent errors. Diagnoses only; changes nothing.
disable-model-invocation: true
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status*)
---

# /worklog:doctor

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status`

Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor`. It exits 1 when a check fails; that is expected, so read its output. Report briefly, in this order:

1. Overall: "all checks passed", or how many checks warn or fail.
2. Each failing or warning row: what it means and the fix command the row prints. The usual fixes are `/worklog:setup` (re-scheduling the tick and repairing the runtime never touches data) and restarting Claude Code (hooks load at session start).
3. Model spend today against the budget, from the status block. Model calls being disabled is a choice, not a failure: notes still render on the deterministic path.

Don't run any repair yourself, and don't edit files.

## Safety

Worklog only reads your work. Never edit files under the data home by hand, and never run git write commands. If a step needs either, tell the user instead.
