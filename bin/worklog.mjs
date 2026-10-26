#!/usr/bin/env node
import { main } from '../scripts/cli.mjs';

main(process.argv.slice(2)).catch((e) => {
  if (e?.code === 'WORKLOG_CONFIG_INVALID') {
    console.error(e.message);
  } else {
    console.error(e?.stack || e?.message || e);
  }
  process.exit(1);
});
