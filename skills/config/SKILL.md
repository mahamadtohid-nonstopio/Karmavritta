---
name: config
description: Show or change a Worklog setting (redaction mode, model budget, repos, capture retention, tick) - every change is backed up and can be undone; also shows the change history.
disable-model-invocation: true
argument-hint: "[get <key> | set <key> <value> | undo | history]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config*)
---

# /worklog:config [get|set|undo|history]

Request: `$ARGUMENTS`

Turn the request into exactly one command and run it:

| They want | Command |
|---|---|
| see everything | `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config` |
| one value | `… config get model.dailyBudgetUsd` |
| mask paths and hosts too | `… config set redaction.mode public` |
| no model calls at all | `… config set model.enabled false` |
| cap spend at 25 cents a day | `… config set model.dailyBudgetUsd 0.25` |
| keep raw events 7 days | `… config set capture.retainRawDays 7` |
| only these prefixes | `… config set keyPrefixes ["ABC","OPS"]` (`[]` = any prefix) |
| mask a colleague's name in free text | `… config set redaction.names ["First Last"]`. Pass the whole list, and `get` it first to keep the existing names. |
| take that back | `… config undo` |
| what changed | `… config history` |

Report what it printed in one line. For a `set`, mention that `/worklog:config undo` reverts it. If it rejects the value, show the message and fix the value from it, or ask. Ask instead of guessing when the key is unclear.

Never edit `config.json` by hand: the CLI locks it, validates the value, backs it up and records the change.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
