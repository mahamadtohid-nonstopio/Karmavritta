import {
  loadConfig,
  saveConfig,
  ensureDataHome,
  getConfigPath,
  getWorklogDir
} from './lib/config.mjs';
import { isValidKey } from './lib/keys.mjs';
import { readTicket, listTickets, upsertTicket, addFinding } from './lib/store.mjs';
import { syncGit, syncDocs } from './sync.mjs';
import { installPlugin, refreshRuntime } from './install.mjs';
import { buildIndex, loadIndex } from './lib/index.mjs';
import * as safety from './lib/safety.mjs';
import * as configstore from './lib/configstore.mjs';
import * as scheduler from './lib/scheduler.mjs';
import { diagnose, formatReport } from './lib/doctor.mjs';
import { runTick, readDailyNote, readItemNote } from './lib/agent.mjs';
import { summary as spendSummary } from './lib/budget.mjs';
import { periodDays, activitySheet, sheetToCsv, sheetToText, exportItem } from './lib/report.mjs';
import { getExportsDir } from './lib/paths.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHandler, dashboardVersion } from './lib/dashboard.mjs';

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const json = !!flags.json;

  switch (cmd) {
    case 'install':      return installPlugin();
    case 'setup':        return setup(flags);
    case 'doctor':       return doctor({ json });
    case 'tick':         return tick(positional, flags, { json });
    case 'today':        return showDay(positional[0], { json });
    case 'day':          return showDay(positional[0], { json });
    case 'item':         return showItem(positional[0]);
    case 'schedule':     return schedule(flags);
    case 'unschedule':   return unschedule();
    case 'pause':        return setPaused(true);
    case 'resume':       return setPaused(false);
    case 'status':       return showStatus({ json });
    case 'init':         return initCfg();
    case 'config':       return configCmd(positional, { json });
    case 'backfill':     return backfill(rest);
    case 'sync':         return backfill(rest);
    case 'list':         return listAll({ json });
    case 'month':        return showMonth(positional, { json });
    case 'recent':       return showRecent(positional, flags, { json });
    case 'search':       return searchAll(positional, { json });
    case 'stats':        return showStats({ json });
    case 'note':         return addNote(positional, flags);
    case 'open':         return openTicket(positional[0]);
    case 'week':         return showSheet('week', flags, { json });
    case 'timesheet':    return showSheet(flags.month ? 'month' : 'week', flags, { json });
    case 'export':       return exportCmd(positional[0], flags);
    case 'dashboard':    return dashboardCmd(rest);
    case 'ticket':
    case 'show':         return showTicket(positional[0], { json });
    case 'help':
    case '--help':
    case '-h':
    case undefined:      return help();
    default:
      if (isValidKey(cmd) || cmd === '_unassigned') return showTicket(cmd, { json });
      console.error(`Unknown command: ${cmd}\n`);
      help();
      process.exit(1);
  }
}

