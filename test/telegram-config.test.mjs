import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTelegramConfig, telegramConfigResponse } from '../lib/telegram-config.ts';
import { findMarkers } from '../scripts/check-client-bundle.mjs';
import { registerWorkerModuleHooks } from '../scripts/lib/worker-module-hooks.mjs';

registerWorkerModuleHooks();
const { middleware, config } = await import('../middleware.ts');
const route = await import('../app/api/telegram-config/route.ts');
const workerEnv = (globalThis.__COURTLY_TEST_ENV ??= {});

const root = fileURLToPath(new URL('../', import.meta.url));

test('the Telegram config is private and never cached', async () => {
  const response = telegramConfigResponse({
    COURTLY_TELEGRAM_SOURCE_URL: ' https://t.me/your_group_invite ',
    COURTLY_TELEGRAM_CHAT_ID: ' -1009999 ',
  });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { sourceUrl: 'https://t.me/your_group_invite', chatId: '-1009999' });
});

test('Telegram links stay hidden when unset or malformed', () => {
  const hidden = { sourceUrl: null, chatId: null };
  assert.deepEqual(resolveTelegramConfig({}), hidden);
  assert.deepEqual(resolveTelegramConfig({ COURTLY_TELEGRAM_SOURCE_URL: ' ', COURTLY_TELEGRAM_CHAT_ID: '' }), hidden);
  assert.equal(resolveTelegramConfig({ COURTLY_TELEGRAM_SOURCE_URL: 'javascript:alert(1)' }).sourceUrl, null);
});

// Runs the real middleware and, only when it lets the request through, the real route.
async function serve(request) {
  const gate = await middleware(request);
  return gate.headers.get('x-middleware-next') === '1' ? route.GET() : gate;
}

test('the Telegram config endpoint is behind the gate', async () => {
  const secret = 'test-only-access-code';
  const sourceUrl = 'https://t.me/your_group_invite';
  Object.assign(workerEnv, {
    COURTLY_ACCESS_CODE: secret,
    COURTLY_TELEGRAM_SOURCE_URL: sourceUrl,
    COURTLY_TELEGRAM_CHAT_ID: '-1009999',
  });
  const url = 'https://courts.example.com/api/telegram-config';
  try {
    const gated = new RegExp(`^${config.matcher[0]}$`);
    assert.match('/api/telegram-config', gated);
    assert.doesNotMatch('/_next/static/app.js', gated);

    const anonymous = await serve(new Request(url));
    assert.equal(anonymous.status, 401);
    assert.doesNotMatch(await anonymous.text(), /t.me|synthetic|1009999/i);

    const forged = await serve(new Request(url, { headers: { cookie: 'courtly_access=forged' } }));
    assert.equal(forged.status, 401);

    const login = await middleware(new Request('https://courts.example.com/', {
      method: 'POST',
      body: new URLSearchParams({ code: secret }),
    }));
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];

    const authenticated = await serve(new Request(url, { headers: { cookie } }));
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await authenticated.json(), { sourceUrl, chatId: '-1009999' });

    delete workerEnv.COURTLY_ACCESS_CODE;
    assert.equal((await serve(new Request(url))).status, 503);
  } finally {
    for (const name of Object.keys(workerEnv)) delete workerEnv[name];
  }
});

test('the bundle check reports a marker in a nested file and stays quiet on a clean tree', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'courtly-bundle-'));
  try {
    const nested = path.join(directory, 'assets', 'chunks');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), 'clean');
    await writeFile(path.join(nested, 'other.js'), 'clean');
    assert.deepEqual(await findMarkers(directory, ['synthetic-marker']), []);
    await writeFile(path.join(nested, 'example.js'), 'x=synthetic-marker');
    assert.deepEqual(await findMarkers(directory, ['synthetic-marker']), [
      { file: path.join(nested, 'example.js'), marker: 'synthetic-marker' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('no Telegram value is a build-time client variable', async () => {
  const forbidden = new RegExp(['VITE', 'COURTLY', 'TELEGRAM'].join('_'));
  const files = ['vite.config.ts', 'middleware.ts', '.env.example', 'README.md', 'docs/operations.md', '.github/workflows/deploy-cloudflare.yml'];
  for (const directory of ['app', 'components', 'lib']) {
    for (const entry of await readdir(path.join(root, directory), { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) files.push(path.relative(root, path.join(entry.parentPath, entry.name)));
    }
  }
  for (const file of files) assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), forbidden, file);
});
