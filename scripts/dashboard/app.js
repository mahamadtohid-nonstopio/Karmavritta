// Worklog dashboard. No framework, no build step, no third-party code.
// Every piece of recorded text reaches the page through textContent, never
// innerHTML, so nothing in a note, commit message or command can inject markup.

const $main = document.getElementById('main');
const $q = document.getElementById('q');
const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const SVG_NS = 'http://www.w3.org/2000/svg';

// --- icons (drawn here, stroke-only, 24px grid) -------------------------------------

const ICONS = {
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5' }]],
  calendar: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M16 3v4M8 3v4M3 10h18' }]],
  ticket: [['path', { d: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z' }], ['path', { d: 'M14 6v2M14 11v2M14 16v2' }]],
  activity: [['path', { d: 'M22 12h-4l-3 8-6-16-3 8H2' }]],
  shield: [['path', { d: 'M12 21s8-3.5 8-10V5l-8-3-8 3v6c0 6.5 8 10 8 10z' }], ['path', { d: 'm9 11.5 2 2 4-4' }]],
  copy: [['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }], ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.4-5.7L20 8.5' }], ['path', { d: 'M20 3.5v5h-5' }]],
  alert: [['path', { d: 'M10.3 4 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z' }], ['path', { d: 'M12 9.5v4M12 17h.01' }]],
  lines: [['path', { d: 'M5 7h14M5 12h14M5 17h9' }]],
  bulb: [['path', { d: 'M9 18h6M10 21h4' }], ['path', { d: 'M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3z' }]],
  dollar: [['path', { d: 'M12 3v18M16.5 7H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H7' }]],
  branch: [['circle', { cx: 6, cy: 5, r: 2 }], ['circle', { cx: 6, cy: 19, r: 2 }], ['circle', { cx: 18, cy: 7, r: 2 }], ['path', { d: 'M6 7v10M18 9c0 5-6 4-11 9' }]],
  filter: [['path', { d: 'M4 6h16M7 12h10M10 18h4' }]],
  chevL: [['path', { d: 'm15 18-6-6 6-6' }]],
  chevR: [['path', { d: 'm9 18 6-6-6-6' }]],
  arrowR: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  checkCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm8.5 12 2.5 2.5 4.5-5' }]],
  xCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm9 9 6 6M15 9l-6 6' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  target: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1.2 }]]
};

function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

// --- DOM helpers ------------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    // The CSP forbids inline style attributes; set styles through the CSSOM instead.
    else if (k === 'css') for (const [p, val] of Object.entries(v)) el.style[p] = String(val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const link = (href, ...children) => h('a', { href }, ...children);
const keyLink = (key) => h('a', { href: `#/ticket/${encodeURIComponent(key)}`, class: 'key' }, key);
const dayLink = (day, label) => (day ? link(`#/day/${day}`, label || day) : null);
const plural = (n, w, suffix = 's') => `${n} ${w}${n === 1 ? '' : suffix}`;

function rich(text, tokens = []) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(KEY_RE)) {
    frag.append(highlight(s.slice(last, m.index), tokens), keyLink(m[0]));
    last = m.index + m[0].length;
  }
  frag.append(highlight(s.slice(last), tokens));
  return frag;
}

function highlight(text, tokens) {
  const frag = document.createDocumentFragment();
  if (!tokens.length || !text) { frag.append(text); return frag; }
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  for (const part of text.split(re)) {
    if (part) frag.append(tokens.some((t) => t.toLowerCase() === part.toLowerCase()) ? h('mark', {}, part) : part);
  }
  return frag;
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', { class: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed: select the text instead'); }
}

/** `$ worklog tick  [Copy]` */
function cmdChip(cmd) {
  return h('span', { class: 'cmd' },
    h('span', { class: 'prompt' }, '$'), h('span', { class: 'txt' }, cmd),
    h('button', { class: 'copy', type: 'button', 'aria-label': `Copy: ${cmd}`, onclick: () => copy(cmd) }, icon('copy'), 'Copy'));
}

function emptyState({ ic = 'lines', title, text, actions = [], small = false }) {
  return h('div', { class: `empty${small ? ' small' : ''}` },
    h('div', { class: 'tile' }, icon(ic)),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    actions.length ? h('div', { class: 'actions' }, actions) : null);
}

function stat({ label, value, small, sub, ic, meter, compact }) {
  return h('div', { class: `stat${compact ? ' compact' : ''}` },
    ic ? h('span', { class: 'tile' }, icon(ic)) : null,
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, String(value), small ? h('small', {}, small) : null),
    meter !== undefined ? h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(meter * 100) },
      h('span', { css: { width: `${Math.min(100, Math.max(0, meter * 100))}%` } })) : null,
    sub ? h('div', { class: 'sub' }, sub) : null);
}

function card(title, count, body, { countClass = '' } = {}) {
  return h('section', { class: 'card' },
    title ? h('div', { class: 'card-head' }, title, count !== null && count !== undefined ? h('span', { class: `count ${countClass}` }, String(count)) : null) : null,
    body);
}

