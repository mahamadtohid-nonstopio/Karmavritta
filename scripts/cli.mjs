import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getWorklogDir
} from './lib/config.mjs';
import { isValidKey } from './lib/keys.mjs';
import { readTicket, listTickets, upsertTicket, addFinding } from './lib/store.mjs';
import { syncGit, syncDocs } from './sync.mjs';
import { installPlugin } from './install.mjs';
import { buildIndex, loadIndex } from './lib/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const json = !!flags.json;

  switch (cmd) {
    case 'install':      return installPlugin();
    case 'init':         return initCfg();
    case 'config':       return showConfig();
    case 'backfill':     return backfill(rest);
    case 'sync':         return backfill(rest);
    case 'list':         return listAll({ json });
    case 'month':        return showMonth(positional, { json });
    case 'recent':       return showRecent(positional, flags, { json });
    case 'search':       return searchAll(positional, { json });
    case 'stats':        return showStats({ json });
    case 'note':         return addNote(positional, flags);
    case 'open':         return openTicket(positional[0]);
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
  console.log(`worklog — per-ticket activity log (Phase 1)

Commands:
  worklog install                   Install the plugin into ~/.claude/plugins/worklog
  worklog init                      Create a default config at ~/.worklog/config.json
  worklog config                    Print current config and its path
  worklog backfill [--since DATE]   Scan configured repos + docs folders, build tickets
  worklog sync                      Alias for backfill (no --since)
  worklog list                      List tickets, sorted by last-active desc
  worklog recent [--days N]         Tickets active in the last N days (default 7)
  worklog month YYYY-MM             Tickets with activity in that month
  worklog search <text>             Grep across titles, commit messages, doc names, findings
  worklog stats                     Overall counts (tickets, commits, docs)
  worklog note --ticket <KEY> "..." Append a finding (--kind finding|hypothesis|ruled-out|decision|note)
  worklog open <KEY>                Open the ticket's most recent doc in VS Code
  worklog <KEY>                     Show a ticket summary (e.g. worklog ESIN-4349)
  worklog ticket <KEY>              Same as above
  worklog help                      Show this help

Most commands accept --json for machine-readable output
(list, month, recent, search, stats, ticket, <KEY>).

Config:  ${getConfigPath()}
Data:    ${getWorklogDir()}

The ticket-key regex is  \\b[A-Z][A-Z0-9]+-\\d+\\b  . Leave keyPrefixes empty
in the config to accept any prefix, or set it to e.g. ["ESIN","OPP"].
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

function openTicket(key) {
  if (!key) {
    console.error('Usage: worklog open <KEY>');
    process.exit(1);
  }
  const t = readTicket(key);
  if (!t) { console.error(`No record for ${key}.`); process.exit(1); }
  if (!t.docs?.length) { console.error(`${key} has no linked docs.`); process.exit(1); }

  const latest = [...t.docs].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))[0];
  const docPath = latest.path;
  console.log(`Opening ${docPath}`);

  // Try VS Code first; fall back to the OS default open.
  const trySpawn = (cmd, args) => new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => resolve(false));
    child.unref();
    setTimeout(() => resolve(true), 50);
  });

  (async () => {
    const codeOk = await trySpawn('code', [docPath]);
    if (codeOk) return;
    if (process.platform === 'win32') {
      await trySpawn('cmd', ['/c', 'start', '""', docPath]);
    } else if (process.platform === 'darwin') {
      await trySpawn('open', [docPath]);
    } else {
      await trySpawn('xdg-open', [docPath]);
    }
  })();
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
