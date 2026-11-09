import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildListing,
  extractVenueCandidates,
  isIgnoredSwapMessage,
  isPotentialCourtMessage,
  matchVenue,
  parseDate,
  parsePrice,
  parseTime,
  splitMessageListings,
} from '../scripts/lib/telegram-parser.mjs';
import { repairListings } from '../scripts/repair-listing-coordinates.mjs';

const venues = [
  { id: 'yishun', canonicalName: 'Yishun Sport Hall', aliases: ['Yishun sports hall'], kind: 'sport_hall', area: 'Yishun', lat: 1.41, lng: 103.83 },
  { id: 'canberra', canonicalName: 'Bukit Canberra Sport Hall', aliases: ['Bukit Canberra Sports Hall'], kind: 'sport_hall', area: 'Sembawang', lat: 1.44, lng: 103.82 },
  { id: 'sengkang', canonicalName: 'Sengkang Sport Hall', aliases: ['Sengkang SH'], kind: 'sport_hall', area: 'Sengkang', lat: 1.39, lng: 103.88 },
  { id: 'anchor', canonicalName: 'Anchor Green Primary School Hall', aliases: ['Anchor Green pri'], kind: 'school_sport_hall', area: 'Punggol', lat: 1.39, lng: 103.89 },
  { id: 'sports-arina-jalan-kayu', canonicalName: 'The Sports Arina @ Jalan Kayu', aliases: ['The Sports Arina Jalan Kayu'], kind: 'sport_hall', area: 'Sengkang' },
];

test('infers 11am-1pm when only the ending pm marker is supplied', () => {
  const date = new Date('2026-09-02T04:00:00.000Z');
  const result = parseTime('11-1pm', date);
  assert.equal(result.status, 'deterministic');
  assert.equal(result.value.hours, 2);
  assert.match(result.value.display, /11:00\s*am.*1:00\s*pm/i);
});

test('infers morning-to-noon ranges when noon carries the pm marker', () => {
  const date = new Date('2026-09-02T04:00:00.000Z');
  for (const [text, start] of [['10-12pm', '10:00 am'], ['11-12pm', '11:00 am']]) {
    const result = parseTime(text, date);
    assert.equal(result.status, 'deterministic');
    assert.match(result.value.display, new RegExp(start + '.*12:00\\s*pm', 'i'));
  }
});

test('parses explicit noon and midnight words as range endpoints', () => {
  const date = new Date('2026-11-08T00:00:00.000Z');
  for (const [text, start, end] of [
    ['10am-12noon', '2026-11-08T02:00:00.000Z', '2026-11-08T04:00:00.000Z'],
    ['11pm-12midnight', '2026-11-08T15:00:00.000Z', '2026-11-08T16:00:00.000Z'],
  ]) {
    const result = parseTime(text, date);
    assert.equal(result.status, 'deterministic');
    assert.equal(result.value.start.toISOString(), start);
    assert.equal(result.value.end.toISOString(), end);
  }
  assert.equal(parseTime('10noon-12pm', date).status, 'ambiguous');
});

test('preserves the explicit noon range from a source-style listing', () => {
  const { listing } = buildListing({
    messageId: 'eunonia-noon-range',
    postedAt: '2026-11-06T09:00:00.000Z',
    text: 'Spare slot going for what I paid.\n\n15 Nov (Sun), 10am-12noon\nEunonia Junnior College Hall - $13.6\n\nMessage me to arrange, cheers!',
  }, venues, { now: new Date('2026-11-08T00:00:00.000Z') });
  assert.equal(listing.playAt, '2026-11-15T02:00:00.000Z');
  assert.equal(listing.playEndAt, '2026-11-15T04:00:00.000Z');
  assert.match(listing.displayTime, /10:00\s*am.*12:00\s*pm/i);
});

test('rolls explicit midnight to the next day for late-night listings', () => {
  const date = new Date('2026-10-28T00:00:00.000Z');
  for (const [text, start, end, hours] of [
    ['10pm to 12am', '2026-10-28T14:00:00.000Z', '2026-10-28T16:00:00.000Z', 2],
    ['11pm-12am', '2026-10-28T15:00:00.000Z', '2026-10-28T16:00:00.000Z', 1],
  ]) {
    const result = parseTime(text, date);
    assert.equal(result.status, 'deterministic');
    assert.equal(result.value.start.toISOString(), start);
    assert.equal(result.value.end.toISOString(), end);
    assert.equal(result.value.hours, hours);
  }
});

test('emits a canonical end timestamp for date-time filtering', () => {
  const result = buildListing({
    messageId: 'date-time-filter',
    postedAt: '2026-09-01T00:00:00.000Z',
    text: 'Court going\n18 Sept\nYishun sports hall\n6-8pm\n$9',
  }, venues, { now: new Date('2026-09-01T00:00:00.000Z') });
  assert.equal(result.issues.length, 0);
  assert.equal(result.listing.playAt, '2026-09-18T10:00:00.000Z');
  assert.equal(result.listing.playEndAt, '2026-09-18T12:00:00.000Z');
});

test('matches the verified Tamp Hub shorthand in split listings', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  for (const [messageId, text, expectedDate] of [
    ['73483-1', 'Extra court\nThurs 22nd Oct\nTamp Hub 2-4pm $8', '22 Oct 2026'],
    ['73483-2', 'Extra court\nFriday 23rd Oct\nTamp Hub 2-4pm $8', '23 Oct 2026'],
  ]) {
    const result = buildListing({
      messageId,
      postedAt: '2026-10-14T16:00:00.000Z',
      text,
    }, productionVenues, { now: new Date('2026-10-14T16:00:00.000Z') });
    assert.deepEqual(result.issues, []);
    assert.equal(result.venueMatch.status, 'deterministic');
    assert.equal(result.listing.facility, 'Our Tampines Hub - Community Auditorium');
    assert.equal(result.listing.displayDate, expectedDate);
    assert.equal(result.listing.lat, 1.353547);
    assert.equal(result.listing.lng, 103.9404);
  }
});

test('matches Smash Arena Joo Koon in repeated split listings with verified coordinates', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  for (const [messageId, extra] of [
    ['81120', ''],
    ['81122', ', rubber floor'],
  ]) {
    const result = buildListing({
      messageId,
      postedAt: '2026-10-24T02:00:00.000Z',
      text: `Giving away a slot below what I paid\n\n$38‼️ (Normally $60${extra})\n24/10 Smash Arena (Jookoon)\n3-5pm\n\nText me if keen!`,
    }, productionVenues, { now: new Date('2026-10-24T02:01:00.000Z') });
    assert.deepEqual(result.issues, []);
    assert.equal(result.venueMatch.status, 'deterministic');
    assert.equal(result.listing.facility, 'Smash Arena');
    assert.equal(result.listing.venueId, 'smash-arena:smash-arena-joo-koon');
    assert.equal(result.listing.lat, 1.329425336);
    assert.equal(result.listing.lng, 103.682841561);
  }
});

test('matches TP Central and TP West abbreviations in split listings', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const message = {
    messageId: '81124',
    postedAt: '2026-10-24T05:00:00.000Z',
    text: 'Hall slots available\n\nTP: Toa Payoh\n\n1. 2 Nov (Mon)\nTP Central CC\n4-6 pm ($8)\n\n2. 3 Nov (Tue)\nTP Central CC\n4-6 pm ($8)\n\n3. 5 Nov (Thu)\nTP West CC\n5.30 to 7.30 pm ($10)\n\nMessage for transfer info',
  };
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 3);
  const parsed = parts.map((part, index) => buildListing(message, allVenues, {
    now: new Date('2026-10-24T05:02:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.deepEqual(parsed.map((item) => item.listing.facility), ['Toa Payoh Central CC', 'Toa Payoh Central CC', 'Toa Payoh West CC']);
  assert.deepEqual(parsed.map((item) => [item.listing.lat, item.listing.lng]), [
    [1.334934520548422, 103.8502045427675],
    [1.334934520548422, 103.8502045427675],
    [1.335221249794357, 103.8451058001388],
  ]);
});

test('matches named private venues with a location suffix without inventing coordinates', () => {
  const message = {
    messageId: '73399',
    postedAt: '2026-09-06T08:00:00.000Z',
    owner: 'Xavier Quek',
    text: 'Passing on 1x court\n\nThe Sports Arina @ Jalan Kayu\nRubber floor, aircon\nComing Sunday 13 September\n8-10PM\n$61 incl card fee\nPing me.',
  };
  const result = buildListing(message, venues, { now: new Date('2026-09-06T08:00:00.000Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'The Sports Arina @ Jalan Kayu');
  assert.deepEqual(result.issues, []);
  assert.equal('lat' in result.listing, false);
  assert.equal('lng' in result.listing, false);
});

test('resolves verified school shorthand with a parenthesized locality', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/edgefield-secondary-parenthesized.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing(message, productionVenues, { now: new Date('2026-09-12T15:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Edgefield Secondary School Hall');
  assert.equal(result.listing.venueId, 'active-sg:edgefield-secondary-school-hall');
  assert.equal(result.listing.price, 8.2);
  assert.equal(result.listing.displayDate, '20 Sept 2026');
  assert.equal(result.listing.displayTime, '7:00 pm–8:00 pm');
  assert.equal(result.listing.sourceTelegramMessageId, '73420');
  assert.equal(result.listing.rawText, message.rawText);
});

test('matches parenthesized location suffixes from an ambiguity fixture', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/sports-arina-parenthesized.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T03:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'The Sports Arina @ Jalan Kayu');
  assert.equal(result.listing.sourceTelegramMessageId, '73343');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.3918);
  assert.equal(result.listing.lng, 103.8771);
});

test('resolves the exact at-location venue ambiguity fixture deterministically', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/sports-arina-at-location.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'The Sports Arina @ Jalan Kayu');
  assert.equal(result.listing.sourceTelegramMessageId, '73301');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.price, 61);
  assert.equal(result.listing.displayTime, '8:00 pm–10:00 pm');
  assert.equal(result.listing.lat, 1.3918);
  assert.equal(result.listing.lng, 103.8771);
});

