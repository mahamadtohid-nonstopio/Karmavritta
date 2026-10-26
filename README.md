# worklog-claude

A Claude Code plugin + CLI that builds **one record per ticket, automatically**
from your git commits and docs. Point it at any repo and docs folder; it scans
for `ESIN-123` / `PROJ-456` / `OPP-7` style keys and groups everything by ticket.

- Zero runtime dependencies. Pure Node (≥ 18). Works on Windows, macOS, Linux.
- Dynamic ticket prefixes — the regex is `[A-Z][A-Z0-9]+-\d+`. ESIN, OPP, PROJ,
  FOO all work with no code change. Set `keyPrefixes` to lock it down if you want.
- Scales to tens of thousands of tickets via a batched writer + `index.json` cache
  + incremental git sync + mtime-cached docs scan.
- `/worklog` slash command inside Claude Code, or `worklog` CLI from any shell.

---

## 1. Install

### From source (right now)

```powershell
cd C:\Vibe-code\worklog-plugin
npm link            # puts the `worklog` CLI on your PATH
worklog install     # copies the Claude Code plugin into ~/.claude/plugins/worklog
```

Then **restart Claude Code** once so it picks up the slash command.

### From npm (after you publish — see §4)

```bash
npm install -g worklog-claude      # or @yourscope/worklog-claude
worklog install
```

Requires **Node ≥ 18** and **git** on PATH.

---

## 2. Set it up

```powershell
worklog init
```

Opens / creates `~/.worklog/config.json`. Edit it to point at your work:

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
  "docOpenScheme": "vscode"
}
```

| Field | What it does |
| --- | --- |
| `repos` | Absolute paths to git repos to scan |
| `docsFolders` | Folders scanned recursively for `*.md` files |
| `keyPrefixes` | **Leave empty to accept any `PROJ-123` style key** — switching projects needs zero code change. Set `["ESIN","OPP"]` to restrict. |
| `authors` | Filters git log to just your commits (OR'd across names and emails) |

Then:

```powershell
worklog backfill --since 2026-01-01
```

That's the one-time full scan. Everything after that is incremental.

---

## 3. Use it

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
| `worklog init` | Create default config |
| `worklog config` | Print config and data paths |
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

## 4. Publish to npm

So that you (or anyone) can `npm install -g` it later from any machine.

### 4.1 Decide the package name

Scoped is safest — the name is always available under your scope:

```powershell
npm view @nonstopio/worklog-claude     # should 404 (not taken)
```

Edit `package.json` → set `"name": "@nonstopio/worklog-claude"` (or keep
unscoped if `worklog-claude` is free).

### 4.2 Fill in metadata

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

### 4.3 One-time npm account setup

```powershell
npm adduser                 # or: npm login
npm whoami                  # confirm who you are
```

Enable **2FA** on https://www.npmjs.com/settings/<you>/profile — npm blocks
publish on new accounts without it.

### 4.4 Pre-publish sanity check

```powershell
npm test                    # should say "pass 36, fail 0"
npm pack --dry-run          # list every file that will ship
```

The `npm pack --dry-run` output should include **only**:

```
bin/worklog.mjs
scripts/cli.mjs
scripts/install.mjs
scripts/sync.mjs
scripts/lib/config.mjs
scripts/lib/index.mjs
scripts/lib/keys.mjs
scripts/lib/store.mjs
commands/worklog.md
skills/worklog/SKILL.md
.claude-plugin/plugin.json
README.md
package.json
```

If `test/` or `node_modules/` sneak in, tighten the `files` field in
`package.json` or add a `.npmignore`.

### 4.5 Publish

```powershell
# Unscoped
npm publish

# Scoped (first publish needs --access public)
npm publish --access public
```

Appears at `https://www.npmjs.com/package/<name>` within ~30s.

### 4.6 Install from anywhere later

```powershell
npm install -g @nonstopio/worklog-claude
worklog install
worklog init
# ...edit config, backfill
```