function pageHead({ eyebrow, title, lede, actions }) {
  return h('div', { class: 'page-head' },
    h('div', {}, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h1', {}, title), lede ? h('div', { class: 'lede' }, lede) : null),
    actions ? h('div', { class: 'head-actions' }, actions) : null);
}

function ago(iso) {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = min / 60;
  if (hr < 48) return `${hr < 10 ? hr.toFixed(1) : Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)} days ago`;
}

const D = (iso) => new Date(`${iso}T12:00:00Z`);
const fmt = (iso, opts) => D(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

function rangeLabel(from, to) {
  const a = D(from), b = D(to);
  if (from === to) return fmt(from, { day: 'numeric', month: 'short', year: 'numeric' });
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function statsLine(stats = {}) {
  const parts = [plural(stats.events || 0, 'event')];
  if (stats.sessions) parts.push(plural(stats.sessions, 'session'));
  if (stats.files) parts.push(`${plural(stats.files, 'file')} touched`);
  if (stats.failures) parts.push(plural(stats.failures, 'failed call'));
  const tools = Object.entries(stats.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}×${n}`);
  if (tools.length) parts.push(tools.join(', '));
  return parts.join(' · ');
}

// --- data ---------------------------------------------------------------------------------

async function api(path, { method = 'GET', action } = {}) {
  const headers = { Accept: 'application/json' };
  if (action) headers['X-Worklog-Action'] = action;
  const res = await fetch(path, { method, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  return body;
}

// --- health grouping (shared by Today's banner and the Health page) -------------------------

const CHECK_NAME = {
  'node runtime': 'Node', 'data home': 'Data home', config: 'Config', 'plugin install': 'Plugin install',
  hooks: 'Hooks', 'runtime copy': 'Runtime copy', 'tick schedule': 'Tick schedule', capture: 'Capture',
  'last tick': 'Last tick', git: 'Git', 'claude cli': 'Claude CLI', 'model spend': 'Model spend', 'recent errors': 'Recent errors'
};
const MONO_CHECKS = new Set(['node runtime', 'git', 'claude cli', 'data home']);
const FIX_ORDER = ['worklog install', 'worklog setup', 'worklog schedule', 'worklog tick'];
const FIX_TITLE = {
  'worklog install': 'Install the plugin', 'worklog setup': 'Set up Worklog',
  'worklog schedule': 'Schedule automatic summaries', 'worklog tick': 'Run your first summary'
};
const SCHEDULER = { schtasks: 'Windows Task Scheduler', launchd: 'launchd', cron: 'cron', crontab: 'cron' };

function checkDetail(c, today) {
  const d = c.detail || '';
  switch (c.name) {
    case 'config': {
      const m = d.match(/\(([^)]*)\)\s*$/);
      return m ? m[1].split(/,\s*/).map((x) => x.replace('=', ': ')).join(' · ') : d;
    }
    case 'git': return d.replace(/^git version\s*/, '');
    case 'claude cli': return d.replace(/\s*\(Claude Code\)/, '');
    case 'capture': return d.replace(/ on (\d{4}-\d{2}-\d{2}),/, (_, day) => (day === today ? ' today ·' : ` on ${day} ·`));
    case 'tick schedule': return d.replace(/^(\w+): not scheduled$/, (_, k) => `not registered in ${SCHEDULER[k] || k}`);
    default: return d;
  }
}

function parseFix(fix = '') {
  let text = fix.replace(/^Run:\s*/, '').trim();
  const restart = /restart Claude Code/i.test(text) && /^worklog\s/.test(text);
  text = text.replace(/,?\s*then restart Claude Code\.?$/i, '').trim();
  return { cmd: /^worklog\s[\w-]+$/.test(text) ? text : null, text, restart };
}

function groupIssues(checks) {
  const groups = new Map();
  for (const c of checks.filter((x) => x.status !== 'ok')) {
    const f = parseFix(c.fix || '');
    const id = f.cmd || f.text || c.name;
    if (!groups.has(id)) groups.set(id, { id, cmd: f.cmd, title: FIX_TITLE[f.cmd] || f.text || CHECK_NAME[c.name] || c.name, restart: false, checks: [], fail: false });
    const g = groups.get(id);
    g.checks.push(c);
    g.restart ||= f.restart;
    g.fail ||= c.status === 'fail';
  }
  const rank = (g) => { const i = FIX_ORDER.indexOf(g.cmd); return i === -1 ? 99 : i; };
  return [...groups.values()].sort((a, b) => (b.fail - a.fail) || rank(a) - rank(b));
}

// --- sidebar --------------------------------------------------------------------------------

async function loadMeta() {
  try {
    const m = await api('/api/meta');
    document.getElementById('ver').textContent = `v${m.version}`;
    const badge = document.getElementById('health-badge');
    const n = (m.health?.warn || 0) + (m.health?.fail || 0);
    badge.hidden = !n;
    badge.textContent = String(n);
    badge.className = `badge${m.health?.fail ? ' fail' : ''}`;
    badge.setAttribute('aria-label', `${n} health ${n === 1 ? 'issue' : 'issues'}`);
    const state = { on: ['', 'Capturing'], paused: ['warn', 'Capture paused'], off: ['off', 'Capture off'] }[m.capture] || ['off', m.capture];
    document.getElementById('side-foot').replaceChildren(
      h('div', { class: 'state' }, h('span', { class: `dot ${state[0]}` }), state[1]),
      h('div', {}, `Local only · 127.0.0.1:${m.port}`),
      h('div', {}, 'Views are read-only'),
      h('div', { class: 'path', title: m.dataHome }, m.dataHome));
  } catch { /* the page itself reports a dead server */ }
}

// --- shared renderers ----------------------------------------------------------------------

function entryList(findings = [], decisions = []) {
  const rows = [
    ...findings.map((f) => ({ tag: f.kind || 'finding', text: f.text, ev: f.evidence })),
    ...decisions.map((d) => ({ tag: 'decision', text: d.text, ev: d.evidence }))
  ];
  if (!rows.length) return null;
  return h('ul', { class: 'entries' }, rows.map((r) => h('li', {},
    h('span', { class: `tag kind-${r.tag}` }, r.tag),
    h('span', {}, rich(r.text), (r.ev || []).length ? h('span', { class: 'cite', title: 'Recorded event ids this claim cites' }, r.ev.slice(0, 2).join(' ')) : null))));
}

function itemRow(item) {
  return h('li', {},
    h('div', { class: 'row-head' }, keyLink(item.key), item.title ? h('span', { class: 'title' }, item.title) : null,
      item.days && item.days.length > 1 ? h('span', { class: 'meta' }, plural(item.days.length, 'day')) : null),
    item.summary ? h('p', { class: 'summary' }, rich(item.summary)) : null,
    entryList(item.findings, item.decisions),
    item.rca?.rootCause ? h('p', { class: 'summary' }, h('strong', {}, 'Root cause: '), rich(item.rca.rootCause)) : null,
    h('div', { class: 'meta', css: { marginTop: '8px' } }, statsLine(item.stats)));
}

function summariseButton(label = 'Summarise now', primary = true) {
  const btn = h('button', { class: `btn ${primary ? 'primary' : ''}`, type: 'button' }, icon('refresh'), label);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.replaceChildren(icon('refresh', 'spin'), 'Summarising…');
    try {
      const r = await api('/api/tick', { method: 'POST', action: 'tick' });
      if (r.skipped) toast(`Skipped: ${r.skipped}`);
      else if (r.error) toast(`Failed: ${r.error}`);
      else toast(`Summarised ${plural(r.items, 'item-day')} · ${plural(r.notesWritten, 'note')} updated`);
    } catch (e) {
      toast(e.message);
    }
    loadMeta();
    render();
  });
  return btn;
}

function setupSteps() {
  return h('div', { class: 'steps' },
    h('div', { class: 'step' },
      h('h4', {}, h('span', { class: 'num' }, '1'), 'Mention a ticket key'),
      h('p', {}, 'Include the key in your branch name or in a prompt to Claude Code. New work is picked up within minutes.'),
      h('span', { class: 'branch-chip' }, icon('branch'), 'feature/', h('span', { class: 'k' }, 'PROJ-123'), '-login')),
    h('div', { class: 'step' },
      h('h4', {}, h('span', { class: 'num' }, '2'), 'Import your git history'),
      h('p', {}, 'Backfill past commits that already reference ticket keys, so your history is here from day one.'),
      cmdChip('worklog backfill')));
}

// --- Today ---------------------------------------------------------------------------------

async function viewToday(params) {
  const range = params.get('range') === 'week' ? 'week' : 'day';
  const [o, hl] = await Promise.all([api(`/api/overview?range=${range}`), api('/api/health').catch(() => null)]);
  const week = range === 'week';
  const s = o.status;
  const cap = o.capture || { events: 0, pending: 0 };
  const spent = s.spend?.usd || 0;
  const budget = s.budgetUsd ?? null;
  const span = week ? 'this week' : 'today';

  const nodes = [pageHead({
    eyebrow: week ? rangeLabel(o.from, o.to) : fmt(o.today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    title: week ? 'This week' : 'Today',
    lede: `Last summary: ${ago(s.lastTick)}`,
    actions: [
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Range' },
        h('a', { href: '#/', 'aria-current': week ? null : 'true' }, 'Day'),
        h('a', { href: '#/?range=week', 'aria-current': week ? 'true' : null }, 'Week')),
      summariseButton()
    ]
  })];

  if (hl) {
    const groups = groupIssues(hl.checks);
    const issues = hl.counts.warn + hl.counts.fail;
    if (issues) {
      const total = hl.checks.length;
      const first = groups[0];
      const setup = groups.some((g) => FIX_ORDER.includes(g.cmd));
      const most = first && first.checks.length * 2 > issues;
      nodes.push(h('section', { class: 'banner', 'aria-label': 'Setup' },
        h('div', { class: 'tile' }, icon('alert')),
        h('div', {},
          h('h2', {}, setup ? 'Finish setup to start seeing your work' : `${plural(issues, 'check')} ${issues === 1 ? 'needs' : 'need'} attention`),
          h('p', {}, `${issues} of ${total} checks need attention. `,
            first?.cmd ? (most ? 'One command fixes most of them' : 'Start with the first step') + (first.restart ? ', then restart Claude Code.' : '.') : 'See Health for what to do.'),
          h('div', { class: 'bar' }, h('span', { css: { width: `${(hl.counts.ok / total) * 100}%` } })),
          h('div', { class: 'small' }, `${hl.counts.ok} of ${total} checks passing`)),
        h('div', { class: 'actions' }, first?.cmd ? cmdChip(first.cmd) : null,
          h('a', { class: 'btn', href: '#/health' }, 'View checks', icon('arrowR')))));
    }
  }

  nodes.push(h('div', { class: 'stats' },
    stat({ label: 'Work items', value: o.items.length, ic: 'lines',
      sub: cap.pending ? `${plural(cap.pending, 'event')} waiting to be summarised` : cap.events ? `${plural(cap.events, 'event')} captured today` : 'nothing captured yet today' }),
    stat({ label: 'Tickets', value: o.counts.newTickets, ic: 'ticket', sub: `recorded ${span}` }),
    stat({ label: 'Findings', value: o.counts.findings, ic: 'bulb', sub: `recorded ${span}` }),
    stat({ label: 'Model spend', value: `$${spent.toFixed(2)}`, small: budget !== null ? `of $${Number(budget).toFixed(2)}` : null, ic: 'dollar',
      meter: budget ? spent / budget : 0 })));

  let worked;
  if (o.items.length) worked = h('ul', { class: 'list' }, o.items.map(itemRow));
  else if (cap.pending) {
    worked = emptyState({ ic: 'lines', title: 'Nothing summarised yet',
      text: `You have ${plural(cap.pending, 'captured event')} from today. Notes appear a few minutes after you work, or you can summarise them right now.`,
      actions: [summariseButton('Summarise now'), cmdChip('worklog tick')] });
  } else if (!cap.events) {
    worked = emptyState({ ic: 'lines', title: `Nothing captured yet ${span}`,
      text: 'Work in Claude Code as usual. Each prompt and tool call is recorded, then summarised here every few minutes.' });
  } else {
    worked = emptyState({ ic: 'ticket', title: `No ticket work ${span}`,
      text: [`${plural(cap.events, 'event')} today didn't mention a ticket key. Put a key like `, h('code', { class: 'inline' }, 'PROJ-123'), ' in your branch name or prompt.'] });
  }

  const recent = o.recent.length
    ? h('ul', { class: 'list' }, o.recent.map((r) => h('li', {},
      h('div', { class: 'row-head' }, keyLink(r.key), h('span', { class: 'meta', css: { marginLeft: 'auto' } }, r.lastActive ? fmt(r.lastActive, { day: 'numeric', month: 'short' }) : '')),
      r.title ? h('div', { class: 'title', css: { marginTop: '2px' } }, r.title) : null,
      h('div', { class: 'meta' }, `${plural(r.findings, 'finding')} · ${plural(r.commits, 'commit')}`))))
    : emptyState({ ic: 'branch', title: 'No tickets this week',
      text: ['Put a ticket key like ', h('code', { class: 'inline' }, 'PROJ-123'), ' in your branch name or prompt and it shows up here.'] });

  nodes.push(h('div', { class: 'grid split' },
    card(week ? 'Worked on this week' : 'Worked on today', o.items.length, worked),
    card('Active this week', o.recent.length, recent)));
  return nodes;
}

// --- Day ---------------------------------------------------------------------------------

async function viewDay(day) {
  const d = await api(`/api/day/${encodeURIComponent(day)}`);
  const picker = h('input', { type: 'date', value: d.day, 'aria-label': 'Jump to day',
    onchange: (e) => { if (e.target.value) location.hash = `#/day/${e.target.value}`; } });
  return [
    pageHead({
      eyebrow: fmt(d.day, { weekday: 'long' }),
      title: fmt(d.day, { day: 'numeric', month: 'long', year: 'numeric' }),
      lede: plural(d.items.length, 'work item'),
      actions: [
        h('a', { class: 'btn icon', href: d.prev ? `#/day/${d.prev}` : '#', 'aria-disabled': d.prev ? null : 'true', 'aria-label': 'Previous active day', title: d.prev || '' }, icon('chevL')),
        picker,
        h('a', { class: 'btn icon', href: d.next ? `#/day/${d.next}` : '#', 'aria-disabled': d.next ? null : 'true', 'aria-label': 'Next active day', title: d.next || '' }, icon('chevR'))
      ]
    }),
    card('Worked on', d.items.length, h('div', {},
      d.items.length ? h('ul', { class: 'list' }, d.items.map(itemRow)) : emptyState({ ic: 'calendar', title: 'No recorded work on this day', small: true }),
      d.note ? h('div', { class: 'card-body' }, h('details', {}, h('summary', {}, 'Raw daily note'), h('pre', { class: 'note' }, d.note))) : null))
  ];
}

// --- Tickets -------------------------------------------------------------------------------

function ticketTable(rows) {
  const cols = [
    { k: 'key', label: 'Key' }, { k: 'title', label: 'Title' }, { k: 'lastActive', label: 'Last activity' },
    { k: 'events', label: 'Events', num: true }, { k: 'commits', label: 'Commits', num: true }
  ];
  let sort = { k: 'lastActive', dir: -1 };
  const thead = h('thead');
  const tbody = h('tbody');
  const paint = () => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sort.k] ?? '', y = b[sort.k] ?? '';
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir || a.key.localeCompare(b.key);
    });
    thead.replaceChildren(h('tr', {}, cols.map((c) => h('th', {
      class: c.num ? 'num-col' : null, scope: 'col', 'aria-sort': sort.k === c.k ? (sort.dir === 1 ? 'ascending' : 'descending') : null
    }, h('button', { type: 'button', onclick: () => { sort = { k: c.k, dir: sort.k === c.k ? -sort.dir : (c.num || c.k === 'lastActive' ? -1 : 1) }; paint(); } }, c.label)))));
    tbody.replaceChildren(...sorted.map((r) => h('tr', { class: 'row', onclick: (e) => { if (!e.target.closest('a')) location.hash = `#/ticket/${encodeURIComponent(r.key)}`; } },
      h('td', {}, keyLink(r.key)),
      h('td', {}, r.title ? h('span', { class: 'title' }, r.title) : h('span', { class: 'meta' }, '—'), r.hasRca ? [' ', h('span', { class: 'chip ok' }, 'RCA')] : null),
      h('td', {}, r.lastActive ? dayLink(r.lastActive, fmt(r.lastActive, { day: 'numeric', month: 'short', year: 'numeric' })) : '—'),
      h('td', { class: 'num-col' }, r.events), h('td', { class: 'num-col' }, r.commits))));
  };
  paint();
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table tickets' }, thead, tbody));
}

