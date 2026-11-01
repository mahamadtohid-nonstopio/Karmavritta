import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Synthetic data home only (rule 5). Ticket keys and text are invented.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-dashboard-test-'));
process.env.WORKLOG_DIR = TMP;

const { createHandler, search, tokenize, dayItems, activeDays } = await import('../scripts/lib/dashboard.mjs');
const { dashboardRoute } = await import('../scripts/cli.mjs');
const safety = await import('../scripts/lib/safety.mjs');

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'worklog.mjs');
const PORT = 5555;
const HOST = `127.0.0.1:${PORT}`;

function ticket(key, o = {}) {
  return {
    key, title: '', status: '', jiraUrl: '', repos: [], branches: [], firstActive: null, lastActive: null,
    activeDates: [], commits: [], prs: [], docs: [], findings: [], decisions: [], artifacts: [], files: [],
    sessions: [], days: [], rca: null, notes: '', ...o
  };
}

fs.mkdirSync(path.join(TMP, 'tickets'), { recursive: true });
const write = (t) => fs.writeFileSync(path.join(TMP, 'tickets', `${t.key}.json`), JSON.stringify(t));
write(ticket('DEMO-1', {
  title: 'Login lockout after reset', lastActive: '2026-10-28', firstActive: '2026-10-27', activeDates: ['2026-10-27', '2026-10-28'],
  findings: [
    { id: 'f1', date: '2026-10-28', kind: 'finding', text: 'Counter is never reset after a password change', evidence: ['e1'] },
    { id: 'f2', date: '2026-10-27', kind: 'ruled-out', text: 'Cache TTL is not the cause', evidence: ['e2'] }
  ],
  decisions: [{ id: 'd1', date: '2026-10-28', text: 'Reset the counter in the handler', evidence: ['e3'] }],
  commits: [{ sha: 'abcdef1234567', repo: 'api', date: '2026-10-28T09:00:00Z', message: 'DEMO-1 reset counter' }],
  artifacts: [{ id: 'a1', kind: 'command', date: '2026-10-28', body: 'SELECT attempts FROM users' }],
  files: [{ id: 'p1', path: 'src/auth/lockout.ts', count: 3, lastSeen: '2026-10-28' }],
  days: [
    { day: '2026-10-27', summary: 'Ruled out the cache', stats: { events: 5, sessions: 1 }, findingIds: ['f2'], decisionIds: [], used: 'model' },
    { day: '2026-10-28', summary: 'Found the counter bug', stats: { events: 9, sessions: 2 }, findingIds: ['f1'], decisionIds: ['d1'], used: 'model' }
  ],
  rca: { date: '2026-10-28', symptom: 'Users locked out', rootCause: 'Counter never reset', fix: 'Reset in handler' }
}));
write(ticket('TASK-2', { title: 'Unrelated cache work', lastActive: '2026-10-20', activeDates: ['2026-10-20'],
  days: [{ day: '2026-10-20', summary: 'Tuned cache', stats: { events: 2 }, findingIds: [], decisionIds: [], used: 'deterministic' }] }));
write(ticket('_unassigned', { days: [{ day: '2026-10-28', stats: { events: 99 } }] }));

const handler = createHandler({ port: PORT, pid: 4242, now: () => new Date('2026-10-28T12:00:00') });
const get = (url, host = HOST, method = 'GET') => handler({ method, url, host });
const body = (r) => JSON.parse(r.body);

// --- request handling and security ----------------------------------------------

test('only the loopback Host header is accepted (DNS-rebinding guard)', async () => {
  assert.equal((await get('/api/ping', 'evil.example:5555')).status, 403);
  assert.equal((await get('/api/ping', '127.0.0.1:9999')).status, 403);
  assert.equal((await get('/api/ping', '')).status, 403);
  assert.equal((await get('/api/ping', `localhost:${PORT}`)).status, 200);
});

test('read-only: anything but GET and HEAD is refused', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await get('/api/ping', HOST, m);
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.Allow, 'GET, HEAD');
  }
  assert.equal((await get('/api/ping', HOST, 'HEAD')).status, 200);
});

test('static files come from an exact allowlist; traversal finds nothing', async () => {
  for (const p of ['/', '/index.html', '/app.js', '/app.css', '/favicon.svg']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  }
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/app.js/../../CLAUDE.md', '/scripts/cli.mjs', '/config.json']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('ticket and day parameters are validated', async () => {
  assert.equal((await get('/api/ticket/..%2F..%2Fconfig')).status, 400);
  assert.equal((await get('/api/ticket/not-a-key')).status, 400);
  assert.equal((await get('/api/ticket/NOPE-404')).status, 404);
  assert.equal((await get('/api/day/2026-13-99x')).status, 400);
  assert.equal((await get('/api/activity?date=soon')).status, 400);
  assert.equal((await get('/api/unknown')).status, 404);
});

