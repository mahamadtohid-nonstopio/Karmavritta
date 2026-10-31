import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  periodDays, activitySheet, sheetToCsv, sheetToText, exportItem, markdownToHtml
} from '../scripts/lib/report.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'worklog.mjs');

// Fabricated values only. This token shape is never a real credential.
const FAKE_TOKEN = 'ghp_' + 'Z'.repeat(4) + 'q7Lm2Xv9Rt4Kp8Wn3Bc6Hd1Jf5Gs0Ay';

function ticket(key, overrides = {}) {
  return {
    key, title: '', status: '', jiraUrl: '', repos: [], branches: [],
    firstActive: null, lastActive: null, activeDates: [], commits: [], prs: [], docs: [],
    findings: [], decisions: [], artifacts: [], files: [], sessions: [], days: [], rca: null, notes: '',
    ...overrides
  };
}

test('periodDays: ISO week runs Monday to Sunday', () => {
  const days = periodDays('2026-10-29', 'week'); // a Thursday
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-10-26');
  assert.equal(days[6], '2026-11-01');
});

test('periodDays: Sunday belongs to the week that started the Monday before', () => {
  assert.equal(periodDays('2026-11-01', 'week')[0], '2026-10-26');
});

test('periodDays: month covers every calendar day', () => {
  const days = periodDays('2026-02-10', 'month');
  assert.equal(days.length, 28);
  assert.equal(days[0], '2026-02-01');
  assert.equal(days.at(-1), '2026-02-28');
});

test('periodDays rejects malformed and impossible dates', () => {
  assert.throws(() => periodDays('2026-13-01'), /Not a real date/);
  assert.throws(() => periodDays('yesterday'), /Expected YYYY-MM-DD/);
  assert.throws(() => periodDays('2026-10-01', 'year'), /week or month/);
});

test('activitySheet counts events, sessions and commits inside the range only', () => {
  const days = periodDays('2026-10-28', 'week');
  const sheet = activitySheet([
    ticket('ABC-1', {
      title: 'alpha',
      days: [
        { day: '2026-10-27', stats: { events: 10, sessions: 1 } },
        { day: '2026-10-28', stats: { events: 5, sessions: 2 } },
        { day: '2026-10-10', stats: { events: 99, sessions: 9 } } // outside
      ],
      commits: [{ sha: 'a1', date: '2026-10-28T10:00:00Z' }, { sha: 'a2', date: '2026-09-01T10:00:00Z' }]
    }),
    ticket('ABC-2', { commits: [{ sha: 'b1', date: '2026-10-30T09:00:00Z' }] }),
    ticket('ABC-3', { days: [{ day: '2026-09-01', stats: { events: 4 } }] }), // nothing in range
    ticket('_unassigned', { days: [{ day: '2026-10-28', stats: { events: 50 } }] })
  ], days);

  assert.deepEqual(sheet.rows.map((r) => r.key), ['ABC-1', 'ABC-2']);
  const a = sheet.rows[0];
  assert.equal(a.events, 15);
  assert.equal(a.sessions, 3);
  assert.equal(a.commits, 1);
  assert.deepEqual(a.perDay, { '2026-10-27': 10, '2026-10-28': 5 });
  assert.equal(sheet.totals.events, 15);
  assert.equal(sheet.totals.commits, 2);
});

test('sheet renderers say events, never hours, and quote CSV safely', () => {
  const days = periodDays('2026-10-28', 'week');
  const sheet = activitySheet([ticket('ABC-1', {
    title: 'has, comma "and quote"',
    days: [{ day: '2026-10-28', stats: { events: 3, sessions: 1 } }]
  })], days);
  const text = sheetToText(sheet);
  assert.match(text, /not hours/);
  assert.match(text, /ABC-1/);
  const csv = sheetToCsv(sheet).split('\n');
  assert.equal(csv[0].split(',').length, 2 + 7 + 3);
  assert.match(csv[1], /"has, comma ""and quote"""/);
  assert.match(sheetToText(activitySheet([], days)), /No recorded activity/);
});

