---
description: Query or rebuild the Worklog (ticket history across git, docs and PRs)
argument-hint: "[KEY | sync | backfill --since YYYY-MM-DD | list | config]"
---

Run the Worklog CLI with the user's arguments.

Call `worklog $ARGUMENTS` using the Bash tool. If the `worklog` command is not
on PATH, fall back to `npx worklog-claude $ARGUMENTS`. Show the output verbatim.

Common usage:
- `/worklog ESIN-4349` — print the ticket summary
- `/worklog list` — list every ticket Worklog knows about
- `/worklog sync` — scan configured repos + docs folders for new activity
- `/worklog backfill --since 2026-01-01` — one-time full import
- `/worklog config` — show the current config path and contents

The plugin works with any ticket-key prefix matching `[A-Z][A-Z0-9]+-\d+`
(ESIN, OPP, PROJ, FOO, …). If the user has `keyPrefixes` configured in
`~/.worklog/config.json`, only those prefixes are captured; otherwise every
match is captured.
