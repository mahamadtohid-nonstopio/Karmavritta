import fs from 'node:fs';
import path from 'node:path';
import * as safety from './safety.mjs';
import {
  getWorklogDir, getConfigPath, getRawDir, getErrorsLog, getRuntimeDir,
  getPluginInstallDir, getStatePath, loadConfig
} from './config.mjs';
import { listRawDays, readRawDay } from './capture.mjs';
import * as scheduler from './scheduler.mjs';
import { summary as spendSummary } from './budget.mjs';

// Diagnoses; changes nothing. Every check reports a status and, when something
// is wrong, the exact command that fixes it.

const OK = 'ok', WARN = 'warn', FAIL = 'fail';

function check(name, status, detail, fix) {
  return fix ? { name, status, detail, fix } : { name, status, detail };
}

function checkRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 18
    ? check('node runtime', OK, `v${process.versions.node}`)
    : check('node runtime', FAIL, `v${process.versions.node} is too old`, 'Install Node 18 or newer');
}

function checkDataHome() {
  const dir = getWorklogDir();
  if (!fs.existsSync(dir)) {
    return check('data home', WARN, `${dir} does not exist yet`, 'Run: worklog setup');
  }
  const probe = path.join(dir, '.doctor-probe');
  try {
    safety.writeFileAtomic(probe, 'ok');
    safety.removePath(probe);
    return check('data home', OK, dir);
  } catch (e) {
    return check('data home', FAIL, `${dir} is not writable: ${e.message}`, 'Check folder permissions');
  }
}

function checkConfig() {
  try {
    const cfg = loadConfig();
    const bits = [`redaction=${cfg.redaction?.mode}`, `capture=${cfg.capture?.paused ? 'paused' : cfg.capture?.enabled ? 'on' : 'off'}`];
    return check('config', OK, `${getConfigPath()} (${bits.join(', ')})`);
  } catch (e) {
    return check('config', FAIL, e.message, `Fix or delete ${getConfigPath()}`);
  }
}

function checkPluginInstall() {
  const dir = getPluginInstallDir();
  if (!fs.existsSync(dir)) {
    return check('plugin install', WARN, `not installed at ${dir}`, 'Run: worklog install');
  }
  const hooks = path.join(dir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooks)) {
    return check('plugin install', FAIL, 'hooks/hooks.json missing from the install', 'Run: worklog install');
  }
  return check('plugin install', OK, dir);
}

function checkHooksManifest() {
  const manifest = path.join(getPluginInstallDir(), 'hooks', 'hooks.json');
  if (!fs.existsSync(manifest)) {
    return check('hooks', WARN, 'no installed hooks manifest', 'Run: worklog install, then restart Claude Code');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const events = Object.keys(parsed.hooks || {});
    if (!events.length) return check('hooks', FAIL, 'manifest declares no events', 'Run: worklog install');
    return check('hooks', OK, events.join(', '));
  } catch (e) {
    return check('hooks', FAIL, `manifest is not valid JSON: ${e.message}`, 'Run: worklog install');
  }
}

function checkRuntimeCopy() {
  const tick = path.join(getRuntimeDir(), 'scripts', 'tick.mjs');
  return fs.existsSync(tick)
    ? check('runtime copy', OK, getRuntimeDir())
    : check('runtime copy', WARN, 'no runtime copy for the scheduled tick', 'Run: worklog install');
}

function checkScheduler() {
  try {
    const s = scheduler.status();
    return s.installed
      ? check('tick schedule', OK, `${s.kind}: ${s.detail}`)
      : check('tick schedule', WARN, `${s.kind}: not scheduled`, 'Run: worklog schedule');
  } catch (e) {
    return check('tick schedule', WARN, e.message, 'Run: worklog schedule');
  }
}