async function viewTickets(params) {
  const { tickets } = await api('/api/tickets');
  const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const tabs = {
    all: tickets,
    week: tickets.filter((t) => (t.lastActive || '') >= weekAgo),
    findings: tickets.filter((t) => t.findings > 0)
  };
  const tab = tabs[params.get('tab')] ? params.get('tab') : 'all';
  const help = params.get('help') === '1';
  const input = h('input', { type: 'search', placeholder: 'Filter by key or title', 'aria-label': 'Filter tickets', value: params.get('f') || '' });
  const holder = h('div');
  const paint = () => {
    const f = input.value.trim().toLowerCase();
    const rows = f ? tabs[tab].filter((t) => `${t.key} ${t.title}`.toLowerCase().includes(f)) : tabs[tab];
    if (!tickets.length) {
      holder.replaceChildren(h('section', { class: 'card' },
        h('table', { class: 'table tickets' }, h('thead', {}, h('tr', {}, ['Key', 'Title', 'Last activity', 'Events', 'Commits'].map((c, i) => h('th', { class: i > 2 ? 'num-col' : null }, c))))),
        emptyState({ ic: 'ticket', title: 'No tickets yet', text: 'Worklog links your work to tickets automatically. Pick either way to get started.' }),
        setupSteps()));
      return;
    }
    holder.replaceChildren(
      h('section', { class: 'card' }, rows.length ? ticketTable(rows)
        : emptyState({ ic: 'filter', title: 'No ticket matches', text: f ? 'Try a shorter filter, or another tab.' : 'Nothing in this tab yet.', small: true })),
      help ? h('section', { class: 'card', css: { marginTop: '16px' } },
        emptyState({ ic: 'branch', title: 'How tickets get linked', text: 'Worklog finds keys like PROJ-123 in your prompts, branch names, commit messages and doc file names.' }), setupSteps()) : null);
  };
  input.addEventListener('input', paint);
  paint();
  const tabHref = (t) => `#/tickets${t === 'all' ? '' : `?tab=${t}`}`;
  return [
    pageHead({ title: 'Tickets', lede: 'Every ticket Worklog has seen in your prompts, branches and commits.' }),
    h('div', { class: 'page-head', css: { marginBottom: '16px' } },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' },
        h('a', { href: tabHref('all'), 'aria-current': tab === 'all' ? 'true' : null }, 'All ', h('span', { class: 'n' }, String(tabs.all.length))),
        h('a', { href: tabHref('week'), 'aria-current': tab === 'week' ? 'true' : null }, 'Active this week'),
        h('a', { href: tabHref('findings'), 'aria-current': tab === 'findings' ? 'true' : null }, 'With findings')),
      h('label', { class: 'filter' }, icon('filter'), input)),
    holder
  ];
}

