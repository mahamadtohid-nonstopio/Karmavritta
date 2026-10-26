# worklog-claude

A Claude Code plugin + CLI that builds **one record per ticket, automatically**.
It captures your Claude Code sessions as they happen, scans your git commits and
docs, groups everything by `ESIN-123` / `PROJ-456` / `OPP-7` style keys, and
writes a daily note plus a rolling note per work item.

- **Automatic session capture.** Hooks record every prompt and tool call to a
  local raw log. A background tick turns them into notes a few minutes later.
  Nothing is asked of you during the session.
- **Zero runtime dependencies.** Pure Node (≥ 18). Windows, macOS, Linux.
- **Dynamic ticket prefixes** — the regex is `[A-Z][A-Z0-9]+-\d+`. ESIN, OPP,
  PROJ, FOO all work with no code change. Set `keyPrefixes` to restrict it.
- **Private by construction.** Everything stays on your disk. Secrets are masked
  at capture, again before any model call, again before any export.
- **Read-only toward your work.** Writes are confined to an allowlist of roots;
  your repos, hosts and trackers are only ever read.
- `/worklog` slash command inside Claude Code, or `worklog` CLI from any shell.

---

## 0. How the capture pipeline works

```
Claude Code session
      │  hooks (fail-open, <100ms, silent)
      ▼
~/.worklog/raw/<day>/<session>.jsonl     redacted event lines
      │  background tick, every 5 min
      ▼
  merge by stable content id  ──►  ~/.worklog/tickets/<KEY>.json
      │  optional `claude -p` extraction, budget-capped
      ▼
~/.worklog/daily/<day>.md  +  ~/.worklog/items/<KEY>/README.md
```

Three properties hold the design together:

- **The tick is the only writer of notes**, it holds a lock, and it is
  idempotent — re-running it over the same events adds nothing.
- **Every model claim must cite an event id** that exists in the raw log.
  Uncited claims are dropped, not softened.
- **The model is optional.** If `claude` is missing, disabled or over budget,
  the tick falls back to a deterministic summary rather than skipping.

---

## 1. Install

### From source (right now)

```powershell
cd C:\Vibe-code\worklog-plugin
npm link            # puts the `worklog` CLI on your PATH
worklog install     # copies the Claude Code plugin into ~/.claude/plugins/worklog
```

Then **restart Claude Code** once so it picks up the slash command.

### From npm (after you publish — see §5)

```bash
npm install -g worklog-claude      # or @yourscope/worklog-claude
worklog install
```

Requires **Node ≥ 18** and **git** on PATH.

---

## 2. Set it up

```powershell
worklog setup            # creates ~/.worklog and schedules the background tick
worklog doctor           # confirms hooks, tick, scheduler and budget are healthy
```

`worklog setup` registers the tick with whatever the OS provides —
`schtasks` on Windows, a launchd agent on macOS, `crontab` on Linux — pointing
at a stable runtime copy under `~/.worklog/runtime/` so a plugin upgrade cannot
orphan the schedule. Use `--interval N` to change the cadence from 5 minutes.

Then edit `~/.worklog/config.json` to point at your work:

```json
{
  "repos": [
    "C:\\Projects\\PE-DryLabAPI",
    "C:\\Projects\\PE-wgs-review-tool"
  ],
  "docsFolders": [
    "C:\\Projects\\docs"
  ],
  "keyPrefixes": [],
  "authors": {
    "names": ["Suraj Wankhade", "Mahamadtohid"],
    "emails": ["you@nonstopio.com"]
  },
  "ado":  { "org": "", "project": "" },
  "jira": { "site": "" },
  "docOpenScheme": "vscode",

  "capture":   { "enabled": true, "paused": false, "retainRawDays": 30 },
  "redaction": { "mode": "secrets", "names": [], "extraPatterns": [] },
  "tick":      { "enabled": true, "intervalMinutes": 5 },
  "model":     { "enabled": true, "command": "claude", "dailyBudgetUsd": 1.0 }
}
```