test('ping identifies the app, its pid and data home', async () => {
  const p = body(await get('/api/ping'));
  assert.equal(p.app, 'worklog');
  assert.equal(p.pid, 4242);
  assert.equal(path.resolve(p.dataHome), path.resolve(TMP));
});

// --- the one write: "Summarise now" ------------------------------------------------

const post = (url, { origin = 'http://127.0.0.1:5555', action = 'tick', host = HOST } = {}) =>
  handler({ method: 'POST', url, host, origin, action });

test('POST /api/tick is refused without our Origin and the custom header', async () => {
  assert.equal((await post('/api/tick', { action: '' })).status, 403, 'no header');
  assert.equal((await post('/api/tick', { origin: 'https://evil.example' })).status, 403, 'foreign origin');
  assert.equal((await post('/api/tick', { origin: '' })).status, 403, 'no origin');
  assert.equal((await post('/api/tick', { host: 'evil.example:5555' })).status, 403, 'foreign host');
  assert.equal((await post('/api/ticket/DEMO-1')).status, 405, 'no other POST route exists');
});

test('POST /api/tick from the dashboard runs the tick', async () => {
  const r = await post('/api/tick');
  assert.equal(r.status, 200);
  const out = body(r);
  assert.ok('notesWritten' in out && 'items' in out, JSON.stringify(out));
  assert.equal(out.modelCalls, 0, 'no raw events here, so no model calls');
});

// --- data routes --------------------------------------------------------------------

test('overview reports today, its items and totals, ignoring _unassigned', async () => {
  const o = body(await get('/api/overview'));
  assert.equal(o.today, '2026-10-28');
  assert.deepEqual(o.items.map((i) => i.key), ['DEMO-1']);
  assert.equal(o.items[0].findings[0].id, 'f1');
  assert.equal(o.items[0].decisions[0].id, 'd1');
  assert.equal(o.totals.tickets, 2);
  assert.equal(o.status.capture, 'on');
});

test('day view resolves findings by id and links to neighbouring active days', async () => {
  const d = body(await get('/api/day/2026-10-28'));
  assert.equal(d.prev, '2026-10-27');
  assert.equal(d.next, null);
  assert.equal(d.items[0].summary, 'Found the counter bug');
  assert.equal(body(await get('/api/day/today')).day, '2026-10-28');
  assert.deepEqual(activeDays(), ['2026-10-20', '2026-10-27', '2026-10-28']);
});

test('deterministic day summaries are not shown as prose (same rule as the daily note)', () => {
  const items = dayItems('2026-10-20');
  assert.equal(items[0].key, 'TASK-2');
  assert.equal(items[0].summary, '');
});

test('ticket view is complete and case-insensitive on the key', async () => {
  const t = body(await get('/api/ticket/demo-1'));
  assert.equal(t.key, 'DEMO-1');
  assert.equal(t.findings.length, 2);
  assert.equal(t.findings[0].id, 'f1', 'newest first');
  assert.equal(t.timeline.length, 2);
  assert.equal(t.commits[0].sha, 'abcdef123');
  assert.equal(t.rca.rootCause, 'Counter never reset');
  assert.equal(t.commands[0].body, 'SELECT attempts FROM users');
});

test('meta reports version, port, capture state and health counts', async () => {
  const m = body(await get('/api/meta'));
  assert.equal(m.port, PORT);
  assert.equal(m.capture, 'on');
  assert.ok(Number.isInteger(m.health.ok));
  assert.ok(m.version);
});

test('overview: week range aggregates days per ticket; capture counts pending events', async () => {
  const dayDir = path.join(TMP, 'raw', '2026-10-28');
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(path.join(dayDir, 's.jsonl'), ['10:00', '11:00'].map((t, i) =>
    JSON.stringify({ v: 1, id: 'e_p' + i, ts: '2026-10-28T' + t + ':00.000Z', day: '2026-10-28', session: 's', event: 'PostToolUse', keys: [] })).join('\n') + '\n');
  const o = body(await get('/api/overview?range=week'));
  assert.equal(o.range, 'week');
  assert.equal(o.from, '2026-10-26');
  const demo = o.items.find((i) => i.key === 'DEMO-1');
  assert.deepEqual(demo.days, ['2026-10-28', '2026-10-27']);
  assert.equal(demo.stats.events, 14, 'events summed across the week');
  assert.equal(demo.findings.length, 2);
  assert.equal(o.capture.events, 2);
  assert.ok(o.capture.pending <= 2);
  const day = body(await get('/api/overview'));
  assert.equal(day.range, 'day');
  assert.equal(day.counts.findings, 1, 'one finding dated today');
});