// --- Ticket ----------------------------------------------------------------------------------

async function viewTicket(key) {
  let t;
  try { t = await api(`/api/ticket/${encodeURIComponent(key)}`); } catch (e) {
    if (e.status === 404) return [pageHead({ title: key }), card(null, null, emptyState({ ic: 'ticket', title: 'Nothing recorded yet', text: `Worklog has no record for ${key}. Mention it in a prompt or branch name, or run worklog backfill.` }))];
    throw e;
  }
  const sections = [];
  const add = (id, title, count, body) => sections.push({ id, title, count, el: h('div', { id: `s-${id}` }, card(title, count, body)) });

  if (t.rca && (t.rca.symptom || t.rca.rootCause || t.rca.fix)) {
    add('rca', 'Root cause', null, h('div', { class: 'card-body rca' }, h('dl', {},
      t.rca.symptom ? [h('dt', {}, 'Symptom'), h('dd', {}, rich(t.rca.symptom))] : null,
      t.rca.rootCause ? [h('dt', {}, 'Cause'), h('dd', {}, rich(t.rca.rootCause))] : null,
      t.rca.fix ? [h('dt', {}, 'Fix'), h('dd', {}, rich(t.rca.fix))] : null)));
  }
  if (t.findings.length) add('findings', 'Findings', t.findings.length, h('div', { class: 'card-body' }, h('ul', { class: 'entries', css: { margin: 0 } }, t.findings.map((f) => h('li', {},
    h('span', { class: `tag kind-${f.kind || 'finding'}` }, f.kind || 'finding'),
    h('span', {}, rich(f.text), ' ', f.date ? h('span', { class: 'meta' }, dayLink(f.date)) : null))))));
  if (t.decisions.length) add('decisions', 'Decisions', t.decisions.length, h('div', { class: 'card-body' }, h('ul', { class: 'entries', css: { margin: 0 } }, t.decisions.map((d) => h('li', {},
    h('span', { class: 'tag kind-decision' }, 'decision'), h('span', {}, rich(d.text), ' ', d.date ? h('span', { class: 'meta' }, dayLink(d.date)) : null))))));
  if (t.timeline.length) add('timeline', 'Timeline', t.timeline.length, h('ul', { class: 'list' }, t.timeline.map((d) => h('li', {},
    h('div', { class: 'row-head' }, dayLink(d.day, fmt(d.day, { weekday: 'short', day: 'numeric', month: 'short' })), h('span', { class: 'meta' }, statsLine(d.stats))),
    d.summary ? h('p', { class: 'summary' }, rich(d.summary)) : null))));
  if (t.commits.length) add('commits', 'Commits', t.commits.length, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Commit'), h('th', {}, 'Date'), h('th', {}, 'Repo'), h('th', {}, 'Message'))),
    h('tbody', {}, t.commits.map((c) => h('tr', {}, h('td', { class: 'mono' }, c.sha), h('td', {}, dayLink(c.date)), h('td', {}, c.repo), h('td', {}, rich(c.message))))))));
  if (t.prs.length) add('prs', 'Pull requests', t.prs.length, h('ul', { class: 'list' }, t.prs.map((p) => h('li', {},
    h('div', { class: 'row-head' }, h('span', { class: 'mono' }, `#${p.id}`), h('span', { class: 'chip' }, p.status || '?'), h('span', { class: 'title' }, p.title))))));
  if (t.docs.length) add('docs', 'Docs', t.docs.length, h('ul', { class: 'list mono-list' }, t.docs.map((d) => h('li', {}, d.path, d.modified ? h('span', { class: 'cite' }, d.modified) : null))));
  if (t.files.length) add('files', 'Files touched', t.files.length, h('ul', { class: 'list mono-list' }, t.files.slice(0, 50).map((f) => h('li', {}, f.path, h('span', { class: 'cite' }, `×${f.count}`)))));
  if (t.commands.length) add('commands', 'Commands and queries', t.commands.length, h('ul', { class: 'list mono-list' }, t.commands.slice(0, 50).map((c) => h('li', {}, c.body, c.date ? h('span', { class: 'cite' }, c.date) : null))));
  if (t.note) add('note', 'Rolling note', null, h('div', { class: 'card-body' }, h('details', {}, h('summary', {}, 'Show the generated Markdown'), h('pre', { class: 'note' }, t.note))));

  const meta = [];
  if (t.firstActive || t.lastActive) meta.push(['Active ', dayLink(t.firstActive) || '?', ' → ', dayLink(t.lastActive) || '?', ` (${plural(t.days, 'day')})`]);
  if (t.repos.length) meta.push(`Repos: ${t.repos.join(', ')}`);
  if (t.branches.length) meta.push(`Branches: ${t.branches.join(', ')}`);

  return [
    pageHead({
      eyebrow: t.status || null,
      title: [h('span', { class: 'key' }, t.key), t.title ? ` ${t.title}` : ''],
      lede: meta.length ? meta.map((m, i) => [i ? ' · ' : '', m]) : null,
      actions: [t.link ? h('a', { class: 'btn', href: t.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open in tracker') : null, cmdChip(`worklog export ${t.key} --format html`)]
    }),
    t.notes ? h('div', { css: { marginBottom: '16px' } }, card('Notes', null, h('div', { class: 'card-body' }, rich(t.notes)))) : null,
    sections.length ? h('nav', { class: 'section-nav', 'aria-label': 'Sections' }, sections.map((s) =>
      h('button', { type: 'button', onclick: () => document.getElementById(`s-${s.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, s.title, s.count ? ` ${s.count}` : ''))) : null,
    sections.length ? h('div', { class: 'grid' }, sections.map((s) => s.el))
      : card(null, null, emptyState({ ic: 'ticket', title: 'Nothing captured in this ticket yet', small: true }))
  ];
}

// --- Search -----------------------------------------------------------------------------------

const TYPE_LABEL = { ticket: 'Tickets', finding: 'Findings', decision: 'Decisions', rca: 'Root causes', day: 'Day summaries', commit: 'Commits', doc: 'Docs', command: 'Commands', file: 'Files' };

async function viewSearch(params) {
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  if ($q.value !== q && document.activeElement !== $q) $q.value = q;
  if (!q.trim()) {
    return [pageHead({ title: 'Search', lede: 'Every word must match. Searches ticket keys and titles, findings, decisions, root causes, commits, docs, commands and file paths.' }),
      card(null, null, emptyState({ ic: 'search', title: 'Type in the search box', text: ['Press ', h('code', { class: 'inline' }, '/'), ' from anywhere to jump to it.'] }))];
  }
  const r = await api(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${encodeURIComponent(type)}` : ''}&limit=100`);
  const all = Object.values(r.counts).reduce((a, b) => a + b, 0);
  const chipHref = (t) => `#/search?q=${encodeURIComponent(q)}${t ? `&type=${t}` : ''}`;
  return [
    pageHead({ title: 'Search', lede: `${plural(all, 'match', 'es')} for “${q}”${type ? ` · showing ${TYPE_LABEL[type] || type}` : ''}` }),
    all ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by type' },
      h('a', { class: 'chip', href: chipHref(''), 'aria-current': type ? null : 'true' }, `All ${all}`),
      Object.entries(r.counts).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
        h('a', { class: 'chip', href: chipHref(t), 'aria-current': type === t ? 'true' : null }, `${TYPE_LABEL[t] || t} ${n}`))) : null,
    card(null, null, r.results.length ? h('ul', { class: 'list' }, r.results.map((x) => h('li', {},
      h('div', { class: 'row-head' },
        h('span', { class: `chip ${x.type === 'finding' ? `kind-${x.kind}` : ''}` }, x.type === 'finding' ? x.kind : x.type),
        keyLink(x.key), x.title && x.type !== 'ticket' ? h('span', { class: 'meta' }, x.title) : null,
        x.ref ? h('span', { class: 'mono meta' }, x.ref) : null,
        x.date ? h('span', { class: 'meta', css: { marginLeft: 'auto' } }, dayLink(x.date)) : null),
      h('div', { class: x.type === 'file' || x.type === 'command' ? 'summary mono' : 'summary' }, highlight(x.snippet, r.tokens)))))
      : emptyState({ ic: 'search', title: 'No matches', text: 'Try fewer or different words, or a ticket key.', small: true })),
    r.total > r.results.length ? h('p', { class: 'meta' }, `Showing the top ${r.results.length} of ${r.total}.`) : null
  ];
}

// --- Root causes --------------------------------------------------------------------------------

function rcaCard(r, tokens) {
  const row = (label, text) => (text ? [h('dt', {}, label), h('dd', {}, rich(text, tokens))] : null);
  return h('article', { class: 'card rca-card' },
    h('header', { class: 'rca-head' },
      h('h3', {}, h('a', { href: `#/ticket/${encodeURIComponent(r.key)}`, class: 'key' }, highlight(r.key, tokens)),
        r.title ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, ' — '), h('span', {}, highlight(r.title, tokens))] : null),
      h('div', { class: 'rca-meta' },
        r.status ? h('span', { class: 'chip' }, r.status) : null,
        r.date ? h('span', { class: 'meta' }, dayLink(r.date, fmt(r.date, { day: 'numeric', month: 'short', year: 'numeric' }))) : null)),
    h('dl', { class: 'rca-body' }, row('Symptom', r.symptom), row('Cause', r.rootCause), row('Fix', r.fix)),
    h('footer', { class: 'rca-foot' },
      h('a', { href: `#/ticket/${encodeURIComponent(r.key)}` }, 'Open ticket', icon('arrowR')),
      r.evidence?.length ? h('span', { class: 'cite', title: 'Recorded event ids this root cause cites' }, r.evidence.join(' ')) : null));
}

async function viewRcas(params) {
  const first = await api(`/api/rcas?q=${encodeURIComponent(params.get('q') || '')}`);
  const input = h('input', { type: 'search', placeholder: 'Search root causes: symptom, cause, fix, key', 'aria-label': 'Search root causes', value: first.q });
  const summary = h('div', { class: 'lede', role: 'status' });
  const holder = h('div', { class: 'grid' });

  const paint = (r) => {
    summary.textContent = !r.total ? '' : r.tokens.length
      ? `${r.count} of ${plural(r.total, 'root cause')} match “${r.q}”`
      : `${plural(r.total, 'root cause')}, newest first`;
    if (!r.total) {
      holder.replaceChildren(card(null, null, emptyState({ ic: 'target', title: 'No root causes yet',
        text: ['When a session’s summary works out why something broke, it is recorded here as Symptom, Cause and Fix. ',
          'Root causes come from model summaries, so keep model calls on and say it plainly in the session, for example ',
          h('code', { class: 'inline' }, 'the root cause is …'), '.'] })));
    } else if (!r.rcas.length) {
      holder.replaceChildren(card(null, null, emptyState({ ic: 'search', title: 'No root cause matches', text: 'Every word must match. Try fewer words, or a ticket key.', small: true })));
    } else {
      holder.replaceChildren(...r.rcas.map((x) => rcaCard(x, r.tokens)));
    }
  };
  paint(first);

  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      history.replaceState(null, '', q ? `#/rcas?q=${encodeURIComponent(q)}` : '#/rcas');
      const mine = ++seq;
      try { const r = await api(`/api/rcas?q=${encodeURIComponent(q)}`); if (mine === seq) paint(r); } catch (e) { toast(e.message); }
    }, 180);
  });
  queueMicrotask(() => { if (first.q) input.focus(); });

  return [
    pageHead({ title: 'Root causes', lede: 'Why things broke and how they were fixed, one card per ticket.' }),
    h('div', { class: 'page-head', css: { marginBottom: '16px', alignItems: 'center' } }, summary,
      h('label', { class: 'filter rca-search' }, icon('search'), input)),
    holder
  ];
}

