---
description: Query the Worklog — captured sessions, daily notes, ticket history
argument-hint: "[today | item KEY | KEY | tick | status | doctor | list | sync]"
---

Run the Worklog CLI with the user's arguments.

Call `worklog $ARGUMENTS` using the Bash tool. If the `worklog` command is not
on PATH, fall back to `npx worklog-claude $ARGUMENTS`. Show the output verbatim.

Captured sessions:
- `/worklog today` — the daily note built from captured Claude Code sessions
- `/worklog item ESIN-4349` — the rolling note for one work item
- `/worklog tick` — summarise anything not yet processed, without waiting for the schedule
- `/worklog status` — is capture on, is the tick fresh, what has it spent
- `/worklog doctor` — health checks, each with the command that fixes it

Ticket history from git and docs:
- `/worklog ESIN-4349` — print the ticket summary
- `/worklog list` — list every ticket Worklog knows about
- `/worklog sync` — scan configured repos + docs folders for new activity
- `/worklog backfill --since 2026-01-01` — one-time full import
- `/worklog config` — show the current config path and contents

The plugin works with any ticket-key prefix matching `[A-Z][A-Z0-9]+-\d+`
(ESIN, OPP, PROJ, FOO, …). If the user has `keyPrefixes` configured in
`~/.worklog/config.json`, only those prefixes are captured; otherwise every
match is captured.
