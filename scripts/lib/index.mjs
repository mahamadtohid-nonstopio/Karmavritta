import fs from 'node:fs';
import path from 'node:path';
import { getWorklogDir, ensureWorklogDir } from './config.mjs';
import { listTickets, readTicket } from './store.mjs';

export function getIndexPath() {
  return path.join(getWorklogDir(), 'index.json');
}

export function buildIndex() {
  ensureWorklogDir();
  const rows = [];
  for (const key of listTickets()) {
    const t = readTicket(key);
    if (!t) continue;
    rows.push({
      key:          t.key,
      title:        t.title || '',
      status:       t.status || '',
      firstActive:  t.firstActive || null,
      lastActive:   t.lastActive || null,
      activeDates:  t.activeDates || [],
      commitCount:  t.commits?.length || 0,
      docCount:     t.docs?.length || 0,
      prCount:      t.prs?.length || 0,
      findingCount: t.findings?.length || 0,
      hasRca:       !!t.rca
    });
  }
  rows.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));

  const index = {
    generatedAt: new Date().toISOString(),
    ticketCount: rows.filter((r) => r.key !== '_unassigned').length,
    tickets: rows,
    lastSync: {}  // repoName -> ISO date, populated by sync.mjs for incremental
  };

  // Preserve previously stored lastSync so incremental sync keeps working.
  const existing = loadIndex({ silent: true });
  if (existing?.lastSync) index.lastSync = existing.lastSync;

  const tmp = `${getIndexPath()}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, getIndexPath());
  return index;
}

export function loadIndex({ silent = false } = {}) {
  const p = getIndexPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (!silent) throw e;
    return null;
  }
}

export function updateLastSync(repoName, iso) {
  const idx = loadIndex({ silent: true }) || {
    generatedAt: new Date().toISOString(), ticketCount: 0, tickets: [], lastSync: {}
  };
  idx.lastSync = idx.lastSync || {};
  idx.lastSync[repoName] = iso;
  const tmp = `${getIndexPath()}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, getIndexPath());
}
