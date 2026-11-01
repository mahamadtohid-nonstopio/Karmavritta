import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { getWorklogDir, getPluginInstallDir } from './paths.mjs';

// ---------------------------------------------------------------------------
// This is the ONLY module allowed to start a process, mutate the filesystem or
// open a network connection. test/safety-static.test.mjs scans every other
// source file and fails the build if it reaches for those APIs directly.
//
// Two invariants hold everything together:
//   1. Writes are confined to an allowlist of roots. The data home, the plugin
//      install dir and the temp dir are in; the user's work repos never are.
//      This is what makes "read-only toward your work" a checkable property
//      rather than a promise.
//   2. Processes are spawned from an allowlist of command names, always with an
//      argv array and never through a shell, so no argument can inject.
// ---------------------------------------------------------------------------

export class SafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafetyError';
    this.code = 'WORKLOG_SAFETY_DENIED';
  }
}

const BASE_COMMANDS = [
  'git',       // read-only history scans
  'claude',    // model extraction, `claude -p` with no tools
  'node',      // re-entry for the scheduled tick
  'schtasks',  // Windows scheduler
  'crontab',   // Linux scheduler
  'launchctl', // macOS scheduler
  'code',      // open a doc
  'open',
  'xdg-open',
  'cmd',       // Windows `start`, used only by openExternal
  'rundll32'   // Windows URL handler, used only by openBrowser (no shell parsing)
];

const extraCommands = new Set();
const extraWriteRoots = new Set();

/** Widen the command allowlist from config. Never narrows the hard-coded base. */
export function allowCommands(names = []) {
  for (const n of names) if (typeof n === 'string' && n) extraCommands.add(n.toLowerCase());
}

/** Widen the write allowlist. Used by the scheduler and by tests. */
export function allowWriteRoot(dir) {
  if (dir) extraWriteRoots.add(path.resolve(dir));
}

export function writeRoots() {
  const roots = [getWorklogDir(), getPluginInstallDir(), os.tmpdir(), ...extraWriteRoots];
  if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'LaunchAgents'));
  }
  return roots.map((r) => path.resolve(r));
}

function samePath(a, b) {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function isInside(root, target) {
  if (samePath(root, target)) return true;
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  // On Windows path.relative is already case-insensitive; on POSIX it is exact.
  return true;
}

/**
 * Resolve a path to its real location, following symlinks on whichever ancestor
 * already exists. Without this a symlink planted inside the data home could
 * redirect a write to an arbitrary location and still pass the prefix check.
 */
function realResolve(target) {
  let current = path.resolve(target);
  const trailing = [];
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...trailing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function isWritable(target) {
  const resolved = realResolve(target);
  return writeRoots().some((root) => isInside(realResolve(root), resolved));
}

export function assertWritable(target) {
  if (!isWritable(target)) {
    throw new SafetyError(
      `Refusing to write outside the worklog data home: ${target}\n` +
      `Allowed roots:\n  ${writeRoots().join('\n  ')}`
    );
  }
  return path.resolve(target);
}

function assertCommand(command) {
  const base = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (!BASE_COMMANDS.includes(base) && !extraCommands.has(base)) {
    throw new SafetyError(
      `Refusing to run a command that is not on the allowlist: ${command}\n` +
      `Allowed: ${[...BASE_COMMANDS, ...extraCommands].join(', ')}`
    );
  }
  return command;
}

// --- filesystem -------------------------------------------------------------

export function mkdirp(dir) {
  fs.mkdirSync(assertWritable(dir), { recursive: true });
  return dir;
}

/** Non-recursive exclusive mkdir. Returns false on EEXIST — used for locking. */
export function tryMkdirExclusive(dir) {
  try {
    fs.mkdirSync(assertWritable(dir));
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

export function writeFileAtomic(file, content) {
  const target = assertWritable(file);
  mkdirp(path.dirname(target));
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  return target;
}

export function writeJsonAtomic(file, value) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendLine(file, line) {
  const target = assertWritable(file);
  mkdirp(path.dirname(target));
  fs.appendFileSync(target, `${line}\n`);
  return target;
}

export function copyFile(src, dst) {
  const target = assertWritable(dst);
  mkdirp(path.dirname(target));
  fs.copyFileSync(src, target);
}

export function copyTree(src, dst) {
  assertWritable(dst);
  const stat = fs.statSync(src);
  if (!stat.isDirectory()) return copyFile(src, dst);
  mkdirp(dst);
  for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dst, name));
}

export function removePath(target, { recursive = false } = {}) {
  fs.rmSync(assertWritable(target), { recursive, force: true });
}

export function removeDirIfEmpty(dir) {
  try { fs.rmdirSync(assertWritable(dir)); return true; } catch { return false; }
}

// --- processes --------------------------------------------------------------

/**
 * Run an allowlisted command and capture stdout. Never uses a shell, so argv
 * entries are passed verbatim and cannot be reinterpreted.
 * Returns a result object rather than throwing, so callers can degrade.
 */
export function runCapture(command, args = [], opts = {}) {
  assertCommand(command);
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      // execFileSync inherits stderr by default, which would let a probe like
      // `schtasks /Query` print its own noise straight at the user.
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
      cwd: opts.cwd,
      timeout: opts.timeout,
      input: opts.input,
      env: opts.env
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, stdout: '', stderr: '', reason: `${command} not found on PATH` };
    }
    const stderr = (e.stderr || '').toString().trim();
    return {
      ok: false,
      stdout: (e.stdout || '').toString(),
      stderr,
      reason: stderr || e.message || `${command} failed`
    };
  }
}

