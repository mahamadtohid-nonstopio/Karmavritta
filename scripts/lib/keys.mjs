const KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const SINGLE_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export function extractKeys(text, allowedPrefixes = []) {
  if (!text) return [];
  const found = text.match(KEY_REGEX);
  if (!found) return [];
  const allowAll = !allowedPrefixes || allowedPrefixes.length === 0;
  const seen = new Set();
  const out = [];
  for (const key of found) {
    if (seen.has(key)) continue;
    const prefix = key.split('-')[0];
    if (allowAll || allowedPrefixes.includes(prefix)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export function isValidKey(key) {
  return typeof key === 'string' && SINGLE_KEY_REGEX.test(key);
}

export function prefixOf(key) {
  return key.split('-')[0];
}
