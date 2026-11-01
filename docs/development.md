# Development

```bash
npm test    # node test/run.mjs: pure node:test, no dependencies
```

`npm test` goes through `test/run.mjs`, which lists the test files itself.
`node --test "test/*.test.mjs"` needs Node 21+ to expand the glob, and
`node --test test/` is rejected by Node 22+, so the runner keeps one command
working from Node 18 onwards.

Read [`CLAUDE.md`](../CLAUDE.md) first. Its ten rules are non-negotiable, and
several are enforced by tests:

| Test | Enforces |
| --- | --- |
| `test/safety-static.test.mjs` | only `scripts/lib/safety.mjs` may spawn, write or open sockets |
| `test/redteam.test.mjs` | planted (fabricated) secrets never survive redaction |
| `test/skills.test.mjs` | every skill is well-formed and only calls CLI subcommands that exist |
| `test/install.test.mjs` | the runtime copy exists where the scheduler points; manifest versions agree |
| `test/dashboard.test.mjs` | loopback-only server, Host check, GET-only, static allowlist, every route, search ranking, start/reuse/stop |

Tests set `WORKLOG_DIR` to a temp folder and invent their own fixtures. No test
touches the real data home or a real repo.

## Project layout

```
.
├── .claude-plugin/
│   ├── plugin.json            # Claude Code plugin manifest
│   └── marketplace.json       # makes the repo a plugin marketplace
├── bin/worklog.mjs            # CLI entry (npm bin)
├── CLAUDE.md                  # the ten rules this repo is held to
├── commands/worklog.md        # catch-all /worklog slash command
├── hooks/
│   ├── hooks.json             # the five events Claude Code fires at us
│   └── run.mjs                # fail-open hook entry point
├── prompts/extract.md         # the extraction prompt (editable on disk)
├── skills/<name>/SKILL.md     # one folder per /worklog:<name> skill; recall and note are model-invoked
├── scripts/
│   ├── cli.mjs                # command dispatcher
│   ├── install.mjs            # `worklog install` and the runtime refresh used by setup
│   ├── tick.mjs               # scheduled tick entry point
│   ├── sync.mjs               # git log + docs scan (batched, incremental)
│   ├── dashboard/             # the dashboard page: index.html, app.js, app.css (no framework, no CDN)
│   └── lib/
│       ├── safety.mjs         # the only module that spawns, writes or opens sockets
│       ├── paths.mjs          # pure path resolution (no cycle with safety)
│       ├── config.mjs         # config loader with deep merge
│       ├── configstore.mjs    # the one write path for config: lock, backup, undo
│       ├── redact.mjs         # local | secrets | public masking
│       ├── capture.mjs        # hook payload → redacted raw event line
│       ├── agent.mjs          # the tick: ingest, merge, extract, render
│       ├── extract.mjs        # model call + citation validation
│       ├── render.mjs         # daily and per-item markdown
│       ├── report.mjs         # activity sheet and public-redacted export (pure)
│       ├── dashboard.mjs      # dashboard request handler, data routes and search (pure: no socket)
│       ├── budget.mjs         # call caps and the spend ledger
│       ├── scheduler.mjs      # schtasks / launchd / cron
│       ├── doctor.mjs         # read-only health checks
│       ├── index.mjs          # index.json builder + lastSync tracker
│       ├── keys.mjs           # ticket-key regex + prefix filter
│       └── store.mjs          # read/write ticket JSON, lock, atomic write
├── test/                      # node:test, synthetic fixtures only; run.mjs is the entry point
└── docs/                      # this file and publishing.md
```

## Adding a skill

1. Create `skills/<name>/SKILL.md` with frontmatter: `name` (must equal the folder),
   `description`, and `disable-model-invocation: true` unless Claude should pick
   it up on its own (then add the name to `MODEL_INVOKED` in `test/skills.test.mjs`).
2. Call the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" <subcommand>`
   and list exactly those commands under `allowed-tools`, for both `Bash(...)` and `PowerShell(...)`.
