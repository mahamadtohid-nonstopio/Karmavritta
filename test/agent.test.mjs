import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-agent-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const { captureEvent } = await import('../scripts/lib/capture.mjs');
const { loadConfig, saveConfig, getDailyNotePath, getItemNotePath, getStatePath, getRawDayDir } =
  await import('../scripts/lib/config.mjs');
const { runTick, propagateKeys, dedupeToolCalls, statsFor, readState } =
  await import('../scripts/lib/agent.mjs');
const { readTicket } = await import('../scripts/lib/store.mjs');
const { renderDaily, renderItem } = await import('../scripts/lib/render.mjs');

/** The model is never invoked in tests — the deterministic path is the subject. */
function noModel() {
  const cfg = loadConfig();
  cfg.model.enabled = false;
  saveConfig(cfg);
  return cfg;
}

const DAY = '2026-10-20';

function at(hour, minute = 0) {
  return new Date(Date.UTC(2026, 9, 20, hour, minute, 0));
}

function syntheticDay() {
  const ev = (payload, when) => captureEvent(payload, { now: when });
  ev({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/w/repo', source: 'startup' }, at(9));
  ev({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: '/w/repo/a.ts' } }, at(9, 1));
  ev({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'debug ESIN-4349 token refresh' }, at(9, 2));
  ev({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: '/w/repo/b.ts' } }, at(9, 3));
  ev({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: '/w/repo/b.ts' }, tool_response: {} }, at(9, 4));
  ev({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { error: 'exit 1' } }, at(9, 5));
  ev({ hook_event_name: 'SessionEnd', session_id: 's1', reason: 'clear' }, at(9, 6));

  ev({ hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'now OPP-12 pricing table' }, at(11));
  ev({ hook_event_name: 'PostToolUse', session_id: 's2', tool_name: 'Edit', tool_input: { file_path: '/w/repo/price.ts' }, tool_response: {} }, at(11, 1));
  ev({ hook_event_name: 'PostToolUse', session_id: 's2', tool_name: 'Edit', tool_input: { file_path: '/w/repo/price.ts' }, tool_response: {} }, at(11, 2));
}

