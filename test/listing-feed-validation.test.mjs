import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FEED_KEY, resolveListingFeed } from '../lib/listing-feed.ts';
import { planFeedPublish } from '../scripts/lib/feed-publish-plan.mjs';
import { SAMPLE_SOURCE_URL } from '../scripts/lib/sample-data.mjs';
import { assertPublishableFeed, isListingFeed, isValidListing } from '../lib/listing-feed-validation.mjs';

const listing = {
  id: 'a',
  facility: 'Example Hall',
  area: 'Central',
  playAt: '2030-01-01T00:00:00.000Z',
  playEndAt: '2030-01-01T01:00:00.000Z',
  postedAt: '2029-12-01T00:00:00.000Z',
  status: 'active',
  sourceMessageId: '1',
  sourceUrl: 'https://t.me/+invented',
  rawText: 'Court at Example Hall',
  displayDate: '1 Jan 2030',
  displayDay: 'Tuesday',
  displayTime: '8:00 am',
  duration: '1 hour',
  price: 10,
  owner: 'Alex',
};
const loadSample = async () => [];

test('the publisher refuses feeds the reader would reject', async () => {
  for (const feed of [
    [{ id: 'x' }],
    [{ ...listing, playAt: null }],
    [{ ...listing, status: undefined }],
    [{ ...listing, sourceMessageId: 1 }],
    [{ id: 'a', playAt: '2036-01-01T00:00:00.000Z', status: 'active', sourceMessageId: '1' }],
    ...Object.keys(listing).filter((field) => field !== 'playEndAt').map((field) => [{ ...listing, [field]: undefined }]),
    [{ ...listing, rawText: 5 }],
    [{ ...listing, duration: null }],
    [{ ...listing, price: undefined }],
    [{ ...listing, price: '10' }],
    [{ ...listing, playAt: 'not a date' }],
    [{ ...listing, status: 'archived' }],
    [{ ...listing, lat: '1.3' }],
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
    listingText: null,
    venueMatch: null,
    lat: null,
    lng: null,
    venueId: null,
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

test('the page never receives a listing it cannot render', () => {
  // Without text to match, the page calls matchVenue(undefined) and throws.
  const withoutText = { ...listing, rawText: undefined };
  assert.equal(isValidListing(withoutText), false);
  assert.equal(isValidListing({ ...withoutText, listingText: 'Example Hall' }), false);
});

test('older feeds without an end time are still valid', () => {
  const older = { ...listing, playEndAt: undefined };
  assert.equal(isValidListing(older), true);
});

test('the publish plan refuses bad feeds before any command exists', () => {
  const plan = (rawFeed, namespaceId = 'ns-1') => planFeedPublish({ rawFeed, root: '/repo', namespaceId });
  assert.throws(() => plan('{not json'), /not valid JSON/);
  assert.throws(() => plan('[]'), /empty or malformed/);
  assert.throws(() => plan('[{"id":"x"}]'), /empty or malformed/);
  assert.throws(() => plan(JSON.stringify([{ ...listing, sourceUrl: SAMPLE_SOURCE_URL }])), /sample listing/);
  assert.throws(() => plan(JSON.stringify([listing]), ''), /COURTLY_FEED_KV_NAMESPACE_ID/);
});

test('the publish plan writes the key the reader reads, with exact arguments', async () => {
  const { args, feedPath, wranglerPath } = planFeedPublish({ rawFeed: JSON.stringify([listing]), root: '/repo', namespaceId: 'ns-1' });
  assert.deepEqual(args, [
    '--no-warnings', wranglerPath, 'kv', 'key', 'put', 'courtly:listings',
    '--namespace-id', 'ns-1', '--path', feedPath, '--remote',
  ]);
  assert.equal(path.basename(feedPath), 'telegram-listings.json');

  // A store that only knows the published key: the reader must ask for exactly that one.
  const published = args[args.indexOf('put') + 1];
  const store = { get: async (key) => (key === published ? [listing] : null) };
  const read = await resolveListingFeed({ store, isDevelopment: false, loadSample });
  assert.equal(read.status, 200);
  assert.equal(FEED_KEY, published);
});

test('the publish script runs the plan and spawns exactly its arguments', async () => {
  const code = (await readFile(new URL('../scripts/publish-feed-to-kv.mjs', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /const plan = planFeedPublish\(/);
  assert.match(code, /spawn\(process\.execPath, plan\.args,/);
  assert.doesNotMatch(code, /courtly:listings|kv.*put/);
});
