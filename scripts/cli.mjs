import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getWorklogDir
} from './lib/config.mjs';
import { isValidKey } from './lib/keys.mjs';
import { readTicket, listTickets } from './lib/store.mjs';
import { syncGit, syncDocs } from './sync.mjs';
import { installPlugin } from './install.mjs';

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'install':      return installPlugin();
    case 'init':         return initCfg();
    case 'config':       return showConfig();
    case 'backfill':     return backfill(rest);
    case 'sync':         return backfill(rest);
    case 'list':         return listAll();
    case 'ticket':
    case 'show':         return showTicket(rest[0]);
    case 'help':
    case '--help':
    case '-h':
    case undefined:      return help();
    default:
      if (isValidKey(cmd) || cmd === '_unassigned') return showTicket(cmd);
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
  worklog list                      List all ticket keys with last-active date and title
  worklog <KEY>                     Show a ticket summary (e.g. worklog ESIN-4349)
  worklog ticket <KEY>              Same as above
  worklog help                      Show this help

Config:  ${getConfigPath()}
Data:    ${getWorklogDir()}

The ticket-key regex is  \\b[A-Z][A-Z0-9]+-\\d+\\b  . Leave keyPrefixes empty
in the config to accept any prefix, or set it to e.g. ["ESIN","OPP"].
`);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; } else { out[key] = true; }
    }
  }
  return out;
}

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
  console.log('git sync...');
  const g = await syncGit({ since: opts.since });
  console.log(`  commits:    ${g.commits}  unassigned: ${g.unassigned}`);
  for (const err of g.errors) console.log(`  warn: ${err}`);
  console.log('docs scan...');
  const d = await syncDocs();
  console.log(`  docs:       ${d.docs}`);
  for (const err of d.errors) console.log(`  warn: ${err}`);
  console.log('done.');
}

function showTicket(key) {
  if (!key) { console.error('Usage: worklog ticket <KEY>'); process.exit(1); }
  const t = readTicket(key);
  if (!t) { console.log(`No record found for ${key}. Try \`worklog backfill\` first.`); return; }

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
    for (const d of t.docs) console.log(`  ${d.path}`);
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

function listAll() {
  const keys = listTickets();
  if (!keys.length) {
    console.log('No tickets yet. Run `worklog backfill` once your config is set.');
    return;
  }
  for (const k of keys) {
    const t = readTicket(k);
    if (!t) continue;
    const last = (t.lastActive || '').padEnd(10);
    const title = (t.title || '').slice(0, 70);
    console.log(`${k.padEnd(14)}  ${last}  ${title}`);
  }
}