test('matches abbreviated verified community-club names from a fixture without inventing coordinates', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/yew-tee-cc.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [
    { id: 'onepa:yew-tee-cc', canonicalName: 'Yew Tee CC', aliases: ['Yew Tee', 'Yew Tee CC', 'Yew Tee Community Club'], kind: 'community_club', area: 'Choa Chu Kang' },
  ], { now: new Date('2026-09-06T07:00:00.000Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Yew Tee CC');
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.sourceTelegramMessageId, '73392');
  assert.equal('lat' in result.listing, false);
  assert.equal('lng' in result.listing, false);
});

test('resolves a private venue override with verified coordinates from a listing fixture', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/sbh-sims.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-04T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'SBH @ Sims');
  assert.equal(result.listing.venueId, 'manual:sbh-sims');
  assert.equal(result.listing.price, 68.2);
  assert.equal(result.listing.displayTime, '9:00 am–11:00 am');
  assert.equal(result.listing.sourceTelegramMessageId, '73266');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.315460529862975);
  assert.equal(result.listing.lng, 103.8812548051696);
});

test('resolves repeated exact community-club venue names with verified coordinates', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/potong-pasir-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Potong Pasir CC');
  assert.equal(result.listing.venueId, 'manual:potong-pasir-cc');
  assert.equal(result.listing.price, 11);
  assert.equal(result.listing.displayTime, '4:30 pm–5:30 pm');
  assert.equal(result.listing.sourceTelegramMessageId, '73294');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.332633815456039);
  assert.equal(result.listing.lng, 103.8671516737261);
});

test('resolves a repeated exact Telegram community-club name as a strict override', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/fernvale-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], {
    now: new Date('2026-09-13T00:00:00.000Z'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Fernvale CC');
  assert.equal(result.listing.venueId, 'manual:fernvale-cc');
  assert.equal(result.listing.price, 7);
  assert.equal(result.listing.displayTime, '7:30 pm–8:30 pm');
  assert.equal(result.listing.sourceTelegramMessageId, '73427');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.391722092792314);
  assert.equal(result.listing.lng, 103.877039073044);
});

test('resolves a short community-club venue in the production catalog', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/yew-tee-cc-production-catalog.json', import.meta.url), 'utf8'));
  const activeSgVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...activeSgVenues, ...overrides], { now: new Date('2026-09-06T07:00:00.000Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Yew Tee CC');
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.sourceTelegramMessageId, '73378');
  assert.equal(result.listing.rawText, message.rawText);
});

test('matches verified sport halls when Telegram omits the ActiveSG suffix', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/heartbeat-bedok.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [
    { id: 'heartbeat', canonicalName: 'Heartbeat @ Bedok ActiveSG Sport Hall', aliases: ['Heartbeat @ Bedok ActiveSG Sports Hall'], kind: 'sport_hall', area: 'Bedok', lat: 1.326985, lng: 103.9316 },
  ], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Heartbeat @ Bedok ActiveSG Sport Hall');
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.sourceTelegramMessageId, '73385');
  assert.equal(result.listing.lat, 1.326985);
  assert.equal(result.listing.lng, 103.9316);
});

test('matches verified government high school halls from Telegram shorthand', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/bukit-panjang-gov-high-two-slots.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing({ ...message, messageId: message.sourceTelegramMessageId, text: message.rawText }, productionVenues, {
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Bukit Panjang Government High School Hall');
  assert.equal(result.listing.price, 12.6);
  assert.equal(result.listing.sourceTelegramMessageId, '73336');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.382242);
  assert.equal(result.listing.lng, 103.7384);
});

test('resolves the unknown government-high shorthand ambiguity fixture', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/bukit-panjang-gov-high.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing({ ...message, messageId: message.messageId, text: message.rawText }, productionVenues, {
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Bukit Panjang Government High School Hall');
  assert.equal(result.listing.sourceTelegramMessageId, '73315');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.price, 12.6);
  assert.equal(result.listing.displayTime, '8:00 am\u201310:00 am');
  assert.equal(result.listing.lat, 1.382242);
  assert.equal(result.listing.lng, 103.7384);
});

test('resolves Ayer Rajah CC shorthand in the availability half of a swap message', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/ayer-rajah-cc-swap.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Ayer Rajah CC');
  assert.equal(result.listing.venueId, 'onepa:ayer-rajah-cc');
  assert.equal(result.listing.displayDate, '21 Sept 2026');
  assert.equal(result.listing.displayTime, '8:30 pm–10:30 pm');
  assert.equal(result.listing.sourceTelegramMessageId, '73245');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.320961547327516);
  assert.equal(result.listing.lng, 103.7476984267228);
});

test('resolves Pasir Ris East CC with verified OneMap coordinates', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: '73434:2',
    postedAt: '2026-09-23T08:00:00.000Z',
    text: '3 Oct (Sat)\nPasir Ris East CC\n130pm-330pm\n$15',
  }, [...productionVenues, ...overrides], { now: new Date('2026-09-23T08:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Pasir Ris East CC');
  assert.equal(result.listing.venueId, 'onepa:pasir-ris-east-cc');
  assert.equal(result.listing.lat, 1.368485527501331);
  assert.equal(result.listing.lng, 103.9594284394219);
});

test('resolves Crescent Girls School shorthand to the verified ActiveSG hall', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: '73441',
    postedAt: '2026-09-23T08:00:00.000Z',
    text: 'Giving up slot\n3 Oct (Sat)\nCrescent girl\'s school\n6pm - 8pm\n$13.20',
  }, [...productionVenues, ...overrides], { now: new Date('2026-09-23T08:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, "Crescent Girls' School Hall");
  assert.equal(result.listing.lat, 1.2926657);
  assert.equal(result.listing.lng, 103.8179673);
});

test('resolves the recurring singular Crescent Girl School shorthand', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: 'crescent-girl-singular',
    postedAt: '2026-10-03T04:00:00.000Z',
    text: 'Passing on court, paid $20.40\n\n10 Oct Sat 3 hours\nCrescent Girl School 2-5pm\n\nPing if interested.',
  }, [...productionVenues, ...overrides], { now: new Date('2026-10-03T04:00:00.000Z') });

  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, "Crescent Girls' School Hall");
  assert.equal(result.listing.lat, 1.2926657);
  assert.equal(result.listing.lng, 103.8179673);
});

test('resolves the recurring Pei Ying Primary School listing to its verified hall', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: 'synthetic-peiying-school-001',
    postedAt: '2026-11-05T04:00:00.000Z',
    text: 'Offering courts at cost\nDate: 08/11 (Sunday)\nVenue: Pei Ying Primary school (near Khatib MRT)\nTime: 5pm-7pm',
  }, [...productionVenues, ...overrides], { now: new Date('2026-11-05T04:00:00.000Z') });

  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Peiying Primary School Hall');
  assert.equal(result.listing.venueId, 'active-sg:peiying-primary-school-hall');
  assert.equal(result.listing.lat, 1.417233);
  assert.equal(result.listing.lng, 103.8304);
});

test('resolves the recovered missing-coordinate venue aliases to verified coordinates', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  const recovered = [
    'Canberra CC',
    'Admilraty Pri School Hall',
    'Keat Hong CC',
    'Yuhua CC',
    'SBH VIP',
    'Hillview CC near Bukit Batok',
    'Ace the Place CC',
    'Toa Payoh South CC',
    'Marymount CC',
    'Bukit Panjang CC',
    'Toa Payoh Central CC',
    'Ace the Place',
    'Choa Chu Kang CC',
    'Tiong Barhu CC',
    'Senja-Cashew CC',
    'Senja CC',
    'Hillview CC',
    'Heartbeat Bedon',
    'Tanjong Parga CC',
    'Nee Soon South CC blk 845 lv 3 Sheng Siong',
    'Ahmad Ibrahim Sec School Hall',
    'Woodlands Secondary School near Marsling CC',
    'Changi simei CC',
    'Nee soon East CC',
    'Ulu Pandan CC',
    'Queenstwon CC',
    'Kaki Bukit CC',
    'Yew tee Primary school',
    'Nanyang CC 14',
    'Elias Park Primary, Pasir Ris',
    'Bidadari CC',
    'Kebun Baru CC',
    'JW Sport Hall Jurong west sports hall',
    'Feng Shan CC',
    'Pek Kio CC',
    'Buona Vista CC',
    'Hong Kah CC',
    'Toa Payoh East CC',
    'Jurong Secondary Sch 618652',
    'Unity seconday school',
    'Community Hall @ Sprout Hub',
    'YCK Sports Hall',
    'Wisma Geylang Serai',
    'SAFRA Mount Faber',
    'SAFRA Toa Payoh',
    'Yishun spt hal',
    'Pei Ying Primary School',
  ];

  for (const alias of recovered) {
    const result = matchVenue(alias, catalog);
    assert.equal(result.status, 'deterministic', alias);
    assert.ok(Number.isFinite(result.venue.lat) && Number.isFinite(result.venue.lng), alias);
  }
});

