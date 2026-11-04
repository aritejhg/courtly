import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveListingFeed } from '../lib/listing-feed.ts';
import { assertPublishableFeed, isListingFeed, isValidListing } from '../lib/listing-feed-validation.mjs';

const listing = { id: 'a', playAt: '2030-01-01T00:00:00.000Z', status: 'active', sourceMessageId: '1' };
const loadSample = async () => [];

test('the publisher refuses feeds the reader would reject', async () => {
  for (const feed of [
    [{ id: 'x' }],
    [{ ...listing, playAt: null }],
    [{ ...listing, status: undefined }],
    [{ ...listing, sourceMessageId: 1 }],
    [listing, null],
    [listing, 'x'],
    { listings: [listing] },
    null,
  ]) {
    assert.throws(() => assertPublishableFeed(feed), /empty or malformed/);
    const read = await resolveListingFeed({ store: { get: async () => feed }, isDevelopment: false, loadSample });
    assert.equal(read.status, 503);
  }
});

test('an empty feed is servable but never published', () => {
  assert.equal(isListingFeed([]), true);
  assert.throws(() => assertPublishableFeed([]), /empty or malformed/);
});

test('accepts the nullable and optional fields ingestion legitimately emits', () => {
  const emitted = {
    ...listing,
    status: 'deleted',
    deletedAt: '2030-01-01T00:00:00.000Z',
    price: null,
    ownerUsername: null,
    lat: null,
    lng: null,
    venueId: null,
    area: null,
  };
  assert.equal(isValidListing(emitted), true);
  assert.doesNotThrow(() => assertPublishableFeed([emitted]));
});

test('accepts every record in the checked-in feed, as publisher and reader', async () => {
  const feed = JSON.parse(await readFile(new URL('../data/telegram-listings.json', import.meta.url), 'utf8'));
  assert.ok(feed.length > 0);
  assert.doesNotThrow(() => assertPublishableFeed(feed));
  const read = await resolveListingFeed({ store: { get: async () => feed }, isDevelopment: false, loadSample });
  assert.equal(read.status, 200);
});

test('the publish script validates before it can reach Wrangler', async () => {
  const source = await readFile(new URL('../scripts/publish-feed-to-kv.mjs', import.meta.url), 'utf8');
  const validated = source.indexOf('assertPublishableFeed(feed)');
  assert.ok(validated > 0);
  assert.ok(validated < source.indexOf('spawn(process.execPath'));
});
