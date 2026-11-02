# Worklog

**An automatic, private worklog for Claude Code: one record per ticket, written for you.**

Work done in Claude Code sessions is easy to lose. A week later nobody can say
what was found, what was tried, what was ruled out or why a decision was made.
Worklog keeps that memory for you. It records your sessions as you work,
groups everything by ticket key (`ABC-123`, `PROJ-45`, …) and writes a daily
note plus a running note per ticket. Afterwards you, or Claude, can ask
*"what do we know about ABC-123?"* and get an answer with sources.

- **Zero effort.** Nothing to remember during a session. Hooks record silently.
- **Private.** Everything stays on your disk. Secrets are masked before anything is saved.
- **Safe.** It never changes your repos, Git host, tracker or database. It only reads.
- **Cheap.** Model calls are optional and capped by a daily budget. Without them it still works.
- **No dependencies.** Pure Node.js 18+ on Windows, macOS and Linux.

---

## Contents

1. [What it does](#what-it-does)
2. [How it works](#how-it-works)
3. [Install](#install)
4. [Set it up](#set-it-up)
5. [Dashboard](#dashboard)
6. [Skills](#skills)
7. [Commands](#commands)
8. [Configuration](#configuration)
9. [Privacy and safety](#privacy-and-safety)
10. [Where your data lives](#where-your-data-lives)
11. [Troubleshooting](#troubleshooting)
12. [Uninstall](#uninstall)
13. [Development](#development)

---

## What it does

| | |
| --- | --- |
| **Captures sessions** | Every prompt and tool call in Claude Code is recorded to a local log, redacted at capture. |
| **Groups by ticket** | Any `[A-Z][A-Z0-9]+-\d+` key in a prompt, branch name, commit or file name ties the work to that ticket. Any prefix works out of the box. |
| **Writes notes** | Every 5 minutes a background job turns new events into a **daily note** and a rolling **per-ticket note** (summary, findings, decisions, root cause, files, commands, timeline). |
| **Imports git and docs** | Commits from your repos and Markdown docs from your folders are attached to the same tickets. |
| **Dashboard** | A local web page: today, any day, every ticket, search, activity and health. Everything is clickable and searchable, with a one-click Summarise now. |
| **Answers questions** | The `recall` skill lets Claude answer from your worklog and cite where each fact came from. |
| **Standups and handovers** | Drafts a Yesterday/Today/Blockers standup or a ticket handover from what was actually recorded. |
| **Activity sheet** | Activity per ticket per day for a week or month, as a table or CSV. |
| **Shareable export** | One-file Markdown or HTML copy of a ticket, with strict redaction for sharing. |
| **Health checks** | `doctor` checks hooks, the background job, the scheduler, the model budget and recent errors, and prints a fix for each problem. |
| **Undo for settings** | Every config change is backed up and can be reverted. |

---

## How it works

```
Claude Code session
      │  hooks: silent, fail-open, < 100 ms each
      ▼
~/.worklog/raw/<day>/<session>.jsonl        redacted event lines
      │  background tick, every 5 minutes
      ▼
  merge by stable id  ──►  ~/.worklog/tickets/<KEY>.json
      │  optional `claude -p` extraction, budget-capped, every claim cited
      ▼
~/.worklog/daily/<day>.md   +   ~/.worklog/items/<KEY>/README.md
```

- **The tick is the only writer of notes.** It holds a lock, and re-running it adds no duplicates.
- **Every model claim must cite a recorded event.** Claims without a citation are dropped, not kept in softened form.
- **The model is optional.** If `claude` is missing, disabled or over budget, Worklog writes a deterministic summary instead.

---

## Install

**Requirements:** [Node.js](https://nodejs.org) **18 or newer** and **git** on your PATH.
Check with `node --version`.

### Option A: Claude Code plugin marketplace (recommended)

Inside Claude Code:

```
/plugin marketplace add mahamadtohid-nonstopio/Karmavritta
/plugin install worklog@karmavritta
```

Restart Claude Code, then run `/worklog:setup`.

**Update later:** `/plugin marketplace update karmavritta`, then `/worklog:setup` again.

### Option B: npm (also gives you the `worklog` terminal command)

```bash
npm install -g worklog-claude
worklog install      # prepares the runtime and prints the two commands below
```

`worklog install` prints the exact commands for your machine. They add the
installed package to Claude Code as a local marketplace:

```bash
claude plugin marketplace add "<folder worklog install printed>"
claude plugin install worklog@karmavritta
```

Restart Claude Code, then run `/worklog:setup` (or `worklog setup`). Worklog
never changes Claude Code's settings itself; you run these two commands.
If you already added the GitHub marketplace (Option A), skip them: it's the
same plugin, and the `karmavritta` name can only be used once.

**Update later:**

```bash
npm update -g worklog-claude
claude plugin marketplace update karmavritta
claude plugin update worklog@karmavritta
worklog setup
```

### Option C: from source

```bash
git clone https://github.com/mahamadtohid-nonstopio/Karmavritta.git
cd Karmavritta
npm link             # puts `worklog` on your PATH
worklog install      # prints the commands that add this folder to Claude Code
```

To try a working copy without installing it at all, start Claude Code with
`claude --plugin-dir <path-to-the-clone>`. It loads only for that session.

---

## Set it up

Run `/worklog:setup` inside Claude Code, or `worklog setup` in a terminal. Setup:

1. creates the data folder `~/.worklog`
2. copies the runtime the background job uses into `~/.worklog/runtime/`
3. schedules the background job with your OS (Task Scheduler on Windows,
   launchd on macOS, cron on Linux), every 5 minutes by default (`--interval N`)
4. asks which **repos** and **docs folders** to import (optional)

Then check everything is green:

```
/worklog:doctor
```

Work as usual. A few minutes later, `/worklog:today` shows what you did.
To import past git history once:

```bash
worklog backfill --since 2026-01-01
```

> **Tip:** put the ticket key in your branch name (`ABC-123/fix-login`) or
> mention it in a prompt. That's how Worklog knows which ticket the work belongs to.

---

## Dashboard

A local web page for browsing everything Worklog has recorded.

```
/worklog:dashboard                 # inside Claude Code
worklog dashboard                  # or from a terminal
```

It starts a small server in the background (if one isn't already running),
opens your browser at `http://127.0.0.1:7341/` and returns. Open a specific
page directly:

```
worklog dashboard ticket ABC-123
worklog dashboard day yesterday        # or: day 2026-10-28, day -3
worklog dashboard search "retry queue"
worklog dashboard rcas                 # or: rcas missing index  (opens filtered)
worklog dashboard activity             # or: month, tickets, health
worklog dashboard status               # is it running?
worklog dashboard stop
```

| Page | What you see |
| --- | --- |
| **Today** | What you worked on today (or this week, with the Day/Week switch), tickets active this week, events waiting to be summarised and model spend. A banner walks you through any unfinished setup. **Summarise now** builds the notes on the spot. Refreshes every minute. |
| **Day** | Any day's work, with previous/next active day and a date picker. |
| **Tickets** | Every ticket, with All / Active this week / With findings tabs. Filter as you type, sort by any column, click a row to open it. With no tickets yet, it shows the two ways to get started. |
| **Ticket** | The full record: root cause, findings (by kind), decisions, a day-by-day timeline, commits, PRs, docs, files touched and commands run. Section shortcuts at the top, and a copyable export command. |
| **RCAs** | Every recorded root cause, newest first. Each card is headed `TICKET — title` and shows the Symptom, Cause and Fix. A search box filters as you type (every word must match, across key, title, symptom, cause and fix) and highlights the matches. |
| **Search** | Every word must match, across ticket titles, findings, decisions, root causes, day summaries, commits, docs, commands and file paths. Matches are highlighted and can be filtered by type. |
| **Activity** | A week or month heat map of events per ticket per day, with totals, active days and the busiest day. Click a cell to open that day. |
| **Health** | A setup score, then the failing checks grouped by the one command that fixes them (in order, with copy buttons), then everything that passes. **Re-run checks** refreshes it. |

**Everything is clickable.** Ticket keys anywhere in the text (even inside a
finding), dates, search results and table rows all link through. Press `/` to
jump to the search box.

**Local, and views are read-only.** The server listens on `127.0.0.1` only,
so nothing else on your network can reach it. Every page only reads. The one
action is **Summarise now**, which runs the same tick as `worklog tick` and
writes only to Worklog's own data folder. That request is accepted only from
the dashboard page itself: it must carry the page's own `Origin` and a custom
header, which other websites can't send. The server also rejects any request
whose `Host` header isn't its own, which blocks other web pages from reading it,
and it serves a strict Content Security Policy. Use `--port N` if 7341 is taken, and `--no-open` to skip opening the browser.

---

## Skills

Inside Claude Code, Worklog adds skills under the `/worklog:` prefix.

### Commands you type

| Skill | What it does | Example |
| --- | --- | --- |
| `/worklog:setup` | Set up or repair: data folder, background job, repos, then a health check | `/worklog:setup` |
| `/worklog:doctor` | Health checks with a fix for each problem, plus today's model spend. Changes nothing. | `/worklog:doctor` |
| `/worklog:dashboard` | Open the local dashboard (today, a day, a ticket, root causes, search, activity, health) | `/worklog:dashboard ticket ABC-123` |
| `/worklog:today` | The daily note for today or any day | `/worklog:today yesterday` |
| `/worklog:item` | Everything recorded for one ticket, with file paths to open | `/worklog:item ABC-123` |
| `/worklog:search` | Search titles, commits, docs and findings | `/worklog:search deadlock` |
| `/worklog:recent` | Tickets touched in the last N days, in a month, or all | `/worklog:recent 14` |
| `/worklog:standup` | Yesterday / Today / Blockers draft from your notes | `/worklog:standup` |
| `/worklog:handover` | A handover note for a ticket: context, ruled out, root cause, next steps | `/worklog:handover ABC-123` |
| `/worklog:timesheet` | Activity per ticket per day, as a week, a month or CSV | `/worklog:timesheet month csv` |
| `/worklog:export` | One-file Markdown/HTML copy of a ticket, strictly redacted for sharing | `/worklog:export ABC-123 html` |
| `/worklog:tick` | Build the notes now instead of waiting for the next run | `/worklog:tick` |
| `/worklog:sync` | Re-scan your repos and docs folders for new commits and docs | `/worklog:sync` |
| `/worklog:pause` | Pause or resume recording, or show its state | `/worklog:pause resume` |
| `/worklog:config` | Show or change a setting; every change can be undone | `/worklog:config set model.enabled false` |

### Skills Claude uses on its own

You don't type these. Claude picks them up when what you say matches.

| Skill | When it kicks in | Example of what you'd say |
| --- | --- | --- |
| `recall` | You ask about past work or mention a ticket key | *"What did we find on ABC-123?"*, *"What did I do last Tuesday?"* |
| `note` | You state a finding, suspicion, ruled-out cause or decision | *"Log finding: the retry queue drains on restart"*, *"Rule out the cache"* |

Every answer from `recall` cites the file or recorded event it came from. If
something wasn't recorded, it says so instead of guessing.

> **About the activity sheet:** Worklog records *events*, not durations, so
> `/worklog:timesheet` shows how active each ticket was per day, not hours.

There is also a catch-all slash command, `/worklog <anything>`, that runs the
CLI with your arguments, for example `/worklog list`.

---

## Commands

Everything the skills do is also available in a terminal as `worklog …`
(Option B or C install). Most read commands accept `--json`.

### Daily use

| Command | What it does |
| --- | --- |
| `worklog today [YYYY-MM-DD]` | Print the daily note (today by default) |
| `worklog item <KEY>` | Print the rolling note for a ticket |
| `worklog <KEY>` / `worklog ticket <KEY>` | Ticket detail: commits, PRs, docs, findings, root cause |
| `worklog list` | All tickets, newest activity first |
| `worklog recent [--days N]` | Tickets touched in the last N days (default 7) |
| `worklog month YYYY-MM` | Tickets active in a month |
| `worklog search <text>` | Search titles, commit messages, docs and findings |
| `worklog stats` | Totals: tickets, commits, docs, date range |
| `worklog note --ticket <KEY> --kind <kind> "<text>"` | Record a finding. Kinds: `finding`, `hypothesis`, `ruled-out`, `decision`, `note`. |
| `worklog open <KEY>` | Open the newest linked doc in your editor |

### Reports and sharing

| Command | What it does |
| --- | --- |
| `worklog week [--date D] [--csv]` | Activity per ticket per day for the week (Mon–Sun) |
| `worklog timesheet [--month] [--date D] [--csv]` | Same sheet, for a week or a calendar month |
| `worklog export <KEY> [--format md\|html] [--out FILE]` | Write a strictly redacted copy to `~/.worklog/exports/` |
| `worklog dashboard [page] [--port N] [--no-open]` | Open the local dashboard, starting it if needed. Pages: `today`, `day <D>`, `ticket <KEY>`, `tickets`, `rcas [words]`, `search <words>`, `activity`, `month`, `health` |
| `worklog dashboard status` / `stop` | Is the dashboard running? / stop it |

### Capture and the background job

| Command | What it does |
| --- | --- |
| `worklog tick [--force] [DAY]` | Summarise new events now; `--force DAY` redoes a day |
| `worklog pause` / `worklog resume` | Stop or restart recording (hooks stay loaded) |
| `worklog status` | Recording on or off, last run, model spend, health counts |
| `worklog schedule [--interval N]` / `worklog unschedule` | Add or remove the OS-scheduled background job |

### Git and docs import

| Command | What it does |
| --- | --- |
| `worklog sync` | Incremental scan of your repos and docs folders |
| `worklog backfill [--since DATE]` | Full or windowed scan (first-time import) |

### Setup and settings

| Command | What it does |
| --- | --- |
| `worklog install` | Prepare the runtime and print the two `claude plugin` commands that add Worklog to Claude Code |
| `worklog setup [--interval N]` | Create the data folder, copy the runtime, schedule the job |
| `worklog doctor` | Read-only health checks, each with a fix |
| `worklog config` | Print the config and data paths |
| `worklog config get <key>` / `set <key> <value>` | Read or change a setting (dotted keys) |
| `worklog config undo` / `history` | Revert the last change / list changes |
| `worklog init` | Create the default config |
| `worklog help` | Help text |

---

## Configuration

Settings live in `~/.worklog/config.json`. Change them with
`worklog config set` (or `/worklog:config`) rather than by hand: each change
is validated, backed up and can be undone with `worklog config undo`.

```json
{
  "repos":       ["C:\\Projects\\api-service", "C:\\Projects\\web-app"],
  "docsFolders": ["C:\\Projects\\docs"],
  "keyPrefixes": [],
  "authors":     { "names": ["Your Name"], "emails": ["you@example.com"] },

  "capture":   { "enabled": true, "paused": false, "retainRawDays": 30 },
  "redaction": { "mode": "secrets", "names": [], "extraPatterns": [] },
  "tick":      { "enabled": true, "intervalMinutes": 5 },
  "model":     { "enabled": true, "command": "claude", "dailyBudgetUsd": 1.0,
                 "maxCallsPerTick": 2, "maxCallsPerDay": 40 }
}
```

| Setting | What it does |
| --- | --- |
| `repos` | Absolute paths of git repos to import commits from |
| `docsFolders` | Folders scanned recursively for `*.md` files |
| `keyPrefixes` | `[]` accepts any `PROJ-123` key. `["ABC","OPS"]` accepts only those prefixes. |
| `authors` | Only import commits by these names or emails |
| `capture.paused` | `true` keeps hooks loaded but records nothing |
| `capture.retainRawDays` | Raw events are deleted after this many days; notes are kept |
| `redaction.mode` | `local`, `secrets` (default) or `public`; see below |
| `redaction.names` | Names to mask wherever they appear in text |
| `redaction.extraPatterns` | Your own regexes to mask |
| `tick.enabled` / `intervalMinutes` | Turn the background job on or off, and how often it runs |
| `model.enabled` | `false` = fully offline, no model calls ever |
| `model.dailyBudgetUsd`, `maxCallsPerTick`, `maxCallsPerDay` | Spending caps for model calls |

Common changes:

```bash
worklog config set model.enabled false          # never call a model
worklog config set model.dailyBudgetUsd 0.25    # cap spend at $0.25/day
worklog config set redaction.mode public        # also mask paths, hosts, IPs
worklog config set keyPrefixes '["ABC","OPS"]'  # only these ticket prefixes
worklog config undo                             # take the last change back
```

---

## Privacy and safety

**Nothing leaves your machine unless you send it.** There is no telemetry. The
only outside call is the optional `claude -p` summary, which is sent already
redacted and is capped by your budget. The only socket Worklog opens is the
dashboard, and it is hard-bound to `127.0.0.1`: there is no option to expose it.

### Redaction

Text is masked three times: when it's captured, again before any model call,
and again before an export. Each mode masks everything the previous one does,
plus more:

| Mode | Use when text is going to… | Masks |
| --- | --- | --- |
| `local` | your own disk | passwords, tokens, API keys, connection strings, private keys, high-entropy blobs |
| `secrets` *(default)* | a model call | the above, plus emails, phone numbers and your `redaction.names` |
| `public` | another person or machine | the above, plus absolute paths, hostnames and IP addresses |

`worklog export` always uses `public`, whatever your setting.

### What Worklog will never do

- **Write outside its own folders.** Writes are limited to `~/.worklog`, the
  plugin folder and the temp folder. Anything else is refused, and there is no switch to allow it.
- **Change your work.** Repos, Git hosts, issue trackers and databases are only
  read. `git` is only run with read-only subcommands.
- **Run arbitrary programs.** Only a fixed list (`git`, `claude`, `node`, the OS
  scheduler, an editor launcher, the browser opener) can start, never through a shell.
- **Break your session.** Hooks catch every error, log it to
  `~/.worklog/logs/errors.log` and let Claude Code carry on.

These rules are enforced by tests. See [`CLAUDE.md`](CLAUDE.md).

### Turning things off

```bash
worklog pause                          # stop recording
worklog config set model.enabled false # no model calls
worklog unschedule                     # stop the background job
```

---

## Where your data lives

Everything is under `~/.worklog` (set `WORKLOG_DIR` to use another folder):

| What | Path |
| --- | --- |
| Settings | `config.json` |
| Daily notes | `daily/<YYYY-MM-DD>.md` |
| Per-ticket notes | `items/<KEY>/README.md` |
| Ticket records (source of truth) | `tickets/<KEY>.json` |
| Commits and docs with no key | `tickets/_unassigned.json` |
| Raw captured events | `raw/<YYYY-MM-DD>/<session>.jsonl` |
| Exports | `exports/` |
| Settings backups and history | `backups/config/` |
| Model spend ledger | `spend.json` |
| Errors from hooks and the background job | `logs/errors.log` |
| Running dashboard (pid and port) | `dashboard.json` |
| Runtime the background job runs | `runtime/` |

Notes are regenerated on every run, so edits to them are overwritten. To add
something permanent, use `worklog note` (or just tell Claude: *"log finding: …"*).

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Anything odd | Run `/worklog:doctor` (or `worklog doctor`). Each failing row prints its fix. |
| `/worklog:today` says "no note yet" | Run `/worklog:tick` to summarise now, or wait for the next 5-minute run. |
| Work shows up as "Unattributed" | No ticket key was seen. Put the key in the branch name or a prompt. |
| `bad option: --test`, `.at is not a function` or similar errors | Your `node` is older than 18. Check `node --version` and `where node` (Windows) or `which -a node`; an older Node earlier on PATH wins. |
| Skills don't appear | Restart Claude Code after installing. |
| `worklog: command not found` | The marketplace install doesn't add a terminal command. Use Option B, or run `node ~/.worklog/runtime/bin/worklog.mjs …`. |
| Background job never runs | Run `/worklog:setup` again. It recopies the runtime and reschedules. |
| Dashboard says the port is taken | Another program uses 7341. Run `worklog dashboard --port 7342`. |
| Dashboard page says "Something went wrong" | The server stopped. Run `worklog dashboard` again. |

---

## Uninstall

Stop the dashboard and remove the scheduled job first, then the plugin, then (optionally) your data:

```bash
worklog dashboard stop
worklog unschedule
#   no `worklog` command? use: node ~/.worklog/runtime/bin/worklog.mjs unschedule

claude plugin uninstall worklog@karmavritta   # or /plugin uninstall … inside Claude Code
claude plugin marketplace remove karmavritta
npm uninstall -g worklog-claude                # npm install only

rm -rf ~/.worklog                         # deletes all your notes and records (optional)
```

---

## Development

```bash
npm test     # pure node:test, no dependencies, synthetic data only
```

Read [`CLAUDE.md`](CLAUDE.md) before changing anything: it holds the ten rules
this repo is held to, and several are enforced by tests.
[`docs/development.md`](docs/development.md) covers the project layout and
design choices, and [`docs/publishing.md`](docs/publishing.md) covers releasing
to the marketplace and npm.

## License

[MIT](LICENSE)
