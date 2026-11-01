---
name: dashboard
description: Open Worklog's local dashboard in the browser (starting it if it isn't running) - Today, any day, tickets, a ticket's full record, root causes, search, activity and health, all clickable and searchable.
disable-model-invocation: true
argument-hint: "[today | day <YYYY-MM-DD|yesterday|-N> | ticket <KEY> | tickets | rcas [words] | search <words> | activity | month | health | status | stop]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" dashboard*)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" dashboard*)
---

# /worklog:dashboard [page]

Request: `$ARGUMENTS`

Run exactly one command, `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" dashboard <page>`, choosing the page from the request:

| They want | page argument |
|---|---|
| nothing given / today | *(none)* |
| a day: "yesterday", "3 days ago", "Monday", a date | `day yesterday`, `day -3`, `day <YYYY-MM-DD>` (resolve weekday names to a date yourself) |
| a ticket | `ticket ABC-123` |
| the ticket list | `tickets` |
| root causes / RCAs, optionally about something | `rcas` or `rcas <their words>` |
| search for something | `search <their words>` |
| this week's / this month's activity | `activity` / `month` |
| health, "is it working" | `health` |
| is it running? | `status` |
| stop it | `stop` |

Only use those shapes; never pass anything else. The command starts the server in the background if needed, replaces an older copy, opens the browser and prints the address. It then returns, so don't wait on it.

Report in one or two lines:
- the address it printed, on its own line (`http://127.0.0.1:<port>/…`, local only)
- "Port … is held by another program": suggest adding `--port 7342` (any free port)
- "Not a day" or "Unknown page": show that line as it is and the shapes above
- "could not open a browser": they can open the address themselves

Remind them, briefly, that everything on the dashboard is clickable (ticket keys, dates, search results) and that `/` jumps to the search box. Don't start anything else.

## Safety

The dashboard listens on 127.0.0.1 only and its pages only read. Its one action, Summarise now, runs the same tick as `worklog tick` and writes only to Worklog's own data home. It never changes your repos or trackers. Never edit files under the data home by hand.