test('resolves current SAFRA Toa Payoh and Senja CC listings with verified coordinates', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  const cases = [
    {
      messageId: '73476',
      postedAt: '2026-10-12T23:00:00.000Z',
      text: 'Extra court going at what I paid.\n\nToday, 13 Oct, 2-4pm\nSafra Toa Payoh- 13 dollars',
      facility: 'SAFRA Toa Payoh',
      lat: 1.329807341225412,
      lng: 103.8544043513386,
    },
    {
      messageId: '73469',
      postedAt: '2026-10-11T20:00:00.000Z',
      text: 'Slot going\n\n16th Oct\nSenja Cc 3-5pm',
      facility: 'Senja-Cashew CC',
      lat: 1.381638133193397,
      lng: 103.7646762509678,
    },
    {
      messageId: '81785',
      postedAt: '2026-11-11T09:00:00.000Z',
      text: 'Spare court for $22\n\n11/11 Wednesday (tonight)\nTPY SAFRA\n10pm - 12am\n\nText me if keen',
      facility: 'SAFRA Toa Payoh',
      lat: 1.329807341225412,
      lng: 103.8544043513386,
      playAt: '2026-11-11T14:00:00.000Z',
      playEndAt: '2026-11-11T16:00:00.000Z',
      price: 22,
    },
  ];
  for (const fixture of cases) {
    const result = buildListing(fixture, catalog, { now: new Date('2026-10-12T00:00:00.000Z') });
    assert.deepEqual(result.issues, []);
    assert.equal(result.listing.facility, fixture.facility);
    assert.equal(result.listing.lat, fixture.lat);
    assert.equal(result.listing.lng, fixture.lng);
    if (fixture.playAt) assert.equal(result.listing.playAt, fixture.playAt);
    if (fixture.playEndAt) assert.equal(result.listing.playEndAt, fixture.playEndAt);
    if (fixture.price != null) assert.equal(result.listing.price, fixture.price);
  }
});

test('resolves TP East CC from a split listing to its verified venue coordinates', async () => {
  const message = {
    messageId: '81374',
    postedAt: '2026-10-31T13:00:00.000Z',
    text: 'Hall slots available\n\nTP: Toa Payoh\n\n10 Nov (Tue) 6 - 7 TP Central CC ($5.50)\n12 Nov (Thu) 4.30 – 6.30 TP East CC ($8)\nMessage for transfer info',
  };
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 2);

  const result = buildListing(message, catalog, {
    now: new Date('2026-11-02T05:00:00.000Z'),
    listingText: parts[1].text,
    listingIndex: 1,
    partCount: parts.length,
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Toa Payoh East CC');
  assert.equal(result.listing.displayTime, '4:30 pm–6:30 pm');
  assert.equal(result.listing.lat, 1.336315364964432);
  assert.equal(result.listing.lng, 103.8548484372016);
});

test('matches strict catalog aliases inside compact listing lines with release text', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  const cases = [
    {
      text: 'Apologies. Giving up court at YCK Sports Hall, 3 Oct, 5-6pm. SGD 6.90',
      postedAt: '2026-09-27T00:00:00.000Z',
      venueId: 'active-sg:yio-chu-kang-sport-hall',
      lat: 1.383626,
      lng: 103.8459,
    },
    {
      text: 'Spare court for what I paid Crescnt Girls(Redhill). Sat, 26 Sep 5-6pm $6.9',
      postedAt: '2026-09-25T00:00:00.000Z',
      venueId: 'active-sg:crescent-girls-school-hall',
      lat: 1.2926657,
      lng: 103.8179673,
    },
    {
      text: 'Giving up court 1 October 2026 today CCK SH 2-4 pm $6 text me thanks',
      postedAt: '2026-09-30T00:00:00.000Z',
      venueId: 'active-sg:choa-chu-kang-sport-hall',
      lat: 1.390778,
      lng: 103.748,
    },
    {
      text: 'Giving up at what I paid $6 9 Oct Friday 1-3pm Jurong west sports hall. Text me thank you',
      postedAt: '2026-10-08T00:00:00.000Z',
      venueId: 'active-sg:jurong-west-sport-hall',
      lat: 1.338418,
      lng: 103.6938,
    },
    {
      text: 'Spare court $13.6 Sun, 20 Sep Jurong Sec Sch 618652 1:00 pm - 3:00 pm 2 hours',
      postedAt: '2026-09-19T00:00:00.000Z',
      venueId: 'school:jurong-secondary',
      lat: 1.33002032220943,
      lng: 103.7239529616472,
    },
    {
      text: 'giving up 31 oct Saturday 3-5pm, woodlands sec school hall, $13.60',
      postedAt: '2026-10-30T00:00:00.000Z',
      venueId: 'active-sg:woodlands-secondary-school-hall',
      lat: 1.439125,
      lng: 103.7746,
    },
  ];

  for (const [index, fixture] of cases.entries()) {
    const result = buildListing({
      messageId: `compact-venue-${index}`,
      postedAt: fixture.postedAt,
      text: fixture.text,
    }, catalog, { now: new Date(fixture.postedAt) });
    assert.equal(result.venueMatch.status, 'deterministic', fixture.text);
    assert.equal(result.listing.venueId, fixture.venueId, fixture.text);
    assert.equal(result.listing.lat, fixture.lat, fixture.text);
    assert.equal(result.listing.lng, fixture.lng, fixture.text);
  }
});

test('repairs persisted listing coordinates only for deterministic venue matches', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const input = [
    { sourceMessageId: 'yew-tee', facility: 'Yew tee Primary school', venueMatch: 'extracted', listingText: 'Yew tee pri school', lat: null, lng: null },
    { sourceMessageId: 'yck', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: 'Extra slot at YCK Sports Hall, 3 Oct, 5-6pm.', lat: null, lng: null },
    { sourceMessageId: 'wisma', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: '📍:Wisma Geylang Serai', lat: null, lng: null },
    { sourceMessageId: 'safra', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: '23/9 Wednesday 9pm to 10pm @ Safra Mount Faber', lat: null, lng: null },
    { sourceMessageId: 'yishun', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: '28/9 yishun spt hal 8-9pm mon', lat: null, lng: null },
    { sourceMessageId: 'delta-redhill', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: 'Delta (Redhill) Thu 1-2pm', lat: null, lng: null },
    { sourceMessageId: 'crescent-typo', facility: 'Unmatched venue', venueMatch: 'unmatched', listingText: 'Crescnt Girls(Redhill) Sun 6-7pm', lat: null, lng: null },
    { sourceMessageId: 'heartbeat', facility: 'Unmatched venue', venueMatch: 'ambiguous', listingText: 'Venue: Heartbeat@Bedok', lat: null, lng: null },
  ];
  const { listings, repaired } = repairListings(input, [...productionVenues, ...overrides]);
  assert.equal(repaired, 7);
  assert.equal(listings[0].venueMatch, 'deterministic');
  assert.equal(listings[0].lat, 1.3968514);
  assert.equal(listings[1].venueMatch, 'deterministic');
  assert.equal(listings[1].facility, 'Yio Chu Kang Sport Hall');
  assert.equal(listings[2].facility, 'Geylang Serai CC');
  assert.equal(listings[3].facility, 'SAFRA Mount Faber');
  assert.equal(listings[4].facility, 'Yishun Sport Hall');
  assert.equal(listings[5].facility, 'Delta Sport Hall');
  assert.equal(listings[5].lat, 1.290525);
  assert.equal(listings[6].facility, "Crescent Girls' School Hall");
  assert.deepEqual(listings[7], input[7]);
});

test('scheduled ingestion audits coordinates, parses, then repairs stored listings', async () => {
  const source = await readFile(new URL('../scripts/run-local-ingestion.mjs', import.meta.url), 'utf8');
  const coordinateAudit = source.indexOf("runStage('venue_coordinate_audit'");
  const parser = source.indexOf("runStage('parser'");
  const listingRepair = source.indexOf("runStage('persisted_listing_coordinate_repair'");
  assert.ok(coordinateAudit >= 0 && coordinateAudit < parser && parser < listingRepair);
});

test('CI deploy workflow keeps venue-mapping verification as a gate', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Verify venue mappings\s+run: npm run venues:verify/);
});

test('flags a time range with no meridiem as ambiguous', () => {
  const result = parseTime('7-9', new Date('2026-09-02T04:00:00.000Z'));
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.value, null);
});

test('rejects impossible calendar dates instead of letting JavaScript normalize them', () => {
  const result = parseDate('31 Feb 2026', '2026-02-01T00:00:00Z');
  assert.equal(result.value, null);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'invalid calendar date');
});

test('rejects impossible clock minutes instead of letting Date normalize them', () => {
  const result = parseTime('7:90-8:90pm', new Date('2026-09-02T04:00:00.000Z'));
  assert.equal(result.value, null);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'invalid clock value');
});

test('resolves verified sport-hall initialism and implicit afternoon time', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/yck-initialism-implicit-afternoon.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing({ ...message, messageId: message.sourceTelegramMessageId, text: message.rawText }, [...productionVenues, ...overrides], {
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Yio Chu Kang Sport Hall');
  assert.equal(result.listing.venueId, 'active-sg:yio-chu-kang-sport-hall');
  assert.equal(result.listing.displayTime, '3:00 pm–4:00 pm');
  assert.equal(result.listing.price, 4.2);
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.sourceTelegramMessageId, '73252');
});

test('does not parse a compact numeric date as the time range', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/buangkok-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Buangkok CC');
  assert.equal(result.listing.displayDate, '17 Sept 2026');
  assert.equal(result.listing.displayTime, '1:30 pm–2:30 pm');
  assert.equal(result.listing.price, 9);
  assert.equal(result.listing.sourceTelegramMessageId, '73273');
  assert.equal(result.listing.rawText, message.rawText);
});

test('parses two-part numeric dates before an explicit clock range', () => {
  const result = buildListing({
    messageId: 'two-part-date',
    postedAt: '2026-09-01T00:00:00.000Z',
    text: '17-09 2:30-3:30pm Buangkok CC $9',
  }, venues, { now: new Date('2026-09-01T00:00:00.000Z') });
  assert.equal(result.listing.displayDate, '17 Sept 2026');
  assert.equal(result.listing.displayTime, '2:30 pm–3:30 pm');
});

