# Worklog — working rules

Non-negotiable constraints for anyone (human or model) changing this repo.

## 1. Hooks fail open

A hook must catch everything, log to `logs/errors.log`, and `exit 0`. A broken
hook must never break a Claude Code session. Only `SessionStart` is synchronous;
keep it under 500 ms and every other event under 100 ms.

## 2. Standard library only at runtime

Zero runtime dependencies, Node ≥ 18, pure ESM. Dev-only tooling is fine.
If a feature seems to need a package, it probably needs less feature.

## 3. All side effects go through `scripts/lib/safety.mjs`

That module is the only place allowed to start a process, write to disk, or
open a socket. `test/safety-static.test.mjs` scans every other source file and
fails the build otherwise. Do not add an exception; add a function to `safety`.

## 4. Read-only toward the user's work

Writes are confined to an allowlist of roots (data home, plugin dir, temp dir).
Work repos, Git hosts, databases and issue trackers are read-only. There is no
flag to turn this off. `git` is only ever invoked with reading subcommands.

## 5. Synthetic test data only

Tests use `WORKLOG_DIR` pointed at a temp dir and invent their own fixtures.
No test may touch the real data home or a real repo. Planted secrets in
`test/redteam.test.mjs` are fabricated values, never real ones.

## 6. No company names, ticket prefixes or hosts in the repo

They live in local config. The ticket-key regex is generic
(`[A-Z][A-Z0-9]+-\d+`) and `keyPrefixes: []` means "accept any prefix".

## 7. Data formats are stable

`tickets/*.json`, `index.json` and the raw event lines are a contract. A shape
change ships with a migration that backs up first and is forward-only.

## 8. Docs change with the feature

README, `docs/` and the rule list change in the same commit as the behaviour
they describe. A feature that is not documented is not done.

## 9. Versions stay in lockstep

`package.json` and `.claude-plugin/plugin.json` must agree. Bump both together.

## 10. Every model claim cites recorded evidence

Extraction output is validated against a schema and each claim must reference an
event id that exists in the raw log. Uncited claims are dropped, not softened.
When the model is unavailable or over budget, fall back to the deterministic
path rather than skipping the tick.

## Redaction

Mask at capture, again before any model call, again before any export. Modes are
destinations, not severity levels: `local` (own disk), `secrets` (leaving the
process), `public` (leaving the machine). Each is a superset of the previous.

## Running the tests

```powershell
npm test          # requires Node >= 18; runs test/run.mjs
```