function help() {
  console.log(`worklog — per-ticket activity log

Setup and health:
  worklog install                   Install the plugin into ~/.claude/plugins/worklog
  worklog setup [--interval N]      Create the data home and schedule the background tick
  worklog doctor                    Diagnose capture, tick, scheduler and budget
  worklog status                    One-line view of capture, last tick and spend
  worklog schedule [--interval N]   Register the tick with the OS scheduler
  worklog unschedule                Remove the scheduled tick
  worklog pause | resume            Stop or restart event capture

Captured work:
  worklog tick [--force] [DAY]      Summarise captured events into notes now
  worklog today [DAY]               Print the daily note
  worklog item <KEY>                Print the rolling note for one work item

Config:
  worklog init                      Create a default config at ~/.worklog/config.json
  worklog config                    Print current config and its path
  worklog config set <key> <value>  Change a setting (backed up first)
  worklog config get <key>          Read one setting
  worklog config undo               Revert the last config change
  worklog config history            List recorded config changes

Backfill and query:
  worklog backfill [--since DATE]   Scan configured repos + docs folders, build tickets
  worklog sync                      Alias for backfill (no --since)
  worklog list                      List tickets, sorted by last-active desc
  worklog recent [--days N]         Tickets active in the last N days (default 7)
  worklog month YYYY-MM             Tickets with activity in that month
  worklog search <text>             Grep across titles, commit messages, doc names, findings
  worklog stats                     Overall counts (tickets, commits, docs)
  worklog note --ticket <KEY> "..." Append a finding (--kind finding|hypothesis|ruled-out|decision|note)
  worklog week [--date D] [--csv]   Activity per item per day for the ISO week (events, not hours)
  worklog timesheet [--month] ...   Same sheet; --month for the calendar month
  worklog export <KEY> [--format md|html] [--out FILE]
                                    Write a public-redacted copy of the item note to exports/
  worklog dashboard [page] [--port N] [--no-open]
                                    Open the local read-only dashboard (starts it if needed).
                                    page: today | day <D|yesterday|-N> | ticket <KEY> | tickets |
                                          rcas [words] | search <words> | activity | month | health
  worklog dashboard status|stop     Is it running? / stop it
  worklog open <KEY>                Open the ticket's most recent doc in VS Code
  worklog <KEY>                     Show a ticket summary (e.g. worklog DEMO-4349)
  worklog ticket <KEY>              Same as above
  worklog help                      Show this help

Most commands accept --json for machine-readable output
(list, month, recent, search, stats, ticket, <KEY>).

Config:  ${getConfigPath()}
Data:    ${getWorklogDir()}

The ticket-key regex is  \\b[A-Z][A-Z0-9]+-\\d+\\b  . Leave keyPrefixes empty
in the config to accept any prefix, or set it to e.g. ["DEMO","TASK"].
`);
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else { flags[key] = true; }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function parseFlags(args) { return parseArgs(args).flags; }

function initCfg() {
  const cfg = loadConfig();
  console.log(`Config at: ${getConfigPath()}`);
  console.log(JSON.stringify(cfg, null, 2));
  console.log('\nEdit the file to add repos (full paths) and docsFolders.');
  console.log('Leave keyPrefixes empty to capture every PROJ-123 style key.');
}

function showConfig() {
  const cfg = loadConfig();
  console.log(`Config path: ${getConfigPath()}`);
  console.log(`Data dir:    ${getWorklogDir()}\n`);
  console.log(JSON.stringify(cfg, null, 2));
}

async function configCmd(positional, { json } = {}) {
  const [sub, ...rest] = positional;
  switch (sub) {
    case undefined: return showConfig();
    case 'get': {
      if (!rest[0]) { console.error('Usage: worklog config get <dotted.key>'); process.exit(1); }
      const value = configstore.getValue(rest[0]);
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      return;
    }
    case 'set': {
      const [key, ...valueParts] = rest;
      if (!key || !valueParts.length) {
        console.error('Usage: worklog config set <dotted.key> <value>');
        process.exit(1);
      }
      try {
        await configstore.setValue(key, valueParts.join(' '));
        console.log(`✓ ${key} = ${JSON.stringify(configstore.getValue(key))}`);
        console.log('  (previous value backed up — `worklog config undo` reverts it)');
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
      return;
    }
    case 'undo': {
      const r = await configstore.undo();
      console.log(r.restored ? `✓ restored ${r.restored}` : `Nothing to undo: ${r.reason}`);
      return;
    }
    case 'history': {
      const entries = configstore.history();
      if (json) { console.log(JSON.stringify(entries, null, 2)); return; }
      if (!entries.length) { console.log('No config changes recorded yet.'); return; }
      for (const e of entries.slice(-25)) console.log(`${e.ts}  ${e.reason}`);
      return;
    }
    default:
      console.error(`Unknown config subcommand: ${sub}\nTry: get, set, undo, history`);
      process.exit(1);
  }
}

async function setup(flags) {
  ensureDataHome();
  loadConfig();
  console.log(`Data home: ${getWorklogDir()}`);
  console.log(`Config:    ${getConfigPath()}`);

  console.log(`Runtime:   ${refreshRuntime()}  (the scheduled tick runs from this copy)`);

  const interval = Number(flags.interval ?? 5);
  const s = scheduler.install(interval);
  console.log(s.ok
    ? `✓ tick scheduled via ${s.kind} every ${s.intervalMinutes} min`
    : `! could not schedule the tick (${s.kind}): ${s.detail}`);

  console.log('');
  console.log('Restart Claude Code so the hooks load, then run `worklog doctor`.');
}

function doctor({ json } = {}) {
  const report = diagnose();
  if (json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(formatReport(report));
  if (!report.healthy) process.exitCode = 1;
}

function schedule(flags) {
  const s = scheduler.install(Number(flags.interval ?? 5));
  console.log(s.ok
    ? `✓ ${s.kind}: tick runs every ${s.intervalMinutes} min\n  ${s.detail}`
    : `✗ could not schedule (${s.kind}): ${s.detail}`);
  if (!s.ok) process.exitCode = 1;
}

function unschedule() {
  const r = scheduler.remove();
  console.log(r.ok ? `✓ scheduled tick ${r.detail}` : `✗ ${r.detail}`);
  if (!r.ok) process.exitCode = 1;
}

async function setPaused(paused) {
  await configstore.setValue('capture.paused', paused ? 'true' : 'false');
  console.log(paused
    ? '✓ capture paused — hooks stay loaded but record nothing'
    : '✓ capture resumed');
}

async function tick(positional, flags, { json } = {}) {
  const days = positional.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const r = await runTick({ force: !!flags.force, days: days.length ? days : null });
  if (json) { console.log(JSON.stringify(r, null, 2)); return; }
  if (r.skipped) { console.log(`Skipped: ${r.skipped}`); return; }
  if (r.error)   { console.log(`Failed: ${r.error}`); process.exitCode = 1; return; }
  console.log(`✓ ${r.days.length} day(s) processed, ${r.items} item-day(s) summarised`);
  console.log(`  ${r.modelCalls} model call(s), ${r.notesWritten} note(s) written, ${r.ms}ms`);
  if (r.pruned) console.log(`  ${r.pruned} raw day(s) pruned`);
  if (r.droppedClaims) console.log(`  ${r.droppedClaims} uncited claim(s) dropped`);
  for (const reason of r.reasons) console.log(`  note: ${reason}`);
}

function showDay(day, { json } = {}) {
  const target = day || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    console.error('Usage: worklog today [YYYY-MM-DD]');
    process.exit(1);
  }
  const note = readDailyNote(target);
  if (json) { console.log(JSON.stringify({ day: target, note }, null, 2)); return; }
  if (!note) {
    console.log(`No note for ${target} yet. Run \`worklog tick\` after some activity.`);
    return;
  }
  console.log(note);
}

function showItem(key) {
  if (!key) { console.error('Usage: worklog item <KEY>'); process.exit(1); }
  const note = readItemNote(key);
  if (!note) {
    console.log(`No note for ${key} yet. Run \`worklog tick\` first.`);
    return;
  }
  console.log(note);
}

function showStatus({ json } = {}) {
  const cfg = loadConfig();
  const s = scheduler.status();
  const spend = spendSummary();
  const report = diagnose();
  const state = { capture: cfg.capture?.paused ? 'paused' : cfg.capture?.enabled ? 'on' : 'off' };
  const lastTick = report.checks.find((c) => c.name === 'last tick')?.detail || 'never';
  const capture = report.checks.find((c) => c.name === 'capture')?.detail || 'nothing yet';

  if (json) {
    console.log(JSON.stringify({
      capture: state.capture, scheduled: s.installed, scheduler: s.kind,
      lastTick, events: capture, spend, healthy: report.healthy
    }, null, 2));
    return;
  }
  console.log('');
  console.log(`Capture:   ${state.capture} (${capture})`);
  console.log(`Schedule:  ${s.installed ? `${s.kind}, active` : `${s.kind}, not scheduled`}`);
  console.log(`Last tick: ${lastTick}`);
  console.log(`Spend:     ${spend.calls} model call(s), $${spend.usd.toFixed(3)} today`);
  console.log(`Health:    ${report.counts.ok} ok, ${report.counts.warn} warning, ${report.counts.fail} failing`);
  console.log('');
}

async function backfill(args) {
  const opts = parseFlags(args);
  const cfg = loadConfig();
  if (cfg.repos.length === 0 && cfg.docsFolders.length === 0) {
    console.log('No repos or docsFolders configured yet.');
    console.log(`Edit ${getConfigPath()} and try again.`);
    return;
  }
  const onProgress = (msg) => console.log(msg);
  console.log('git sync...');
  const g = await syncGit({ since: opts.since, onProgress });
  console.log(`  commits:    ${g.commits}  unassigned: ${g.unassigned}`);
  for (const err of g.errors) console.log(`  warn: ${err}`);
  console.log('docs scan...');
  const d = await syncDocs({ onProgress });
  const skipNote = d.skipped ? `, skipped ${d.skipped} unchanged` : '';
  const missNote = d.missing ? `, ${d.missing} marked missing` : '';
  console.log(`  docs:       ${d.docs}${skipNote}${missNote}`);
  for (const err of d.errors) console.log(`  warn: ${err}`);
  console.log('rebuilding index...');
  const idx = buildIndex();
  console.log(`  ${idx.ticketCount} ticket${idx.ticketCount === 1 ? '' : 's'} indexed`);
  console.log('done.');
}

function showTicket(key, { json } = {}) {
  if (!key) { console.error('Usage: worklog ticket <KEY>'); process.exit(1); }
  const t = readTicket(key);
  if (!t) {
    if (json) { console.log(JSON.stringify({ key, found: false }, null, 2)); return; }
    console.log(`No record found for ${key}. Try \`worklog backfill\` first.`);
    return;
  }
  if (json) { console.log(JSON.stringify(t, null, 2)); return; }

  const head = t.title ? `${t.key} — ${t.title}` : t.key;
  console.log('');
  console.log(head);
  console.log('-'.repeat(Math.min(head.length, 80)));
  if (t.status) console.log(`Status:   ${t.status}`);
  if (t.firstActive || t.lastActive) {
    console.log(`Active:   ${t.firstActive || '?'} → ${t.lastActive || '?'}  (${t.activeDates.length} day${t.activeDates.length === 1 ? '' : 's'})`);
  }
  if (t.repos.length) console.log(`Repos:    ${t.repos.join(', ')}`);
  if (t.branches.length) console.log(`Branches: ${t.branches.join(', ')}`);
  if (t.jiraUrl) console.log(`Jira:     ${t.jiraUrl}`);

  if (t.commits.length) {
    console.log(`\nCommits (${t.commits.length}):`);
    const sorted = [...t.commits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const c of sorted.slice(0, 20)) {
      const sha = (c.sha || '').slice(0, 9);
      const date = (c.date || '').slice(0, 10);
      console.log(`  ${sha}  ${date}  [${c.repo}]  ${c.message}`);
    }
    if (sorted.length > 20) console.log(`  ... and ${sorted.length - 20} more`);
  }

  if (t.prs.length) {
    console.log(`\nPRs (${t.prs.length}):`);
    for (const p of t.prs) {
      console.log(`  #${p.id} [${p.status || '?'}]  ${p.title || ''}  ${p.url || ''}`);
    }
  }

  if (t.docs.length) {
    console.log(`\nDocs (${t.docs.length}):`);
    const docsSorted = [...t.docs].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    for (const d of docsSorted) console.log(`  ${d.path}`);
  }

  if (t.findings.length) {
    console.log(`\nFindings (${t.findings.length}):`);
    for (const f of t.findings.slice(-10)) console.log(`  [${f.date}] (${f.kind}) ${f.text}`);
  }

  if (t.rca) {
    console.log('\nRCA:');
    if (t.rca.symptom)   console.log(`  Symptom:    ${t.rca.symptom}`);
    if (t.rca.rootCause) console.log(`  Root cause: ${t.rca.rootCause}`);
    if (t.rca.fix)       console.log(`  Fix:        ${t.rca.fix}`);
  }

  console.log('');
}

function indexRows() {
  const idx = loadIndex({ silent: true });
  if (idx?.tickets) return idx.tickets;
  // Fallback: no index yet — build summaries from ticket files.
  return listTickets().map((k) => {
    const t = readTicket(k); if (!t) return null;
    return {
      key: t.key, title: t.title || '', status: t.status || '',
      firstActive: t.firstActive, lastActive: t.lastActive,
      activeDates: t.activeDates || [],
      commitCount: t.commits.length, docCount: t.docs.length,
      prCount: t.prs.length, findingCount: t.findings.length, hasRca: !!t.rca
    };
  }).filter(Boolean);
}

function printTicketTable(rows) {
  if (!rows.length) { console.log('(none)'); return; }
  console.log(`${'KEY'.padEnd(14)}  ${'LAST'.padEnd(10)}  ${'C'.padStart(3)} ${'D'.padStart(3)}  TITLE`);
  for (const t of rows) {
    const last = (t.lastActive || '').padEnd(10);
    const title = (t.title || '').slice(0, 60);
    const c = String(t.commitCount ?? t.commits?.length ?? 0).padStart(3);
    const d = String(t.docCount    ?? t.docs?.length    ?? 0).padStart(3);
    console.log(`${t.key.padEnd(14)}  ${last}  ${c} ${d}  ${title}`);
  }
}

function listAll({ json } = {}) {
  const rows = indexRows().sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) {
    console.log('No tickets yet. Run `worklog backfill` once your config is set.');
    return;
  }
  printTicketTable(rows);
}

function showMonth(args, { json } = {}) {
  const month = args[0];
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: worklog month YYYY-MM   (e.g. worklog month 2026-08)');
    process.exit(1);
  }
  const rows = indexRows()
    .filter((t) => (t.activeDates || []).some((d) => d.startsWith(month)))
    .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
  if (json) { console.log(JSON.stringify({ month, count: rows.length, tickets: rows }, null, 2)); return; }
  console.log(`\nTickets active in ${month}: ${rows.length}\n`);
  printTicketTable(rows);
}

