---
name: worklog
description: Log findings, RCAs and notes against the current ticket during an investigation. Use when the developer says "log finding", "note that", "rule this out", "the root cause is …", or similar in-session observations tied to a ticket.
---

# worklog

This skill is a lightweight recorder. When the developer makes a dated
observation about a specific ticket while working, append it to the ticket's
JSON file so it is remembered across sessions.

## When to use

Trigger when the user says things like:
- "log finding: …" / "note: …" / "RCA: …"
- "we ruled out …"
- "the root cause is …"
- "decision: we'll go with X"

## What to do

1. Determine the ticket key:
   - If the user named a key (ESIN-4349, PROJ-12, …), use it.
   - Otherwise read the current git branch in the working directory and extract
     a key via the regex `\b[A-Z][A-Z0-9]+-\d+\b`.
   - If no key can be determined, ask the user which ticket.
2. Append the finding using the Worklog CLI. The simplest path is:
   `worklog note --ticket <KEY> --kind <finding|hypothesis|ruled-out|decision|note> "<text>"`
   (Phase 3 of the build adds `worklog note`. Until it is implemented, write
   the finding directly to `~/.worklog/tickets/<KEY>.json` under `findings`,
   with `{ date, kind, text, source: "session" }`.)
3. Confirm back to the user with a one-liner.

## Guardrails

- Never fabricate a key. Ask if unsure.
- Never edit RCA fields without the user's explicit approval.
- Keep findings short and literal — one sentence per entry.
