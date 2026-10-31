---
name: standup
description: Draft a standup (Yesterday / Today / Blockers) from the last working day's and today's daily notes, with ticket keys and nothing the notes don't say.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent*)
---

# /worklog:standup [day]

Argument: `$ARGUMENTS` (the standup day; default today)

Recent items:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" recent --days 5`

1. Work out the **previous working day** before the standup day. Skip Saturday and Sunday: Monday's previous day is Friday. Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today <that day>`. If that day has no note, step back one more working day, up to three times.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" today <standup day>` for anything already done today.
3. Write the standup. Each section has at most four bullets, one line each, starting with the ticket key:

   **Yesterday** — what moved, from the previous working day's summaries, findings and decisions.
   **Today** — items still in progress: open hypotheses, findings without a fix, plus anything already started today. Phrase it as intent ("continue …"), never as done.
   **Blockers** — only failures or open questions the notes actually record. Otherwise write "None recorded".

4. Under the draft, list the day files used. Don't carry over event ids or file paths, because a standup is read aloud.

Never invent work. If both days are empty, say so and suggest `/worklog:tick` in case notes are pending.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
