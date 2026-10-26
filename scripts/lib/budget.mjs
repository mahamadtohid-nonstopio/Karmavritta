import fs from 'node:fs';
import * as safety from './safety.mjs';
import { getLedgerPath } from './config.mjs';

// Cost control exists from the first model call, not after the first surprise
// bill. Every spend decision is recorded, and `doctor` prints the ledger.

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function loadLedger() {
  const p = getLedgerPath();
  if (!fs.existsSync(p)) return { days: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? { days: parsed.days || {} } : { days: {} };
  } catch {
    return { days: {} };
  }
}

export function dayEntry(ledger, day = today()) {
  return ledger.days[day] || { calls: 0, usd: 0, byFeature: {} };
}

/**
 * @returns {{allowed: boolean, reason?: string}} why a model call was refused,
 *          so the caller can log it and fall back deterministically.
 */
export function checkBudget(cfg, { callsThisTick = 0 } = {}) {
  const model = cfg?.model || {};
  if (!model.enabled) return { allowed: false, reason: 'model disabled in config' };

  const perTick = model.maxCallsPerTick ?? 2;
  if (callsThisTick >= perTick) {
    return { allowed: false, reason: `per-tick cap reached (${perTick})` };
  }

  const entry = dayEntry(loadLedger());
  const perDay = model.maxCallsPerDay ?? 40;
  if (entry.calls >= perDay) {
    return { allowed: false, reason: `daily call cap reached (${entry.calls}/${perDay})` };
  }

  const budget = model.dailyBudgetUsd ?? 1;
  const next = entry.usd + (model.estimatedCostPerCallUsd ?? 0.02);
  if (next > budget) {
    return { allowed: false, reason: `daily budget would be exceeded ($${entry.usd.toFixed(3)} of $${budget})` };
  }

  return { allowed: true };
}

export function recordSpend(cfg, feature, usd) {
  const ledger = loadLedger();
  const day = today();
  const entry = dayEntry(ledger, day);
  entry.calls += 1;
  entry.usd = Number((entry.usd + (usd ?? cfg?.model?.estimatedCostPerCallUsd ?? 0.02)).toFixed(6));
  entry.byFeature[feature] = (entry.byFeature[feature] || 0) + 1;
  ledger.days[day] = entry;

  // Keep the ledger small; 90 days is plenty to spot a trend.
  const days = Object.keys(ledger.days).sort();
  for (const d of days.slice(0, Math.max(0, days.length - 90))) delete ledger.days[d];

  safety.writeJsonAtomic(getLedgerPath(), ledger);
  return entry;
}

export function summary(day = today()) {
  const entry = dayEntry(loadLedger(), day);
  return { day, calls: entry.calls, usd: entry.usd, byFeature: entry.byFeature };
}