### 4.7 Publishing updates

```powershell
npm version patch   # 0.1.0 → 0.1.1  bug fix
npm version minor   # 0.1.0 → 0.2.0  new feature
npm version major   # 0.1.0 → 1.0.0  breaking
npm publish
```

`npm version` edits `package.json` and tags the commit (if the folder is a git repo).

### 4.8 Common gotchas

| Symptom | Fix |
| --- | --- |
| `402 Payment Required` on scoped publish | Add `--access public` |
| `403 Forbidden` | Name is taken, or you're not logged in — `npm whoami` |
| `E2FA` | Enable 2FA on npmjs.com, then `npm login` again |
| `bad option: --test` | Node too old. Use Node ≥ 18 (`nvm use 22`) |
| `worklog: command not found` after `npm link` | On Windows, run PowerShell as admin and re-link |

---

## 5. Smoke test before you publish

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
# → restart Claude Code → try /worklog <KEY> inside a chat
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

## 6. Where things live

| What | Path |
| --- | --- |
| CLI config | `~/.worklog/config.json` |
| Ticket records | `~/.worklog/tickets/<KEY>.json` |
| Unassigned bucket | `~/.worklog/tickets/_unassigned.json` |
| Index cache | `~/.worklog/index.json` |
| Plugin install | `~/.claude/plugins/worklog/` |

Override the data dir for testing with `WORKLOG_DIR=/tmp/sandbox`.

---

## 7. Uninstall

```powershell
npm unlink -g worklog-claude                           # or: npm uninstall -g worklog-claude
Remove-Item -Recurse C:\Users\nonstop\.claude\plugins\worklog
Remove-Item -Recurse C:\Users\nonstop\.worklog         # drops your data (optional)
```

---

## 8. Development

```powershell
npm test              # 36 tests, no deps
```

### Project layout

```
worklog-plugin/
├── bin/worklog.mjs            # CLI entry (npm bin)
├── .claude-plugin/plugin.json # Claude Code plugin manifest
├── commands/worklog.md        # /worklog slash command
├── skills/worklog/SKILL.md    # finding/RCA logger skill
├── scripts/
│   ├── cli.mjs                # command dispatcher
│   ├── install.mjs            # `worklog install` logic
│   ├── sync.mjs               # git log + docs scan (batched, incremental)
│   └── lib/
│       ├── config.mjs         # config loader with deep merge
│       ├── index.mjs          # index.json builder + lastSync tracker
│       ├── keys.mjs           # ticket-key regex + prefix filter
│       └── store.mjs          # read/write ticket JSON, lock, atomic write
├── test/                      # 36 tests, pure node:test
├── package.json
└── README.md
```

### Design choices worth knowing

- **One JSON per ticket, not a database.** Diffable, human-readable, trivially editable.
- **File lock = mkdir.** Portable and atomic on every OS. Stale-lock recovery at 15s.
- **Batched upserts.** Sync groups events by ticket key first, so each ticket file is opened/locked exactly once per sync.
- **Index cache.** `~/.worklog/index.json` holds per-ticket summaries so `list`/`month`/`recent`/`stats` don't open every ticket file. Rebuilt at the end of each sync.
- **Incremental git log.** `index.json.lastSync[repo]` is passed as `--since=` on the next sync. Explicit `--since` on the CLI overrides.
- **Mtime-cached docs scan.** `index.json.lastDocsScan` cuts work on huge docs trees.

---

## 9. Phases (per the PRD)

- [x] **Phase 1** — store, backfill, terminal queries, CLI, install, note, open, JSON mode, incremental sync, index cache
- [ ] **Phase 2** — self-contained HTML dashboard (month/ticket/search views)
- [ ] **Phase 3** — Claude Code hooks for automatic in-session capture
- [ ] **Phase 4** — Jira & Azure DevOps enrichment, `/worklog rca`

---

## License

MIT
