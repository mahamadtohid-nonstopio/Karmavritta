import { redactWithReport, redactionOptions } from './redact.mjs';
import { renderItem } from './render.mjs';

// Read-only reports over ticket files: the activity sheet and item export.
// Pure functions — no clock reads, no I/O — so the CLI owns every side effect
// and the tests can feed synthetic tickets straight in.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(d) { return d.toISOString().slice(0, 10); }

function parseDay(day) {
  if (!DAY_RE.test(day || '')) throw new Error(`Expected YYYY-MM-DD, got ${day ?? '(nothing)'}`);
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || isoDay(d) !== day) throw new Error(`Not a real date: ${day}`);
  return d;
}

/** Inclusive list of days for the ISO week (Mon–Sun) or calendar month containing `day`. */
export function periodDays(day, period = 'week') {
  const d = parseDay(day);
  const out = [];
  if (period === 'month') {
    const cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    while (cur.getUTCMonth() === d.getUTCMonth()) {
      out.push(isoDay(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }
  if (period !== 'week') throw new Error(`period must be week or month, got ${period}`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  const cur = new Date(d);
  cur.setUTCDate(cur.getUTCDate() - offset);
  for (let i = 0; i < 7; i++) {
    out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Activity per work item per day. The capture log records events, not
 * durations, so this is deliberately an activity sheet: recorded events,
 * sessions and commits — never hours.
 */
export function activitySheet(tickets, days) {
  const inRange = new Set(days);
  const rows = [];
  for (const t of tickets) {
    if (!t || t.key === '_unassigned') continue;
    const perDay = {};
    let events = 0, sessions = 0, commits = 0;
    for (const d of t.days || []) {
      if (!inRange.has(d.day)) continue;
      const n = d.stats?.events || 0;
      perDay[d.day] = (perDay[d.day] || 0) + n;
      events += n;
      sessions += d.stats?.sessions || 0;
    }
    for (const c of t.commits || []) {
      if (inRange.has((c.date || '').slice(0, 10))) commits++;
    }
    if (!events && !commits) continue;
    rows.push({ key: t.key, title: t.title || '', perDay, events, sessions, commits });
  }
  rows.sort((a, b) => b.events - a.events || b.commits - a.commits || a.key.localeCompare(b.key));
  const totals = { events: 0, sessions: 0, commits: 0, perDay: {} };
  for (const r of rows) {
    totals.events += r.events; totals.sessions += r.sessions; totals.commits += r.commits;
    for (const [day, n] of Object.entries(r.perDay)) totals.perDay[day] = (totals.perDay[day] || 0) + n;
  }
  return { from: days[0], to: days.at(-1), days, rows, totals };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sheetToCsv(sheet) {
  const head = ['key', 'title', ...sheet.days, 'events', 'sessions', 'commits'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of sheet.rows) {
    lines.push([r.key, r.title, ...sheet.days.map((d) => r.perDay[d] || 0), r.events, r.sessions, r.commits]
      .map(csvCell).join(','));
  }
  return lines.join('\n');
}

export function sheetToText(sheet) {
  const short = sheet.days.map((d) => d.slice(5)); // MM-DD
  const keyW = Math.max(8, ...sheet.rows.map((r) => r.key.length));
  const lines = [];
  lines.push(`Activity ${sheet.from} → ${sheet.to}  (recorded events per day — not hours)`);
  lines.push('');
  if (!sheet.rows.length) {
    lines.push('No recorded activity in this period.');
    return lines.join('\n');
  }
  lines.push(`${'ITEM'.padEnd(keyW)}  ${short.map((s) => s.padStart(5)).join(' ')}  ${'EVENTS'.padStart(6)} ${'SESS'.padStart(4)} ${'COMMITS'.padStart(7)}`);
  for (const r of sheet.rows) {
    const cells = sheet.days.map((d) => String(r.perDay[d] || '·').padStart(5)).join(' ');
    lines.push(`${r.key.padEnd(keyW)}  ${cells}  ${String(r.events).padStart(6)} ${String(r.sessions).padStart(4)} ${String(r.commits).padStart(7)}`);
  }
  const tcells = sheet.days.map((d) => String(sheet.totals.perDay[d] || '·').padStart(5)).join(' ');
  lines.push(`${'TOTAL'.padEnd(keyW)}  ${tcells}  ${String(sheet.totals.events).padStart(6)} ${String(sheet.totals.sessions).padStart(4)} ${String(sheet.totals.commits).padStart(7)}`);
  return lines.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
}

/** Minimal Markdown → HTML for the subset render.mjs emits. Everything is escaped first. */
export function markdownToHtml(md, title) {
  const out = [];
  let list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = line.match(/^- (.*)$/);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    closeList();
    if (line) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    ':root{color-scheme:light dark;--fg:#1d1d1f;--bg:#fff;--muted:#6e6e73;--code:#f2f2f5}',
    '@media (prefers-color-scheme:dark){:root{--fg:#e8e8ed;--bg:#161618;--muted:#a1a1a6;--code:#26262a}}',
    'body{font:16px/1.55 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:46rem;margin:2rem auto;padding:0 16px}',
    'code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.9em;word-break:break-word}',
    'h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:2rem}em{color:var(--muted)}',
    '</style></head><body>',
    ...out,
    '</body></html>',
    ''
  ].join('\n');
}

const BANNER_RE = /^<!-- generated by worklog[^\n]*-->\n?/m;

/**
 * Render one item for leaving the machine. Always redacted at `public` level
 * regardless of the configured mode — an export is a destination, and the
 * destination decides the mode. Returns what was masked so the caller can say so.
 */
export function exportItem(ticket, cfg, { format = 'md', exportedOn } = {}) {
  if (!['md', 'html'].includes(format)) throw new Error(`format must be md or html, got ${format}`);
  const base = redactionOptions(cfg);
  const md = renderItem(ticket, cfg).replace(BANNER_RE, '');
  const footer = `\n---\n_Exported${exportedOn ? ` ${exportedOn}` : ''} by worklog · redaction: public_\n`;
  const { text, found } = redactWithReport(md + footer, { ...base, mode: 'public' });
  const title = ticket.title ? `${ticket.key} — ${ticket.title}` : ticket.key;
  const content = format === 'html' ? markdownToHtml(text, redactWithReport(title, { ...base, mode: 'public' }).text) : text;
  return { content, masked: found };
}
