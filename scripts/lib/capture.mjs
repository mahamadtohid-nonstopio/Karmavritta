import fs from 'node:fs';
import path from 'node:path';
import * as safety from './safety.mjs';
import { loadConfig, getRawDayDir, getErrorsLog } from './config.mjs';
import { extractKeys } from './keys.mjs';
import { redactDeep, redact, redactionOptions } from './redact.mjs';
import { stableId } from './store.mjs';

export const RAW_SCHEMA_VERSION = 1;

/** Keep a hook's disk footprint bounded even if a tool returns a huge blob. */
const MAX_LINE_BYTES = 32 * 1024;

export function dayOf(iso) {
  return (iso || new Date().toISOString()).slice(0, 10);
}

function clip(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}…[+${value.length - max} chars]` : value;
}

function firstStringField(obj) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** One readable line per tool call — this is what the digest and notes quote. */
export function summarizeTool(name, input = {}) {
  switch (name) {
    case 'Bash':         return input.command || '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': return input.file_path || input.notebook_path || '';
    case 'Glob':         return input.pattern || '';
    case 'Grep':         return `${input.pattern || ''}${input.path ? ` in ${input.path}` : ''}`;
    case 'WebFetch':     return input.url || '';
    case 'WebSearch':    return input.query || '';
    case 'Task':         return input.description || '';
    default:             return firstStringField(input);
  }
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);
const ARTIFACT_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch']);

export function classifyTool(name) {
  if (FILE_TOOLS.has(name)) return 'file';
  if (ARTIFACT_TOOLS.has(name)) return 'artifact';
  return 'other';
}

/**
 * Build the raw record for a hook payload. Pure — does no IO — so tests can
 * assert on the shape and on redaction without touching disk.
 */
export function buildRecord(payload = {}, cfg, { now = new Date(), branch = '' } = {}) {
  const event = payload.hook_event_name || payload.event || 'Unknown';
  const ts = now.toISOString();
  const maxChars = cfg?.capture?.maxFieldChars ?? 2000;
  const redactOpts = redactionOptions(cfg);

  const tool = payload.tool_name || '';
  const rawSummary = event === 'UserPromptSubmit'
    ? (payload.prompt || '')
    : summarizeTool(tool, payload.tool_input);

  const summary = redact(clip(rawSummary, maxChars), redactOpts);
  const cwd = payload.cwd || '';

  // Keys can come from the prompt, the command, a file path, the branch or the
  // directory name. The tick later propagates a session's key across events
  // that mention none, so the hook does not need to be clever here.
  const keySources = [rawSummary, branch, cwd, payload.transcript_path || ''];
  const keys = [...new Set(keySources.flatMap((s) => extractKeys(s, cfg?.keyPrefixes)))];

  const record = {
    v: RAW_SCHEMA_VERSION,
    id: stableId('e', payload.session_id, ts, event, rawSummary),
    ts,
    day: dayOf(ts),
    session: payload.session_id || 'unknown',
    event,
    cwd: redact(cwd, redactOpts),
    keys,
    tool,
    kind: tool ? classifyTool(tool) : event.toLowerCase(),
    summary
  };

  if (branch) record.branch = branch;
  if (event === 'SessionStart' && payload.source) record.source = payload.source;
  if (event === 'SessionEnd' && payload.reason) record.reason = payload.reason;

  if (event === 'PostToolUse') {
    const response = payload.tool_response;
    record.ok = !(response && (response.error || response.is_error));
    const errText = response?.error || response?.stderr || '';
    if (errText) record.error = redact(clip(String(errText), 500), redactOpts);
  }

  // A small redacted slice of the input, for tools whose summary loses too much.
  if (payload.tool_input && record.kind === 'artifact') {
    record.detail = redactDeep(trimObject(payload.tool_input, maxChars), redactOpts);
  }

  return record;
}

function trimObject(obj, maxChars) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = clip(v, Math.min(maxChars, 600));
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function rawFileFor(day, session) {
  const safeSession = String(session || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return path.join(getRawDayDir(day), `${safeSession}.jsonl`);
}

/** Read-only branch lookup. Only called on SessionStart, where it is worth it. */
export function currentBranch(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return '';
  const r = safety.runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1500 });
  return r.ok ? r.stdout.trim() : '';
}

export function logCaptureError(err) {
  try {
    safety.appendLine(getErrorsLog(), JSON.stringify({
      ts: new Date().toISOString(),
      where: 'capture',
      message: String(err?.message || err)
    }));
  } catch {
    // Logging the failure must not become the failure.
  }
}

/**
 * The hook entry point. Returns a result object; never throws.
 */
export function captureEvent(payload = {}, { now = new Date() } = {}) {
  try {
    const cfg = loadConfig();
    if (!cfg.capture?.enabled) return { skipped: 'disabled' };
    if (cfg.capture?.paused) return { skipped: 'paused' };

    const event = payload.hook_event_name || payload.event || 'Unknown';
    const allowed = cfg.capture?.events || [];
    if (allowed.length && !allowed.includes(event)) return { skipped: 'event-not-captured' };

    const branch = event === 'SessionStart' ? currentBranch(payload.cwd) : '';
    const record = buildRecord(payload, cfg, { now, branch });

    let line = JSON.stringify(record);
    if (line.length > MAX_LINE_BYTES) {
      record.summary = clip(record.summary, 1000);
      delete record.detail;
      record.truncated = true;
      line = JSON.stringify(record);
    }

    const file = rawFileFor(record.day, record.session);
    safety.appendLine(file, line);
    return { written: true, file, id: record.id, keys: record.keys };
  } catch (err) {
    logCaptureError(err);
    return { error: String(err?.message || err) };
  }
}

/** Read every raw event for a day, newest file last. Skips unparseable lines. */
export function readRawDay(day) {
  const dir = getRawDayDir(day);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.jsonl')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* a torn line must not stop the tick */ }
    }
  }
  out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return out;
}

export function listRawDays() {
  const root = path.dirname(getRawDayDir('x'));
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}
