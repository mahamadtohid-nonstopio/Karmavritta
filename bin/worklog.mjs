#!/usr/bin/env node
import { main } from '../scripts/cli.mjs';

main(process.argv.slice(2)).catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
