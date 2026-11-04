import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeListings,
  listingDeduplicationKey,
  shouldReplaceDuplicate,
  suppressDuplicateActiveSlotReposts,
  suppressIncompleteSameSlotReposts,
} from '../scripts/lib/listing-dedupe.mjs';

const activeSlot = ({ sourceMessageId, postedAt, price, listingText = 'Spare court at venue 14 Nov 7pm' }) => ({
  listing: {
    sourceMessageId,
    sourceTelegramMessageId: sourceMessageId.split(':', 1)[0],
    owner: 'Sample Owner',
    status: 'active',
    postedAt,
    venueId: 'verified:venue',
    lat: 1.3,
    lng: 103.8,
    playAt: '2026-11-14T11:00:00.000Z',
    playEndAt: '2026-11-14T13:00:00.000Z',
    sport: 'Badminton',
    price,
    listingText,
  },
  venueMatch: { status: 'deterministic' },
});

test('a live repost replaces its deleted canonical', () => {
  const deleted = { sourceMessageId: '81386:1', status: 'deleted' };
  const active = { sourceMessageId: '81410:1', status: 'active' };

  assert.equal(shouldReplaceDuplicate(deleted, active), true);
});

test('a deleted duplicate cannot suppress an active canonical', () => {
  const active = { sourceMessageId: '81410:1', status: 'active' };
  const deleted = { sourceMessageId: '81386:1', status: 'deleted' };

  assert.equal(shouldReplaceDuplicate(active, deleted), false);
});

test('deduplicates persisted exact-slot reposts and keeps the newest active source', () => {
  const older = { sourceMessageId: '81586:2', status: 'active', postedAt: '2026-10-30T13:15:00.000Z', listingText: 'Clementi Sport Hall 11 Nov 6-7pm $6.90', venueId: 'clementi', playAt: '2026-11-11T10:00:00.000Z', playEndAt: '2026-11-11T11:00:00.000Z', price: 6.9 };
  const newer = { ...older, sourceMessageId: '81650:2', postedAt: '2026-10-31T13:15:00.000Z' };

  assert.equal(listingDeduplicationKey(older), listingDeduplicationKey(newer));
  assert.deepEqual(dedupeListings([older, newer]), [newer]);
});

test('keeps identical listing text when its parsed slot or price differs', () => {
  const first = { listingText: 'Clementi Sport Hall 11 Nov 6-7pm', venueId: 'clementi', playAt: '2026-11-11T10:00:00.000Z', playEndAt: '2026-11-11T11:00:00.000Z', price: 6.9 };
  const anotherDate = { ...first, playAt: '2026-11-12T10:00:00.000Z', playEndAt: '2026-11-12T11:00:00.000Z' };
  const anotherPrice = { ...first, price: 8 };

  assert.notEqual(listingDeduplicationKey(first), listingDeduplicationKey(anotherDate));
  assert.notEqual(listingDeduplicationKey(first), listingDeduplicationKey(anotherPrice));
  assert.equal(dedupeListings([first, anotherDate, anotherPrice]).length, 3);
});

test('prefers active canonical over expired or deleted reposts', () => {
  const expired = { status: 'expired', postedAt: '2026-11-01T00:15:00.000Z' };
  const active = { status: 'active', postedAt: '2026-10-30T00:15:00.000Z' };
  const deleted = { status: 'deleted', postedAt: '2026-11-02T00:15:00.000Z' };

  assert.equal(shouldReplaceDuplicate(expired, active), true);
  assert.equal(shouldReplaceDuplicate(active, deleted), false);
});

test('suppresses only an exact same-owner slot repost when its price is explicitly known', () => {
  const priced = { listing: { status: 'active', owner: 'owner', venueId: 'venue', playAt: '2026-11-13T09:00:00.000Z', playEndAt: '2026-11-13T10:00:00.000Z', sport: 'Badminton', lat: 1.3, lng: 103.8, price: 6 }, venueMatch: { status: 'deterministic' } };
  const incomplete = { listing: { ...priced.listing, price: null }, venueMatch: priced.venueMatch };
  const unrelatedOwner = { listing: { ...incomplete.listing, owner: 'another owner' }, venueMatch: priced.venueMatch };
  const conflictingPrice = { listing: { ...priced.listing, price: 8 }, venueMatch: priced.venueMatch };

  assert.deepEqual(suppressIncompleteSameSlotReposts([priced, incomplete]), [priced]);
  assert.equal(suppressIncompleteSameSlotReposts([priced, unrelatedOwner]).length, 2);
  assert.equal(suppressIncompleteSameSlotReposts([priced, conflictingPrice, incomplete]).length, 3);
});

