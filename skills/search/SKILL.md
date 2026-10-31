---
name: search
description: Search everything Worklog recorded - ticket titles, commit messages, linked docs and findings - and show the matches grouped by ticket.
disable-model-invocation: true
argument-hint: "<words>"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" search *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" search *)
  - Read
---

# /worklog:search <words>

Request: `$ARGUMENTS`

If nothing was asked, ask what to search for and stop. Otherwise run exactly one command, with the words quoted as one argument:

`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" search '<words>' --json`

The match is a case-insensitive substring over titles, commit messages, doc paths and titles, and finding text. Present the results briefly: the ticket key and title, then up to three matches each, each saying what kind it is (title, commit, doc, finding) and its date. Offer `/worklog:item <KEY>` for the full record.

If nothing matched, say so and suggest one shorter word, a ticket key, or `/worklog:sync` if the git history may not be imported yet.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
