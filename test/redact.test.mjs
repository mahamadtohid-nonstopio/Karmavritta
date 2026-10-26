import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep, redactWithReport, scanForSecrets, normalizeMode } from '../scripts/lib/redact.mjs';

test('mode names normalise, unknown falls back to secrets', () => {
  assert.equal(normalizeMode('local'), 'local');
  assert.equal(normalizeMode('public'), 'public');
  assert.equal(normalizeMode('nonsense'), 'secrets');
  assert.equal(normalizeMode(undefined), 'secrets');
});

test('credentials are masked even in local mode', () => {
  const out = redact('export API_KEY=abcdef1234567890', { mode: 'local' });
  assert.ok(!out.includes('abcdef1234567890'), out);
  assert.match(out, /REDACTED:credential/);
});

test('url credentials keep the scheme and host shape', () => {
  const out = redact('git clone https://tohid:hunter2@github.com/acme/repo.git', { mode: 'local' });
  assert.ok(!out.includes('hunter2'));
  assert.match(out, /https:\/\/\[REDACTED:url-credentials\]@github\.com/);
});

test('connection strings lose the password but keep the server', () => {
  const cs = 'Server=sql01;Database=Dry;User Id=svc;Password=S3cr3t!Pass;';
  const out = redact(cs, { mode: 'local' });
  assert.ok(!out.includes('S3cr3t!Pass'));
  assert.ok(out.includes('Server=sql01'));
  assert.ok(out.includes('Database=Dry'));
});

test('emails are kept in local mode and masked from secrets mode up', () => {
  const text = 'ping me at tohid@nonstopio.com';
  assert.ok(redact(text, { mode: 'local' }).includes('tohid@nonstopio.com'));
  assert.ok(!redact(text, { mode: 'secrets' }).includes('tohid@nonstopio.com'));
});

test('configured names are masked in free prose, not just labelled fields', () => {
  const text = 'Suraj said the retry queue drains on restart.';
  const out = redact(text, { mode: 'secrets', names: ['Suraj'] });
  assert.ok(!out.includes('Suraj'), out);
  assert.match(out, /\[REDACTED:name\] said the retry queue/);
});

test('short name entries are ignored so initials do not shred the text', () => {
  const out = redact('SQ is fine', { mode: 'secrets', names: ['SQ'] });
  assert.equal(out, 'SQ is fine');
});

test('paths and hosts survive until public mode', () => {
  const text = 'see C:\\Users\\nonstop\\notes.md on build.internal';
  assert.ok(redact(text, { mode: 'secrets' }).includes('C:\\Users\\nonstop'));
  const pub = redact(text, { mode: 'public' });
  assert.ok(!pub.includes('nonstop'));
  assert.ok(!pub.includes('build.internal'));
});

test('ticket keys and git shas are never masked', () => {
  const text = 'ESIN-4349 fixed in 3f98efe8d1c2b4a5f6e7d8c9b0a1f2e3d4c5b6a7';
  assert.equal(redact(text, { mode: 'public' }), text);
});

test('high-entropy blobs are masked even when unlabelled', () => {
  const blob = 'Zx8Qw3Lm9Pv2Rt6Yb1Nk4Hs7Jd0Fg5Ac8Ue3Wi6Oy9Tz2';
  const out = redact(`value ${blob}`, { mode: 'local' });
  assert.ok(!out.includes(blob), out);
});

test('redactDeep walks nested structures and leaves keys alone', () => {
  const input = { token: 'ghp_0123456789abcdefghij', nested: [{ note: 'ok' }] };
  const out = redactDeep(input, { mode: 'local' });
  assert.ok('token' in out);
  assert.match(out.token, /REDACTED/);
  assert.equal(out.nested[0].note, 'ok');
});

test('report names the rules that fired without echoing the secret', () => {
  const { text, found } = redactWithReport('ghp_0123456789abcdefghij and me@x.com', { mode: 'secrets' });
  assert.ok(found.includes('github-token'));
  assert.ok(found.includes('email'));
  assert.ok(!text.includes('ghp_'));
});

test('scanForSecrets flags a planted secret and clears clean text', () => {
  assert.ok(scanForSecrets('AKIAIOSFODNN7EXAMPLE').length > 0);
  assert.deepEqual(scanForSecrets('just a normal sentence about deadlocks'), []);
});

test('a malformed custom pattern cannot break redaction', () => {
  const out = redact('hello', { mode: 'local', extraPatterns: ['([unclosed'] });
  assert.equal(out, 'hello');
});

test('non-string input is returned unharmed', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(42), '');
});