test('keeps the newest exact same-owner slot repost despite text wrappers', () => {
  const older = activeSlot({ sourceMessageId: '81462', postedAt: '2026-10-27T07:15:00.000Z', price: 8.9 });
  const newer = activeSlot({ sourceMessageId: '81633:2', postedAt: '2026-10-31T09:15:00.000Z', price: 8.9, listingText: '14 Nov 7pm at venue - $8.90' });

  assert.deepEqual(suppressDuplicateActiveSlotReposts([older, newer]), [newer]);
});

test('uses the newest explicit price when an owner reposts the same exact slot', () => {
  const older = activeSlot({ sourceMessageId: '81633:2', postedAt: '2026-10-31T09:15:00.000Z', price: 8.9 });
  const newer = activeSlot({ sourceMessageId: '81771', postedAt: '2026-11-04T02:15:00.000Z', price: 6.9 });

  assert.deepEqual(suppressDuplicateActiveSlotReposts([older, newer]), [newer]);
});

test('preserves multiple exact-slot parts from one source message', () => {
  const firstCourt = activeSlot({ sourceMessageId: '81771:1', postedAt: '2026-11-04T02:15:00.000Z', price: 6.9 });
  const secondCourt = activeSlot({ sourceMessageId: '81771:2', postedAt: '2026-11-04T02:15:00.000Z', price: 6.9 });

  assert.deepEqual(suppressDuplicateActiveSlotReposts([firstCourt, secondCourt]), [firstCourt, secondCourt]);
});

test('does not mistake a date after "court" for a numbered court', () => {
  const older = activeSlot({
    sourceMessageId: '81515',
    postedAt: '2026-10-28T17:15:00.000Z',
    price: null,
    listingText: 'Giving up court\n12/11 Thu 8-9pm Yishun sport hall',
  });
  older.listing.venueId = 'active-sg:yishun-sport-hall';
  older.listing.playAt = '2026-11-12T12:00:00.000Z';
  older.listing.playEndAt = '2026-11-12T13:00:00.000Z';
  older.listing.lat = 1.412018;
  older.listing.lng = 103.8312;
  const newer = activeSlot({
    sourceMessageId: '81741:1',
    postedAt: '2026-11-02T17:15:00.000Z',
    price: null,
    listingText: '12/11 Yishun sport hall 8-9pm',
  });
  Object.assign(newer.listing, {
    venueId: older.listing.venueId,
    playAt: older.listing.playAt,
    playEndAt: older.listing.playEndAt,
    lat: older.listing.lat,
    lng: older.listing.lng,
  });

  assert.deepEqual(suppressDuplicateActiveSlotReposts([older, newer]), [newer]);
});

test('keeps same-slot listings from different owners', () => {
  const first = activeSlot({ sourceMessageId: '9001', postedAt: '2026-11-01T00:00:00.000Z', price: 7 });
  const second = activeSlot({ sourceMessageId: '9002', postedAt: '2026-11-02T00:00:00.000Z', price: 7 });
  second.listing.owner = 'Another Invented Owner';

  assert.deepEqual(suppressDuplicateActiveSlotReposts([first, second]), [first, second]);
  const sameOwnerCase = activeSlot({ sourceMessageId: '9003', postedAt: '2026-11-03T00:00:00.000Z', price: 7 });
  sameOwnerCase.listing.owner = '  SAMPLE owner ';
  assert.deepEqual(suppressDuplicateActiveSlotReposts([first, sameOwnerCase]), [sameOwnerCase]);
});

test('keeps one owner with explicitly different courts posted in separate messages', () => {
  const courtOne = activeSlot({ sourceMessageId: '9101', postedAt: '2026-11-01T00:00:00.000Z', price: 7, listingText: 'Court 1 14 Nov 7pm venue' });
  const courtTwo = activeSlot({ sourceMessageId: '9102', postedAt: '2026-11-02T00:00:00.000Z', price: 7, listingText: 'Court 2 14 Nov 7pm venue' });
  const courtOneRepost = activeSlot({ sourceMessageId: '9103', postedAt: '2026-11-03T00:00:00.000Z', price: 7, listingText: 'ct 1, 14 Nov 7pm venue' });

  assert.deepEqual(suppressDuplicateActiveSlotReposts([courtOne, courtTwo]), [courtOne, courtTwo]);
  assert.deepEqual(suppressDuplicateActiveSlotReposts([courtOne, courtTwo, courtOneRepost]), [courtTwo, courtOneRepost]);
});