function checkCapture() {
  if (!fs.existsSync(getRawDir())) {
    return check('capture', WARN, 'no events captured yet', 'Restart Claude Code, then use a tool in a session');
  }
  const days = listRawDays();
  if (!days.length) return check('capture', WARN, 'raw folder is empty', 'Restart Claude Code so hooks load');
  const latestDay = days.at(-1);
  const events = readRawDay(latestDay);
  const last = events.at(-1);
  const ageHours = last ? (Date.now() - Date.parse(last.ts)) / 3_600_000 : Infinity;
  const detail = `${events.length} events on ${latestDay}, last ${last ? `${ageHours.toFixed(1)}h ago` : 'unknown'}`;
  return ageHours > 72
    ? check('capture', WARN, detail, 'Hooks may not be loading — restart Claude Code and run worklog doctor again')
    : check('capture', OK, detail);
}

function checkTickState() {
  if (!fs.existsSync(getStatePath())) {
    return check('last tick', WARN, 'the tick has never run', 'Run: worklog tick');
  }
  try {
    const state = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    if (!state.lastTick) return check('last tick', WARN, 'no lastTick recorded', 'Run: worklog tick');
    const ageMin = (Date.now() - Date.parse(state.lastTick)) / 60_000;
    const detail = `${state.lastTick} (${ageMin.toFixed(0)} min ago)`;
    return ageMin > 120
      ? check('last tick', WARN, detail, 'Run: worklog schedule')
      : check('last tick', OK, detail);
  } catch (e) {
    return check('last tick', WARN, e.message);
  }
}

function checkGit() {
  const r = safety.runCapture('git', ['--version']);
  return r.ok
    ? check('git', OK, r.stdout.trim())
    : check('git', WARN, 'not on PATH — commit scanning is disabled', 'Install git or add it to PATH');
}

function checkClaudeCli(cfg) {
  if (!cfg?.model?.enabled) return check('claude cli', OK, 'model extraction disabled in config');
  const r = safety.runCapture(cfg.model.command || 'claude', ['--version'], { timeout: 10_000 });
  return r.ok
    ? check('claude cli', OK, r.stdout.trim().split('\n')[0])
    : check('claude cli', WARN, 'not available — the tick will use the deterministic path', 'Install the claude CLI, or set model.enabled=false');
}

function checkBudget(cfg) {
  const s = spendSummary();
  const cap = cfg?.model?.dailyBudgetUsd ?? 1;
  const detail = `${s.calls} calls, $${s.usd.toFixed(3)} of $${cap} today`;
  return s.usd > cap ? check('model spend', WARN, detail, 'Raise model.dailyBudgetUsd or leave it capped') : check('model spend', OK, detail);
}

function recentErrors(limit = 5) {
  const p = getErrorsLog();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-limit)
    .map((l) => { try { return JSON.parse(l); } catch { return { message: l }; } });
}

function checkErrors() {
  const errs = recentErrors();
  if (!errs.length) return check('recent errors', OK, 'none');
  const last = errs.at(-1);
  return check('recent errors', WARN, `${errs.length} logged, last: ${last.message}`, `Inspect ${getErrorsLog()}`);
}

export function diagnose() {
  let cfg = null;
  try { cfg = loadConfig(); } catch { /* checkConfig reports it */ }

  const checks = [
    checkRuntime(),
    checkDataHome(),
    checkConfig(),
    checkPluginInstall(),
    checkHooksManifest(),
    checkRuntimeCopy(),
    checkScheduler(),
    checkCapture(),
    checkTickState(),
    checkGit(),
    checkClaudeCli(cfg),
    checkBudget(cfg),
    checkErrors()
  ];

  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status] += 1;

  return {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    dataHome: getWorklogDir(),
    counts,
    healthy: counts.fail === 0,
    checks,
    errors: recentErrors()
  };
}

const ICON = { ok: '✓', warn: '!', fail: '✗' };

export function formatReport(report) {
  const lines = [''];
  lines.push(`worklog doctor — ${report.platform}`);
  lines.push(`data home: ${report.dataHome}`);
  lines.push('');
  for (const c of report.checks) {
    lines.push(`  ${ICON[c.status]} ${c.name.padEnd(16)} ${c.detail}`);
    if (c.fix) lines.push(`      → ${c.fix}`);
  }
  lines.push('');
  lines.push(`  ${report.counts.ok} ok, ${report.counts.warn} warning, ${report.counts.fail} failing`);
  lines.push('');
  return lines.join('\n');
}