test('parses month-first ordinal dates with weekday labels', () => {
  const result = parseDate('Nov 18th Wednesday', '2026-11-11T00:00:00.000Z');
  assert.equal(result.status, 'deterministic');
  assert.equal(result.value.toISOString(), '2026-11-18T04:00:00.000Z');
});

test('keeps month-first dates attached to each split venue listing', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const message = {
    messageId: 'month-first-split-date-regression',
    postedAt: '2026-11-08T00:00:00.000Z',
    text: 'Zhenghua CC\n430pm-630pm\nNov 18th Wednesday\n\nQueenstown Primary School\n6pm-8pm\n14 Nov Saturday',
  };
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 2);
  const parsed = parts.map((part) => buildListing(message, catalog, {
    now: new Date('2026-11-08T00:00:00.000Z'),
    listingText: part.text,
    partCount: parts.length,
  }));
  assert.deepEqual(parsed.map(({ listing }) => listing.displayDate), ['18 Nov 2026', '14 Nov 2026']);
  assert.ok(parsed.every(({ listing }) => /4:30 pm.*6:30 pm|6:00 pm.*8:00 pm/.test(listing.displayTime)));
});

test('does not split parenthesized court-number ranges from the stated time and price', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const message = {
    messageId: 'parenthesized-court-range-regression',
    postedAt: '2026-11-08T00:00:00.000Z',
    text: 'Spare courts for what I paid:\nBukit Canberra sport hall (14-11)Saturday\n4-6pm, $18.20\n\nClementi sport hall(15-11)Sunday\n4-6pm, $18.20',
  };
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 2);
  const parsed = parts.map((part) => buildListing(message, catalog, {
    now: new Date('2026-11-08T00:00:00.000Z'),
    listingText: part.text,
    partCount: parts.length,
  }));
  assert.deepEqual(parsed.map(({ listing }) => listing.facility), ['Bukit Canberra Sport Hall', 'Clementi Sport Hall']);
  assert.deepEqual(parsed.map(({ listing }) => listing.displayDate), ['14 Nov 2026', '15 Nov 2026']);
  assert.ok(parsed.every(({ listing }) => /4:00 pm.*6:00 pm/.test(listing.displayTime)));
  assert.deepEqual(parsed.map(({ listing }) => listing.price), [18.2, 18.2]);
  assert.ok(parsed.every(({ issues }) => issues.length === 0));
});

test('keeps source-provided start times when no slot end is stated', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const message = {
    messageId: 'start-time-only-regression',
    postedAt: '2026-10-31T02:00:00.000Z',
    text: 'Spare courts for what I paid $6.90 per hr\n\n1st Nov\nJiemin Pri 7pm\n\n8th Nov\nEndeavour Pri 5pm\nJiemin Pri 5pm\n\nText me if keen thanks',
  };
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 3);
  const parsed = parts.map((part, listingIndex) => buildListing(message, catalog, {
    now: new Date('2026-10-31T00:00:00.000Z'),
    listingText: part.text,
    listingIndex,
    partCount: parts.length,
  }));
  assert.deepEqual(parsed.map(({ listing }) => listing.facility), [
    'Jiemin Primary School Hall',
    'Endeavour Primary School Hall',
    'Jiemin Primary School Hall',
  ]);
  assert.deepEqual(parsed.map(({ listing }) => listing.displayDate), ['1 Nov 2026', '8 Nov 2026', '8 Nov 2026']);
  assert.deepEqual(parsed.map(({ listing }) => listing.displayTime), ['7:00 pm', '5:00 pm', '5:00 pm']);
  assert.deepEqual(parsed.map(({ listing }) => listing.playAt), [
    '2026-11-01T11:00:00.000Z',
    '2026-11-08T09:00:00.000Z',
    '2026-11-08T09:00:00.000Z',
  ]);
  assert.deepEqual(parsed.map(({ listing }) => listing.playEndAt), parsed.map(({ listing }) => listing.playAt));
  assert.ok(parsed.every(({ listing }) => listing.duration === 'Unknown' && listing.price === 6.9));
  assert.ok(parsed.every(({ issues }) => issues.length === 0));
});

test('parses common non-dollar price wording deterministically', () => {
  assert.deepEqual(parsePrice('cost is 8.30 bucks').value, 8.3);
  assert.deepEqual(parsePrice('SGD 12.60').value, 12.6);
  assert.equal(parsePrice('releasing at cost 12 August').status, 'missing');
  assert.deepEqual(parsePrice('2 Courts going at what I paid:\n\n15 Nov Sunday\n6-8pm\nHenry Park Primary School\n\nPlease text if keen. Cheers.'), {
    value: null,
    status: 'missing',
  });
});

test('resolves recurring audit venue spellings and metadata to verified venues', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const cases = [
    ['Joo chiat CC\n13 Nov 5:30-7:30pm $11', 'onepa:joo-chiat-cc'],
    ['Geylang SBH\n14 Nov 3-5pm $44', 'telegram:sbh-geylang'],
    ['Tech Ghee Primary School Hall\n14 Nov 7pm $8.90', 'active-sg:teck-ghee-primary-school-hall'],
    ['Eunonia Junnior College Hall\n15 Nov 9am-11am $13.60', 'active-sg:eunoia-junior-college-hall'],
    ['Sun, 15 Nov, Jurong Sec Sch (S618652)\n10am-12pm $13.60', 'school:jurong-secondary'],
    ['Christchurch sec\n15 Nov 2-4pm $13.60', 'active-sg:christ-church-secondary-school-hall'],
    ['Clememti Town Secondary School\n15 Nov 5-6pm $8.90', 'active-sg:clementi-town-secondary-school-hall'],
    ['Slot Mayflower Secondary School 1hr (6pm-7pm) -21 Nov\n$6.90', 'active-sg:mayflower-secondary-school-hall'],
    ['KFF badminton arena VIP court(with aircon) $80', 'manual:kff-guillemard'],
    ['1b) Jurong West sport hall\n15 Nov 2026 10am-12pm $13.60', 'active-sg:jurong-west-sport-hall'],
    ['One Tampines Hub\n12 Nov 2-3pm $3.20', 'active-sg:our-tampines-hub-community-auditorium'],
    ['Tanglin cc\n10 Nov 6:30pm 1 hour $5.80', 'onepa:tanglin-cc'],
    ['Giving up slot Mayflower Secondary School 1hr (6pm-7pm) -21 nov\n$6.90', 'active-sg:mayflower-secondary-school-hall'],
  ];
  for (const [text, id] of cases) {
    const result = buildListing({ messageId: 'audit-venue-regression', postedAt: '2026-11-01T00:00:00Z', text }, catalog, { now: new Date('2026-11-01T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, id, text);
    assert.ok(Number.isFinite(result.listing.lat) && Number.isFinite(result.listing.lng), text);
  }
});

test('parses recurring bare trailing prices without treating long numbers as prices', () => {
  assert.equal(parsePrice('8sep tues 5-6pm yio chu kang 8.3').value, 8.3);
  assert.equal(parsePrice('20 Sep Sunday\nHeartbeat Bedok 2-4pm 12.6').value, 12.6);
  assert.equal(parsePrice('Jurong East Sport Hall 609517\nFri 11 Sep 7-8pm').value, null);
});

test('resolves a weekday-only date to the next occurrence after posting', () => {
  const result = parseDate('Court Thurs 12-2pm', '2026-08-29T12:00:00+08:00');
  assert.equal(result.status, 'deterministic');
  assert.equal(result.value.toISOString(), '2026-09-03T04:00:00.000Z');
});

test('treats duplicate records for the same canonical venue as one match', () => {
  const duplicates = [venues[2], { ...venues[2], id: 'override-sengkang' }];
  assert.equal(matchVenue('Sengkang SH', duplicates).status, 'deterministic');
});

test('splits repeated venues while carrying date context forward', () => {
  const message = {
    text: 'Slots going:\n9th Sept, Wednesday\nYishun sports hall\n8-9pm\n$8.30\nBukit Canberra Sports Hall\n7-8pm\n$8.30\n10th Sept, Thursday\nYishun sports hall\n7-8pm\n$8.30',
  };
  const parts = splitMessageListings(message, venues);
  assert.equal(parts.length, 3);
  assert.match(parts[1].text, /9th Sept[\s\S]*Bukit Canberra/);
  assert.match(parts[2].text, /10th Sept[\s\S]*Yishun/);
});

test('keeps repeated time rows, carries the parent date, and ignores time ranges as dates', async () => {
  const message = {
    messageId: '73329',
    postedAt: '2026-09-05T12:00:00.000Z',
    text: 'Extra courts 13th September\n2pm-3pm our Tampines hub $8.30\n2-4 heartbeat Bedok $12.60\n5-7pm heartbeat bedon $12.60',
  };
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 3);
  assert.match(parts[2].text, /heartbeat bedon/i);
  const parsed = parts.map((part, index) => buildListing(message, allVenues, {
    now: new Date('2026-09-05T12:00:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.deepEqual(parsed.map((item) => item.listing.displayDate), ['13 Sept 2026', '13 Sept 2026', '13 Sept 2026']);
  assert.equal(parsed[1].listing.displayTime, '2:00 pm–4:00 pm');
  assert.equal(parsed[2].listing.displayTime, '5:00 pm–7:00 pm');
});

test('carries one venue backward when repeated time rows precede it', async () => {
  const message = {
    messageId: '73413',
    postedAt: '2026-09-12T04:00:00.000Z',
    text: 'Extra courts.\n20th sep (Sun)\n1pm - 3pm (2 hrs)-$12.60\n2pm - 3pm (1 hr)-$6.30\nYishun Town Secondary school hall (hall B, wood floor)',
  };
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 2);
  const parsed = parts.map((part, index) => buildListing(message, allVenues, {
    now: new Date('2026-09-12T04:00:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.deepEqual(parsed.map((item) => item.listing.facility), ['Yishun Town Secondary School Hall', 'Yishun Town Secondary School Hall']);
});

test('carries a unique venue across split time rows with per-hour prices', async () => {
  const message = {
    messageId: '81146',
    postedAt: '2026-10-25T04:00:00.000Z',
    text: 'Giving up CLEMENTI SPORTS HALL court for what I paid ($13.60) TONIGHT\n\n25th Oct (Sunday)\nClementi Sports\n7pm -9pm $13.6 total\n\n26th October (Monday)\n8am- 9am $3.2/h\n10am-11am $3.2/h\n\nText me if keen ☺️',
  };
  const venues = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8')), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'))];
  const parts = splitMessageListings(message, venues);
  const parsed = parts.map((part, index) => buildListing(message, venues, {
    now: new Date(message.postedAt), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.equal(parts.length, 3);
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.ok(parsed.every((item) => item.listing.venueId === 'active-sg:clementi-sport-hall'));
  assert.ok(parsed.every((item) => Number.isFinite(item.listing.lat) && Number.isFinite(item.listing.lng)));
  assert.deepEqual(parsed.map((item) => item.listing.displayDate), ['25 Oct 2026', '26 Oct 2026', '26 Oct 2026']);
  assert.deepEqual(parsed.map((item) => item.listing.playAt), [
    '2026-10-25T11:00:00.000Z', '2026-10-26T00:00:00.000Z', '2026-10-26T02:00:00.000Z',
  ]);
});

test('separates an attached meridiem from a following verified venue name', async () => {
  const message = {
    messageId: '81678:3',
    postedAt: '2026-11-09T00:00:00.000Z',
    text: 'Spare court for what I paid\n11/11(Wed) 10 to11amKampong Ubi Community Club $3.50',
  };
  const venues = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8')), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'))];
  const result = buildListing(message, venues, { now: new Date(message.postedAt) });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.venueId, 'onepa:kampong-ubi-cc');
  assert.equal(result.listing.playAt, '2026-11-11T02:00:00.000Z');
  assert.equal(result.listing.playEndAt, '2026-11-11T03:00:00.000Z');
});

test('collapses repeated venue text before strict catalog matching', async () => {
  const message = {
    messageId: '90901:1',
    postedAt: '2026-10-27T00:00:00.000Z',
    text: 'Court to let go\n29/10(Thu) 7 to 8pm Kampong Ubi Community Kampong Ubi Community ClubClub $6',
  };
  const venues = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8')), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'))];
  const result = buildListing(message, venues, { now: new Date(message.postedAt) });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.venueId, 'onepa:kampong-ubi-cc');
  assert.equal(result.listing.playAt, '2026-10-29T11:00:00.000Z');
  assert.equal(result.listing.playEndAt, '2026-10-29T12:00:00.000Z');
});