export function commandExists(command, probeArgs = ['--version']) {
  return runCapture(command, probeArgs).ok;
}

/** Fire-and-forget launch, used only for opening a doc in an editor. */
export function spawnDetached(command, args = []) {
  assertCommand(command);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', () => done(false));
      child.unref();
      setTimeout(() => done(true), 50);
    } catch {
      done(false);
    }
  });
}

export async function openExternal(target) {
  const candidates = process.platform === 'win32'
    ? [['code.cmd', [target]], ['cmd', ['/c', 'start', '', target]]]
    : process.platform === 'darwin'
      ? [['code', [target]], ['open', [target]]]
      : [['code', [target]], ['xdg-open', [target]]];
  for (const [cmd, args] of candidates) {
    if (await spawnDetached(cmd, args)) return cmd;
  }
  return null;
}

// --- background processes -----------------------------------------------------

/**
 * Start an allowlisted command fully detached (used for the dashboard server)
 * and return its pid, or null if it could not start. No shell, argv only.
 */
export function spawnBackground(command, args = [], { env } = {}) {
  assertCommand(command);
  try {
    const child = spawn(command, args, {
      stdio: 'ignore', detached: true, windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env
    });
    child.on('error', () => {});
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

/** Stop a process we started. Callers must verify it is ours first (see dashboard ping). */
export function stopProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid); return true; } catch { return false; }
}

// --- local network --------------------------------------------------------------

// The dashboard is the only socket Worklog opens. It is hard-bound to the IPv4
// loopback address: there is no parameter that could expose it on a LAN.
export const LOOPBACK = '127.0.0.1';

/**
 * Serve `handler` on 127.0.0.1. The handler receives
 * { method, url, host, origin, action } and returns { status, headers, body }.
 * Request bodies are never read, so no payload a page sends can reach the handler.
 * Resolves to { port, close } once listening; rejects on EADDRINUSE etc.
 */
export function serveLocal(handler, { port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      let out;
      try {
        out = await handler({
          method: req.method, url: req.url || '/', host: req.headers.host || '',
          origin: req.headers.origin || '', action: req.headers['x-worklog-action'] || ''
        });
      } catch (e) {
        out = { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Internal error' };
      }
      res.writeHead(out.status || 200, out.headers || {});
      res.end(req.method === 'HEAD' ? undefined : (out.body ?? ''));
    });
    server.requestTimeout = 30_000;
    server.on('error', reject);
    server.listen(port, LOOPBACK, () => {
      server.off('error', reject);
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

/**
 * GET a path on our own loopback server. Resolves to { status, json } or null
 * when nothing answers. Only ever talks to 127.0.0.1.
 */
export function probeLocal(port, pathname = '/api/ping', { timeoutMs = 800 } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host: LOOPBACK, port, path: pathname, timeout: timeoutMs,
      headers: { Host: `${LOOPBACK}:${port}` } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (data.length < 65536) data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Open one of our own loopback URLs in the default browser. Refuses anything
 * else. On Windows this uses rundll32's URL handler rather than `cmd /c start`,
 * because cmd.exe would re-parse `&` in a query string as a command separator.
 */
export async function openBrowser(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9\-._~:/?#@!$'()*+,;=%&]*$/.test(String(url))) {
    throw new SafetyError(`Refusing to open a URL that is not the local dashboard: ${url}`);
  }
  const candidates = process.platform === 'win32'
    ? [['rundll32', ['url.dll,FileProtocolHandler', url]]]
    : process.platform === 'darwin' ? [['open', [url]]] : [['xdg-open', [url]]];
  for (const [cmd, args] of candidates) {
    if (await spawnDetached(cmd, args)) return cmd;
  }
  return null;
}
