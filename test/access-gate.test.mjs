import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { accessGate } = await import('../lib/access-gate.ts');

test('the dev server stays open when no gate secret is configured', async () => {
  const result = await accessGate(new Request('http://localhost/'), undefined, { isDevelopment: true });
  assert.equal(result, null);
});

test('production fails closed on every host when no gate secret is configured', async () => {
  for (const url of ['https://courtly.workers.dev/', 'https://courts.example.com/', 'http://localhost/', 'http://127.0.0.1/']) {
    for (const secret of [undefined, '']) {
      const result = await accessGate(new Request(url), secret);
      assert.equal(result.status, 503, url);
      assert.equal(result.headers.get('cache-control'), 'no-store');
    }
  }
});

test('a configured secret is enforced in development too', async () => {
  const result = await accessGate(new Request('http://localhost/'), 'test-only-access-code', { isDevelopment: true });
  assert.equal(result.status, 401);
});

test('rejects a wrong code and a forged cookie', async () => {
  const url = 'https://courts.example.com/';
  const secret = 'test-only-access-code';
  const wrong = await accessGate(new Request(url, {
    method: 'POST',
    body: new URLSearchParams({ code: 'wrong' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), secret);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  const forged = await accessGate(new Request(url, { headers: { cookie: 'courtly_access=forged' } }), secret);
  assert.equal(forged.status, 401);
});

test('middleware opens the gate only from the build-time development flag', async () => {
  const source = await readFile(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(source, /isDevelopment: import\.meta\.env\.DEV\b/);
});

test('requires code and accepts a signed cookie after login', async () => {
  const url = 'https://courtly.workers.dev/';
  const secret = 'test-only-access-code';
  const blocked = await accessGate(new Request(url), secret);
  assert.equal(blocked.status, 401);

  const login = await accessGate(new Request(url, {
    method: 'POST',
    body: new URLSearchParams({ code: secret }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), secret);
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^courtly_access=/);

  const allowed = await accessGate(new Request(url, { headers: { cookie: cookie.split(';', 1)[0] } }), secret);
  assert.equal(allowed, null);
});