// --- Activity ---------------------------------------------------------------------------------

async function viewActivity(params) {
  const period = params.get('period') === 'month' ? 'month' : 'week';
  const date = params.get('date') || '';
  const a = await api(`/api/activity?period=${period}${date ? `&date=${date}` : ''}`);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const href = (p, d) => `#/activity?period=${p}${d ? `&date=${d}` : ''}`;
  const max = Math.max(1, ...a.rows.flatMap((r) => Object.values(r.perDay)));
  const level = (n) => (n ? Math.min(4, Math.max(1, Math.ceil((4 * n) / max))) : 0);
  const activeDays = a.days.filter((d) => a.totals.perDay[d]).length;
  const busiest = a.days.reduce((best, d) => ((a.totals.perDay[d] || 0) > (a.totals.perDay[best] || 0) ? d : best), a.days[0]);
  const hasBusiest = (a.totals.perDay[busiest] || 0) > 0;
  const month = period === 'month';

  const head = h('tr', {}, h('th', { class: 'lead', scope: 'col' }, 'Ticket'),
    a.days.map((d) => h('th', { scope: 'col', class: d === today ? 'today' : null },
      month ? fmt(d, { weekday: 'narrow' }) : fmt(d, { weekday: 'short' }),
      h('span', { class: 'dnum' }, String(D(d).getUTCDate())))),
    a.rows.length ? h('th', { scope: 'col' }, 'Total') : null);

  let body;
  if (a.rows.length) {
    body = a.rows.map((r) => h('tr', {},
      h('td', { class: 'label' }, keyLink(r.key), r.title ? h('span', { class: 'title' }, r.title) : null),
      a.days.map((d) => {
        const n = r.perDay[d] || 0;
        return h('td', { class: 'tile' }, n
          ? h('a', { href: `#/day/${d}`, class: `l${level(n)}`, title: `${r.key} on ${fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}: ${plural(n, 'event')}` }, String(n))
          : h('span', { 'aria-label': 'no activity' }));
      }),
      h('td', { class: 'total' }, String(r.events))));
  } else {
    body = [110, 140, 90].map((w) => h('tr', { 'aria-hidden': 'true' },
      h('td', { class: 'label' }, h('div', { class: 'skeleton-bar', css: { width: `${w}px` } })),
      a.days.map(() => h('td', { class: 'tile' }, h('span')))));
  }

  const legend = h('div', { class: 'legend', 'aria-hidden': 'true' }, 'Less', [0, 1, 2, 3, 4].map((i) => h('i', { class: `lg${i}` })), 'More');

  return [
    pageHead({
      title: 'Activity',
      lede: 'How busy each ticket was, day by day. Counts are recorded events, not hours.',
      actions: [
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' },
          h('a', { href: href('week', date), 'aria-current': month ? null : 'true' }, 'Week'),
          h('a', { href: href('month', date), 'aria-current': month ? 'true' : null }, 'Month')),
        h('a', { class: 'btn icon', href: href(period, a.prev), 'aria-label': `Previous ${period}` }, icon('chevL')),
        h('a', { class: 'pill', href: href(period, ''), title: `Back to this ${period}`, css: { color: 'var(--text)', textDecoration: 'none' } },
          month ? fmt(a.from, { month: 'long', year: 'numeric' }) : rangeLabel(a.from, a.to)),
        h('a', { class: 'btn icon', href: href(period, a.next), 'aria-label': `Next ${period}` }, icon('chevR'))
      ]
    }),
    h('div', { class: 'stats' },
      stat({ label: 'Events', value: a.totals.events, compact: true }),
      stat({ label: 'Tickets touched', value: a.rows.length, compact: true }),
      stat({ label: 'Active days', value: activeDays, small: `of ${a.days.length}`, compact: true }),
      stat({ label: 'Busiest day', value: hasBusiest ? fmt(busiest, { weekday: 'short', day: 'numeric' }) : '—',
        small: hasBusiest ? plural(a.totals.perDay[busiest], 'event') : null, compact: true })),
    h('section', { class: 'card' },
      h('div', { class: `heat${month ? ' month' : ''}${a.rows.length ? '' : ' heat-empty'}` }, h('table', {}, h('thead', {}, head), h('tbody', {}, body))),
      a.rows.length ? null : emptyState({ ic: 'activity', title: `No activity recorded this ${period}`,
        text: 'Once your work is linked to tickets, each row fills in with how much happened on that day.',
        actions: [h('a', { class: 'btn', href: '#/tickets?help=1' }, 'How tickets get linked', icon('arrowR'))] }),
      legend)
  ];
}

