---
name: sync
description: Re-scan the configured git repos and docs folders for new commits and docs, attach them to tickets by key, and rebuild the index; --since for a one-time backfill.
disable-model-invocation: true
argument-hint: "[--since YYYY-MM-DD]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" sync*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" backfill*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" sync*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" backfill*)
---

# /worklog:sync [--since DATE]

Argument: `$ARGUMENTS`

Run exactly one command. Use a 10-minute timeout, because a first backfill over large repos can be slow:

- no argument → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" sync` (incremental, seconds)
- a start date ("since January", "--since 2026-01-01") → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" backfill --since <YYYY-MM-DD>`

Report: commits found, commits with no key (the `_unassigned` bucket), docs scanned, and tickets indexed. Show each `warn:` line, for example a repo path that doesn't exist. If it says no repos or docs folders are configured, point to `/worklog:setup`.

Git is only read (`git log`, `git rev-parse`); nothing in the repos changes. Never run git yourself for this.

## Safety

Worklog only reads your work. Never edit files under the data home by hand, and never run git write commands. If a step needs either, tell the user instead.