test('ticket rows carry total recorded events', async () => {
  const { tickets } = body(await get('/api/tickets'));
  assert.equal(tickets.find((t) => t.key === 'DEMO-1').events, 14);
});

test('root causes: one card per ticket with an RCA, newest first', async () => {
  write(ticket('OPS-3', { title: 'Export times out', lastActive: '2026-10-29',
    rca: { date: '2026-10-29', symptom: 'Export job times out', rootCause: 'Missing index on audit table', fix: 'Add the index' } }));
  write(ticket('OPS-4', { title: 'No RCA here', lastActive: '2026-10-29', rca: { symptom: '', rootCause: '', fix: '' } }));
  try {
    const r = body(await get('/api/rcas'));
    assert.deepEqual(r.rcas.map((x) => x.key), ['OPS-3', 'DEMO-1'], 'empty RCAs are skipped; newest first');
    assert.equal(r.total, 2);
    assert.equal(r.rcas[1].rootCause, 'Counter never reset');
    assert.equal(r.rcas[1].title, 'Login lockout after reset');
  } finally {
    fs.rmSync(path.join(TMP, 'tickets', 'OPS-3.json'));
    fs.rmSync(path.join(TMP, 'tickets', 'OPS-4.json'));
  }
});

test('root causes: search needs every word, across key, title, symptom, cause and fix', async () => {
  const hit = body(await get('/api/rcas?q=counter%20handler'));
  assert.equal(hit.count, 1);
  assert.equal(hit.total, 1);
  assert.deepEqual(hit.tokens, ['counter', 'handler']);
  assert.equal(body(await get('/api/rcas?q=demo-1')).count, 1, 'matches the key');
  assert.equal(body(await get('/api/rcas?q=lockout')).count, 1, 'matches the title');
  assert.equal(body(await get('/api/rcas?q=counter%20banana')).count, 0);
});

test('tickets list excludes the unassigned bucket and sorts by last activity', async () => {
  const { tickets } = body(await get('/api/tickets'));
  assert.deepEqual(tickets.map((t) => t.key), ['DEMO-1', 'TASK-2']);
  assert.equal(tickets[0].hasRca, true);
});

test('activity endpoint returns the week with neighbours', async () => {
  const a = body(await get('/api/activity?period=week&date=2026-10-28'));
  assert.equal(a.from, '2026-10-26');
  assert.equal(a.prev, '2026-10-25');
  assert.equal(a.next, '2026-11-02');
  assert.equal(a.rows[0].key, 'DEMO-1');
  assert.equal(a.unit, 'events');
});

// --- search ---------------------------------------------------------------------------

test('search requires every word and ranks root causes and findings above commits', () => {
  const r = search('counter reset');
  assert.ok(r.total >= 4);
  const types = r.results.map((x) => x.type);
  assert.ok(types.indexOf('rca') < types.indexOf('commit'));
  assert.ok(types.indexOf('finding') < types.indexOf('commit'));
  assert.equal(search('counter banana').total, 0, 'all tokens must match');
});

test('search type filter narrows results but keeps per-type counts', () => {
  const r = search('counter', { type: 'commit' });
  assert.ok(r.results.every((x) => x.type === 'commit'));
  assert.ok(r.counts.finding >= 1, 'counts still cover every type');
});

test('search matches on the ticket key and title too', () => {
  assert.ok(search('demo-1').results.some((x) => x.type === 'ticket' && x.key === 'DEMO-1'));
  assert.ok(search('lockout counter').results.length > 0, '"lockout" is only in the title');
});

test('search finds commands and file paths, and ignores empty queries', async () => {
  assert.ok(search('attempts').results.some((x) => x.type === 'command'));
  assert.ok(search('lockout.ts').results.some((x) => x.type === 'file'));
  assert.equal(search('   ').total, 0);
  assert.deepEqual(tokenize('  A  b c '), ['a', 'b', 'c']);
  const viaHttp = body(await get('/api/search?q=cache'));
  assert.ok(viaHttp.results.length > 0);
});

// --- CLI route mapping ------------------------------------------------------------

