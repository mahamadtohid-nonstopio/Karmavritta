import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-budget-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const { checkBudget, recordSpend, summary, loadLedger, today } =
  await import('../scripts/lib/budget.mjs');

const cfg = (model = {}) => ({
  model: {
    enabled: true, maxCallsPerDay: 3, maxCallsPerTick: 2,
    dailyBudgetUsd: 0.05, estimatedCostPerCallUsd: 0.02, ...model
  }
});

test('a first call inside every cap is allowed', () => {
  sandbox();
  assert.deepEqual(checkBudget(cfg()), { allowed: true });
});

test('the daily call cap is enforced from the ledger', () => {
  sandbox();
  recordSpend(cfg(), 'extract', 0);
  recordSpend(cfg(), 'extract', 0);
  recordSpend(cfg(), 'extract', 0);
  const r = checkBudget(cfg());
  assert.equal(r.allowed, false);
  assert.match(r.reason, /daily call cap reached \(3\/3\)/);
});

test('the budget refuses the call that would cross the line, not the one after', () => {
  sandbox();
  recordSpend(cfg(), 'extract');          // 0.02
  assert.equal(checkBudget(cfg()).allowed, true, '0.04 still fits under 0.05');
  recordSpend(cfg(), 'extract');          // 0.04
  const r = checkBudget(cfg());
  assert.equal(r.allowed, false, '0.06 would exceed 0.05');
  assert.match(r.reason, /daily budget/);
});

test('spend is recorded per feature and survives a reload', () => {
  sandbox();
  recordSpend(cfg(), 'extract');
  recordSpend(cfg(), 'rollup');
  const s = summary();
  assert.equal(s.calls, 2);
  assert.equal(s.usd, 0.04);
  assert.deepEqual(s.byFeature, { extract: 1, rollup: 1 });
  assert.ok(loadLedger().days[today()]);
});

test('a corrupt ledger reads as empty rather than blocking the tick', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'spend.json'), 'not json');
  assert.deepEqual(loadLedger(), { days: {} });
  assert.equal(checkBudget(cfg()).allowed, true);
});

test('disabling the model short-circuits before the ledger is read', () => {
  sandbox();
  const r = checkBudget(cfg({ enabled: false }));
  assert.equal(r.allowed, false);
  assert.match(r.reason, /disabled/);
});
