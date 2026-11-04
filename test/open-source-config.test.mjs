import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveListingFeed } from '../lib/listing-feed.ts';
import { internalChatId, telegramMessageUrl, telegramOwnerUrl } from '../lib/telegram-links.ts';
import { assertNotSampleFeed, SAMPLE_SOURCE_URL } from '../scripts/lib/sample-data.mjs';
import { getTelegramSourceUrl, requireTelegramSource } from '../scripts/lib/telegram-source-config.mjs';

const noEnvFile = { envFile: path.join(os.tmpdir(), 'courtly-no-such-env-file') };
const sample = [{ id: 'sample' }];
const loadSample = async () => sample;

test('ingestion refuses to run without a configured Telegram source', () => {
  assert.throws(
    () => requireTelegramSource({ env: {}, ...noEnvFile }),
    (error) => error.code === 'TELEGRAM_SOURCE_NOT_CONFIGURED'
      && /COURTLY_TELEGRAM_CHAT_ID/.test(error.message)
      && /COURTLY_TELEGRAM_SOURCE_URL/.test(error.message),
  );
  assert.throws(
    () => requireTelegramSource({ env: { COURTLY_TELEGRAM_CHAT_ID: '123', COURTLY_TELEGRAM_SOURCE_URL: 'https://t.me/your_group_invite' }, ...noEnvFile }),
    /COURTLY_TELEGRAM_CHAT_ID must be/,
  );
  assert.equal(getTelegramSourceUrl({ env: {}, ...noEnvFile }), '');
});

test('Telegram source resolves from the environment before the VM .env file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'courtly-env-'));
  const envFile = path.join(dir, '.env');
  try {
    await writeFile(envFile, '# comment\nOTHER=1\nexport COURTLY_TELEGRAM_CHAT_ID="-1001"\nCOURTLY_TELEGRAM_SOURCE_URL=https://t.me/your_group_invite\n');
    assert.deepEqual(requireTelegramSource({ env: {}, envFile }), { chatId: '-1001', sourceUrl: 'https://t.me/your_group_invite' });
    assert.equal(requireTelegramSource({ env: { COURTLY_TELEGRAM_CHAT_ID: '-1002' }, envFile }).chatId, '-1002');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser Telegram links disappear when no chat is configured', () => {
  assert.equal(internalChatId('-1001234'), '1234');
  assert.equal(telegramMessageUrl('-1001234', '42'), 'https://t.me/c/1234/42');
  assert.equal(telegramMessageUrl('1234', '42'), 'https://t.me/c/1234/42');
  assert.equal(telegramMessageUrl(undefined, '42'), null);
  assert.equal(telegramMessageUrl('', '42'), null);
  assert.equal(telegramOwnerUrl('@alex', null), 'https://t.me/alex');
  assert.equal(telegramOwnerUrl(undefined, null), null);
  assert.equal(telegramOwnerUrl(undefined, 'https://t.me/c/1234/42'), 'https://t.me/c/1234/42');
});

test('only the dev server serves sample listings when no feed is bound', async () => {
  const dev = await resolveListingFeed({ isDevelopment: true, loadSample });
  assert.equal(dev.status, 200);
  assert.deepEqual(dev.body.listings, sample);
  const production = await resolveListingFeed({ isDevelopment: false, loadSample });
  assert.equal(production.status, 503);
  assert.equal('listings' in production.body, false);
});

test('an empty, invalid, or failing KV feed never falls back to sample listings', async () => {
  for (const isDevelopment of [true, false]) {
    for (const store of [
      { get: async () => null },
      { get: async () => [{ id: 'missing-fields' }] },
      { get: async () => { throw new Error('KV down'); } },
    ]) {
      const result = await resolveListingFeed({ store, isDevelopment, loadSample });
      assert.equal(result.status, 503);
      assert.equal('listings' in result.body, false);
    }
  }
});

test('a valid KV feed is served as live data', async () => {
  const listings = JSON.parse(await readFile(new URL('../data/telegram-listings.json', import.meta.url), 'utf8'));
  const store = { get: async (key) => (key === 'courtly:listings' ? listings : null) };
  const result = await resolveListingFeed({ store, isDevelopment: false, loadSample });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'cloudflare-kv');
  assert.deepEqual(result.body.listings, listings);
});

test('feed publishing refuses sample listings', () => {
  assert.throws(() => assertNotSampleFeed([{ sourceUrl: 'https://t.me/your_group_invite' }, { sourceUrl: SAMPLE_SOURCE_URL }]), /1 sample listing/);
  assert.doesNotThrow(() => assertNotSampleFeed([{ sourceUrl: 'https://t.me/your_group_invite' }]));
});

test('source sync never copies checked-in listing data over runtime data', async () => {
  const script = await readFile(new URL('../scripts/deploy-from-github-oracle.sh', import.meta.url), 'utf8');
  for (const file of ['telegram-listings', 'telegram-messages', 'parser-ambiguities', 'unmatched-venue-candidates', 'ambiguity-review-history']) {
    assert.match(script, new RegExp(`--exclude='data/${file}\\.json'`));
  }
  assert.match(script, /--exclude='\.env'/);
});

test('source sync examples use generic overridable paths', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const script = await read('scripts/deploy-from-github-oracle.sh');
  const dropIn = await read('ops/courtly-ingest.service.d/github-deploy.conf');
  for (const name of ['COURTLY_GITHUB_SOURCE_DIR', 'COURTLY_APP_DIR', 'COURTLY_GITHUB_KEY', 'COURTLY_GITHUB_KNOWN_HOSTS']) {
    assert.match(script, new RegExp(`\\$\\{${name}:-/opt/courtly/`));
  }
  assert.doesNotMatch(script + dropIn, /\/home\//);
  assert.match(dropIn, /ExecStartPre=\/usr\/bin\/bash \/opt\/courtly\/source\/scripts\/deploy-from-github-oracle\.sh/);
});

test('notice and docs carry the release warnings', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const notice = await read('NOTICE');
  assert.match(notice, /https:\/\/www\.onemap\.gov\.sg\/legal\/opendatalicence\.html/);
  assert.match(notice, /https:\/\/www\.onemap\.gov\.sg\/legal\/apitermsofservice\.html/);
  for (const doc of [await read('README.md'), await read('docs/operations.md')]) {
    assert.match(doc, /credential-free checkout/);
    assert.match(doc, /allowlist/);
  }
  assert.match(await read('docs/operations.md'), /Moving a VM to rewritten history/);
});
