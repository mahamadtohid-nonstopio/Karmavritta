---
name: handover
description: Write a handover note for a work item so someone else (or future you) can pick it up - context, what was tried and ruled out, root cause, current state, next steps - citing the worklog for every fact.
disable-model-invocation: true
argument-hint: "<TICKET-KEY>"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket *)
  - Read
---

# /worklog:handover <KEY>

Key: `$0`

If no key was given, ask for one and stop.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item '$0'`

Also run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket <KEY> --json` for exact dates, commits, PRs and docs.

Write the handover in this shape, using only what the two outputs say:

```
## <KEY> — <title>
**State:** <status / last active date / open PRs>
**Context:** 2–3 sentences: what the problem is.
**Root cause:** <recorded RCA, or "not established">
**Tried and ruled out:** bullets from findings of kind ruled-out
**Open hypotheses:** bullets from kind hypothesis
**Decisions:** bullets
**Where the work is:** branches, newest commits (short sha + message), newest docs
**Next steps:** 2–4 bullets, each derived from an open hypothesis or a missing fix, labelled as a suggestion
```

Cite each fact with its date or event id, the way the note does. Anything not in the record is "not recorded", never guessed. Keep it under a screen.

The handover is shown in chat; nothing is written. If they want to share it outside the machine, suggest `/worklog:export <KEY>`, which applies public redaction.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
