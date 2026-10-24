# worklog-claude

A Claude Code plugin that builds **one record per ticket, automatically**.
Captures commits, PRs and docs across every git repo and docs folder you point
it at, and groups them by ticket key — so recalling "what did I do on
ESIN-2742, and where is the doc?" takes seconds instead of minutes.

Works with **any** ticket-key prefix matching `[A-Z][A-Z0-9]+-\d+`
(ESIN, OPP, PROJ, FOO, …). Point it at a new project tomorrow and it just
works — nothing is hardcoded.

Status: **Phase 1 (MVP)** — store, backfill from git + docs, terminal view.
Phases 2–4 (dashboard, hooks, Jira/ADO sync, RCA) are specced in the PRD and
will land incrementally.

---

## What this does

- **Scans every git repo you list** and pulls commits whose message or branch
  mentions a ticket key.
- **Scans your docs folders** for markdown files and links them by ticket key
  (both from the filename and from the first `#` heading).
- **Groups everything by ticket** in `~/.worklog/tickets/<KEY>.json` — one
  readable, diffable JSON file per ticket.
- **Multi-key items go everywhere.** A doc named
  `ESIN-2725-ESIN-2742-review.md` is linked under both tickets.
- **Keyless items** (commits with no ticket in message or branch) go to an
  `_unassigned` bucket — nothing is silently dropped.
- **Deduplicates** on commit SHA, PR id and absolute doc path, so you can
  rerun the backfill as many times as you want.
- **Dynamic ticket prefixes** — leave `keyPrefixes: []` in the config and
  every `PROJ-123` style key is captured, no matter the project.

Inside Claude Code, the `/worklog` slash command gives you a one-key terminal
view of any ticket.

---

## Install

### Option A — from npm (after it's published)

```bash
npm install -g worklog-claude
worklog install
```

### Option B — from source (dev / before publishing)

```bash
git clone <this-repo>
cd worklog-plugin
npm link           # puts `worklog` on PATH globally
worklog install    # copies plugin into ~/.claude/plugins/worklog
```

Either way, two steps:
1. **`npm install -g` / `npm link`** — puts the `worklog` CLI on your PATH.
2. **`worklog install`** — copies the Claude Code plugin files into
   `~/.claude/plugins/worklog/` so the `/worklog` slash command appears
   inside Claude Code. Restart Claude Code (or `/plugin reload`) once.

Requires **Node.js 18 or newer**.

---

## Run

### 1. First-time setup

```bash
worklog init
```

Creates `~/.worklog/config.json`. Edit it:

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

- `repos` — absolute paths to git working trees to scan.
- `docsFolders` — folders to scan recursively for `*.md` files.
- `keyPrefixes` — **leave empty to capture every `PROJ-123` style key**, or
  set e.g. `["ESIN","OPP"]` to restrict. This is the dynamic bit — switching
  to a new project is zero code change.