test('exportItem always applies public redaction, whatever the configured mode', () => {
  const t = ticket('ABC-9', {
    title: 'login lockout',
    findings: [{ id: 'f1', date: '2026-10-28', kind: 'finding', text: `token was ${FAKE_TOKEN}`, evidence: ['e1'] }],
    files: [{ path: 'C:\\Users\\someone\\src\\app\\Login.cs', count: 3 }]
  });
  const cfg = { redaction: { mode: 'local', names: [], extraPatterns: [] } };
  const { content, masked } = exportItem(t, cfg, { format: 'md', exportedOn: '2026-10-29' });
  assert.ok(!content.includes(FAKE_TOKEN), 'planted token must not survive export');
  assert.ok(!content.includes('C:\\Users\\someone'), 'absolute paths are masked at public level');
  assert.ok(!content.includes('edits here are overwritten'), 'generated-file banner is dropped');
  assert.match(content, /redaction: public/);
  assert.ok(masked.length > 0);
});

test('exportItem html escapes everything and rejects unknown formats', () => {
  const t = ticket('ABC-9', { title: '<script>alert(1)</script>', notes: 'a <b>bold</b> claim' });
  const { content } = exportItem(t, {}, { format: 'html' });
  assert.match(content, /^<!doctype html>/);
  assert.ok(!content.includes('<script>alert'), 'title must be escaped');
  assert.ok(!content.includes('<b>bold</b>'), 'notes must be escaped');
  assert.throws(() => exportItem(t, {}, { format: 'pdf' }), /md or html/);
});

test('markdownToHtml handles headings, lists and inline code', () => {
  const html = markdownToHtml('# T\n\n- one `x`\n- **two**\n\npara', 'T');
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<ul>\n<li>one <code>x<\/code><\/li>\n<li><strong>two<\/strong><\/li>\n<\/ul>/);
  assert.match(html, /<p>para<\/p>/);
});

function run(args, env) {
  try {
    return { ok: true, stdout: execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
    }) };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', code: e.status };
  }
}

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-report-test-'));
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'ABC-7.json'), JSON.stringify(ticket('ABC-7', {
    title: 'synthetic',
    findings: [{ id: 'f1', date: '2026-10-28', kind: 'finding', text: `saw ${FAKE_TOKEN}`, evidence: [] }],
    days: [{ day: '2026-10-28', stats: { events: 12, sessions: 2 } }]
  })));
  return dir;
}

test('cli: week --json reports events for the requested week', () => {
  const dir = home();
  const r = run(['week', '--date', '2026-10-28', '--json'], { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.unit, 'events');
  assert.equal(out.from, '2026-10-26');
  assert.equal(out.rows[0].key, 'ABC-7');
  assert.equal(out.rows[0].events, 12);
});

test('cli: week rejects a bad date with exit 1', () => {
  const r = run(['week', '--date', 'soon'], { WORKLOG_DIR: home() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
});

test('cli: export writes a redacted file under the data home', () => {
  const dir = home();
  const r = run(['export', 'ABC-7', '--format', 'html'], { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  const files = fs.readdirSync(path.join(dir, 'exports'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^ABC-7-\d{4}-\d{2}-\d{2}\.html$/);
  const body = fs.readFileSync(path.join(dir, 'exports', files[0]), 'utf8');
  assert.ok(!body.includes(FAKE_TOKEN));
});

test('cli: export refuses to write outside the allowlisted roots', () => {
  const dir = home();
  const outside = path.join(path.parse(process.cwd()).root, 'worklog-should-not-exist', 'x.md');
  const r = run(['export', 'ABC-7', '--out', outside], { WORKLOG_DIR: dir });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /Not written/);
  assert.ok(!fs.existsSync(outside));
});

test('cli: export of an unknown item exits 1', () => {
  const r = run(['export', 'ABC-404'], { WORKLOG_DIR: home() });
  assert.equal(r.ok, false);
});
