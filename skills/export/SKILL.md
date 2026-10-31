---
name: export
description: Export one work item's note as a single Markdown or HTML file, always with public-level redaction (secrets, emails, names, absolute paths, hosts and IPs masked), ready to share.
disable-model-invocation: true
argument-hint: "<TICKET-KEY> [md|html]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" export *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" export *)
  - Read
---

# /worklog:export <KEY> [md|html]

Arguments: `$ARGUMENTS`

If no key was given, ask for one and stop. The format is `md` unless they said html, page or browser.

Run exactly one command:

`node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" export <KEY> --format <md|html>`

It writes `exports/<KEY>-<date>.<ext>` under the data home. Only pass `--out <file>` when they named a destination. Worklog refuses any path outside its own data home, plugin folder and temp folder, and prints "Not written". In that case say so and keep the default location. Don't try to work around it.

Report:
1. The file path it printed, on its own line.
2. What was masked. The export always uses `public` redaction, whatever the configured mode, because the file is meant to leave the machine.
3. Offer to read the file back so they can check it before sharing. Redaction is pattern-based, so a human review is still worth doing.

## Safety

Worklog only reads your work. The only write here is the export file, inside Worklog's own data home. Never edit other files there by hand. If a step needs that, tell the user instead.