test('keeps time when listings put time before the repeated venue', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/delta-sports-hall.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 5);
  const parsed = parts.map((part, index) => buildListing(message, productionVenues, {
    now: new Date('2026-09-06T06:00:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.deepEqual(parsed.map((item) => item.listing.displayTime), [
    '2:00 pm–4:00 pm', '4:00 pm–6:00 pm', '5:00 pm–6:00 pm', '1:00 pm–2:00 pm', '8:00 pm–9:00 pm',
  ]);
  assert.ok(parsed.every((item) => item.listing.rawText === message.text));
  assert.deepEqual(parsed.map((item) => item.listing.sourceMessageId), ['73371:1', '73371:2', '73371:3', '73371:4', '73371:5']);
});

test('resolves bare Delta shorthand to the verified Delta Sport Hall', async () => {
  const message = {
    messageId: '73455',
    postedAt: '2026-10-11T05:00:00.000Z',
    text: 'Selling 26 Oct Monday 4-5 pm delta $4.1 ping me please',
  };
  const venues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const parsed = buildListing(message, venues, { now: new Date(message.postedAt), listingText: message.text });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.listing.facility, 'Delta Sport Hall');
  assert.equal(parsed.listing.lat, 1.290525);
  assert.equal(parsed.listing.lng, 103.8206);
});

test('resolves Bedok South Secondary School shorthand to the verified hall', async () => {
  const message = {
    messageId: '73462',
    postedAt: '2026-10-11T05:00:00.000Z',
    text: 'Extra court\n18 Oct\nBedok south secondary school\n7 to 8pm\n8.30',
  };
  const venues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const parsed = buildListing(message, venues, { now: new Date(message.postedAt), listingText: message.text });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.listing.facility, 'Bedok South Secondary School Hall');
  assert.equal(parsed.listing.lat, 1.325136551591829);
  assert.equal(parsed.listing.lng, 103.9509891392604);
});

test('parses Telegram shorthand m as PM in a repeated-listing message', async () => {
  const source = JSON.parse(await readFile(new URL('./fixtures/clementi-repeated-m-suffix.json', import.meta.url), 'utf8'));
  const message = { ...source, messageId: source.sourceTelegramMessageId, text: source.rawText };
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const parts = splitMessageListings(message, productionVenues);
  const parsed = parts.map((part, index) => buildListing(message, productionVenues, {
    now: new Date('2026-09-06T06:00:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.equal(parts.length, 4);
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.equal(parsed[3].listing.displayTime, '8:00 pm–9:00 pm');
  assert.equal(parsed[3].listing.sourceMessageId, '73357:4');
  assert.equal(parsed[3].listing.rawText, message.rawText);
});

test('splits venue lines with station notes and ignores a standalone locality line', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  const message = {
    messageId: 'synthetic-multi-venue-001',
    postedAt: '2026-11-01T04:00:00.000Z',
    text: 'Sun 8 Nov\nShuqun Primary School (Next to Lakeside MRT)\n11am-2pm\nFrontier Primary School\n3pm-4pm',
  };
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 2);
  const parsed = parts.map((part, listingIndex) => buildListing(message, catalog, {
    now: new Date(message.postedAt), listingText: part.text, listingIndex, partCount: parts.length,
  }));
  assert.equal(parsed[0].listing.facility, 'Shuqun Primary School Hall');
  assert.equal(parsed[1].listing.facility, 'Frontier Primary School Hall');

  const localityMessage = {
    ...message,
    messageId: 'synthetic-locality-002',
    text: 'Sun 8 Nov\nKeming Primary School\n(Bukit Batok)\n1pm-2pm',
  };
  const localityParts = splitMessageListings(localityMessage, catalog);
  assert.equal(localityParts.length, 1);
  const localityParsed = buildListing(localityMessage, catalog, {
    now: new Date(message.postedAt), listingText: localityParts[0].text, listingIndex: 0, partCount: 1,
  });
  assert.equal(localityParsed.listing.facility, 'Keming Primary School Hall');
});

test('uses the specific verified VIP alias while retaining the generic venue alias', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const catalog = [...productionVenues, ...overrides];
  assert.equal(matchVenue('Singapore Badminton Hall (SBH VIP)', catalog).venue.canonicalName, 'SBH @ Sims');
  assert.equal(matchVenue('Singapore Badminton Hall', catalog).venue.canonicalName, 'SBH Geylang');
  for (const [name, canonicalName] of [
    ['Wyse Active', 'WYSE'],
    ['Euonia JC Hall', 'Eunoia Junior College Hall'],
    ['Changkat Changi Sec Sch', 'Changkat Changi Secondary School Hall'],
    ['Edgefield Secondary Sch (Punggol)', 'Edgefield Secondary School Hall'],
    ['Southview Primary School', 'South View Primary School Hall'],
  ]) {
    const result = matchVenue(name, catalog);
    assert.equal(result.venue.canonicalName, canonicalName, name);
    assert.ok(Number.isFinite(result.venue.lat) && Number.isFinite(result.venue.lng), name);
  }
});

test('ignores wanted-only messages but keeps the availability half of mixed messages', () => {
  assert.equal(isPotentialCourtMessage('Looking for court at Anchor Green pri on 13 Sept 5pm', venues), false);
  const mixed = 'Looking for slot: Anchor Green pri\nSun 13 Sept 5pm\nCourt to let go: Sengkang SH\nMon 14 Sep 3-5pm $8';
  assert.equal(isPotentialCourtMessage(mixed, venues), true);
  assert.equal(splitMessageListings({ text: mixed }, venues).length, 1);
  assert.match(splitMessageListings({ text: mixed }, venues)[0].text, /Sengkang SH/);
  assert.doesNotMatch(splitMessageListings({ text: mixed }, venues)[0].text, /Anchor Green/);

  const exchange = 'Court exchange\nLet go: 12 Nov Bishan clubhouse 9-10pm\nWant: 12 Nov Bishan clubhouse 8-9pm';
  assert.equal(splitMessageListings({ text: exchange }, venues).length, 1);
  assert.match(splitMessageListings({ text: exchange }, venues)[0].text, /9-10pm/);
  assert.doesNotMatch(splitMessageListings({ text: exchange }, venues)[0].text, /8-9pm/);
});

test('ignores swap-only posts and removes swap-preference footers from release listings', () => {
  assert.equal(isIgnoredSwapMessage('Want to swap court\nI have 8-9pm\nI need 6-7pm'), true);
  assert.equal(isPotentialCourtMessage('Want to swap court\nI have 8-9pm\nI need 6-7pm', venues), false);
  const release = {
    text: 'Slots going:\n8sep 5-6pm yishun $8\nWill prioritise those with courts to swap:\n- yishun\n- sengkang',
  };
  assert.equal(splitMessageListings(release, venues).length, 1);
  assert.doesNotMatch(splitMessageListings(release, venues)[0].text, /prioritise|sengkang/i);
});

test('extracts obvious venue-shaped names when the catalog has no entry', () => {
  assert.deepEqual(extractVenueCandidates('Slot going 8 sept 4.30-6.30pm Zhenghua cc $$13'), ['Zhenghua cc']);
  const result = buildListing({
    messageId: 'unknown-cc', postedAt: '2026-08-31T10:00:00Z', text: 'Slot going 8 sept 4.30-6.30pm Zhenghua cc $$13',
  }, venues, { now: new Date('2026-08-31T10:00:00Z') });
  assert.equal(result.venueMatch.status, 'extracted');
  assert.equal(result.listing.facility, 'Zhenghua CC');
  assert.ok(result.issues.some((issue) => issue.field === 'venue' && issue.kind === 'extracted'));
  assert.equal('lat' in result.listing, false);
});

test('uses explicit calendar date despite an incorrect weekday label', () => {
  const result = parseDate('13/6 (Sun)', '2026-06-12T09:00:00Z');
  assert.equal(result.status, 'deterministic');
  assert.equal(result.value.toISOString(), '2026-06-13T04:00:00.000Z');
  assert.equal(result.weekday, 'sun');
  assert.equal(result.actualWeekday, 'sat');
});

test('treats the common "toady" typo as today in synthetic release posts', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const postedAt = '2026-11-05T09:21:23.000Z';
  const result = buildListing({
    messageId: 'synthetic-relative-day-001',
    postedAt,
    text: 'Friendly court availability\nDelta Sport Hall\nToady\n6-8pm $10',
  }, [...productionVenues, ...overrides], { now: new Date(postedAt) });

  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.playAt, '2026-11-05T10:00:00.000Z');
  assert.equal(result.listing.playEndAt, '2026-11-05T12:00:00.000Z');
  assert.equal(result.listing.status, 'active');
});