test('dashboard pages map to hash routes; bad input is rejected', () => {
  assert.deepEqual(dashboardRoute([]), { route: '#/' });
  assert.deepEqual(dashboardRoute(['ticket', 'demo-1']), { route: '#/ticket/DEMO-1' });
  assert.deepEqual(dashboardRoute(['DEMO-1']), { route: '#/ticket/DEMO-1' });
  assert.deepEqual(dashboardRoute(['day', '2026-10-28']), { route: '#/day/2026-10-28' });
  assert.match(dashboardRoute(['day', '-2']).route, /^#\/day\/\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(dashboardRoute(['search', 'a&b', 'c']), { route: '#/search?q=a%26b%20c' });
  assert.deepEqual(dashboardRoute(['month']), { route: '#/activity?period=month' });
  assert.deepEqual(dashboardRoute(['rcas']), { route: '#/rcas' });
  assert.deepEqual(dashboardRoute(['rca', 'missing', 'index']), { route: '#/rcas?q=missing%20index' });
  assert.ok(dashboardRoute(['day', 'soon']).error);
  assert.ok(dashboardRoute(['ticket', 'x']).error);
  assert.ok(dashboardRoute(['bogus']).error);
});

// --- safety primitives ----------------------------------------------------------------

test('serveLocal answers on 127.0.0.1 and probeLocal reads it back', async () => {
  const srv = await safety.serveLocal(async ({ host }) => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'probe', host }) }));
  try {
    assert.equal(safety.LOOPBACK, '127.0.0.1');
    const r = await safety.probeLocal(srv.port, '/x');
    assert.equal(r.status, 200);
    assert.equal(r.json.app, 'probe');
    assert.equal(r.json.host, `127.0.0.1:${srv.port}`);
  } finally { await srv.close(); }
  assert.equal(await safety.probeLocal(srv.port, '/x', { timeoutMs: 300 }), null, 'closed port answers null');
});

test('openBrowser refuses anything that is not our loopback URL', async () => {
  for (const url of ['https://example.com/', 'http://localhost:7341/', 'file:///C:/x', 'http://127.0.0.1:7341/" & calc', 'javascript:alert(1)']) {
    await assert.rejects(() => safety.openBrowser(url), /not the local dashboard/, url);
  }
});

test('stopProcess refuses nonsense and our own pid', () => {
  assert.equal(safety.stopProcess(0), false);
  assert.equal(safety.stopProcess(-5), false);
  assert.equal(safety.stopProcess(process.pid), false);
});

// --- real lifecycle -----------------------------------------------------------------------

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function cli(args) {
  try {
    return { ok: true, out: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, WORKLOG_DIR: TMP }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

let lifecyclePort = null;
after(() => { if (lifecyclePort) cli(['dashboard', 'stop', '--port', String(lifecyclePort)]); });

test('cli: dashboard starts in the background, is reused, reports status and stops', async () => {
  lifecyclePort = await freePort();
  const port = String(lifecyclePort);

  const start = cli(['dashboard', '--no-open', '--json', '--port', port]);
  assert.ok(start.ok, start.out);
  const s = JSON.parse(start.out);
  assert.equal(s.reused, false);
  assert.equal(s.url, `http://127.0.0.1:${port}/#/`);

  const ping = await safety.probeLocal(lifecyclePort);
  assert.equal(ping.json.app, 'worklog');
  assert.equal(path.resolve(ping.json.dataHome), path.resolve(TMP));
  assert.ok(fs.existsSync(path.join(TMP, 'dashboard.json')));

  const again = JSON.parse(cli(['dashboard', 'ticket', 'DEMO-1', '--no-open', '--json', '--port', port]).out);
  assert.equal(again.reused, true);
  assert.equal(again.url, `http://127.0.0.1:${port}/#/ticket/DEMO-1`);

  assert.match(cli(['dashboard', 'status', '--port', port]).out, /Running: http:\/\/127\.0\.0\.1/);
  assert.match(cli(['dashboard', 'stop', '--port', port]).out, /dashboard stopped/);
  assert.equal(await safety.probeLocal(lifecyclePort, '/api/ping', { timeoutMs: 300 }), null);
  lifecyclePort = null;
});

// The blocker lives in this process, so the CLI must run asynchronously:
// a synchronous exec would freeze the event loop and the blocker could not answer.
function cliAsync(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, WORKLOG_DIR: TMP }, timeout: 30_000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}` }));
  });
}

test('cli: a port held by another program is reported, not taken over', async () => {
  const blocker = await safety.serveLocal(async () => ({ status: 200, headers: {}, body: 'not worklog' }));
  try {
    const r = await cliAsync(['dashboard', '--no-open', '--port', String(blocker.port)]);
    assert.equal(r.ok, false);
    assert.match(r.out, /held by another program/);
  } finally { await blocker.close(); }
});

test('cli: bad page and bad port exit with a clear message', () => {
  assert.match(cli(['dashboard', 'day', 'soon', '--no-open']).out, /Not a day/);
  assert.match(cli(['dashboard', '--port', '99999', '--no-open']).out, /--port must be/);
});
