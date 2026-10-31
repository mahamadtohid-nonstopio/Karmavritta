---
name: setup
description: Set up or repair Worklog - create the data home, schedule the background tick, point it at repos and docs folders, choose redaction and model budget, then run doctor.
disable-model-invocation: true
argument-hint: "[--interval N]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" setup*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor*)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" setup*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config*)
---

# /worklog:setup

Setup is idempotent: re-running it repairs the schedule and never changes recorded data. Keep it to a few short exchanges.

Launcher: `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs"`. Node 18 or newer is required. If `node --version` prints an older version, say so first and stop.

## 1. What is already known

!`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config`

Summarise in a short list: the data home, whether `repos` / `docsFolders` are set, `keyPrefixes` (empty means any `PROJ-123` key), the redaction mode and the model budget.

## 2. Ask one question, default the rest

Ask, in ONE message, only what can't be detected:
- **Repos and docs folders** to scan (absolute paths). Offer the current working directory if it is a git repo.

Use these defaults without asking, and list them so the user can override:
- tick every 5 minutes (`$ARGUMENTS` may carry `--interval N`)
- `redaction.mode` = `secrets`
- `model.dailyBudgetUsd` = current value
- `keyPrefixes` = `[]` (accept any prefix)

## 3. Apply

1. `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" setup` (add `--interval N` if given). It creates the data home and registers the tick with the OS scheduler.
2. For each setting the user gave, run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" config set <dotted.key> <value>`. For lists, pass JSON, for example `config set repos ["C:\\code\\api","C:\\code\\web"]`. Every change is backed up, and `/worklog:config undo` reverts it.

Report what each command printed. If one fails, show the error and stop.

## 4. Check

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" doctor`. It exits 1 when a check fails; that is expected, so read its output. Show the failing rows with their fix, or "all checks passed". Finish with: restart Claude Code so the hooks load, then try `/worklog:today`. Optionally run `/worklog:sync` once to import git history.

## Safety

Worklog only reads your work. These commands write only to Worklog's own data home and the OS scheduler entry. Never edit files under the data home by hand, and never run git write commands. If a step needs either, tell the user instead.