- `authors` — git author filter (OR'd across names and emails) so you only
  ingest your own commits.

### 2. Build history

```bash
worklog backfill --since 2026-01-01
```

Scans every configured repo and docs folder, writes one JSON per ticket to
`~/.worklog/tickets/`. Idempotent — re-run as often as you like.

### 3. Query

```bash
worklog list                 # every ticket, newest activity first
worklog ESIN-4349            # ticket summary (commits, docs, PRs, findings)
worklog ticket ESIN-4349     # same as above
worklog _unassigned          # commits/docs with no ticket key found
worklog sync                 # incremental re-scan
worklog config               # print current config + paths
worklog help
```

### 4. Inside Claude Code

Once `worklog install` is done and Claude Code is restarted, the `/worklog`
slash command is available:

```
/worklog ESIN-4349
/worklog list
/worklog sync
/worklog backfill --since 2026-01-01
/worklog config
```

The slash command just shells out to the `worklog` CLI.

### Example output

```
$ worklog ESIN-4349

ESIN-4349 — Log order-summary fallback as Warning
-------------------------------------------------
Status:   In QA
Active:   2026-10-20 → 2026-10-24  (3 days)
Repos:    PE-DryLabAPI
Branches: ESIN-4349/qa
Jira:     https://<site>.atlassian.net/browse/ESIN-4349

Commits (2):
  9fa0c855e  2026-10-23  [PE-DryLabAPI]  [ESIN-4349] Log order-summary fallback as Warning
  5a2b1c0e3  2026-10-22  [PE-DryLabAPI]  [ESIN-4349] Add fallback path

Docs (1):
  C:\Projects\docs\ESIN-4349-backend-changes.md
```

---

## Where things live

| What                      | Where                                    |
| ------------------------- | ---------------------------------------- |
| CLI config                | `~/.worklog/config.json`                 |
| Ticket records            | `~/.worklog/tickets/<KEY>.json`          |
| Unassigned bucket         | `~/.worklog/tickets/_unassigned.json`    |
| Plugin install directory  | `~/.claude/plugins/worklog/`             |

Override the data directory for testing with `WORKLOG_DIR=/tmp/wl`.

---

## Publish to npm

### 1. Pick a package name

Scoped is recommended because the name is always available under your scope:

```bash
npm view worklog-claude            # check if the unscoped name is free
```

If taken, use `@your-scope/worklog-claude` and update `package.json`:

```json
"name": "@nonstopio/worklog-claude"
```

### 2. One-time npm account setup

```bash
npm adduser        # or: npm login
npm whoami         # confirm you're signed in
```

Enable 2FA on npmjs.com — npm blocks publish on accounts without it.

### 3. Fill in metadata

Add to `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/<you>/worklog-plugin.git"
},
"homepage": "https://github.com/<you>/worklog-plugin#readme",
"bugs": {
  "url": "https://github.com/<you>/worklog-plugin/issues"
},
"author": "Mahamadtohid Naikwadi <mahamadtohid.naikwadi@nonstopio.com>"
```

### 4. Pre-publish sanity check

```bash
npm test            # all 21 tests should pass
npm pack --dry-run  # prints every file that will be shipped
```

Confirm you see `bin/`, `scripts/`, `commands/`, `skills/`, `.claude-plugin/`,
`README.md`, `package.json` and nothing else (no `test/`, no `node_modules/`).

### 5. Publish

Unscoped:
```bash
npm publish
```

Scoped — needs `--access public` the first time:
```bash
npm publish --access public
```

Appears at `https://www.npmjs.com/package/<name>` within ~30 seconds.

### 6. Verify from a clean machine

```bash
npm install -g <name>
worklog --help
worklog install
```

### 7. Publishing updates

```bash
npm version patch     # 0.1.0 -> 0.1.1  (bug fixes)
npm version minor     # 0.1.0 -> 0.2.0  (new feature, back-compat)
npm version major     # 0.1.0 -> 1.0.0  (breaking)
npm publish
```

`npm version` bumps `package.json` and (if the folder is a git repo) tags the
commit automatically.

### Common gotchas

| Error / symptom | Fix |
| --- | --- |
| `402 Payment Required` on a scoped publish | Add `--access public` |
| `403 Forbidden` | Name is taken by someone else, or you're not logged in — `npm whoami` |
| `E2FA` | Enable 2FA on npmjs.com, then `npm login` again |
| `bad option: --test` | Node too old — `nvm use 22` (needs ≥ 18) |
| `worklog: command not found` after `npm link` | On Windows, run PowerShell as admin and re-link |

---

## Uninstall

```bash
npm unlink -g worklog-claude                      # remove the CLI
rm -rf ~/.claude/plugins/worklog                  # remove the Claude plugin
rm -rf ~/.worklog                                 # remove your data (optional)
```

On Windows PowerShell:
```powershell
npm unlink -g worklog-claude
Remove-Item -Recurse C:\Users\<you>\.claude\plugins\worklog
Remove-Item -Recurse C:\Users\<you>\.worklog
```

---

## Development

```bash
npm test              # node --test, no deps
```

- Pure Node (≥ 18), **zero runtime dependencies**.
- Works on Windows, macOS and Linux paths.
- Store is file-locked (mkdir-based) and writes atomically (temp file + rename).

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
│   ├── sync.mjs               # git log + docs scan
│   └── lib/
│       ├── config.mjs         # ~/.worklog/config.json loader
│       ├── keys.mjs           # ticket-key regex + prefix filter
│       └── store.mjs          # read/write ticket JSON, lock, atomic write
├── test/
│   ├── keys.test.mjs
│   └── store.test.mjs
├── package.json
└── README.md
```

---

## Phase 1 scope (this release)

- [x] Scaffold + config + key extraction + JSON store with lock & atomic write
- [x] `syncGit` and `syncDocs` with dedupe
- [x] `/worklog <KEY>` and `worklog list` terminal views
- [x] `worklog install` to drop the plugin into `~/.claude/plugins`
- [x] Dynamic ticket prefix (empty `keyPrefixes` = allow any)
- [x] 21 unit tests covering keys and store

Coming next (per PRD):
- Phase 2 — self-contained HTML dashboard (month view, ticket detail, search)
- Phase 3 — hooks + ingest for automatic in-session capture, `/worklog note`
- Phase 4 — Jira & ADO enrichment, `/worklog rca`, `_unassigned` view

---

## License

MIT
"# Karmavritta" 
