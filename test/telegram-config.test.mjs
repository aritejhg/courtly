import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessGate } from '../lib/access-gate.ts';
import { resolveTelegramConfig, telegramConfigResponse } from '../lib/telegram-config.ts';
import { findMarkers } from '../scripts/check-client-bundle.mjs';

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

test('the Telegram config endpoint is behind the gate', async () => {
  const anonymous = await accessGate(new Request('https://courts.example.com/api/telegram-config'), 'test-only-access-code');
  assert.equal(anonymous.status, 401);
  assert.doesNotMatch(await anonymous.text(), /t\.me|telegram/i);

  const source = await readFile(path.join(root, 'middleware.ts'), 'utf8');
  const [, matcher] = /matcher:\s*\['\/\((.+)\)'\]/.exec(source);
  const gated = new RegExp(`^/${matcher}$`);
  assert.match('/api/telegram-config', gated);
  assert.match('/api/listings', gated);
  assert.doesNotMatch('/_next/static/app.js', gated);
});

test('the bundle check reports a marker in any nested file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'courtly-bundle-'));
  try {
    await writeFile(path.join(directory, 'clean.js'), 'clean');
    assert.deepEqual(await findMarkers(directory, ['synthetic-marker']), []);
    await writeFile(path.join(directory, 'leak.js'), 'x=synthetic-marker');
    assert.equal((await findMarkers(directory, ['synthetic-marker'])).length, 1);
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
