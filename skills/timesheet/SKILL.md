---
name: timesheet
description: Activity per work item per day for this week (or a month) - recorded events, sessions and commits - optionally as CSV. Shows activity, not hours.
disable-model-invocation: true
argument-hint: "[week|month] [YYYY-MM-DD] [csv]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" week*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" timesheet*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" week*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" timesheet*)
---

# /worklog:timesheet [week|month] [date] [csv]

This week so far:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" week`

Arguments: `$ARGUMENTS`

- No arguments: show the table above.
- Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" timesheet` with these flags:
  - `--month` for a calendar month (otherwise it shows the ISO week, Monday to Sunday)
  - `--date YYYY-MM-DD` for the week or month containing that day. Resolve "last week" or "September" to a date yourself.
  - `--csv` for CSV

  Show that output instead. CSV goes in a fenced block, unchanged.

Always say plainly that the numbers are **recorded activity, not hours**. Worklog's capture log stores events, not durations. Each cell is the number of Claude Code events recorded for that item that day, and the commits column counts commits dated in the period. If they need hours for a timesheet system, the most active items and days are a starting point to estimate from. Never present the numbers as time.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