// --- Health ----------------------------------------------------------------------------------

async function viewHealth(params, { fresh = false } = {}) {
  const r = await api(`/api/health${fresh ? '?fresh=1' : ''}`);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const total = r.checks.length;
  const groups = groupIssues(r.checks);
  const good = r.checks.filter((c) => c.status === 'ok');
  const issues = r.counts.warn + r.counts.fail;
  const pct = (n) => `${(n / total) * 100}`;

  const rerun = h('button', { class: 'btn', type: 'button' }, icon('refresh'), 'Re-run checks');
  rerun.addEventListener('click', async () => {
    rerun.disabled = true;
    rerun.replaceChildren(icon('refresh', 'spin'), 'Checking…');
    try { const nodes = await viewHealth(params, { fresh: true }); $main.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); toast('Checks re-run'); }
    catch (e) { toast(e.message); rerun.disabled = false; }
    loadMeta();
  });

  const SHOW = 6;
  const goodCell = (c) => h('div', { class: 'card good' }, icon('checkCircle'), h('b', {}, CHECK_NAME[c.name] || c.name),
    h('span', { class: `d${MONO_CHECKS.has(c.name) ? ' mono' : ''}`, title: c.detail }, checkDetail(c, today)));
  const goodGrid = h('div', { class: 'good-grid' }, good.slice(0, SHOW).map(goodCell));
  const more = good.length > SHOW ? h('button', { class: 'btn', type: 'button', css: { marginTop: '12px' } }, `Show ${good.length - SHOW} more`) : null;
  more?.addEventListener('click', () => { goodGrid.append(...good.slice(SHOW).map(goodCell)); more.remove(); });

  return [
    pageHead({
      title: 'Health',
      lede: [r.os, `Worklog ${r.version}`, r.claudeVersion ? `Claude Code ${r.claudeVersion}` : null].filter(Boolean).join(' · '),
      actions: [rerun]
    }),
    h('div', { class: 'grid split' },
      h('section', { class: 'card pad' },
        h('div', { class: 'score' }, h('span', { class: 'big' }, String(r.counts.ok)), h('span', { class: 'of' }, `of ${total} checks passing`),
          h('span', { class: `todo${issues ? '' : ' ok'}` }, issues ? `${plural(groups.length, 'step')} to finish setup` : 'All checks passed')),
        h('div', { class: 'segbar', role: 'img', 'aria-label': `${r.counts.ok} passing, ${r.counts.warn} warnings, ${r.counts.fail} failing` },
          r.counts.ok ? h('span', { class: 'ok', css: { flexGrow: pct(r.counts.ok) } }) : null,
          r.counts.warn ? h('span', { class: 'warn', css: { flexGrow: pct(r.counts.warn) } }) : null,
          r.counts.fail ? h('span', { class: 'fail', css: { flexGrow: pct(r.counts.fail) } }) : null),
        h('div', { class: 'legend-row' },
          h('span', {}, h('i', { class: 'sq ok' }), `${r.counts.ok} passing`),
          h('span', {}, h('i', { class: 'sq warn' }), plural(r.counts.warn, 'warning')),
          h('span', {}, h('i', { class: 'sq fail' }), `${r.counts.fail} failing`))),
      h('section', { class: 'card pad' },
        h('div', { class: 'label', css: { color: 'var(--text-2)', fontWeight: '500' } }, 'Model calls today'),
        h('div', { css: { fontSize: '30px', fontWeight: '700', marginTop: '10px' } }, String(r.spend.calls)),
        h('div', { class: 'meta', css: { marginTop: '10px' } }, `$${(r.spend.usd || 0).toFixed(3)} spent`))),

    issues ? h('h2', { class: 'section-title' }, 'Needs attention', h('span', { class: 'count warn' }, String(issues)),
      h('span', { class: 'hint' }, 'Grouped by the command that fixes them, in order.')) : null,
    groups.map((g, i) => h('section', { class: 'card fix-card' },
      h('span', { class: 'num warn' }, String(i + 1)),
      h('div', {},
        h('h3', {}, g.title, g.checks.length > 1 || g.restart
          ? h('span', { class: 'why' }, ` · ${g.checks.length > 1 ? `fixes ${g.checks.length} checks` : 'fixes 1 check'}${g.restart ? ', then restart Claude Code' : ''}`) : null),
        h('ul', {}, g.checks.map((c) => h('li', { class: c.status === 'fail' ? 'fail' : null },
          h('span', {}, h('b', {}, CHECK_NAME[c.name] || c.name), ` — ${checkDetail(c, today)}`))))),
      g.cmd ? cmdChip(g.cmd) : h('span'))),

    h('h2', { class: 'section-title' }, 'All good', h('span', { class: 'count ok' }, String(good.length))),
    goodGrid, more,

    r.errors?.length ? h('div', { css: { marginTop: '24px' } }, card('Recent errors', r.errors.length,
      h('ul', { class: 'list errors' }, r.errors.slice(-15).reverse().map((e) => h('li', {}, e.ts ? `${e.ts}  ` : '', e.where ? `[${e.where}] ` : '', e.message || ''))))) : null
  ];
}

