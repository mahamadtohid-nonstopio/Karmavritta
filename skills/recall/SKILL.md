---
name: recall
description: Answer questions from the user's automatic worklog (Worklog) - what they did on a day or week, everything known about a ticket (findings, root cause, decisions, commits, PRs, docs, files, commands), standups, activity sheets and handovers. Use whenever they mention a ticket key like ABC-1234, ask what they did or found, what we know about something, when they last touched something, or want a standup, weekly summary or handover - even if they don't say "worklog".
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" *)
  - Read
  - Grep
  - Glob
---

# Worklog recall

Worklog is written automatically. Hooks capture each Claude Code session as redacted events, and a background tick turns them into notes every 5 minutes. A git and docs scan attaches commits and documents by ticket key. Read the worklog; don't edit it.

Launcher: `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs"`. Run it with `config` to print the data home: `~/.worklog`, or `$WORKLOG_DIR` if that is set.

## Ask the CLI first (every read command takes `--json`)

| Question | Command |
|---|---|
| everything about ABC-1234 | `ticket ABC-1234 --json` (canonical) · `item ABC-1234` (rendered rolling note) |
| what did I do on a day | `today <YYYY-MM-DD>` |
| what did I touch this week / in September | `recent --days 7 --json` · `month 2026-09 --json` |
| where did X come up | `search '<words>' --json` |
| activity per item per day | `week --date <day> --json` · `timesheet --month --json` |
| is capture working | `status --json` |

Read files only for detail the CLI doesn't show:
- `items/<KEY>/README.md`: the rolling note (findings, decisions, RCA, commits, files, commands, timeline)
- `daily/<YYYY-MM-DD>.md`: one day across all items
- `tickets/<KEY>.json`: canonical data. `days[]` holds per-day summaries and stats; findings and decisions carry `evidence` event ids.
- `exports/`: redacted copies the user made

## How to answer

1. Use the order CLI → item note → daily notes → grep across the data home. Ticket keys match `[A-Z][A-Z0-9]+-\d+`.
2. Cite the source for every fact, for example "(items/ABC-1234/README.md, 2026-10-28)", keeping event ids where the note shows them.
3. Never claim more than the record says. If something isn't recorded, say "not recorded". Model-extracted claims without a recorded event were already dropped, so don't fill the gap yourself.
4. Activity numbers are events, not hours. Never present them as time spent.
5. For a standup, handover or shareable copy, point to `/worklog:standup`, `/worklog:handover <KEY>` or `/worklog:export <KEY>`, or follow the same rules inline.

## The only write allowed (only when the user explicitly asks to record something)

`note --ticket <KEY> --kind finding|hypothesis|ruled-out|decision|note "<text>"`. Don't write anything else in the data home, and never edit its files by hand.

## What Worklog will never do

As part of this skill, never: edit a codebase; run a git command that changes anything (commit, checkout, merge, push…); create, comment on or merge a PR; write to an issue tracker or database. If the user wants one of those, they do it themselves, outside this skill.