test('keeps strong listing intent even when the venue name is unknown', () => {
  assert.equal(isPotentialCourtMessage('Court to let go 9 Sep 6-8pm at New Unknown Academy $9', venues), true);
});

test('resolves repeated listings using common community-club abbreviations', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/jln-besar-tg-pagar.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 2);
  const parsed = parts.map((part, index) => buildListing(message, allVenues, {
    now: new Date('2026-09-06T06:00:00.000Z'), listingText: part.text, listingIndex: index, partCount: parts.length,
  }));
  assert.deepEqual(parsed.flatMap((item) => item.issues), []);
  assert.deepEqual(parsed.map((item) => item.listing.facility), ['Jalan Besar CC', 'Tanjong Pagar CC']);
  assert.deepEqual(parsed.map((item) => item.listing.price), [13, 8]);
  assert.ok(parsed.every((item) => item.listing.rawText === message.rawText));
  assert.deepEqual(parsed.map((item) => item.listing.sourceMessageId), ['73364:1', '73364:2']);
});

test('splits compact community-club suffixes and extracts unknown venues', async () => {
  const message = {
    messageId: '73238',
    postedAt: '2026-09-01T02:00:00.000Z',
    text: 'Giving / exchange slots:\n\nKaki BukitCC \n8 Sep, 6.30pm-8.30pm \n\nTeck GheeCC \n10 Sep, 4.30pm-6.30pm \n\nWoodlands Galaxy CC \n11 Sep, 4.30pm-6.30pm',
  };
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const allVenues = [...productionVenues, ...overrides];
  const parts = splitMessageListings(message, allVenues);
  assert.equal(parts.length, 3);
  const listings = parts.map((part, index) => buildListing(message, allVenues, {
    now: new Date('2026-09-01T00:00:00.000Z'),
    listingText: part.text,
    listingIndex: index,
    partCount: parts.length,
  }));
  assert.deepEqual(listings.map(({ listing }) => listing.facility), ['Kaki Bukit CC', 'Teck Ghee CC', 'Woodlands Galaxy CC']);
  assert.deepEqual(listings.map(({ venueMatch }) => venueMatch.status), ['deterministic', 'deterministic', 'extracted']);
  assert.deepEqual(listings[0].issues, []);
  assert.deepEqual(listings[1].issues, []);
  assert.ok(listings[2].issues.some((issue) => issue.field === 'venue' && issue.kind === 'extracted'));
});

test('reports non-venue ambiguity fields too', () => {
  const result = buildListing({ messageId: 'x', postedAt: '2026-08-30T10:00:00+08:00', text: '7 Sep Mon Sengkang SH 7-9 $8' }, venues, { now: new Date('2026-08-30T03:00:00Z') });
  assert.ok(result.issues.some((issue) => issue.field === 'time'));
  assert.ok(!result.issues.some((issue) => issue.field === 'venue'));
});

test('resolves a verified community-club venue from the production venue catalog', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/queenstown-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T04:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Queenstown CC');
  assert.equal(result.listing.venueId, 'onepa:queenstown-cc');
  assert.equal(result.listing.sourceTelegramMessageId, '73350');
  assert.equal(result.listing.rawText, message.rawText);
});

test('resolves Fernvale Village shorthand to the verified private badminton hall', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: '73448',
    postedAt: '2026-10-05T11:00:00.000Z',
    text: 'Giving up court\nFernvale village\n18 Oct 2026\n7-9pm\n$33/h',
  }, productionVenues, { now: new Date('2026-10-07T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Fernvale Village');
  assert.equal(result.listing.venueId, 'manual:fernvale-village');
  assert.equal(result.listing.lat, 1.396192911537063);
  assert.equal(result.listing.lng, 103.8786175244272);
});

test('does not attach school-hall coordinates to an explicit community-club shorthand', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/radin-mas-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing(message, productionVenues, { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.ok(result.issues.some((issue) => issue.field === 'venue' && issue.kind === 'extracted'));
  assert.equal(result.venueMatch.status, 'extracted');
  assert.equal(result.listing.facility, 'Radin Mas CC');
  assert.equal(result.listing.venueId, 'telegram:radin-mas-cc');
  assert.equal(result.listing.displayDate, '17 Sept 2026');
  assert.equal(result.listing.displayTime, '6:00 pm–7:00 pm');
  assert.equal(result.listing.price, 7);
  assert.equal(result.listing.sourceTelegramMessageId, '73280');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal('lat' in result.listing, false);
  assert.equal('lng' in result.listing, false);
});

test('does not attach sport-hall coordinates to an explicit community-club shorthand', async () => {
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing({
    messageId: 'hougang-cc',
    postedAt: '2026-09-08T00:00:00Z',
    text: '$6\n21-Sep (Monday)\nHougang CC\n7:30-8:30pm',
  }, productionVenues, { now: new Date('2026-09-08T00:00:00Z') });
  assert.equal(result.venueMatch.status, 'extracted');
  assert.equal(result.listing.facility, 'Hougang CC');
  assert.equal('lat' in result.listing, false);
});

test('preserves the leading hour in dotted time ranges', () => {
  assert.deepEqual(extractVenueCandidates('9.30-10.30am tiong barhu cc $8'), ['tiong barhu cc']);
});

test('matches verified shorthand rows embedded with date, time, and price', () => {
  assert.equal(matchVenue('15sep tues 5-6pm sengkang 8.3', venues).status, 'deterministic');
  const schoolVenues = [...venues, {
    id: 'east-spring', canonicalName: 'East Spring Primary School Hall', aliases: ['East Spring Pri'],
    kind: 'school_sport_hall', area: 'Tampines',
  }];
  assert.equal(matchVenue('13sep sun 2-3pm east spring 8.3', schoolVenues).status, 'deterministic');
});

test('accepts punctuation before a clock and redundant meridiem on 24-hour clocks', () => {
  const date = new Date('2026-09-01T00:00:00Z');
  assert.equal(parseTime('.10:30am to 12:30pm', date).status, 'deterministic');
  assert.equal(parseTime('13:30 - 15:30 pm', date).status, 'deterministic');
});

test('resolves repeated exact Kampong Glam CC names with verified coordinates', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/kampong-glam-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Kampong Glam CC');
  assert.equal(result.listing.venueId, 'manual:kampong-glam-cc');
  assert.equal(result.listing.area, 'Kallang');
  assert.equal(result.listing.price, 11);
  assert.equal(result.listing.displayTime, '9:30 am–10:30 am');
  assert.equal(result.listing.sourceTelegramMessageId, '73287');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.302795227115325);
  assert.equal(result.listing.lng, 103.8635978518025);
});

test('resolves Henderson CC from the verified venue override', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/henderson-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Henderson CC');
  assert.equal(result.listing.area, 'Bukit Merah');
  assert.equal(result.listing.price, 5);
  assert.equal(result.listing.sourceTelegramMessageId, '73322');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.286010159391979);
  assert.equal(result.listing.lng, 103.8233153131407);
});

test('resolves the strict KFF shorthand to KFF Guillemard with verified coordinates', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/kff.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], {
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'KFF Guillemard');
  assert.equal(result.listing.area, 'Kallang');
  assert.equal(result.listing.price, 61.2);
  assert.equal(result.listing.sourceTelegramMessageId, '73308');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.310041970721942);
  assert.equal(result.listing.lng, 103.8824289266939);
});

test('resolves a verified Geylang Serai CC listing with coordinates', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/geylang-serai-cc.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const overrides = JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url), 'utf8'));
  const result = buildListing(message, [...productionVenues, ...overrides], { now: new Date('2026-09-06T00:00:00.000Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Geylang Serai CC');
  assert.equal(result.listing.venueId, 'onepa:geylang-serai-cc');
  assert.equal(result.listing.area, 'Geylang');
  assert.equal(result.listing.price, 9);
  assert.equal(result.listing.displayDate, '17 Sept 2026');
  assert.equal(result.listing.displayTime, '7:30 pm–8:30 pm');
  assert.equal(result.listing.sourceTelegramMessageId, '73259');
  assert.equal(result.listing.rawText, message.rawText);
  assert.equal(result.listing.lat, 1.31649443408573);
  assert.equal(result.listing.lng, 103.8969416697428);
});