function showRecent(args, flags, { json } = {}) {
  const days = Number(flags.days ?? 7);
  if (!Number.isFinite(days) || days < 1) {
    console.error('Usage: worklog recent [--days N]   (N must be a positive integer)');
    process.exit(1);
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = indexRows()
    .filter((t) => (t.lastActive || '') >= cutoff)
    .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
  if (json) { console.log(JSON.stringify({ sinceDate: cutoff, days, count: rows.length, tickets: rows }, null, 2)); return; }
  console.log(`\nTickets active since ${cutoff} (${days} day${days === 1 ? '' : 's'}): ${rows.length}\n`);
  printTicketTable(rows);
}

function searchAll(args, { json } = {}) {
  const needle = args.join(' ').trim();
  if (!needle) {
    console.error('Usage: worklog search <text>');
    process.exit(1);
  }
  const n = needle.toLowerCase();
  const hits = [];
  // Search needs full ticket data (commit messages, finding text) — fall back to the files.
  for (const key of listTickets()) {
    const t = readTicket(key);
    if (!t) continue;
    const matches = [];
    if ((t.title || '').toLowerCase().includes(n)) matches.push(`title: ${t.title}`);
    for (const c of t.commits || []) {
      if ((c.message || '').toLowerCase().includes(n)) {
        matches.push(`commit ${c.sha?.slice(0, 9)}: ${c.message}`);
      }
    }
    for (const d of t.docs || []) {
      if ((d.path || '').toLowerCase().includes(n) || (d.title || '').toLowerCase().includes(n)) {
        matches.push(`doc: ${d.path}`);
      }
    }
    for (const f of t.findings || []) {
      if ((f.text || '').toLowerCase().includes(n)) matches.push(`finding [${f.date}]: ${f.text}`);
    }
    if (matches.length) hits.push({ ticket: t, matches });
  }
  if (json) {
    console.log(JSON.stringify({
      needle,
      count: hits.length,
      hits: hits.map(h => ({ key: h.ticket.key, title: h.ticket.title, matches: h.matches }))
    }, null, 2));
    return;
  }
  if (!hits.length) { console.log(`No matches for "${needle}".`); return; }
  console.log(`\n${hits.length} ticket${hits.length === 1 ? '' : 's'} match "${needle}":\n`);
  for (const { ticket, matches } of hits) {
    console.log(`${ticket.key} — ${ticket.title || ''}`);
    for (const m of matches.slice(0, 5)) console.log(`  · ${m}`);
    if (matches.length > 5) console.log(`  · ... and ${matches.length - 5} more match${matches.length - 5 === 1 ? '' : 'es'}`);
    console.log('');
  }
}

async function addNote(positional, flags) {
  const text = positional.join(' ').trim();
  const key = flags.ticket;
  const kind = flags.kind || 'finding';
  if (!text) {
    console.error('Usage: worklog note --ticket <KEY> [--kind finding|hypothesis|ruled-out|decision|note] "<text>"');
    process.exit(1);
  }
  if (!key || (!isValidKey(key) && key !== '_unassigned')) {
    console.error(`--ticket <KEY> is required. Expected PROJ-123 format, got ${key ?? '(nothing)'}`);
    process.exit(1);
  }
  const allowedKinds = ['finding', 'hypothesis', 'ruled-out', 'decision', 'note'];
  if (!allowedKinds.includes(kind)) {
    console.error(`--kind must be one of: ${allowedKinds.join(', ')}`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  await upsertTicket(key, (t) => {
    addFinding(t, { date: today, kind, text, source: 'cli' });
  });
  buildIndex();
  console.log(`✓ ${key}: ${kind} added (${text.slice(0, 60)}${text.length > 60 ? '...' : ''})`);
}

async function openTicket(key) {
  if (!key) {
    console.error('Usage: worklog open <KEY>');
    process.exit(1);
  }
  const t = readTicket(key);
  if (!t) { console.error(`No record for ${key}.`); process.exit(1); }
  if (!t.docs?.length) { console.error(`${key} has no linked docs.`); process.exit(1); }

  const latest = [...t.docs].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))[0];
  console.log(`Opening ${latest.path}`);
  await safety.openExternal(latest.path);
}

function showStats({ json } = {}) {
  const tickets = indexRows();
  const realTickets = tickets.filter((t) => t.key !== '_unassigned');
  const totalCommits = tickets.reduce((n, t) => n + (t.commitCount || 0), 0);
  const totalDocs    = tickets.reduce((n, t) => n + (t.docCount    || 0), 0);
  const unassigned   = tickets.find((t) => t.key === '_unassigned');
  const dateSet = new Set();
  for (const t of realTickets) for (const d of (t.activeDates || [])) dateSet.add(d);
  const dates = [...dateSet].sort();

  if (json) {
    console.log(JSON.stringify({
      tickets: realTickets.length,
      commits: totalCommits,
      docs: totalDocs,
      unassigned: unassigned ? { commits: unassigned.commitCount, docs: unassigned.docCount } : null,
      activeRange: dates.length ? { from: dates[0], to: dates.at(-1), days: dates.length } : null
    }, null, 2));
    return;
  }

  console.log('');
  console.log(`Tickets:           ${realTickets.length}`);
  console.log(`Commits:           ${totalCommits}`);
  console.log(`Docs:              ${totalDocs}`);
  console.log(`Unassigned bucket: ${unassigned ? `${unassigned.commitCount} commits, ${unassigned.docCount} docs` : '0'}`);
  if (dates.length) {
    console.log(`Active range:      ${dates[0]} → ${dates.at(-1)}  (${dates.length} day${dates.length === 1 ? '' : 's'})`);
  }
  console.log('');
}

function showSheet(period, flags, { json } = {}) {
  const day = typeof flags.date === 'string' ? flags.date : new Date().toISOString().slice(0, 10);
  let days;
  try { days = periodDays(day, period); } catch (e) {
    console.error(`${e.message}
Usage: worklog ${period === 'month' ? 'timesheet --month' : 'week'} [--date YYYY-MM-DD] [--csv] [--json]`);
    process.exit(1);
  }
  const tickets = listTickets().map((k) => readTicket(k)).filter(Boolean);
  const sheet = activitySheet(tickets, days);
  if (json) { console.log(JSON.stringify({ period, unit: 'events', ...sheet }, null, 2)); return; }
  if (flags.csv) { console.log(sheetToCsv(sheet)); return; }
  console.log(sheetToText(sheet));
}

async function exportCmd(key, flags) {
  if (!key) { console.error('Usage: worklog export <KEY> [--format md|html] [--out FILE]'); process.exit(1); }
  const t = readTicket(key);
  if (!t) { console.error(`No record for ${key}.`); process.exit(1); }
  const format = typeof flags.format === 'string' ? flags.format : 'md';
  const today = new Date().toISOString().slice(0, 10);
  let result;
  try { result = exportItem(t, loadConfig(), { format, exportedOn: today }); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const target = typeof flags.out === 'string'
    ? path.resolve(flags.out)
    : path.join(getExportsDir(), `${key}-${today}.${format}`);
  // safety refuses anything outside the write allowlist (data home, plugin dir, temp).
  try { safety.writeFileAtomic(target, result.content); } catch (e) {
    console.error(`Not written: ${e.message}`); process.exit(1);
  }
  console.log(`✓ exported ${key} → ${target}`);
  console.log(result.masked.length
    ? `  masked (public redaction): ${result.masked.join(', ')}`
    : '  nothing needed masking (public redaction applied)');
}

// --- dashboard -----------------------------------------------------------------

const DEFAULT_DASHBOARD_PORT = 7341;
const CLI_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'worklog.mjs');
const dashboardStatePath = () => path.join(getWorklogDir(), 'dashboard.json');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function localToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Map `worklog dashboard <page…>` to a hash route. Returns { route } or { error }. */
export function dashboardRoute(words = []) {
  const [page = 'today', ...rest] = words;
  const arg = rest.join(' ').trim();
  switch (page.toLowerCase()) {
    case 'today': return { route: '#/' };
    case 'yesterday': return { route: `#/day/${localToday(-1)}` };
    case 'day': {
      const v = (arg || 'today').toLowerCase();
      let day = null;
      if (v === 'today') day = localToday();
      else if (v === 'yesterday') day = localToday(-1);
      else if (/^-\d{1,4}$/.test(v)) day = localToday(Number(v));
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) day = v;
      return day ? { route: `#/day/${day}` } : { error: `Not a day: ${arg}. Use YYYY-MM-DD, today, yesterday or -N.` };
    }
    case 'ticket': case 'item': {
      const key = arg.toUpperCase();
      return isValidKey(key) ? { route: `#/ticket/${key}` } : { error: `Not a ticket key: ${arg || '(nothing)'}` };
    }
    case 'search': return { route: arg ? `#/search?q=${encodeURIComponent(arg)}` : '#/search' };
    case 'tickets': return { route: '#/tickets' };
    case 'rca': case 'rcas': return { route: arg ? `#/rcas?q=${encodeURIComponent(arg)}` : '#/rcas' };
    case 'activity': case 'week': case 'timesheet': return { route: '#/activity' };
    case 'month': return { route: '#/activity?period=month' };
    case 'health': case 'doctor': return { route: '#/health' };
    default: {
      const key = page.toUpperCase();
      if (isValidKey(key)) return { route: `#/ticket/${key}` };
      return { error: `Unknown page: ${page}. Try today, day <D>, ticket <KEY>, tickets, rcas [words], search <words>, activity, month or health.` };
    }
  }
}

