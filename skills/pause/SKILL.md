---
name: pause
description: Pause or resume Worklog's session capture, or show whether it is paused.
disable-model-invocation: true
argument-hint: "[resume|status]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" pause)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" resume)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" pause)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" resume)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status)
---

# /worklog:pause [resume|status]

Argument: `$ARGUMENTS`

Run exactly one command and report its output in one or two lines:

- no argument, or `on` → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" pause`
- `resume`, `off` or `unpause` → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" resume`
- `status` → `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" status`

While paused, the hooks stay loaded but record nothing. Notes already written are untouched. The setting is a reversible config change (`/worklog:config undo`). After pausing, remind them to resume with `/worklog:pause resume`.

## Safety

Worklog only reads your work. Never edit files under the data home by hand. If a step needs that, tell the user instead.