test('resolves the recurring Geylang Seral typo to verified Geylang Serai coordinates', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const result = buildListing({ messageId: 'geylang-seral-regression', postedAt: '2026-10-28T11:00:00Z', text: '2/11(Mon) 4:30 to 5:30 Geylang Seral cc $4.50' }, catalog, { now: new Date('2026-10-28T00:00:00Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Geylang Serai CC');
  assert.equal(result.listing.venueId, 'onepa:geylang-serai-cc');
  assert.equal(result.listing.lat, 1.31649443408573);
  assert.equal(result.listing.lng, 103.8969416697428);
});

test('resolves spaced Zheng Hua CC to the verified Zhenghua CC override', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const result = buildListing({ messageId: 'zheng-hua-regression', postedAt: '2026-10-26T10:00:00Z', text: 'Spare badminton slot\nzheng hua CC\n6 nov (friday)\n9.30am-11.30am' }, catalog, { now: new Date('2026-10-28T00:00:00Z') });
  assert.deepEqual(result.issues, []);
  assert.equal(result.listing.facility, 'Zhenghua CC');
  assert.equal(result.listing.venueId, 'telegram:zhenghua-cc');
  assert.equal(result.listing.lat, 1.386776581332976);
  assert.equal(result.listing.lng, 103.7715753922954);
});

test('does not fuzzy-match a known venue inside an unknown venue name', () => {
  const result = matchVenue('Unknown Yishun Sport Hall Annex', venues);
  assert.equal(result.status, 'extracted');
  assert.equal(result.venue?.provisional, true);
  assert.equal(result.venue?.lat, undefined);
  assert.equal(result.venue?.lng, undefined);
});

test('keeps colliding strict aliases ambiguous', () => {
  const colliding = [
    { id: 'one', canonicalName: 'North Primary School Hall', aliases: ['NPS'], kind: 'school_sport_hall', lat: 1, lng: 103 },
    { id: 'two', canonicalName: 'Noble Primary School Hall', aliases: ['NPS'], kind: 'school_sport_hall', lat: 2, lng: 104 },
  ];
  const result = matchVenue('NPS', colliding);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.venue, null);
});

test('resolves locality-only shorthand to the unique public sport hall', async () => {
  const message = JSON.parse(await readFile(new URL('./fixtures/clementi-shorthand.json', import.meta.url), 'utf8'));
  const productionVenues = JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url), 'utf8'));
  const result = buildListing(message, productionVenues, { now: new Date('2026-09-06T00:00:00Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.facility, 'Clementi Sport Hall');
  assert.equal(result.listing.venueId, 'active-sg:clementi-sport-hall');
  assert.equal(result.listing.price, 8);
  assert.equal(result.listing.displayTime, '3:00 pm–5:00 pm');
  assert.equal(result.listing.lat, 1.311015);
  assert.equal(result.listing.lng, 103.7649);
  assert.equal(result.listing.sourceMessageId, '73406:2');
  assert.equal(result.listing.rawText, message.text);
});

test('keeps locality shorthand ambiguous when it has multiple public sport halls', () => {
  const colliding = [
    { id: 'one', canonicalName: 'North Sport Hall', aliases: ['North'], kind: 'sport_hall', lat: 1, lng: 103 },
    { id: 'two', canonicalName: 'North Primary School Hall', aliases: ['North'], kind: 'school_sport_hall', lat: 2, lng: 104 },
    { id: 'three', canonicalName: 'North Secondary Sport Hall', aliases: ['North'], kind: 'sport_hall', lat: 3, lng: 105 },
  ];
  assert.equal(matchVenue('North', colliding).status, 'ambiguous');
});

test('restores ZHCC and trailing transaction metadata without broad venue matching', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const text of [
    'Court going 8 Oct Thurs\n\n4.30-6.30pm zhcc at cost\n\n$13',
    '8 Oct (Thurs)\nZHCC\n4.30-6.30pm\n$13',
    '8 Oct Thurs\n4.30-6.30pm ZHCC at original price $13',
    '8 Oct Thurs\n4.30-6.30pm ZHCC below cost $13',
  ]) {
    const result = buildListing({ messageId: 'zhcc-regression', postedAt: '2026-09-30T16:00:00.000Z', text }, catalog, { now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic');
    assert.equal(result.listing.venueId, 'telegram:zhenghua-cc');
    assert.equal(result.listing.lat, 1.386776581332976);
    assert.equal(result.listing.lng, 103.7715753922954);
    assert.equal(result.listing.price, 13);
    assert.equal(result.listing.displayTime, '4:30 pm–6:30 pm');
  }
  assert.notEqual(matchVenue('Unknown ZHCC Annex', catalog).status, 'deterministic');
});

test('restores verified MacPherson CC names and coordinates', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const name of ['Macpherson CC', 'MacPherson Community Club']) {
    const result = buildListing({ messageId: 'macpherson-regression', postedAt: '2026-09-29T05:59:56Z', text: `16 October\n${name}\n4.30-5.30pm\n$6.50` }, catalog, { now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic');
    assert.equal(result.listing.venueId, 'onepa:macpherson-cc');
    assert.equal(result.listing.lat, 1.323473899118196);
    assert.equal(result.listing.lng, 103.8846383700013);
  }
});

test('restores school shorthand, LF prefix and parenthesized weekday cleanup', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const [text, id] of [
    ['LF Ahmad Ibrahim sec\n11 Oct (Sunday)\n10-11am', 'school:ahmad-ibrahim-secondary'],
    ['Ahmad Ibrahim sec School\n11 Oct\n10-11am', 'school:ahmad-ibrahim-secondary'],
    ['Giving up court, $12.6\n10th October (Saturday)\nKe Ming Primary School\n2pm-4pm', 'active-sg:keming-primary-school-hall'],
    ['Slot going\n10 Oct (Sat)\n2pm to 4pm\nCCK stadium', 'active-sg:choa-chu-kang-sport-hall'],
    ['11 Oct (Sun), Peirce Secondary Sports Hall\n7-9pm $12.60', 'active-sg:peirce-secondary-school-hall'],
    ['Slot going\n11 Oct (Sun) Qihua Primary School (Woodland)\n7-9pm ($12.60)', 'active-sg:qihua-primary-school-hall'],
    ['Slot going\n11 Oct (Sun) Qihua Primary School (Woodlands)\n7-9pm ($12.60)', 'active-sg:qihua-primary-school-hall'],
  ]) {
    const result = buildListing({ messageId: 'school-regression', postedAt: '2026-09-29T00:00:00Z', text }, catalog, { now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, id);
    assert.ok(Number.isFinite(result.listing.lat) && Number.isFinite(result.listing.lng));
  }
});

test('restores Teck Ghee CC separately from the school hall', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const name of ['Teck Ghee CC', 'Teck Ghee Community Club']) {
    const result = buildListing({ messageId: 'teck-ghee-regression', postedAt: '2026-09-30T00:00:00Z', text: `${name}\n11 Oct\n4.30-6.30pm $13` }, catalog, { now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(result.listing.venueId, 'onepa:teck-ghee-cc');
    assert.equal(result.listing.lat, 1.363106005257572);
    assert.equal(result.listing.lng, 103.8535605086277);
  }
});

