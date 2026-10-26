import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as safety from './safety.mjs';
import { getWorklogDir } from './config.mjs';
import { redact, redactionOptions } from './redact.mjs';
import { checkBudget, recordSpend } from './budget.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Prompts live on disk so retargeting the plugin at a new domain is an edit,
 * not a code change. A copy in the data home wins over the packaged default.
 */
export function loadPrompt(name = 'extract') {
  for (const p of [
    path.join(getWorklogDir(), 'prompts', `${name}.md`),
    path.join(PACKAGE_ROOT, 'prompts', `${name}.md`)
  ]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return '';
}

const KINDS = new Set(['finding', 'hypothesis', 'ruled-out', 'decision', 'note']);

/** A compact, numbered, already-redacted view of one ticket-day. */
export function buildDigest(key, day, events, cfg) {
  const opts = { ...redactionOptions(cfg), mode: 'secrets' };
  const lines = [`Work item: ${key}`, `Date: ${day}`, '', 'Events:'];
  for (const e of events) {
    const label = e.tool ? `${e.event}/${e.tool}` : e.event;
    const status = e.ok === false ? ' [FAILED]' : '';
    const summary = redact(e.summary || '', opts).replace(/\s+/g, ' ').slice(0, 300);
    lines.push(`- ${e.id} ${label}${status}: ${summary}`);
    if (e.error) lines.push(`    error: ${redact(e.error, opts).slice(0, 200)}`);
  }
  return lines.join('\n');
}

function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function cleanText(value, max = 200) {
  if (typeof value !== 'string') return '';
  return redact(value.replace(/\s+/g, ' ').trim(), { mode: 'public' }).slice(0, max);
}

/**
 * Enforce CLAUDE.md rule 10: a claim that does not cite a recorded event id is
 * dropped, not softened. Returns the validated object plus what was discarded.
 */
export function validateExtraction(raw, validIds) {
  const ids = validIds instanceof Set ? validIds : new Set(validIds || []);
  const dropped = [];
  const out = { title: '', summary: '', findings: [], decisions: [], rca: null };
  if (!raw || typeof raw !== 'object') return { result: out, dropped: ['response was not an object'] };

  out.title = cleanText(raw.title, 120);
  out.summary = cleanText(raw.summary, 600);

  const citedOf = (entry) => (Array.isArray(entry?.evidence) ? entry.evidence : [])
    .filter((id) => ids.has(id));

  for (const f of Array.isArray(raw.findings) ? raw.findings : []) {
    const evidence = citedOf(f);
    const text = cleanText(f?.text);
    if (!text) { dropped.push('finding with no text'); continue; }
    if (!evidence.length) { dropped.push(`uncited finding: ${text.slice(0, 60)}`); continue; }
    const kind = KINDS.has(f?.kind) ? f.kind : 'finding';
    out.findings.push({ kind, text, evidence });
  }

  for (const d of Array.isArray(raw.decisions) ? raw.decisions : []) {
    const evidence = citedOf(d);
    const text = cleanText(d?.text);
    if (!text) { dropped.push('decision with no text'); continue; }
    if (!evidence.length) { dropped.push(`uncited decision: ${text.slice(0, 60)}`); continue; }
    out.decisions.push({ text, evidence });
  }

  const rca = raw.rca;
  if (rca && typeof rca === 'object') {
    const evidence = citedOf(rca);
    const symptom = cleanText(rca.symptom, 300);
    const rootCause = cleanText(rca.rootCause, 300);
    const fix = cleanText(rca.fix, 300);
    if ((symptom || rootCause || fix) && evidence.length) {
      out.rca = { symptom, rootCause, fix, evidence };
    } else if (symptom || rootCause || fix) {
      dropped.push('uncited rca');
    }
  }

  return { result: out, dropped };
}

function modelArgs(cfg) {
  if (Array.isArray(cfg?.model?.args) && cfg.model.args.length) return cfg.model.args;
  return ['-p', '--output-format', 'json'];
}

function parseCliResponse(stdout) {
  // `--output-format json` wraps the answer; plain mode returns it directly.
  const envelope = extractJsonObject(stdout);
  if (envelope && typeof envelope.result === 'string') return extractJsonObject(envelope.result);
  return envelope;
}

/**
 * One model call, no tools. Returns a deterministic-fallback marker rather
 * than throwing, so an unavailable or over-budget model never skips a tick.
 */
export function runExtraction({ key, day, events, cfg, callsThisTick = 0 }) {
  const ids = new Set(events.map((e) => e.id));
  const budget = checkBudget(cfg, { callsThisTick });
  if (!budget.allowed) return { used: 'skipped', reason: budget.reason, result: null, dropped: [] };

  const prompt = loadPrompt('extract');
  if (!prompt) return { used: 'skipped', reason: 'extract prompt missing', result: null, dropped: [] };

  const digest = buildDigest(key, day, events, cfg);
  const input = `${prompt}\n\n---\n\n${digest}\n`;

  const command = cfg?.model?.command || 'claude';
  let r = safety.runCapture(command, modelArgs(cfg), {
    input,
    timeout: cfg?.model?.timeoutMs ?? 120_000
  });
  if (!r.ok && Array.isArray(cfg?.model?.args)) {
    // A configured flag set that this CLI version rejects should not be fatal.
    r = safety.runCapture(command, ['-p'], { input, timeout: cfg?.model?.timeoutMs ?? 120_000 });
  }
  if (!r.ok) return { used: 'unavailable', reason: r.reason, result: null, dropped: [] };

  recordSpend(cfg, 'extract');

  const parsed = parseCliResponse(r.stdout);
  if (!parsed) return { used: 'unparseable', reason: 'no JSON object in response', result: null, dropped: [] };

  const { result, dropped } = validateExtraction(parsed, ids);
  return { used: 'model', result, dropped, digestIds: [...ids] };
}

/**
 * What we can say without a model: counts, the files touched most, whether
 * anything failed. Deliberately boring and always available.
 */
export function deterministicSummary(key, day, events) {
  const tools = new Map();
  const files = new Set();
  let failures = 0;
  for (const e of events) {
    if (e.tool) tools.set(e.tool, (tools.get(e.tool) || 0) + 1);
    if (e.kind === 'file' && e.summary) files.add(e.summary);
    if (e.ok === false) failures += 1;
  }
  const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([t, n]) => `${t}×${n}`).join(', ');
  const parts = [`${events.length} recorded events on ${day}`];
  if (topTools) parts.push(`mostly ${topTools}`);
  if (files.size) parts.push(`${files.size} file${files.size === 1 ? '' : 's'} touched`);
  if (failures) parts.push(`${failures} failed call${failures === 1 ? '' : 's'}`);
  return { title: '', summary: `${parts.join('; ')}.`, findings: [], decisions: [], rca: null };
}
