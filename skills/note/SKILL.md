---
name: note
description: Record a finding, hypothesis, ruled-out cause, decision or note against a work item during an investigation. Use when the developer says "log finding", "note that", "rule this out", "the root cause is …", "decision: …" or a similar in-session observation tied to a ticket.
argument-hint: "[--kind finding|hypothesis|ruled-out|decision|note] <text>"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" note *)
  - PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" note *)
  - Bash(git branch --show-current)
  - PowerShell(git branch --show-current)
---

# Record a finding

When the developer states a dated observation about a specific ticket while working, record it so it survives across sessions.

## Steps

1. **The key.** Use the one they named (`ABC-1234`). Otherwise run `git branch --show-current` and take the first match of `\b[A-Z][A-Z0-9]+-\d+\b`. If there is still none, ask which ticket. Never invent a key.
2. **The kind.**

   | They say | kind |
   |---|---|
   | "found", "turns out", "the root cause is" | `finding` |
   | "maybe", "I suspect", "could be" | `hypothesis` |
   | "ruled out", "not the cause", "it isn't X" | `ruled-out` |
   | "decided", "we'll go with" | `decision` |
   | anything else | `note` |

3. **The text.** One short literal sentence in their words. No secrets, tokens or customer data; capture redacts too, but don't rely on it.
4. Run exactly one command:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/worklog.mjs" note --ticket <KEY> --kind <kind> "<text>"`
5. Confirm in one line, using what it printed.

## Guardrails

- Never write `tickets/*.json` or any other data-home file directly. The CLI is the only write path, because it locks, merges by stable id and reindexes.
- Don't change an item's RCA, title or status. Only add entries.
- One sentence per entry. Split separate observations into separate notes.
