import fs from 'node:fs';
import * as safety from './safety.mjs';
import { ensureWorklogDir, getIndexPath } from './config.mjs';
import { listTickets, readTicket } from './store.mjs';

export { getIndexPath };

export function buildIndex() {
  ensureWorklogDir();
  const rows = [];
  for (const key of listTickets()) {
    const t = readTicket(key);
    if (!t) continue;
    rows.push({
      key:           t.key,
      title:         t.title || '',
      status:        t.status || '',
      firstActive:   t.firstActive || null,
      lastActive:    t.lastActive || null,
      activeDates:   t.activeDates || [],
      commitCount:   t.commits?.length   || 0,
      docCount:      t.docs?.length      || 0,
      prCount:       t.prs?.length       || 0,
      findingCount:  t.findings?.length  || 0,
      decisionCount: t.decisions?.length || 0,
      sessionCount:  t.sessions?.length  || 0,
      hasRca:        !!t.rca
    });
  }
  rows.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));

  const index = {
    generatedAt: new Date().toISOString(),
    ticketCount: rows.filter((r) => r.key !== '_unassigned').length,
    tickets: rows,
    lastSync: {}  // repoName -> ISO date, populated by sync.mjs for incremental
  };

  // Preserve previously stored sync stamps so incremental scans keep working.
  const existing = loadIndex({ silent: true });
  if (existing?.lastSync) index.lastSync = existing.lastSync;
  if (existing?.lastDocsScan) index.lastDocsScan = existing.lastDocsScan;

  safety.writeFileAtomic(getIndexPath(), JSON.stringify(index, null, 2));
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
  safety.writeFileAtomic(getIndexPath(), JSON.stringify(idx, null, 2));
}