| Field | What it does |
| --- | --- |
| `repos` | Absolute paths to git repos to scan |
| `docsFolders` | Folders scanned recursively for `*.md` files |
| `keyPrefixes` | **Leave empty to accept any `PROJ-123` style key** — switching projects needs zero code change. Set `["ESIN","OPP"]` to restrict. |
| `authors` | Filters git log to just your commits (OR'd across names and emails) |
| `capture` | Session capture. `paused: true` keeps hooks loaded but records nothing. Raw events are deleted after `retainRawDays`; the notes stay. |
| `redaction` | `local` \| `secrets` \| `public` — see §4. `names` are masked in free text. |
| `tick` | Background summarisation. `enabled: false` stops the schedule; `worklog tick --force` still runs. |
| `model` | Extraction via `claude -p`. Capped by `maxCallsPerTick`, `maxCallsPerDay` and `dailyBudgetUsd`. Set `enabled: false` for a fully offline worklog. |

Change settings through the CLI so every write is backed up and reversible:

```powershell
worklog config set redaction.mode public
worklog config set model.dailyBudgetUsd 0.25
worklog config undo                          # revert the last change
worklog config history                       # what changed, and when
```

For the git/docs side of the record:

```powershell
worklog backfill --since 2026-01-01
```

That's the one-time full scan. Everything after that is incremental.

---

## 3. Use it

### What you did today

```powershell
worklog today                       # the daily note, rendered from captured sessions
worklog today 2026-10-20            # any past day
worklog item ESIN-4349              # rolling note: timeline, findings, files, commands
worklog status                      # capture on? tick fresh? what has it spent?
```

These read notes the tick already wrote. To summarise right now instead of
waiting for the schedule:

```powershell
worklog tick                        # process everything not yet summarised
worklog tick --force 2026-10-20     # redo one day from the raw log
worklog pause                       # stop recording (hooks stay loaded)
worklog resume
```

### Day-to-day queries

```powershell
worklog list                        # all tickets, newest activity first
worklog recent --days 7             # what you touched this week
worklog month 2026-08               # tickets active in August
worklog ESIN-4349                   # ticket detail (commits, docs, findings, RCA)
worklog search deadlock             # grep titles, commit msgs, doc names, findings
worklog stats                       # overall counts
worklog _unassigned                 # commits/docs with no key found
```

### Keeping it current

```powershell
worklog sync                        # incremental re-scan (seconds, not minutes)
worklog backfill --since 2026-10-01 # explicit window override
```

### Logging findings as you investigate

```powershell
worklog note --ticket ESIN-4349 --kind ruled-out "transactionscope was not the cause"
worklog note --ticket ESIN-4349 --kind finding   "retry queue drains on process restart"
```

Kinds: `finding | hypothesis | ruled-out | decision | note`.

### Opening the ticket's doc

```powershell
worklog open ESIN-4349   # opens the newest linked .md in VS Code
```

### JSON mode (for scripts and Claude)

```powershell
worklog list     --json
worklog ESIN-4349 --json
worklog recent  --days 7 --json
worklog search  deadlock --json
worklog stats   --json
```

### Inside Claude Code

Once the plugin is installed and Claude Code is restarted, type:

```
/worklog ESIN-4349
/worklog recent --days 7
/worklog search deadlock
/worklog sync
```

The slash command just shells out to the `worklog` CLI; output is shown inline.

### Full command reference

| Command | Purpose |
| --- | --- |
| `worklog install` | Copy plugin to `~/.claude/plugins/worklog` |
| `worklog setup [--interval N]` | Create the data home and schedule the tick |
| `worklog doctor` | 13 read-only health checks, each with the command that fixes it |
| `worklog status` | Capture state, last tick, model spend, health counts |
| `worklog schedule` / `unschedule` | Register or remove the OS-scheduled tick |
| `worklog pause` / `resume` | Stop or restart event capture |
| `worklog tick [--force] [DAY]` | Summarise captured events into notes now |
| `worklog today [DAY]` | Print the daily note |
| `worklog item <KEY>` | Print the rolling note for one work item |
| `worklog init` | Create default config |
| `worklog config` | Print config and data paths |
| `worklog config set/get/undo/history` | Change a setting, reversibly |
| `worklog backfill [--since DATE]` | Full / windowed scan |
| `worklog sync` | Incremental re-scan |
| `worklog list` | All tickets, newest activity first |
| `worklog recent [--days N]` | Tickets touched in last N days (default 7) |
| `worklog month YYYY-MM` | Tickets active in that month |
| `worklog search <text>` | Grep across titles, commits, docs, findings |
| `worklog stats` | Counts (tickets, commits, docs, date range) |
| `worklog <KEY>` or `worklog ticket <KEY>` | Ticket detail |
| `worklog note --ticket <KEY> --kind <k> "<text>"` | Add a finding |
| `worklog open <KEY>` | Open newest linked doc in VS Code |
| `worklog help` | Help text |

All read commands (`list`, `month`, `recent`, `search`, `stats`, `ticket`, `<KEY>`) support `--json`.

---

## 4. Privacy and safety

Nothing leaves your machine unless you send it somewhere. There is no telemetry
and no network client in the codebase.

### Redaction modes are destinations, not severity levels

Each mode is a superset of the one before it:

| Mode | Where the text is going | What is masked |
| --- | --- | --- |
| `local` | your own disk | credentials, tokens, keys, connection strings, high-entropy blobs |
| `secrets` | leaving the process (a model call) | the above, plus emails, phone numbers and your configured `names` |
| `public` | leaving the machine (an export, a paste) | the above, plus absolute paths, hostnames and IP addresses |

The default is `secrets`. Capture always masks at the configured mode, the
model digest is masked again before it is sent, and extracted text is masked a
third time at `public` level before it reaches a note.

### What the plugin may touch

`scripts/lib/safety.mjs` is the only module allowed to start a process, write
to disk or open a socket, and `test/safety-static.test.mjs` scans every other
source file and fails the build if one reaches for those APIs directly.

- **Writes** are confined to `~/.worklog`, the plugin install dir and the temp
  dir. A write anywhere else throws. There is no flag to turn this off.
- **Processes** come from a fixed allowlist (`git`, `claude`, the schedulers,
  an editor launcher), always spawned with an argv array and never through a
  shell. `git` is only ever invoked with reading subcommands.
- **Your repos, Git hosts, databases and issue trackers are read-only.**

### Turning parts of it off

```powershell
worklog pause                                  # stop recording entirely
worklog config set model.enabled false         # local-only, no model calls ever
worklog config set capture.retainRawDays 7     # keep less raw history
worklog config set redaction.mode public       # mask paths and hosts too
worklog unschedule                             # stop the background tick
```

To delete everything, remove `~/.worklog`. Nothing lives anywhere else.

---

## 5. Publish to npm

So that you (or anyone) can `npm install -g` it later from any machine.

### 5.1 Decide the package name

Scoped is safest — the name is always available under your scope:

```powershell
npm view @nonstopio/worklog-claude     # should 404 (not taken)
```

Edit `package.json` → set `"name": "@nonstopio/worklog-claude"` (or keep
unscoped if `worklog-claude` is free).

### 5.2 Fill in metadata

```json
{
  "name": "@nonstopio/worklog-claude",
  "version": "0.1.0",
  "description": "...",
  "repository": {
    "type": "git",
    "url": "https://github.com/mahamadtohid-nonstopio/Karmavritta.git"
  },
  "homepage": "https://github.com/mahamadtohid-nonstopio/Karmavritta#readme",
  "bugs": { "url": "https://github.com/mahamadtohid-nonstopio/Karmavritta/issues" },
  "author": "Mahamadtohid Naikwadi <mahamadtohid.naikwadi@nonstopio.com>",
  "license": "MIT"
}
```

### 5.3 One-time npm account setup

```powershell
npm adduser                 # or: npm login
npm whoami                  # confirm who you are
```

Enable **2FA** on https://www.npmjs.com/settings/<you>/profile — npm blocks
publish on new accounts without it.

### 5.4 Pre-publish sanity check

```powershell
npm test                    # should say "fail 0"
npm pack --dry-run          # list every file that will ship
```

The `npm pack --dry-run` output should include `bin/`, `scripts/`, `hooks/`,
`prompts/`, `commands/`, `skills/`, `.claude-plugin/`, `CLAUDE.md`, `README.md`
and `package.json` — and nothing else. If `test/` or `node_modules/` sneak in,
tighten the `files` field in `package.json` or add a `.npmignore`.

### 5.5 Publish

```powershell
# Unscoped
npm publish

# Scoped (first publish needs --access public)
npm publish --access public
```

Appears at `https://www.npmjs.com/package/<name>` within ~30s.

### 5.6 Install from anywhere later

```powershell
npm install -g @nonstopio/worklog-claude
worklog install
worklog init
# ...edit config, backfill
```

### 5.7 Publishing updates

```powershell
npm version patch   # 0.1.0 → 0.1.1  bug fix
npm version minor   # 0.1.0 → 0.2.0  new feature
npm version major   # 0.1.0 → 1.0.0  breaking
npm publish
```

`npm version` edits `package.json` and tags the commit (if the folder is a git repo).

### 5.8 Common gotchas

| Symptom | Fix |
| --- | --- |
| `402 Payment Required` on scoped publish | Add `--access public` |
| `403 Forbidden` | Name is taken, or you're not logged in — `npm whoami` |
| `E2FA` | Enable 2FA on npmjs.com, then `npm login` again |
| `bad option: --test` | Node too old. Use Node ≥ 18 (`nvm use 22`) |
| `worklog: command not found` after `npm link` | On Windows, run PowerShell as admin and re-link |

---

## 6. Smoke test before you publish

Run these in order. Each one either prints something sensible or exits with a
clear error. If anything surprises you, pause.

```powershell
# 1. Config loads
worklog config

# 2. Full backfill works
worklog backfill --since 2026-01-01

# 3. Queries are fast and show real data
worklog list
worklog recent --days 7
worklog stats
worklog search deadlock          # try a word you know appears in your repos

# 4. Ticket detail works
worklog <KEY-YOU-SAW-IN-LIST>

# 5. Incremental sync is incremental
worklog sync                      # should say "scanning <repo> since <date>..."

# 6. Note persists
worklog note --ticket <KEY> --kind finding "test from smoke run"
worklog <KEY>                     # confirm it shows in Findings

# 7. JSON mode is parseable
worklog list --json | ConvertFrom-Json | Select -First 2

# 8. Install flow works end-to-end
worklog install
worklog setup
worklog doctor                    # expect 0 failing
# → restart Claude Code → use a tool in a session → then:
worklog tick
worklog today                     # the session you just had, summarised
```

Nuclear-option clean-slate test (optional, best right before publish):

```powershell
npm unlink -g worklog-claude
Remove-Item -Recurse C:\Users\nonstop\.claude\plugins\worklog
Remove-Item -Recurse C:\Users\nonstop\.worklog

cd C:\Vibe-code\worklog-plugin
npm link
worklog install
worklog init
# fill config, backfill, verify queries
```

If this works, strangers running `npm install -g <pkg>` will have the same experience.

---

## 7. Where things live

| What | Path |
| --- | --- |
| CLI config | `~/.worklog/config.json` |
| Ticket records | `~/.worklog/tickets/<KEY>.json` |
| Unassigned bucket | `~/.worklog/tickets/_unassigned.json` |
| Raw captured events | `~/.worklog/raw/<YYYY-MM-DD>/<session>.jsonl` |
| Daily notes | `~/.worklog/daily/<YYYY-MM-DD>.md` |
| Per-item notes | `~/.worklog/items/<KEY>/README.md` |
| Index cache | `~/.worklog/index.json` |
| Tick state (per-day fingerprints) | `~/.worklog/state.json` |
| Model spend ledger | `~/.worklog/spend.json` |
| Config backups + change history | `~/.worklog/backups/config/` |
| Hook and tick errors | `~/.worklog/logs/errors.log` |
| Runtime copy the scheduler runs | `~/.worklog/runtime/` |
| Plugin install | `~/.claude/plugins/worklog/` |

Notes are generated — the tick overwrites them. Anything you want to keep goes
into the ticket record via `worklog note`, which the notes then render.

Override the data dir for testing with `WORKLOG_DIR=/tmp/sandbox`.

---

## 8. Uninstall

```powershell
npm unlink -g worklog-claude                           # or: npm uninstall -g worklog-claude
Remove-Item -Recurse C:\Users\nonstop\.claude\plugins\worklog
Remove-Item -Recurse C:\Users\nonstop\.worklog         # drops your data (optional)
```

---

## 9. Development

```powershell
npm test              # no deps, pure node:test
```

`CLAUDE.md` holds the non-negotiable rules for changing this repo. Read it
before your first change — several of them are enforced by tests.

### Project layout

```
worklog-plugin/
├── bin/worklog.mjs            # CLI entry (npm bin)
├── .claude-plugin/plugin.json # Claude Code plugin manifest
├── CLAUDE.md                  # the 10 rules this repo is held to
├── commands/worklog.md        # /worklog slash command
├── hooks/
│   ├── hooks.json             # the five events Claude Code fires at us
│   └── run.mjs                # fail-open hook entry point
├── prompts/extract.md         # the extraction prompt (editable on disk)
├── skills/worklog/SKILL.md    # finding/RCA logger skill
├── scripts/
│   ├── cli.mjs                # command dispatcher
│   ├── install.mjs            # `worklog install` logic
│   ├── tick.mjs               # scheduled tick entry point
│   ├── sync.mjs               # git log + docs scan (batched, incremental)
│   └── lib/
│       ├── safety.mjs         # the only module that spawns, writes or sockets
│       ├── paths.mjs          # pure path resolution (no cycle with safety)
│       ├── config.mjs         # config loader with deep merge
│       ├── configstore.mjs    # the one write path for config: lock, backup, undo
│       ├── redact.mjs         # local | secrets | public masking
│       ├── capture.mjs        # hook payload → redacted raw event line
│       ├── agent.mjs          # the tick: ingest, merge, extract, render
│       ├── extract.mjs        # model call + citation validation
│       ├── render.mjs         # daily and per-item markdown
│       ├── budget.mjs         # call caps and the spend ledger
│       ├── scheduler.mjs      # schtasks / launchd / cron
│       ├── doctor.mjs         # 13 read-only health checks
│       ├── index.mjs          # index.json builder + lastSync tracker
│       ├── keys.mjs           # ticket-key regex + prefix filter
│       └── store.mjs          # read/write ticket JSON, lock, atomic write
├── test/                      # pure node:test, synthetic fixtures only
├── package.json
└── README.md
```

### Design choices worth knowing

- **One JSON per ticket, not a database.** Diffable, human-readable, trivially editable.
- **File lock = mkdir.** Portable and atomic on every OS. Stale-lock recovery at 15s.
- **Hooks are fail-open and silent.** They catch everything, log to `logs/errors.log` and exit 0. A broken hook must never break your session.
- **Stable content-addressed ids.** Findings, files and events are keyed by a hash of their normalised text, so re-running the tick merges instead of duplicating.
- **Counts are stored per day and summed, never incremented**, for the same reason.
- **The tick skips unchanged days** by comparing a fingerprint of the day's event ids, and skips unchanged notes by comparing bytes.
- **Prompts live on disk.** Retargeting extraction at a different domain is an edit to `prompts/extract.md`, not a code change. A copy under `~/.worklog/prompts/` wins over the packaged one.
- **Batched upserts.** Sync groups events by ticket key first, so each ticket file is opened/locked exactly once per sync.
- **Index cache.** `~/.worklog/index.json` holds per-ticket summaries so `list`/`month`/`recent`/`stats` don't open every ticket file.
- **Incremental git log.** `index.json.lastSync[repo]` is passed as `--since=` on the next sync. Explicit `--since` on the CLI overrides.
- **Mtime-cached docs scan.** `index.json.lastDocsScan` cuts work on huge docs trees.

---

## 10. Roadmap

- [x] **Store and backfill** — ticket records, git + docs scan, terminal queries, JSON mode, incremental sync, index cache
- [x] **Safety and redaction** — write allowlist, command allowlist, three-mode masking, static enforcement test
- [x] **Session capture** — hooks, raw event log, scheduler, `doctor`, config undo
- [x] **Summarisation** — background tick, budget-capped extraction with cited evidence, daily and per-item notes
- [ ] **Search and recall** — local inverted index, read-only MCP server, recall skill, `/worklog:` commands
- [ ] **Enrichment** — Jira & Azure DevOps detail, HTML dashboard, `/worklog rca`

---

## License

MIT