3. If the skill needs behaviour the CLI lacks, add a subcommand first, with tests.
   Skills only describe; the CLI does the work.
4. Add it to the Skills table in the README in the same commit.

## Design choices worth knowing

- **One JSON per ticket, not a database.** Diffable, human-readable, easy to inspect.
- **File lock = mkdir.** Portable and atomic on every OS. Stale locks are recovered after 15 s.
- **Hooks are fail-open and silent.** They catch everything, log to `logs/errors.log` and exit 0.
- **Stable content-addressed ids.** Findings, files and events are keyed by a hash of their
  normalised text, so re-running the tick merges instead of duplicating.
- **Counts are stored per day and summed, never incremented**, for the same reason.
- **The tick skips unchanged days** by fingerprinting each day's event ids, and skips
  unchanged notes by comparing bytes.
- **Prompts live on disk.** Retargeting extraction is an edit to `prompts/extract.md`.
  A copy under `~/.worklog/prompts/` wins over the packaged one.
- **Activity, not hours.** The raw log has events but no durations, so the activity
  sheet counts events. Recording durations would change the event format, and rule 7
  requires a migration for that.
- **Runtime copy.** The scheduled tick runs from `~/.worklog/runtime/`, refreshed by
  `setup`, so a plugin update that moves files cannot orphan the schedule.
- **Batched upserts and an index cache.** Sync opens each ticket file once per run;
  `index.json` lets `list` / `recent` / `month` / `stats` avoid opening every ticket.
- **Incremental git log.** `index.json.lastSync[repo]` becomes `--since` on the next sync.
- **Dashboard split.** `safety.serveLocal` owns the socket and is hard-bound to
  127.0.0.1. `lib/dashboard.mjs` is a `{method, url, host, origin, action} → {status, headers, body}`
  handler, so every route is tested without a network. Request bodies are never read.
- **The one write.** `POST /api/tick` ("Summarise now") runs `runTick()`, which writes
  only to the data home. It requires our own `Origin` and an `X-Worklog-Action: tick`
  header. A cross-site page can't add that header without a CORS preflight, which
  this server never answers. Every other non-GET request gets 405, and only one
  tick runs at a time (409 otherwise).
- **Health cache.** `diagnose()` starts git, claude and the scheduler, so its result is
  cached for 60 s for the sidebar badge. `?fresh=1` (Re-run checks) bypasses the cache. The page is plain JS and
  writes all recorded text with `textContent`, so recorded data can't inject markup.
  The CSP forbids inline scripts and styles, so dynamic values (such as heat-map
  intensity) go through `element.style.setProperty`.
- **Dashboard lifecycle.** `worklog dashboard` pings `/api/ping`. Our server
  answers with its version, pid and data home. A matching server is reused; an
  older one (or one serving another data home) is replaced. Only a process that
  identified itself through that ping is ever stopped. On Windows the browser is
  opened with `rundll32 url.dll,FileProtocolHandler`, because `cmd /c start`
  would re-parse `&` in the URL.

## Roadmap

- [x] **Store and backfill**: ticket records, git and docs scan, queries, JSON mode, incremental sync
- [x] **Safety and redaction**: write allowlist, command allowlist, three-mode masking, static enforcement test
- [x] **Session capture**: hooks, raw event log, scheduler, `doctor`, config undo
- [x] **Summarisation**: background tick, budget-capped cited extraction, daily and per-item notes
- [x] **Skills**: `/worklog:` commands, recall and note skills, standup, handover, activity sheet, export
- [ ] **Search index and MCP**: local full-text index and a read-only MCP server for recall
- [ ] **Durations**: per-session time in the raw log (with a migration), so the sheet can show hours
- [x] **Dashboard**: local read-only web UI with today, days, tickets, search, activity and health
- [ ] **Enrichment**: Jira and Azure DevOps detail, a settings page on the dashboard
