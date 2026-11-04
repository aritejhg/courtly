import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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

const MAX_AGE_SECONDS = 2592000;
const gateUrl = 'https://courts.example.com/';
const gateSecret = 'test-only-access-code';

async function loginCookieAt(now) {
  const login = await accessGate(new Request(gateUrl, {
    method: 'POST',
    body: new URLSearchParams({ code: gateSecret }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), gateSecret, { now });
  assert.equal(login.status, 303);
  const header = login.headers.get('set-cookie');
  assert.match(header, new RegExp(`Max-Age=${MAX_AGE_SECONDS}`));
  return header.split(';', 1)[0];
}
const withCookie = (cookie, now) => accessGate(new Request(gateUrl, { headers: { cookie } }), gateSecret, { now });

test('malformed cookie encoding is an ordinary unauthenticated response', async () => {
  for (const cookie of ['courtly_access=%E0%A4%A', 'courtly_access=%', 'other=1; courtly_access=%zz']) {
    const result = await withCookie(cookie);
    assert.equal(result.status, 401, cookie);
  }
  const login = await accessGate(new Request(gateUrl, {
    method: 'POST',
    body: new URLSearchParams({ code: gateSecret }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'courtly_access=%' },
  }), gateSecret);
  assert.equal(login.status, 303);
});

test('a token expires server-side at the cookie Max-Age', async () => {
  const issuedAt = 1_800_000_000_000;
  const cookie = await loginCookieAt(issuedAt);
  assert.equal(await withCookie(cookie, issuedAt + (MAX_AGE_SECONDS - 1) * 1000), null);
  assert.equal((await withCookie(cookie, issuedAt + MAX_AGE_SECONDS * 1000)).status, 401);
});

test('a tampered expiry or signature is rejected', async () => {
  const issuedAt = 1_800_000_000_000;
  const cookie = await loginCookieAt(issuedAt);
  const [name, value] = cookie.split('=');
  const [expiry, signature] = decodeURIComponent(value).split('.');
  const extended = `${name}=${Number(expiry) + 1}.${signature}`;
  assert.equal((await withCookie(extended, issuedAt)).status, 401);
  const flipped = `${name}=${expiry}.${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;
  assert.equal((await withCookie(flipped, issuedAt)).status, 401);
  assert.equal((await withCookie(`${name}=${signature}`, issuedAt)).status, 401);
});

test('old constant tokens no longer authenticate', async () => {
  const old = createHmac('sha256', gateSecret).update('courtly-access-v1').digest('hex');
  assert.equal((await withCookie(`courtly_access=${old}`)).status, 401);
});

test('the token is an HMAC of the version and expiry under the configured secret', async () => {
  const issuedAt = 1_800_000_000_000;
  const cookie = await loginCookieAt(issuedAt);
  const [expiry, signature] = decodeURIComponent(cookie.split('=')[1]).split('.');
  assert.equal(Number(expiry), Math.floor(issuedAt / 1000) + MAX_AGE_SECONDS);
  const sign = (key, at) => createHmac('sha256', key).update(`courtly-access-v2:${at}`).digest('hex');
  assert.equal(signature, sign(gateSecret, expiry));

  // Issued under one secret, rejected under another.
  const otherSecret = 'another-test-only-access-code';
  const other = await accessGate(new Request(gateUrl, { headers: { cookie } }), otherSecret, { now: issuedAt });
  assert.equal(other.status, 401);

  // A token built independently with the right key is accepted; with the wrong key it is not.
  const forgedWith = (key) => `courtly_access=${expiry}.${sign(key, expiry)}`;
  assert.equal(await withCookie(forgedWith(gateSecret), issuedAt), null);
  assert.equal((await withCookie(forgedWith(otherSecret), issuedAt)).status, 401);
  assert.equal((await withCookie(forgedWith(''), issuedAt)).status, 401);
});

test('the session cookie is HttpOnly, Secure, SameSite=Lax and site-wide', async () => {
  const login = await accessGate(new Request(gateUrl, {
    method: 'POST',
    body: new URLSearchParams({ code: gateSecret }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), gateSecret);
  const [pair, ...attributes] = login.headers.get('set-cookie').split(';').map((part) => part.trim());
  assert.match(pair, /^courtly_access=[^=s]+$/);
  const flags = new Set();
  const values = new Map();
  for (const attribute of attributes) {
    const [name, value] = attribute.split('=');
    if (value === undefined) flags.add(name.toLowerCase());
    else values.set(name.toLowerCase(), value);
  }
  assert.ok(flags.has('httponly'));
  assert.ok(flags.has('secure'));
  assert.equal(values.get('samesite'), 'Lax');
  assert.equal(values.get('path'), '/');
  assert.equal(values.get('max-age'), String(MAX_AGE_SECONDS));
});
