import test from 'node:test';
import assert from 'node:assert/strict';

const { accessGate } = await import('../lib/access-gate.ts');

test('allows local requests when no gate secret is configured', async () => {
  const result = await accessGate(new Request('http://localhost/'), undefined);
  assert.equal(result, null);
});
test('fails closed on workers.dev when no gate secret is configured', async () => {
  const result = await accessGate(new Request('https://courtly.workers.dev/'), undefined);
  assert.equal(result.status, 503);
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
