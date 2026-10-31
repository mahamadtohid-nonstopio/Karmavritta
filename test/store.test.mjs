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
  await upsertTicket('DEMO-1', (t) => { t.title = 'first'; });
  let t = readTicket('DEMO-1');
  assert.equal(t.key, 'DEMO-1');
  assert.equal(t.title, 'first');

  await upsertTicket('DEMO-1', (t) => { t.title = 'second'; });
  t = readTicket('DEMO-1');
  assert.equal(t.title, 'second');
});

test('mergeCommit dedupes on sha+repo', async () => {
  await upsertTicket('DEMO-2', (t) => {
    mergeCommit(t, { sha: 'abc', repo: 'r', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
    mergeCommit(t, { sha: 'abc', repo: 'r', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
    mergeCommit(t, { sha: 'abc', repo: 'other', date: '2026-10-20T10:00:00+05:30', message: 'm', branch: 'b' });
  });
  const t = readTicket('DEMO-2');
  assert.equal(t.commits.length, 2);
  assert.deepEqual(t.repos.sort(), ['other', 'r']);
});

test('mergeDoc dedupes on absolute path and updates modified', async () => {
  await upsertTicket('DEMO-3', (t) => {
    mergeDoc(t, { path: 'C:\\docs\\DEMO-3.md', title: 't', created: '2026-10-20T00:00:00.000Z', modified: '2026-10-20T00:00:00.000Z' });
    mergeDoc(t, { path: 'C:\\docs\\DEMO-3.md', title: 't', created: '2026-10-20T00:00:00.000Z', modified: '2026-10-22T00:00:00.000Z' });
  });
  const t = readTicket('DEMO-3');
  assert.equal(t.docs.length, 1);
  assert.equal(t.docs[0].modified, '2026-10-22T00:00:00.000Z');
});

test('mergePR dedupes on id and overlays fields', async () => {
  await upsertTicket('DEMO-4', (t) => {
    mergePR(t, { id: 57301, status: 'active',   title: 'x', created: '2026-10-23' });
    mergePR(t, { id: 57301, status: 'completed' });
  });
  const t = readTicket('DEMO-4');
  assert.equal(t.prs.length, 1);
  assert.equal(t.prs[0].status, 'completed');
  assert.equal(t.prs[0].title, 'x');
});

test('touchDate maintains firstActive/lastActive/activeDates', async () => {
  await upsertTicket('DEMO-5', (t) => {
    touchDate(t, '2026-10-20T11:00:00+05:30');
    touchDate(t, '2026-10-24T09:00:00+05:30');
    touchDate(t, '2026-10-21T15:00:00+05:30');
    touchDate(t, '2026-10-20T18:00:00+05:30'); // dup day
  });
  const t = readTicket('DEMO-5');
  assert.equal(t.firstActive, '2026-10-20');
  assert.equal(t.lastActive,  '2026-10-24');
  assert.deepEqual(t.activeDates, ['2026-10-20', '2026-10-21', '2026-10-24']);
});

test('ignores malformed dates', async () => {
  await upsertTicket('DEMO-6', (t) => {
    touchDate(t, 'nonsense');
    touchDate(t, '');
    touchDate(t, null);
  });
  const t = readTicket('DEMO-6');
  assert.equal(t.firstActive, null);
  assert.equal(t.lastActive, null);
  assert.deepEqual(t.activeDates, []);
});

test('listTickets returns all written keys', async () => {
  await upsertTicket('DEMO-10', () => {});
  await upsertTicket('TASK-3', () => {});
  await upsertTicket('_unassigned', () => {});
  const keys = listTickets();
  assert.deepEqual(keys.sort(), ['DEMO-10', 'TASK-3', '_unassigned'].sort());
});

test('idempotent re-runs produce no duplicate commits (regression)', async () => {
  const commit = { sha: 'deadbeef', repo: 'repo-a', date: '2026-10-23T14:02:00+05:30', message: '[DEMO-11] fix', branch: 'DEMO-11/qa' };
  for (let i = 0; i < 3; i++) {
    await upsertTicket('DEMO-11', (t) => { mergeCommit(t, commit); });
  }
  const t = readTicket('DEMO-11');
  assert.equal(t.commits.length, 1);
  assert.deepEqual(t.repos, ['repo-a']);
  assert.deepEqual(t.branches, ['DEMO-11/qa']);
});