// --- router ------------------------------------------------------------------------------------

const ROUTES = [
  [/^\/?$/, (m, p) => ['today', viewToday(p)]],
  [/^\/day\/(\d{4}-\d{2}-\d{2}|today)$/, (m) => ['today', viewDay(m[1])]],
  [/^\/tickets$/, (m, p) => ['tickets', viewTickets(p)]],
  [/^\/rcas$/, (m, p) => ['rcas', viewRcas(p)]],
  [/^\/ticket\/([^/]+)$/, (m) => ['tickets', viewTicket(decodeURIComponent(m[1]).toUpperCase())]],
  [/^\/search$/, (m, p) => ['search', viewSearch(p)]],
  [/^\/activity$/, (m, p) => ['activity', viewActivity(p)]],
  [/^\/health$/, (m, p) => ['health', viewHealth(p)]]
];

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const params = new URLSearchParams(qs);
  let match = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { match = fn(m, params); break; } }
  if (!match) { $main.replaceChildren(pageHead({ title: 'Not found' }), card(null, null, emptyState({ ic: 'search', title: 'No such page', actions: [h('a', { class: 'btn', href: '#/' }, 'Go to Today')] }))); return; }
  const [nav, promise] = match;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!$main.childElementCount) $main.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  try {
    const nodes = await promise;
    if (seq !== renderSeq) return;
    $main.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
    document.title = `${(document.querySelector('main h1')?.textContent || 'Worklog').slice(0, 60)} · Worklog`;
  } catch (e) {
    if (seq !== renderSeq) return;
    $main.replaceChildren(pageHead({ title: 'Something went wrong' }),
      card(null, null, emptyState({ ic: 'alert', title: e.message || String(e), text: ['Is the dashboard still running? Start it again with ', h('code', { class: 'inline' }, 'worklog dashboard'), '.'] })));
  }
}

// --- search box -----------------------------------------------------------------------------

let searchTimer;
function goSearch(value, replace) {
  const q = value.trim();
  const target = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
  if (location.hash === target) return;
  if (replace && location.hash.startsWith('#/search')) { history.replaceState(null, '', target); render(); } else location.hash = target;
}
$q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => goSearch($q.value, true), 220); });
document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); goSearch($q.value, false); });
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $q.focus(); $q.select(); }
  else if (e.key === 'Escape' && document.activeElement === $q) { $q.value = ''; $q.blur(); }
});

// Static icons in the shell.
for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon));

window.addEventListener('hashchange', () => { render(); if (!location.hash.startsWith('#/search')) window.scrollTo(0, 0); });
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  loadMeta();
  if (location.hash === '' || location.hash === '#/' || location.hash.startsWith('#/?')) render();
}, 60_000);

loadMeta();
render();