function parseDashboardArgs(args) {
  const out = { words: [], port: DEFAULT_DASHBOARD_PORT, open: true, json: false, error: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-open') out.open = false;
    else if (a === '--json') out.json = true;
    else if (a === '--port') {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) out.error = `--port must be 1-65535, got ${args[i] ?? '(nothing)'}`;
      else out.port = n;
    } else out.words.push(a);
  }
  return out;
}

async function pingDashboard(port) {
  const r = await safety.probeLocal(port, '/api/ping');
  if (!r) return { state: 'free' };
  if (r.json?.app === 'worklog') return { state: 'worklog', info: r.json };
  return { state: 'foreign' };
}

async function waitFor(port, wanted, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const p = await pingDashboard(port);
    if (wanted(p)) return p;
    await pause(150);
  }
  return null;
}

/** Make sure our dashboard, for this data home and this version, answers on `port`. */
async function ensureDashboard(port) {
  const here = getWorklogDir();
  let p = await pingDashboard(port);
  if (p.state === 'foreign') return { error: `Port ${port} is held by another program. Try --port <other>.` };
  if (p.state === 'worklog') {
    if (p.info.version === dashboardVersion() && path.resolve(p.info.dataHome || '') === path.resolve(here)) {
      return { port, reused: true, pid: p.info.pid };
    }
    // An older copy, or one serving another data home: replace it.
    if (p.info.pid) safety.stopProcess(p.info.pid);
    if (!(await waitFor(port, (x) => x.state === 'free', 5000))) {
      return { error: `An older dashboard on port ${port} did not stop. Run \`worklog dashboard stop\` and try again.` };
    }
  }
  const pid = safety.spawnBackground(process.execPath, [CLI_BIN, 'dashboard', 'serve', '--port', String(port)], { env: { WORKLOG_DIR: here } });
  if (!pid) return { error: 'Could not start the dashboard process.' };
  p = await waitFor(port, (x) => x.state !== 'free');
  if (!p) return { error: `The dashboard did not start on port ${port}. Try \`worklog dashboard serve --port ${port}\` to see why.` };
  if (p.state === 'foreign') return { error: `Port ${port} is held by another program. Try --port <other>.` };
  return { port, reused: false, pid: p.info.pid };
}

