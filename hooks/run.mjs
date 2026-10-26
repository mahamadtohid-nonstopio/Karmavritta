#!/usr/bin/env node
// Claude Code hook entry point.
//
// Contract (CLAUDE.md rule 1): catch everything, log, exit 0. A failure here
// must never surface to the user or block a tool call. Nothing is printed on
// the happy path — stdout from a hook is fed back into the session.

const STDIN_TIMEOUT_MS = 2000;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) finish();
    });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;  // Not our business to complain about a malformed payload.
  }

  const { captureEvent } = await import('../scripts/lib/capture.mjs');
  captureEvent(payload);
}

main()
  .catch(async (err) => {
    try {
      const { logCaptureError } = await import('../scripts/lib/capture.mjs');
      logCaptureError(err);
    } catch { /* give up quietly */ }
  })
  .finally(() => process.exit(0));
