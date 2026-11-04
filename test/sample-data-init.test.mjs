import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNotSampleFeed, initializeSampleData, SAMPLE_SOURCE_URL } from '../scripts/lib/sample-data.mjs';
import { assertPublishableFeed } from '../lib/listing-feed-validation.mjs';

const checkedIn = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const sampleMessages = await checkedIn('telegram-messages.json');
const sampleListings = await checkedIn('telegram-listings.json');
const sample = (id) => ({ messageId: id, id, sourceUrl: SAMPLE_SOURCE_URL });
const live = (id) => ({ messageId: id, id, sourceUrl: 'https://t.me/your_group_invite' });

async function withFiles(messages, listings, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'courtly-init-'));
  const messagesPath = path.join(dir, 'messages.json');
  const listingsPath = path.join(dir, 'listings.json');
  try {
    if (messages !== undefined) await writeFile(messagesPath, typeof messages === 'string' ? messages : JSON.stringify(messages));
    if (listings !== undefined) await writeFile(listingsPath, typeof listings === 'string' ? listings : JSON.stringify(listings));
    const writes = [];
    const initialize = () => initializeSampleData({
      messagesPath,
      listingsPath,
      readFile,
      writeJson: async (file, value) => { writes.push(path.basename(file)); await writeFile(file, JSON.stringify(value)); },
    });
    await run({ initialize, writes, messagesPath, listingsPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a fresh install has its sample messages and listings emptied', async () => {
  await withFiles(sampleMessages, sampleListings, async ({ initialize, messagesPath, listingsPath }) => {
    assert.deepEqual(await initialize(), { initialized: true, reason: 'samples', removed: sampleMessages.length + sampleListings.length });
    assert.deepEqual(JSON.parse(await readFile(messagesPath, 'utf8')), []);
    assert.deepEqual(JSON.parse(await readFile(listingsPath, 'utf8')), []);
  });
});

test('live data is never touched', async () => {
  const relabel = (records, index) => records.map((record, at) => (at === index ? { ...record, sourceUrl: 'https://t.me/your_group_invite' } : record));
  const cases = [
    [[live('1')], [live('a')]],
    // Real records that inherited the sample URL through bad configuration.
    [[sample('5551')], [sample('tg-5551-real-hall')]],
    [[...sampleMessages, sample('5551')], sampleListings],
    [sampleMessages, [...sampleListings, sample('tg-5551-real-hall')]],
    // The same number of marked records, with one unknown ID.
    [[{ ...sampleMessages[0], messageId: '5551' }, ...sampleMessages.slice(1)], sampleListings],
    [sampleMessages, [{ ...sampleListings[0], id: 'tg-5551-real-hall' }, ...sampleListings.slice(1)]],
    // Part of the sample set, or a repeated sample record in place of one.
    [sampleMessages.slice(1), sampleListings],
    [sampleMessages, sampleListings.slice(1)],
    [[sampleMessages[0], ...sampleMessages.slice(0, -1)], sampleListings],
    [sampleMessages, [sampleListings[0], ...sampleListings.slice(0, -1)]],
    // The right IDs on a record that is not marked as a sample.
    [relabel(sampleMessages, 0), sampleListings],
    [sampleMessages, relabel(sampleListings, 0)],
    // A missing or empty counterpart.
    [sampleMessages, []],
    [[], sampleListings],
    [sampleMessages, undefined],
    [undefined, sampleListings],
    [[], [live('a')]],
    [[live('1')], []],
  ];
  for (const [messages, listings] of cases) {
    await withFiles(messages, listings, async ({ initialize, writes, messagesPath, listingsPath }) => {
      const result = await initialize();
      assert.equal(result.initialized, false);
      assert.deepEqual(writes, []);
      if (messages) assert.deepEqual(JSON.parse(await readFile(messagesPath, 'utf8')), messages);
      if (listings) assert.deepEqual(JSON.parse(await readFile(listingsPath, 'utf8')), listings);
    });
  }
});

test('missing, empty, or unreadable files are left alone', async () => {
  for (const [messages, listings] of [[undefined, undefined], [[], []], ['{broken', sampleListings], [{ not: 'an array' }, []], [sampleMessages, 'oops']]) {
    await withFiles(messages, listings, async ({ initialize, writes }) => {
      assert.equal((await initialize()).initialized, false);
      assert.deepEqual(writes, []);
    });
  }
});

test('initializing does not weaken the publish guards', () => {
  assert.throws(() => assertPublishableFeed([]), /empty or malformed/);
  assert.throws(() => assertNotSampleFeed([sample('a')]), /sample listing/);
});

test('the ingestion runner initializes samples before it reads Telegram, and never in a dry run', async () => {
  const code = (await readFile(new URL('../scripts/run-local-ingestion.mjs', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const guard = code.indexOf('if (!dryRun) {\n    const initialized = await initializeSampleData(');
  assert.ok(guard > 0);
  assert.ok(guard < code.indexOf("runStage('telegram_read'"));
});
