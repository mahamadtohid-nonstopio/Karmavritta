import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate the store to a temp dir before importing it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-test-'));
process.env.WORKLOG_DIR = TMP;

const store = await import('../scripts/lib/store.mjs');
const { upsertTicket, readTicket, newTicket, mergeCommit, mergeDoc, mergePR, touchDate, listTickets } = store;

function wipeTickets() {
  const dir = path.join(TMP, 'tickets');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}

beforeEach(() => wipeTickets());

test('upsertTicket creates then updates a ticket', async () => {
  await upsertTicket('ESIN-1', (t) => { t.title = 'first'; });
  let t = readTicket('ESIN-1');
  assert.equal(t.key, 'ESIN-1');
  assert.equal(t.title, 'first');

  await upsertTicket('ESIN-1', (t) => { t.title = 'second'; });
  t = readTicket('ESIN-1');
  assert.equal(t.title, 'second');
});

test('mergeCommit dedupes on sha+repo', async () => {
  await upsertTicket('ESIN-2', (t) => {
    mergeCommit(t, { sha: 'abc', repo: 'r', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
    mergeCommit(t, { sha: 'abc', repo: 'r', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
    mergeCommit(t, { sha: 'abc', repo: 'other', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
  });
  const t = readTicket('ESIN-2');
  assert.equal(t.commits.length, 2);
  assert.deepEqual(t.repos.sort(), ['other', 'r']);
});

test('mergeDoc dedupes on absolute path and updates modified', async () => {
  await upsertTicket('ESIN-3', (t) => {
    mergeDoc(t, { path: 'C:\\docs\\ESIN-3.md', title: 't', created: '2026-10-20T00:00:00.000Z', modified: '2026-10-20T00:00:00.000Z' });
    mergeDoc(t, { path: 'C:\\docs\\ESIN-3.md', title: 't', created: '2026-10-20T00:00:00.000Z', modified: '2026-10-22T00:00:00.000Z' });
  });
  const t = readTicket('ESIN-3');
  assert.equal(t.docs.length, 1);
  assert.equal(t.docs[0].modified, '2026-10-22T00:00:00.000Z');
});

test('mergePR dedupes on id and overlays fields', async () => {
  await upsertTicket('ESIN-4', (t) => {
    mergePR(t, { id: 57301, status: 'active',   title: 'x', created: '2026-10-23' });
    mergePR(t, { id: 57301, status: 'completed' });
  });
  const t = readTicket('ESIN-4');
  assert.equal(t.prs.length, 1);
  assert.equal(t.prs[0].status, 'completed');
  assert.equal(t.prs[0].title, 'x');
});

test('touchDate maintains firstActive/lastActive/activeDates', async () => {
  await upsertTicket('ESIN-5', (t) => {
    touchDate(t, '2026-10-20T11:00:00+05:30');
    touchDate(t, '2026-10-24T09:00:00+05:30');
    touchDate(t, '2026-10-21T15:00:00+05:30');
    touchDate(t, '2026-10-20T18:00:00+05:30'); // dup day
  });
  const t = readTicket('ESIN-5');
  assert.equal(t.firstActive, '2026-10-20');
  assert.equal(t.lastActive,  '2026-10-24');
  assert.deepEqual(t.activeDates, ['2026-10-20', '2026-10-21', '2026-10-24']);
});

test('ignores malformed dates', async () => {
  await upsertTicket('ESIN-6', (t) => {
    touchDate(t, 'nonsense');
    touchDate(t, '');
    touchDate(t, null);
  });
  const t = readTicket('ESIN-6');
  assert.equal(t.firstActive, null);
  assert.equal(t.lastActive, null);
  assert.deepEqual(t.activeDates, []);
});

test('listTickets returns all written keys', async () => {
  await upsertTicket('ESIN-10', () => {});
  await upsertTicket('OPP-3', () => {});
  await upsertTicket('_unassigned', () => {});
  const keys = listTickets();
  assert.deepEqual(keys.sort(), ['ESIN-10', 'OPP-3', '_unassigned'].sort());
});

test('idempotent re-runs produce no duplicate commits (regression)', async () => {
  const commit = { sha: 'deadbeef', repo: 'repo-a', date: '2026-10-23T14:02:00+05:30', message: '[ESIN-11] fix', branch: 'ESIN-11/qa' };
  for (let i = 0; i < 3; i++) {
    await upsertTicket('ESIN-11', (t) => { mergeCommit(t, commit); });
  }
  const t = readTicket('ESIN-11');
  assert.equal(t.commits.length, 1);
  assert.deepEqual(t.repos, ['repo-a']);
  assert.deepEqual(t.branches, ['ESIN-11/qa']);
});
