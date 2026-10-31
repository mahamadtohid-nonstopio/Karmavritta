import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep } from '../scripts/lib/redact.mjs';

// Every value here is synthetic. The point of this file is that a planted
// secret must not survive redaction at the level that guards its destination.
// If you add a secret format the plugin might see in the wild, add it here.

// Planted values are joined at runtime so no source line matches a secret
// scanner (GitHub push protection blocks them). Redaction sees the full string.
const j = (...parts) => parts.join('');

const PLANTED = [
  ['github classic PAT',  j('gh', 'p_', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456')],
  ['github fine-grained', j('github', '_pat_', '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789')],
  ['slack bot token',     j('xo', 'xb-', '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx')],
  ['aws access key',      j('AK', 'IA', 'IOSFODNN7EXAMPLE')],
  ['google api key',      j('AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r')],
  ['stripe live key',     j('sk', '_live_', '51AbCdEfGhIjKlMnOpQrStUvWx')],
  ['anthropic key',       j('sk', '-ant-', 'api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')],
  ['npm token',           j('np', 'm_', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')],
  ['jwt',                 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
  ['bearer header',       'Authorization: Bearer AbCdEf0123456789GhIjKlMnOp'],
  ['url credentials',     'https://svc-account:P@ssw0rdLong@git.internal/acme/repo.git'],
  ['sql connection',      'Server=db01;Database=Lab;User Id=sa;Password=Tr0ub4dor&3;'],
  ['env secret',          'CLIENT_SECRET=aVeryLongClientSecretValue123'],
  ['yaml token',          'auth_token: "9f8e7d6c5b4a39281706fedcba0987654321"'],
  ['private key',         j('-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1b2c3\n-----END RSA ', 'PRIVATE KEY-----')]
];

// The sensitive substring that must be gone. For composite strings we only
// assert on the secret part, not the surrounding label.
const NEEDLES = {
  'bearer header':    'AbCdEf0123456789GhIjKlMnOp',
  'url credentials':  'P@ssw0rdLong',
  'sql connection':   'Tr0ub4dor&3',
  'env secret':       'aVeryLongClientSecretValue123',
  'yaml token':       '9f8e7d6c5b4a39281706fedcba0987654321',
  'private key':      'MIIEowIBAAKCAQEAx1b2c3'
};

for (const [label, planted] of PLANTED) {
  const needle = NEEDLES[label] || planted;

  test(`local mode removes ${label}`, () => {
    const out = redact(`before ${planted} after`, { mode: 'local' });
    assert.ok(!out.includes(needle), `${label} survived: ${out}`);
    assert.ok(out.includes('before') && out.includes('after'), 'surrounding text should survive');
  });

  test(`${label} does not survive a nested payload`, () => {
    const payload = {
      tool: 'Bash',
      input: { command: `curl -H "x: ${planted}" https://api.example.com` },
      output: [`log line with ${planted}`]
    };
    const out = JSON.stringify(redactDeep(payload, { mode: 'secrets' }));
    assert.ok(!out.includes(needle), `${label} survived nesting: ${out}`);
  });
}

test('a transcript mixing several secrets comes out clean', () => {
  const transcript = PLANTED.map(([l, v]) => `${l}: ${v}`).join('\n');
  const out = redact(transcript, { mode: 'public' });
  for (const [label, planted] of PLANTED) {
    const needle = NEEDLES[label] || planted;
    assert.ok(!out.includes(needle), `${label} survived the mixed transcript`);
  }
});

test('redaction is idempotent — masking twice changes nothing', () => {
  const once = redact(PLANTED.map(([, v]) => v).join('\n'), { mode: 'public' });
  const twice = redact(once, { mode: 'public' });
  assert.equal(twice, once);
});

test('ordinary engineering prose is left intact', () => {
  const prose = [
    'DEMO-4349 deadlock reproduced on the retry queue.',
    'Ruled out TransactionScope; see commit 3f98efe and docs/rca.md.',
    'Next: check SqlDependency timeout of 30 seconds.'
  ].join('\n');
  assert.equal(redact(prose, { mode: 'secrets' }), prose);
});
