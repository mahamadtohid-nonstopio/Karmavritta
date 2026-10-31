---
name: item
description: Everything Worklog has recorded for one work item (ticket) - summary, findings, root cause, decisions, commits, PRs, docs, files touched, commands run and timeline, with the file paths to open.
disable-model-invocation: true
argument-hint: "<TICKET-KEY>"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config)
  - Read
  - Grep
  - Glob
---

# /worklog:item <KEY>

Key: `$0`

If no key was given, ask for one and stop. A key looks like `ABC-1234`.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" item '$0'`

If the rolling note above says there is no note yet, run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" ticket <KEY>` instead. That record comes from git and docs and exists even before a session was captured.

Then:

1. Give a few lines: title, status, active range, and what is recorded (counts of findings, commits, docs).
2. What matters for picking the work back up: the problem, root cause and findings, the fix, decisions and anything ruled out. Keep the event-id citations. Never claim more than the note says. If something isn't recorded, say "not recorded".
3. The useful paths, under the data home printed by `config`: `items/<KEY>/README.md` (rolling note), `tickets/<KEY>.json` (canonical data), and the newest linked doc.
4. Offer next steps: `/worklog:handover <KEY>` for a handover note, `/worklog:export <KEY>` for a shareable redacted copy, and `/worklog:note` to record a finding.

Read-only: don't edit anything in the data home.

## Safety

Worklog only reads your work. Never edit files under the data home by hand, and never run git write commands. If a step needs either, tell the user instead.