test('resolves recurring shorthand venues with authoritative coordinates', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const cases = [
    ['Hello, an extra court at Shuqun Primary Saturday 24 Oct 3-4pm n hoping to pass it on for $8.3.', 'active-sg:shuqun-primary-school-hall', 1.347603, 103.7215],
    ['14 Oct Wednesday\nWhampoa CC\n4.30pm to 6.30pm\n$11', 'onepa:whampoa-cc', 1.324867492965702, 103.8572012109099],
    ['24th October, Saturday: 9.30am to 11.30am\nBradell CC\nPing if interested', 'onepa:braddell-heights-cc', 1.351690381546186, 103.870408875865],
  ];
  for (const [text, id, lat, lng] of cases) {
    const result = buildListing({ messageId: 'recurring-venue-regression', postedAt: '2026-10-05T00:00:00Z', text }, catalog, { now: new Date('2026-10-05T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, id, text);
    assert.equal(result.listing.lat, lat, text);
    assert.equal(result.listing.lng, lng, text);
  }
});

test('resolves recurring misspelled venue names only to their verified catalog entries', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const cases = [
    ['Bishan club house\n7 Oct 7-9pm $14', 'active-sg:bishan-clubhouse'],
    ['Marsling 2ndry school\n7 Oct 7-9pm $14', 'active-sg:marsiling-secondary-school-hall'],
    ['Swiss Cottage Sport Hall\n7 Oct 7-9pm $14', 'active-sg:swiss-cottage-secondary-school-hall'],
    ['Bt Canberra Sports Hall\n7 Oct 7-9pm $14', 'active-sg:bukit-canberra-sport-hall'],
    ['PoiChing School Hall\n7 Oct 7-9pm $14', 'active-sg:poi-ching-school-hall'],
    ['Tech Ghee Primary Sport Hall\n7 Oct 7-9pm $14', 'active-sg:teck-ghee-primary-school-hall'],
    ['Changi Semei CC\n7 Oct 7-9pm $14', 'onepa:changi-simei-cc'],
    ['Woodland CC\n7 Oct 7-9pm $14', 'onepa:woodlands-cc'],
    ['Bedok heartbeat\n7 Oct 7-9pm $14', 'active-sg:heartbeat-bedok-activesg-sport-hall'],
    ['Crescent Girls (Redhill)\n7 Oct 7-9pm $14', 'active-sg:crescent-girls-school-hall'],
    ['Cho Chu Kang sport hall\n7 Oct 7-9pm $14', 'active-sg:choa-chu-kang-sport-hall'],
    ['Jingshan Primary sch\n7 Oct 7-9pm $14', 'active-sg:jing-shan-primary-school-hall'],
    ['Jie Min Primary Sch\n7 Oct 7-9pm $14', 'active-sg:jiemin-primary-school-hall'],
    ['Gan Eng Seng Pri\n7 Oct 7-9pm $14', 'active-sg:gan-eng-seng-primary-school-hall'],
    ['Meridian Primary Sports Hall\n7 Oct 7-9pm $14', 'active-sg:meridian-primary-school-hall'],
    ['Meridian secondary sch\n7 Oct 7-9pm $14', 'active-sg:meridian-secondary-school-hall'],
    ['Hougangsports hall\n7 Oct 7-9pm $14', 'active-sg:hougang-sport-hall'],
    ['Jurong Green CC\n7 Oct 7-9pm $14', 'onepa:jurong-green-cc'],
    ['Kallang CC\n7 Oct 7-9pm $14', 'onepa:kallang-cc'],
    ['Kampong Ubi Community Club\n7 Oct 7-9pm $14', 'onepa:kampong-ubi-cc'],
    ['Paya Lebar Kovan CC\n7 Oct 7-9pm $14', 'onepa:paya-lebar-kovan-cc'],
    ['Expo SBH\n7 Oct 7-9pm $14', 'manual:sbh-east-coast-expo'],
    ['OCBC Areane\n7 Oct 7-9pm $14', 'singapore-sports-hub:ocbc-arena'],
    ['SproutHub\n7 Oct 7-9pm $14', 'manual:sprout-hub-community-hall'],
    ['Feenvale CC\n7 Oct 7-9pm $14', 'manual:fernvale-cc'],
    ['Elais Park Pri Sch, Pasir Ris\n7 Oct 7-9pm $14', 'active-sg:elias-park-primary-school-hall'],
  ];
  for (const [text, id] of cases) {
    const result = buildListing({ messageId: 'recurring-venue-alias-regression', postedAt: '2026-10-05T00:00:00Z', text }, catalog, { now: new Date('2026-10-05T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, id, text);
    assert.ok(Number.isFinite(result.listing.lat) && Number.isFinite(result.listing.lng), text);
  }
});

test('splits Sports Hub and Punggol venues without leaking venue or price context', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const message = {
    messageId: 'sports-hub-split-regression',
    postedAt: '2026-10-31T08:00:00.000Z',
    text: 'Spare slots going for what I paid.\n\n4 Nov (Wed), 2-4pm\nSports Hub - $9\n4 Nov (Wed), 5-7pm\nPunngol Sports Hall - $13.8\n\nMessage me to arrange, cheers!',
  };
  const parts = splitMessageListings(message, catalog);
  assert.equal(parts.length, 2);
  const first = buildListing(message, catalog, { now: new Date('2026-11-02T00:00:00Z'), listingText: parts[0].text, listingIndex: 0, partCount: parts.length });
  const second = buildListing(message, catalog, { now: new Date('2026-11-02T00:00:00Z'), listingText: parts[1].text, listingIndex: 1, partCount: parts.length });
  assert.equal(first.listing.facility, 'OCBC Arena');
  assert.equal(first.listing.venueId, 'singapore-sports-hub:ocbc-arena');
  assert.equal(first.listing.lat, 1.304642569458006);
  assert.equal(first.listing.lng, 103.8760996173369);
  assert.equal(first.listing.displayTime, '2:00 pm–4:00 pm');
  assert.equal(first.listing.price, 9);
  assert.equal(second.listing.facility, 'Punggol Sport Centre');
  assert.equal(second.listing.venueId, 'manual:punggol-sport-centre');
  assert.equal(second.listing.venueMatch, 'deterministic');
  assert.equal(second.listing.displayTime, '5:00 pm–7:00 pm');
  assert.equal(second.listing.price, 13.8);
  assert.equal(second.listing.lat, 1.408560282991146);
  assert.equal(second.listing.lng, 103.906845295414);
  assert.notEqual(matchVenue('Unknown Sports Hub Annex', catalog).status, 'deterministic');
});

test('resolves recurring Punggol sports-hall spellings to the verified Sport Centre', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const text of [
    '6 Nov (Fri) Punggol sports hall 1pm-2pm ($3.20)',
    '3 Nov Tues 3-4pm Punggol indoor sports hall',
    'Punggol SH, Sat 7 Nov 11am-12pm $6.50',
    '4 Nov 5-7pm Punngol Sports Hall $13.80',
  ]) {
    const result = buildListing({ messageId: 'punggol-sport-hall-spelling', postedAt: '2026-10-31T00:00:00Z', text }, catalog, { now: new Date('2026-10-31T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, 'manual:punggol-sport-centre', text);
    assert.equal(result.listing.lat, 1.408560282991146, text);
    assert.equal(result.listing.lng, 103.906845295414, text);
  }
});

test('strips swap preference annotations before matching the verified venue', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  for (const text of [
    '5nov thurs 7-9pm jurong west 13.6 (swap prefer)',
    '4nov wed 6-8pm jurong west 12.4 (swap prefers)',
  ]) {
    const result = buildListing({
      messageId: 'swap-preference-venue-regression',
      postedAt: '2026-10-30T12:00:00Z',
      text,
    }, catalog, { now: new Date('2026-11-02T00:00:00Z') });
    assert.equal(result.venueMatch.status, 'deterministic', text);
    assert.equal(result.listing.venueId, 'active-sg:jurong-west-sport-hall', text);
    assert.equal(result.listing.lat, 1.338418, text);
    assert.equal(result.listing.lng, 103.6938, text);
  }
});

test('resolves repeated same-owner Thomson night shorthand to the verified Thomson CC', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const result = buildListing({
    messageId: 'thomson-night-shorthand-regression',
    postedAt: '2026-11-05T09:00:00.000Z',
    text: 'Giving up Thomson night 12 Nov thur 7.30-8.30pm $6',
  }, catalog, { now: new Date('2026-11-05T00:00:00Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.venueId, 'telegram:thomson-cc');
  assert.equal(result.listing.lat, 1.351202992134877);
  assert.equal(result.listing.lng, 103.8363139796527);
});
test('maps verified Singapore Sports Hub shorthand to its badminton arena', async () => {
  const catalog = [...JSON.parse(await readFile(new URL('../data/badminton-venues.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/venue-overrides.json', import.meta.url)))];
  const result = buildListing({ messageId: 'sports-hub-shorthand-regression', postedAt: '2026-10-31T08:00:00.000Z', text: '4 Nov (Wed) 2-4pm Sports Hub $9' }, catalog, { now: new Date('2026-11-02T00:00:00Z') });
  assert.equal(result.venueMatch.status, 'deterministic');
  assert.equal(result.listing.venueId, 'singapore-sports-hub:ocbc-arena');
  assert.equal(result.listing.lat, 1.304642569458006);
  assert.equal(result.listing.lng, 103.8760996173369);
});

test('derives listing status from a fixed clock, boundary and deletion signals', () => {
  const build = (extra, nowIso, text = 'Spare court 15 Nov 10am-12pm Yishun Sport Hall $10') => buildListing(
    { messageId: 'status-case', postedAt: '2026-11-01T00:00:00.000Z', text, ...extra },
    venues,
    { now: new Date(nowIso) },
  ).listing;
  const start = '2026-11-15T02:00:00.000Z';

  const future = build({}, '2026-11-14T00:00:00.000Z');
  assert.equal(future.playAt, start);
  assert.equal(future.status, 'active');
  assert.equal('deletedAt' in future, false);

  const past = build({}, '2026-11-16T00:00:00.000Z');
  assert.equal(past.status, 'expired');
  assert.equal('deletedAt' in past, false);

  assert.equal(build({}, start).status, 'expired');
  assert.equal(build({}, '2026-11-15T01:59:59.999Z').status, 'active');

  const deleted = build({ deleted: true }, '2026-11-14T00:00:00.000Z');
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.deletedAt, '2026-11-14T00:00:00.000Z');

  const taken = build({}, '2026-11-14T00:00:00.000Z', 'TAKEN - 15 Nov 10am-12pm Yishun Sport Hall $10');
  assert.equal(taken.status, 'deleted');
  assert.equal(taken.deletedAt, '2026-11-14T00:00:00.000Z');
});

test('keeps future listings with no usable end time out of the active feed', () => {
  const now = new Date('2026-11-14T00:00:00.000Z');
  const build = (messageId, text) => buildListing(
    { messageId, postedAt: '2026-11-01T00:00:00.000Z', text },
    venues,
    { now },
  ).listing;

  const singleTime = build('synthetic-single-time', 'Spare court 15 Nov 10am Yishun Sport Hall $10');
  assert.equal(singleTime.status, 'incomplete');
  assert.equal(singleTime.playEndAt, singleTime.playAt);
  assert.equal(singleTime.duration, 'Unknown');

  const missingTime = build('synthetic-missing-time', 'Spare court 15 Nov Yishun Sport Hall $10');
  assert.equal(missingTime.status, 'incomplete');
  assert.equal(missingTime.displayTime, 'Time unknown');

  const explicitDuration = build('synthetic-explicit-duration', 'Spare court 15 Nov 10am for 2 hours Yishun Sport Hall $10');
  assert.equal(explicitDuration.status, 'active');
  assert.equal(Date.parse(explicitDuration.playEndAt) - Date.parse(explicitDuration.playAt), 2 * 60 * 60 * 1000);
});

test('rolls a month-day date that already passed into the next year, unless the year is explicit', () => {
  const postedAt = '2026-12-30T04:00:00.000Z';
  const rolled = parseDate('Spare court 2 Jan 8pm', postedAt);
  assert.equal(rolled.status, 'deterministic');
  assert.equal(rolled.value.toISOString(), '2027-01-02T04:00:00.000Z');

  const sameYear = parseDate('Spare court 31 Dec 8pm', postedAt);
  assert.equal(sameYear.value.toISOString(), '2026-12-31T04:00:00.000Z');

  const explicit = parseDate('Spare court 2/1/2026 8pm', postedAt);
  assert.equal(explicit.value.toISOString(), '2026-01-02T04:00:00.000Z');
});
