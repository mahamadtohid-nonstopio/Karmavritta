---
name: today
description: Show today's daily note (or any day's) - the work items touched, what was found and decided, and activity per item, built from captured Claude Code sessions.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD | yesterday | -N]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status*)
---

# /worklog:today [day]

Argument: `$ARGUMENTS`

With no argument, show today:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today`

If they passed a day, resolve it to `YYYY-MM-DD` yourself (`yesterday`, `-3` = three days back, "Monday" = the most recent Monday). Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today <YYYY-MM-DD>` and show that day instead. Only pass a `YYYY-MM-DD` value.

Present it briefly:

1. One line: how many work items, how many recorded events.
2. Per item: the summary, then findings and decisions, keeping the cited event ids as they are.
3. The "Unattributed" bucket, if there is one: work where no ticket key appeared. Suggest naming the key in a prompt or branch next time.

The note reflects the last background tick, which runs every 5 minutes. If it says there is no note yet, suggest `/worklog:tick` to summarise now. If the CLI says Worklog isn't set up, say so in one line and suggest `/worklog:setup`. Don't edit any file.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