test('a synthetic day renders a daily note and one note per work item', async () => {
  sandbox();
  noModel();
  syntheticDay();

  const r = await runTick();
  assert.equal(r.ran, true);
  assert.deepEqual(r.days, [DAY]);
  assert.equal(r.modelCalls, 0);

  const daily = fs.readFileSync(getDailyNotePath(DAY), 'utf8');
  assert.match(daily, /^# 2026-10-20/);
  assert.match(daily, /## ESIN-4349/);
  assert.match(daily, /## OPP-12/);

  assert.ok(fs.existsSync(getItemNotePath('ESIN-4349')));
  assert.ok(fs.existsSync(getItemNotePath('OPP-12')));
  assert.match(fs.readFileSync(getItemNotePath('OPP-12'), 'utf8'), /price\.ts/);
});

test('re-running the tick adds no duplicates and rewrites nothing', async () => {
  sandbox();
  noModel();
  syntheticDay();

  await runTick();
  const first = readTicket('ESIN-4349');
  const dailyBefore = fs.readFileSync(getDailyNotePath(DAY), 'utf8');

  const second = await runTick();
  assert.equal(second.days.length, 0, 'an unchanged day should be skipped entirely');
  assert.equal(second.notesWritten, 0);

  const forced = await runTick({ force: true });
  assert.deepEqual(forced.days, [DAY]);
  assert.equal(forced.notesWritten, 0, 'identical content must not be rewritten');

  const after = readTicket('ESIN-4349');
  assert.equal(after.findings.length, first.findings.length);
  assert.equal(after.files.length, first.files.length);
  assert.equal(after.days.length, 1);
  assert.equal(fs.readFileSync(getDailyNotePath(DAY), 'utf8'), dailyBefore);
});

test('file touches accumulate per path rather than per event', async () => {
  sandbox();
  noModel();
  syntheticDay();
  await runTick();

  const opp = readTicket('OPP-12');
  assert.equal(opp.files.length, 1);
  assert.equal(opp.files[0].count, 2);
  assert.equal(opp.activeDates.join(), DAY);
  assert.equal(opp.sessions.length, 1);
});

test('a failed tool call is counted and surfaced in the summary', async () => {
  sandbox();
  noModel();
  syntheticDay();
  await runTick();

  const t = readTicket('ESIN-4349');
  const day = t.days[0];
  assert.equal(day.stats.failures, 1);
  assert.equal(day.used, 'deterministic');
  assert.match(day.summary, /1 failed call/);
});

test('new events on a processed day are picked up on the next tick', async () => {
  sandbox();
  noModel();
  syntheticDay();
  await runTick();

  captureEvent({
    hook_event_name: 'PostToolUse', session_id: 's2',
    tool_name: 'Write', tool_input: { file_path: '/w/repo/new.ts' }, tool_response: {}
  }, { now: at(12) });

  const r = await runTick();
  assert.deepEqual(r.days, [DAY]);
  const opp = readTicket('OPP-12');
  assert.equal(opp.files.length, 2);
  assert.equal(opp.days.length, 1, 'the day entry is updated, not appended');
});

test('state records a fingerprint per day and per key', async () => {
  sandbox();
  noModel();
  syntheticDay();
  await runTick();

  const state = readState();
  assert.ok(state.lastTick);
  assert.ok(state.days[DAY].fingerprint);
  assert.deepEqual(Object.keys(state.days[DAY].keys).sort(), ['ESIN-4349', 'OPP-12']);
});

test('raw days beyond the retention window are pruned', async () => {
  const dir = sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  cfg.capture.retainRawDays = 1;
  saveConfig(cfg);

  for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    fs.mkdirSync(getRawDayDir(day), { recursive: true });
    fs.writeFileSync(path.join(getRawDayDir(day), 's.jsonl'), `${JSON.stringify({
      v: 1, id: `e_${day}`, ts: `${day}T09:00:00.000Z`, day, session: 's', event: 'UserPromptSubmit',
      keys: ['ESIN-1'], tool: '', kind: 'userpromptsubmit', summary: 'work on ESIN-1'
    })}\n`);
  }

  const r = await runTick();
  assert.equal(r.pruned, 2);
  assert.equal(fs.existsSync(getRawDayDir('2026-10-01')), false);
  assert.equal(fs.existsSync(getRawDayDir('2026-10-03')), true);
  assert.ok(fs.existsSync(path.join(dir, 'daily', '2026-10-01.md')), 'the note outlives the raw events');
});

test('a key established mid-session is applied to the whole session', () => {
  const events = [
    { session: 's1', ts: '1', keys: [], id: 'a' },
    { session: 's1', ts: '2', keys: ['ESIN-1'], id: 'b' },
    { session: 's1', ts: '3', keys: [], id: 'c' },
    { session: 's2', ts: '4', keys: [], id: 'd' }
  ];
  const out = propagateKeys(events);
  assert.deepEqual(out.map((e) => e.keys), [['ESIN-1'], ['ESIN-1'], ['ESIN-1'], []]);
});

test('a later key in the same session takes over from the earlier one', () => {
  const out = propagateKeys([
    { session: 's1', ts: '1', keys: ['A-1'], id: 'a' },
    { session: 's1', ts: '2', keys: [], id: 'b' },
    { session: 's1', ts: '3', keys: ['B-2'], id: 'c' },
    { session: 's1', ts: '4', keys: [], id: 'd' }
  ]);
  assert.deepEqual(out.map((e) => e.keys), [['A-1'], ['A-1'], ['B-2'], ['B-2']]);
});

test('PreToolUse is dropped when its PostToolUse arrived', () => {
  const events = [
    { session: 's', event: 'PreToolUse', tool: 'Read', summary: 'a.ts' },
    { session: 's', event: 'PostToolUse', tool: 'Read', summary: 'a.ts' },
    { session: 's', event: 'PreToolUse', tool: 'Bash', summary: 'sleep 99' }
  ];
  const out = dedupeToolCalls(events);
  assert.equal(out.length, 2);
  assert.equal(out[0].event, 'PostToolUse');
  assert.equal(out[1].summary, 'sleep 99', 'an interrupted call still counts');
});

test('stats count tools, distinct files, sessions and failures', () => {
  const s = statsFor([
    { tool: 'Read', kind: 'file', summary: 'a.ts', session: 's1' },
    { tool: 'Read', kind: 'file', summary: 'a.ts', session: 's1' },
    { tool: 'Bash', kind: 'artifact', summary: 'ls', session: 's2', ok: false }
  ]);
  assert.deepEqual(s, { events: 3, tools: { Read: 2, Bash: 1 }, files: 1, sessions: 2, failures: 1 });
});

test('an empty day renders a note that says so', () => {
  const md = renderDaily('2026-01-01', []);
  assert.match(md, /No activity recorded/);
});

test('rendering is pure — the same input gives the same bytes', () => {
  const ticket = {
    key: 'ESIN-1', title: 'Thing', status: '', repos: ['r'], branches: [], activeDates: ['2026-01-01'],
    firstActive: '2026-01-01', lastActive: '2026-01-01', commits: [], prs: [], docs: [],
    findings: [{ id: 'f1', kind: 'finding', text: 'it leaks', evidence: ['e_1'] }],
    decisions: [], artifacts: [], files: [], sessions: [], days: [], rca: null, notes: ''
  };
  assert.equal(renderItem(ticket), renderItem(ticket));
  assert.match(renderItem(ticket), /it leaks.*e_1/);
});

test('a second tick while one holds the lock backs off instead of racing', async () => {
  const dir = sandbox();
  noModel();
  syntheticDay();
  fs.mkdirSync(path.join(dir, '.tick.lock'));
  const r = await runTick();
  assert.equal(r.ran, false);
  assert.match(r.skipped, /another tick/);
  fs.rmdirSync(path.join(dir, '.tick.lock'));
});

test('tick.enabled=false stops the scheduled run but --force still works', async () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  cfg.tick.enabled = false;
  saveConfig(cfg);
  syntheticDay();

  const off = await runTick();
  assert.equal(off.ran, false);
  assert.match(off.skipped, /disabled/);

  const forced = await runTick({ force: true });
  assert.equal(forced.ran, true);
  assert.ok(fs.existsSync(getDailyNotePath(DAY)));
});
