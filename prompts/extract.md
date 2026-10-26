You are summarising one day of recorded engineering activity for a single work
item. You are given a numbered digest of events that were captured
automatically and already redacted.

Return ONLY a JSON object, no prose before or after, matching this shape:

{
  "title": "short noun phrase describing the work item, or empty string",
  "summary": "two or three sentences on what was actually done",
  "findings": [
    { "kind": "finding|hypothesis|ruled-out", "text": "one sentence", "evidence": ["e_abc123"] }
  ],
  "decisions": [
    { "text": "one sentence stating the decision", "evidence": ["e_abc123"] }
  ],
  "rca": {
    "symptom": "", "rootCause": "", "fix": "", "evidence": ["e_abc123"]
  }
}

Rules you must follow:

1. Every entry in `findings`, `decisions` and `rca` MUST cite at least one
   event id from the digest in its `evidence` array. An entry you cannot tie to
   a specific event must be omitted entirely. Do not invent event ids.
2. Do not speculate. If the digest does not show a root cause, return an `rca`
   with empty strings.
3. Prefer what the engineer did and concluded over what they merely looked at.
   A file that was read once is not a finding.
4. Keep each `text` under 200 characters and write it so it still makes sense
   a month from now, without the surrounding session.
5. Never include credentials, tokens, personal names, hostnames or absolute
   paths in your output, even if they somehow appear in the digest.
6. If the day contains nothing worth recording, return empty arrays and empty
   strings rather than padding.
