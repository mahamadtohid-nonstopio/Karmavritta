---
name: tick
description: Summarise captured session events into daily and item notes now, instead of waiting for the 5-minute background tick; can redo one day from the raw log.
disable-model-invocation: true
argument-hint: "[--force] [YYYY-MM-DD]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" tick*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" tick*)
---

# /worklog:tick [--force] [day]

Argument: `$ARGUMENTS`

Run exactly one command. Use a 5-minute timeout, because it may make budget-capped model calls:

- no argument → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" tick`
- a day, or "redo yesterday" → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" tick --force <YYYY-MM-DD>`. Resolve relative days yourself.

Report what it printed in two or three lines: days processed, items summarised, model calls, and notes written. Then:

- `Skipped: …`: explain it plainly. Another tick holds the lock, or the tick is disabled; `worklog tick --force` still runs.
- `uncited claim(s) dropped`: the model said something it couldn't tie to a recorded event, so it was left out on purpose. That is the design working, not an error.
- `note:` lines: show them, for example "over budget, used the deterministic summary".

The tick is idempotent: running it twice over the same events adds nothing. Suggest `/worklog:today` to see the result.

## Safety

Worklog only reads your work. The tick writes only to Worklog's own data home. Never edit files there by hand. If a step needs that, tell the user instead.
