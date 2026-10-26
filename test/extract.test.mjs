import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-extract-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const { validateExtraction, buildDigest, deterministicSummary, loadPrompt, runExtraction } =
  await import('../scripts/lib/extract.mjs');
const { loadConfig, saveConfig } = await import('../scripts/lib/config.mjs');

const IDS = ['e_aaa111', 'e_bbb222'];

test('a claim that cites a recorded event id survives', () => {
  const { result, dropped } = validateExtraction({
    title: 'Token refresh loop',
    summary: 'Traced a retry storm in the auth client.',
    findings: [{ kind: 'finding', text: 'The refresh call retries without backoff.', evidence: ['e_aaa111'] }]
  }, IDS);

  assert.equal(result.title, 'Token refresh loop');
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].evidence, ['e_aaa111']);
  assert.equal(dropped.length, 0);
});

test('an uncited claim is dropped, not softened', () => {
  const { result, dropped } = validateExtraction({
    findings: [
      { kind: 'finding', text: 'cited', evidence: ['e_bbb222'] },
      { kind: 'finding', text: 'invented', evidence: [] },
      { kind: 'finding', text: 'hallucinated id', evidence: ['e_zzz999'] }
    ]
  }, IDS);

  assert.deepEqual(result.findings.map((f) => f.text), ['cited']);
  assert.equal(dropped.length, 2);
  assert.ok(dropped.some((d) => /invented/.test(d)));
});

test('decisions and rca obey the same rule', () => {
  const { result, dropped } = validateExtraction({
    decisions: [
      { text: 'Switch to exponential backoff', evidence: ['e_aaa111'] },
      { text: 'Rewrite the whole client', evidence: ['nope'] }
    ],
    rca: { symptom: 'thundering herd', rootCause: 'no backoff', fix: 'add jitter', evidence: [] }
  }, IDS);

  assert.equal(result.decisions.length, 1);
  assert.equal(result.rca, null);
  assert.ok(dropped.includes('uncited rca'));
});

test('an unknown kind falls back to finding rather than passing through', () => {
  const { result } = validateExtraction({
    findings: [{ kind: 'speculation', text: 'maybe', evidence: ['e_aaa111'] }]
  }, IDS);
  assert.equal(result.findings[0].kind, 'finding');
});

test('garbage in gives an empty result, not a throw', () => {
  for (const input of [null, 'a string', 42, [], { findings: 'not an array' }]) {
    const { result } = validateExtraction(input, IDS);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.decisions, []);
  }
});

test('validated text is redacted at public level and length-capped', () => {
  const { result } = validateExtraction({
    title: 'x'.repeat(300),
    findings: [{ text: `token="ghp_${'a'.repeat(30)}" leaked`, evidence: ['e_aaa111'] }]
  }, IDS);

  assert.equal(result.title.length, 120);
  assert.ok(!result.findings[0].text.includes('ghp_a'), 'a secret must not reach the note');
  assert.match(result.findings[0].text, /REDACTED/);
});

test('the digest is numbered by event id and marks failures', () => {
  sandbox();
  const cfg = loadConfig();
  const digest = buildDigest('ESIN-1', '2026-10-20', [
    { id: 'e_aaa111', event: 'UserPromptSubmit', summary: 'look at the retry loop' },
    { id: 'e_bbb222', event: 'PostToolUse', tool: 'Bash', summary: 'npm test', ok: false, error: 'exit 1' }
  ], cfg);

  assert.match(digest, /Work item: ESIN-1/);
  assert.match(digest, /- e_aaa111 UserPromptSubmit: look at the retry loop/);
  assert.match(digest, /- e_bbb222 PostToolUse\/Bash \[FAILED\]: npm test/);
  assert.match(digest, /error: exit 1/);
});

test('the digest redacts secrets before anything leaves the process', () => {
  sandbox();
  const cfg = loadConfig();
  const digest = buildDigest('ESIN-1', '2026-10-20', [
    { id: 'e_aaa111', event: 'PostToolUse', tool: 'Bash', summary: 'curl -H "api_key: sk-livetestvalue123456"' }
  ], cfg);
  assert.ok(!digest.includes('sk-livetestvalue123456'));
  assert.match(digest, /REDACTED/);
});

test('the packaged extract prompt is found and demands citations', () => {
  sandbox();
  const prompt = loadPrompt('extract');
  assert.ok(prompt.length > 100);
  assert.match(prompt, /MUST cite at least one/);
  assert.match(prompt, /Do not invent event ids/);
});

test('a missing prompt name returns empty rather than throwing', () => {
  sandbox();
  assert.equal(loadPrompt('no-such-prompt'), '');
});

test('the deterministic summary states counts without inventing findings', () => {
  const s = deterministicSummary('ESIN-1', '2026-10-20', [
    { tool: 'Read', kind: 'file', summary: 'a.ts' },
    { tool: 'Read', kind: 'file', summary: 'b.ts' },
    { tool: 'Bash', kind: 'artifact', summary: 'npm test', ok: false }
  ]);
  assert.match(s.summary, /3 recorded events on 2026-10-20/);
  assert.match(s.summary, /Read×2/);
  assert.match(s.summary, /2 files touched/);
  assert.match(s.summary, /1 failed call/);
  assert.deepEqual(s.findings, []);
  assert.equal(s.rca, null);
});

test('extraction is skipped, not attempted, when the model is disabled', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  saveConfig(cfg);

  const r = runExtraction({ key: 'ESIN-1', day: '2026-10-20', events: [{ id: 'e_a' }], cfg: loadConfig() });
  assert.equal(r.used, 'skipped');
  assert.match(r.reason, /disabled/);
  assert.equal(r.result, null);
});

test('the per-tick cap stops the second call in the same tick', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.maxCallsPerTick = 1;
  saveConfig(cfg);

  const r = runExtraction({
    key: 'ESIN-1', day: '2026-10-20', events: [{ id: 'e_a' }], cfg: loadConfig(), callsThisTick: 1
  });
  assert.equal(r.used, 'skipped');
  assert.match(r.reason, /per-tick cap/);
});