async function serveDashboard(port) {
  const ctx = { pid: process.pid };
  let srv;
  try {
    srv = await safety.serveLocal(createHandler(ctx), { port });
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use by another program.` : `Could not start: ${e.message}`);
    process.exit(1);
  }
  ctx.port = srv.port;
  try {
    safety.writeJsonAtomic(dashboardStatePath(), {
      pid: process.pid, port: srv.port, version: dashboardVersion(), startedAt: new Date().toISOString()
    });
  } catch { /* the state file is a convenience; the ping is the source of truth */ }
  console.log(`Worklog dashboard on http://127.0.0.1:${srv.port}/  (Ctrl+C to stop)`);
  const shutdown = async () => {
    try {
      const st = JSON.parse(fs.readFileSync(dashboardStatePath(), 'utf8'));
      if (st.pid === process.pid) safety.removePath(dashboardStatePath());
    } catch {}
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function statePort(fallback) {
  try { return JSON.parse(fs.readFileSync(dashboardStatePath(), 'utf8')).port || fallback; } catch { return fallback; }
}

async function dashboardCmd(rawArgs) {
  const a = parseDashboardArgs(rawArgs);
  if (a.error) { console.error(a.error); process.exit(1); }
  const sub = a.words[0];
  const explicitPort = rawArgs.includes('--port');

  if (sub === 'serve') return serveDashboard(a.port);

  if (sub === 'status') {
    const port = explicitPort ? a.port : statePort(a.port);
    const p = await pingDashboard(port);
    const res = p.state === 'worklog'
      ? { running: true, url: `http://127.0.0.1:${port}/`, pid: p.info.pid, version: p.info.version, dataHome: p.info.dataHome }
      : { running: false, port, portHeldByOther: p.state === 'foreign' };
    if (a.json) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(res.running
      ? `Running: ${res.url}  (pid ${res.pid}, v${res.version})`
      : `Not running on port ${port}${res.portHeldByOther ? ' (another program holds that port)' : ''}. Start it with \`worklog dashboard\`.`);
    return;
  }

  if (sub === 'stop') {
    const port = explicitPort ? a.port : statePort(a.port);
    const p = await pingDashboard(port);
    if (p.state !== 'worklog') { console.log(`No Worklog dashboard is running on port ${port}.`); return; }
    // Only a process that answered our own ping with its pid is ever stopped.
    safety.stopProcess(p.info.pid);
    const gone = await waitFor(port, (x) => x.state === 'free', 5000);
    try { if (fs.existsSync(dashboardStatePath())) safety.removePath(dashboardStatePath()); } catch {}
    console.log(gone ? `✓ dashboard stopped (pid ${p.info.pid})` : `! asked pid ${p.info.pid} to stop, but port ${port} still answers`);
    if (!gone) process.exitCode = 1;
    return;
  }

  const r = dashboardRoute(a.words);
  if (r.error) { console.error(r.error); process.exit(1); }
  const port = explicitPort ? a.port : statePort(a.port);
  const s = await ensureDashboard(port);
  if (s.error) { console.error(s.error); process.exit(1); }
  const url = `http://127.0.0.1:${s.port}/${r.route}`;
  if (a.json) console.log(JSON.stringify({ url, reused: s.reused, pid: s.pid }, null, 2));
  else {
    console.log(`${s.reused ? 'Dashboard already running' : '✓ dashboard started'} (pid ${s.pid}, local only)`);
    console.log(url);
  }
  if (a.open) {
    const opened = await safety.openBrowser(url);
    if (!opened && !a.json) console.log('  (could not open a browser; open the address above yourself)');
  }
}
