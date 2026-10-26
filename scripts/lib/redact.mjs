// Masking applied three times: at capture, before any model call, and before
// any export. Modes are destinations, not severity dials:
//
//   local   — written to your own disk. Credentials go, everything else stays
//             readable, because an unreadable local note is a useless one.
//   secrets — leaving the process (model call). Adds personal data and the
//             configured name list.
//   public  — leaving the machine (export, share). Adds paths, hosts and IPs.
//
// Each mode is a superset of the one before it.

const MODE_RANK = { local: 0, secrets: 1, public: 2 };

export const MODES = Object.keys(MODE_RANK);

export function normalizeMode(mode) {
  return MODE_RANK[mode] === undefined ? 'secrets' : mode;
}

function rank(mode) {
  return MODE_RANK[normalizeMode(mode)];
}

// Ordered: most specific first, so a GitHub PAT is labelled as one rather than
// being swallowed by the generic key=value rule.
const RULES = [
  {
    name: 'private-key',
    minRank: 0,
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  { name: 'github-token',   minRank: 0, re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g },
  { name: 'github-pat',     minRank: 0, re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'slack-token',    minRank: 0, re: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'aws-access-key', minRank: 0, re: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g },
  { name: 'google-api-key', minRank: 0, re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'stripe-key',     minRank: 0, re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
  { name: 'anthropic-key',  minRank: 0, re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-key',     minRank: 0, re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'npm-token',      minRank: 0, re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: 'jwt',            minRank: 0, re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: 'url-credentials',
    minRank: 0,
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi,
    replace: (_m, scheme) => `${scheme}[REDACTED:url-credentials]@`
  },
  {
    name: 'bearer-token',
    minRank: 0,
    re: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: (_m, scheme) => `${scheme} [REDACTED:bearer-token]`
  },
  {
    // Password=...; inside an ADO/SQL style connection string.
    name: 'connection-secret',
    minRank: 0,
    re: /\b(password|pwd|user id|uid|account ?key|shared ?access ?key)\s*=\s*([^;'"\r\n]+)/gi,
    replace: (_m, field) => `${field}=[REDACTED:connection-secret]`
  },
  {
    // Generic `secret: "value"` / `api_key=value` across JSON, YAML, env, CLI.
    name: 'credential',
    minRank: 0,
    // The bare-value branch excludes `:` and `=` and must end on a boundary.
    // Without that, `token: auth_token: "<real secret>"` masks the inner *key*
    // and leaves the actual secret in the clear.
    re: /\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?token|password|passwd|secret|token|credential)s?)(["']?\s*[:=]\s*)(?:"([^"\r\n]{6,})"|'([^'\r\n]{6,})'|([^\s"',;:=]{6,})(?=$|[\s,;)\]}>"']))/gi,
    replace: (_m, key, sep, dq, sq) => {
      const q = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
      return `${key}${sep}${q}[REDACTED:credential]${q}`;
    }
  },
  { name: 'email', minRank: 1, re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    name: 'phone',
    minRank: 1,
    re: /(?<![\w.-])\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w.-])/g
  },
  { name: 'ipv4',     minRank: 2, re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'home-dir', minRank: 2, re: /(?:[A-Za-z]:\\Users\\[^\\\s"']+|\/(?:home|Users)\/[^/\s"']+)/g },
  {
    name: 'hostname',
    minRank: 2,
    re: /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|dev|ai|internal|local|corp)\b/gi
  }
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shannon entropy per character — used to spot unlabelled secret blobs. */
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const BLOB_RE = /\b[A-Za-z0-9+/=_-]{40,}\b/g;

function maskHighEntropyBlobs(text, found) {
  return text.replace(BLOB_RE, (m) => {
    // Hex digests (git shas, content ids) are low entropy and worth keeping.
    if (/^[0-9a-f]+$/i.test(m)) return m;
    if (!/[A-Z]/.test(m) || !/[a-z]/.test(m) || !/\d/.test(m)) return m;
    if (entropy(m) < 4.0) return m;
    found.push('high-entropy-blob');
    return '[REDACTED:high-entropy-blob]';
  });
}

/**
 * @returns {{ text: string, found: string[] }} masked text plus the rule names
 *          that fired, so callers can log that masking happened without
 *          logging what was masked.
 */
export function redactWithReport(input, options = {}) {
  if (typeof input !== 'string' || !input) {
    return { text: typeof input === 'string' ? input : '', found: [] };
  }
  const mode = normalizeMode(options.mode);
  const limit = rank(mode);
  const found = [];
  let text = input;

  for (const rule of RULES) {
    if (rule.minRank > limit) continue;
    text = text.replace(rule.re, (...args) => {
      found.push(rule.name);
      return rule.replace ? rule.replace(...args) : `[REDACTED:${rule.name}]`;
    });
  }

  text = maskHighEntropyBlobs(text, found);

  // Local name list (PRD improvement #2): Chitragupta only masks names in
  // labelled fields, so a name mentioned in prose survives. This catches those.
  if (limit >= 1) {
    for (const name of options.names || []) {
      const trimmed = String(name || '').trim();
      if (trimmed.length < 3) continue;
      const re = new RegExp(`\\b${escapeRe(trimmed)}\\b`, 'gi');
      text = text.replace(re, () => {
        found.push('name');
        return '[REDACTED:name]';
      });
    }
  }

  for (const pattern of options.extraPatterns || []) {
    try {
      const re = new RegExp(pattern, 'g');
      text = text.replace(re, () => {
        found.push('custom');
        return '[REDACTED:custom]';
      });
    } catch {
      // A bad user regex must never break capture.
    }
  }

  return { text, found: [...new Set(found)] };
}

export function redact(input, options = {}) {
  return redactWithReport(input, options).text;
}

/** Deep-walk an object, masking every string. Keys are left alone. */
export function redactDeep(value, options = {}, depth = 0) {
  if (depth > 12) return '[REDACTED:too-deep]';
  if (typeof value === 'string') return redact(value, options);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, options, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, options, depth + 1);
    return out;
  }
  return value;
}

/** Deny-list scan. Returns the rule names that would fire at `public` level. */
export function scanForSecrets(input) {
  return redactWithReport(input, { mode: 'local' }).found;
}

export function containsSecret(input) {
  return scanForSecrets(input).length > 0;
}

export function redactionOptions(cfg) {
  return {
    mode: normalizeMode(cfg?.redaction?.mode),
    names: cfg?.redaction?.names || [],
    extraPatterns: cfg?.redaction?.extraPatterns || []
  };
}
