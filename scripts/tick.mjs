#!/usr/bin/env node
// Entry point for the scheduled background tick. The scheduler points at the
// copy of this file under the data home, so a plugin upgrade cannot orphan it.
// Exits 0 whatever happens: a failing tick must not make the OS scheduler
// start reporting errors at the user.

import { runTick } from './lib/agent.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const json = args.includes('--json');
const quiet = args.includes('--quiet');
const dayArgs = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

try {
  const r = await runTick({ force, days: dayArgs.length ? dayArgs : null });
  if (json) {
    console.log(JSON.stringify(r, null, 2));
  } else if (!quiet) {
    if (r.skipped) console.log(`tick skipped: ${r.skipped}`);
    else if (r.error) console.log(`tick failed: ${r.error}`);
    else {
      console.log(`tick: ${r.days.length} day(s), ${r.items} item-day(s), ${r.modelCalls} model call(s), ${r.notesWritten} note(s) written in ${r.ms}ms`);
      for (const reason of r.reasons) console.log(`  note: ${reason}`);
    }
  }
} catch (err) {
  if (!quiet) console.error(`tick error: ${err?.message || err}`);
}
process.exit(0);
