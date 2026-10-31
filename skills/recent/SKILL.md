---
name: recent
description: Overview of work items - tickets touched in the last N days, in a given month, or all of them - plus overall stats.
disable-model-invocation: true
argument-hint: "[N days | YYYY-MM | all | stats]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" month *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" list*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" stats*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" month *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" list*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" stats*)
---

# /worklog:recent [range]

Argument: `$ARGUMENTS`

Run exactly one command:

| They want | Command |
|---|---|
| nothing given, or "this week" | `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent --days 7` |
| last N days / "last two weeks" | `… recent --days <N>` |
| a month ("September", `2026-09`) | `… month <YYYY-MM>` |
| everything | `… list` |
| totals | `… stats` |

Show the table as printed (C = commits, D = docs), newest activity first. Then add one line naming the two or three most active items. Offer `/worklog:item <KEY>` for any of them, and `/worklog:timesheet` for activity per day.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
