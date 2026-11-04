import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearchQuery, parseSearchQuery, parseClock, parseDates, parseDurationMinutes } from '../lib/search-query.ts';

// Thursday 8 Oct 2026, 10:00 Singapore.
const NOW = new Date('2026-10-08T02:00:00.000Z');
const parse = (input) => parseSearchQuery(input, NOW);

const listing = (overrides = {}) => ({
  name: 'Shelton College',
  facility: 'Shelton college',
  area: 'Bukit Merah',
  owner: 'fakeowner',
  ownerUsername: '@fake_handle',
  price: 24,
  duration: '2 hours',
  playAt: '2026-10-10T11:00:00.000Z', // Sat 7pm SGT
  playEndAt: '2026-10-10T13:00:00.000Z', // Sat 9pm SGT
  ...overrides,
});
const matches = (input, overrides) => matchesSearchQuery(listing(overrides), parse(input));

test('plain text keeps old behaviour without matching sport', () => {
  assert.equal(matches('shelton'), true);
  assert.equal(matches('bukit merah'), true);
  assert.equal(matches('shelton merah'), true, 'terms are ANDed, not a phrase');
  assert.equal(matches('badminton'), false);
  assert.equal(matches('fakeowner'), false, 'owner needs by:');
  assert.equal(parse('shelton').hasKeys, false);
  assert.deepEqual(parse('shelton').summary, []);
});

test('quotes, curly quotes, unclosed quotes and key: value spacing', () => {
  assert.deepEqual(parse('venue:"shelton college"').venue.include, ['shelton college']);
  assert.deepEqual(parse('venue:“shelton college”').venue.include, ['shelton college']);
  assert.deepEqual(parse('venue:"shel').venue.include, ['shel']);
  assert.deepEqual(parse('venue: shelton').venue.include, ['shelton']);
  assert.deepEqual(parse('VENUE:Shelton').venue.include, ['shelton']);
  assert.deepEqual(parse('venue:"a:b"').venue.include, ['a:b']);
});

test('trailing empty key is ignored instead of emptying results', () => {
  const parsed = parse('venue:');
  assert.equal(parsed.hasKeys, false);
  assert.equal(matchesSearchQuery(listing(), parsed), true);
  assert.deepEqual(parse('venue: area:east').venue.include, [], 'does not swallow the next key');
});

test('non-keys stay as text', () => {
  assert.deepEqual(parse('9:30').terms.include, ['9:30']);
  assert.deepEqual(parse('http://x foo:bar').terms.include, ['http://x', 'foo:bar']);
  assert.deepEqual(parse('-').terms.include, []);
});

test('multiple values: repeat or comma is OR, quoted comma is literal, duplicates collapse', () => {
  assert.deepEqual(parse('area:east area:west').area.include, ['east', 'west']);
  assert.deepEqual(parse('area:east,west,,east').area.include, ['east', 'west']);
  assert.deepEqual(parse('venue:"a, b"').venue.include, ['a, b']);
  assert.equal(matches('venue:nope,shelton'), true);
  assert.equal(matches('venue:nope venue:shelton'), true);
  assert.equal(matches('venue:shelton by:nobody'), false, 'different keys AND');
});

test('negation excludes, combines with includes, and works for text', () => {
  assert.equal(matches('-venue:shelton'), false);
  assert.equal(matches('-venue:nope,shelton'), false, 'excludes any listed value');
  assert.equal(matches('-shelton'), false);
  assert.equal(matches('-"shelton college"'), false);
  assert.equal(matches('venue:shelton -area:tampines'), true);
  assert.equal(matches('-by:fakeowner'), false);
  assert.equal(matches('-price:<30'), false);
  assert.equal(matches('-price:<30', { price: null }), true, 'unknown price is not < 30');
  assert.equal(matches('-from:7pm'), false, 'excludes listings overlapping 7pm-midnight');
  assert.equal(matches('-from:10pm'), true);
  assert.equal(matches('-to:6pm'), true);
  assert.equal(matches('-from:6pm -to:8pm'), false);
  assert.deepEqual(parse('-from:7pm').summary, ['not time 19:00–24:00']);
});

test('area: region names expand, other values are substrings', () => {
  assert.equal(matches('area:east', { area: 'Tampines' }), true);
  assert.equal(matches('area:east', { area: 'Jurong East' }), false, 'east means the region');
  assert.equal(matches('area:west', { area: 'Jurong East' }), true);
  assert.equal(matches('area:merah'), true);
});

test('by: matches owner or username, with or without @', () => {
  assert.equal(matches('by:fakeowner'), true);
  assert.equal(matches('by:@fake_handle'), true);
  assert.equal(matches('by:fake_handle', { ownerUsername: undefined }), false);
});

test('clock parsing', () => {
  assert.equal(parseClock('7pm'), '19:00');
  assert.equal(parseClock('7:30pm'), '19:30');
  assert.equal(parseClock('12am'), '00:00');
  assert.equal(parseClock('12pm'), '12:00');
  assert.equal(parseClock('19'), '19:00');
  assert.equal(parseClock('1930'), '19:30');
  assert.equal(parseClock('930'), '09:30');
  assert.equal(parseClock('7'), '07:00');
  assert.equal(parseClock('noon'), '12:00');
  assert.equal(parseClock('25'), null);
  assert.equal(parseClock('13pm'), null);
  assert.equal(parseClock('abc'), null);
});

test('from/to window, last one wins, invalid ignored with a note', () => {
  assert.equal(matches('from:6pm to:8pm'), true);
  assert.equal(matches('from:9pm'), false);
  assert.equal(matches('to:7pm'), false);
  assert.equal(matches('from:8pm'), true, 'overlap counts');
  const repeated = parse('from:5pm from:10pm');
  assert.equal(repeated.from, '22:00');
  assert.ok(repeated.notes.length);
  const invalid = parse('from:25');
  assert.equal(invalid.from, undefined);
  assert.match(invalid.notes[0], /not a time/);
  assert.equal(matchesSearchQuery(listing(), invalid), true, 'bad time must not empty the list');
});

test('window crossing midnight', () => {
  const late = { playAt: '2026-10-10T15:30:00.000Z', playEndAt: '2026-10-10T17:00:00.000Z' }; // 11:30pm-1am
  assert.equal(matches('from:22:00 to:01:00', late), true);
  assert.equal(matches('from:22:00 to:01:00'), false);
});

test('date parsing: relative, weekdays, day-first, year rollover, invalid', () => {
  assert.deepEqual(parseDates('today', NOW), ['2026-10-08']);
  assert.deepEqual(parseDates('tomorrow', NOW), ['2026-10-09']);
  assert.deepEqual(parseDates('thu', NOW), ['2026-10-08'], 'weekday includes today');
  assert.deepEqual(parseDates('saturday', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('wed', NOW), ['2026-10-14']);
  assert.deepEqual(parseDates('weekend', NOW), ['2026-10-10', '2026-10-11']);
  assert.deepEqual(parseDates('10/10', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('9-10-26', NOW), ['2026-10-09']);
  assert.deepEqual(parseDates('2026-10-10', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('5/1', NOW), ['2027-01-05'], 'past day-month rolls to next year');
  assert.equal(parseDates('31/2', NOW), null);
  assert.equal(parseDates('sa', NOW), null, 'too short to be a weekday');
  // 23:30 UTC on 7 Oct is already 8 Oct in Singapore.
  assert.deepEqual(parseDates('today', new Date('2026-10-07T23:30:00.000Z')), ['2026-10-08']);
});

test('date matching: OR across dates, combined with window, negation', () => {
  assert.equal(matches('date:sat'), true);
  assert.equal(matches('date:fri,sat'), true);
  assert.equal(matches('date:fri'), false);
  assert.equal(matches('date:weekend from:6pm'), true);
  assert.equal(matches('date:sat from:10pm'), false);
  assert.equal(matches('-date:sat'), false);
  assert.equal(matches('-date:sun'), true);
  const invalid = parse('date:31/2');
  assert.equal(matchesSearchQuery(listing(), invalid), true);
  assert.match(invalid.notes[0], /not a date/);
});

test('price ranges', () => {
  assert.equal(matches('price:<30'), true);
  assert.equal(matches('price:<24'), false);
  assert.equal(matches('price:<=24'), true);
  assert.equal(matches('price:>=24'), true);
  assert.equal(matches('price:>24'), false);
  assert.equal(matches('price:20-30'), true);
  assert.equal(matches('price:30-20'), true, 'reversed range');
  assert.equal(matches('price:$24'), true);
  assert.equal(matches('price:25'), false);
  assert.equal(matches('price:<10,>20'), true, 'OR of ranges');
  assert.equal(matches('price:<30', { price: null }), false);
  assert.match(parse('price:cheap').notes[0], /not understood/);
});

test('duration ranges', () => {
  assert.equal(matches('dur:2h'), true);
  assert.equal(matches('dur:2'), true);
  assert.equal(matches('dur:120m'), true);
  assert.equal(matches('duration:>=2h'), true);
  assert.equal(matches('dur:>2h'), false);
  assert.equal(matches('dur:1h-1.5h'), false);
  assert.equal(matches('dur:1h30m', { duration: 'Unknown', playEndAt: '2026-10-10T12:30:00.000Z' }), true, 'falls back to times');
  assert.equal(matches('dur:2h', { duration: 'Unknown', playEndAt: '2026-10-10T11:00:00.000Z' }), false);
});

test('summary describes parsed filters', () => {
  const { summary } = parse('venue:shelton -area:tampines date:sat from:7pm price:<30 extra');
  assert.deepEqual(summary, [
    'venue shelton',
    'not area tampines',
    'date 2026-10-10',
    'time 19:00–24:00',
    'price < $30',
    'text extra',
  ]);
});

test('review fixes: midnight end, Sunday weekend, quoted value then comma, duplicate notes, dotted times', () => {
  assert.equal(matches('to:midnight'), true, '00:00 end means end of day');
  assert.equal(matches('date:sat to:12am'), true);
  assert.deepEqual(parse('to:midnight').summary, ['time 00:00–24:00']);
  const sunday = new Date('2026-10-11T02:00:00.000Z');
  assert.deepEqual(parseDates('weekend', sunday), ['2026-10-10', '2026-10-11']);
  assert.deepEqual(parse('venue:"shelton college",oracle').venue.include, ['shelton college', 'oracle']);
  assert.equal(matches('venue:"shelton college",oracle'), true);
  assert.equal(parse('date:xyz date:xyz').notes.length, 1);
  assert.equal(parseClock('7.30pm'), '19:30');
  assert.equal(parseDurationMinutes('1h30'), 90);
  assert.equal(parseDurationMinutes('90m'), 90);
  assert.equal(parseDurationMinutes('2'), 120);
});

test('review round 1 (Sol): overnight window catches after-midnight courts, numeric overflow is ignored', () => {
  const early = { playAt: '2026-10-10T16:30:00.000Z', playEndAt: '2026-10-10T17:00:00.000Z' }; // 00:30-01:00 SGT
  assert.equal(matches('from:22:00 to:01:00', early), true);
  assert.equal(matches('from:22:00 to:00:30', early), false);
  const huge = '9'.repeat(310);
  assert.equal(matches(`price:${huge}`), true);
  assert.match(parse(`price:${huge}`).notes[0], /not understood/);
  assert.equal(matches(`dur:${huge}`), true);
  assert.deepEqual(parse('venue:"Shelton College","Tampines Hub"').venue.include, ['shelton college', 'tampines hub']);
});

test('review round 2: spaced values join, listings crossing midnight match early-morning windows', () => {
  assert.equal(parse('from:7 pm').from, '19:00');
  assert.deepEqual(parse('from:7 pm').terms.include, []);
  assert.equal(matches('from:7 pm'), true);
  assert.equal(matches('dur:2 hours'), true);
  assert.equal(matches('price:< 30'), true);
  assert.equal(matches('price:20 - 30'), true);
  assert.equal(matches('price:< 30 shelton'), true, 'joining stops after the number');
  const lateNight = { playAt: '2026-10-10T14:30:00.000Z', playEndAt: '2026-10-10T16:30:00.000Z' }; // 22:30-00:30 SGT
  assert.equal(matches('to:1am', lateNight), true);
  assert.equal(matches('from:0:00 to:2am', lateNight), true);
  assert.equal(matches('-to:1am', lateNight), false);
  assert.equal(matches('from:1am to:2am', lateNight), false);
});

test('review round 2 (Sol): free text ANDs, spaced comma lists, curly apostrophes in data, exact-value dedupe', () => {
  assert.equal(matches('shelton nonsense'), false, 'every free-text word must match');
  assert.equal(matches('venue:"Shelton College", "Tampines Hub"'), true);
  assert.deepEqual(parse('area:east, west shelton').area.include, ['east', 'west']);
  assert.deepEqual(parse('area:east, west shelton').terms.include, ['shelton']);
  assert.equal(matches('by:"Fakeco’s Games"', { owner: 'Fakeco’s Games' }), true);
  assert.equal(matches("by:fakeco's", { owner: 'Fakeco’s Games' }), true);
  assert.equal(matches('price:7.404,7.40', { price: 7.4 }), true);
  const overnight = { playAt: '2026-10-10T15:30:00.000Z', playEndAt: '2026-10-10T17:00:00.000Z' }; // 23:30-01:00 SGT
  assert.equal(matches('to:2am', overnight), true);
  assert.equal(matches('-to:2am', overnight), false);
});

test('review round 3: text summary says and, dates typed like the cards', () => {
  assert.deepEqual(parse('shelton hall price:<30').summary, ['price < $30', 'text shelton and hall']);
  assert.deepEqual(parseDates('10 oct', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('oct 10', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('10 october 2027', NOW), ['2027-10-10']);
  assert.deepEqual(parseDates('5 jan', NOW), ['2027-01-05']);
  assert.equal(parseDates('10 xyz', NOW), null);
  assert.equal(matches('date:10 oct'), true);
  assert.deepEqual(parse('date:10 oct').terms.include, []);
  assert.equal(matches('date:"10 Oct 2026"'), true);
  assert.equal(matches('date:oct 10 shelton'), true);
  assert.deepEqual(parse('date:sat shelton').terms.include, ['shelton'], 'stops joining when not a date');
});

test('review round 3 (Sol): spaced comma lists with units/operators, exact price bounds', () => {
  const oneHour = { price: 7.4, duration: '1 hour', playEndAt: '2026-10-10T12:00:00.000Z' };
  assert.equal(matches('dur:1 hour, 2 hours', oneHour), matches('dur:1h dur:2h', oneHour));
  assert.equal(matches('dur:1 hour, 2 hours', oneHour), true);
  assert.deepEqual(parse('dur:1 hour, 2 hours').terms.include, []);
  assert.equal(matches('price:< 10, > 30', oneHour), true);
  assert.deepEqual(parse('price:< 10, > 30').terms.include, []);
  assert.equal(matches('price:>7.399', oneHour), true);
  assert.equal(matches('price:7.4005', oneHour), false);
  assert.equal(matches('price:7.4', oneHour), true);
  assert.deepEqual(parse('price:7.4005').summary, ['price $7.4005']);
  assert.deepEqual(parse('price:7.4').summary, ['price $7.40']);
  assert.deepEqual(parse('date:10 oct, 11 oct').date.include, ['2026-10-10', '2026-10-11']);
});

test('review round 4: range with a space before the dash stays a range', () => {
  assert.equal(matches('price:20 -30'), true);
  assert.deepEqual(parse('price:20 -30').terms.exclude, []);
  assert.equal(matches('dur:1h -2h'), true);
  assert.equal(matches('price:<30 -shelton'), false, 'a negated word after a value is still a negation');
});

test('review round 4 (Sol): invalid spaced dates, timestamp durations, date + overnight window, leading-comma lists', () => {
  const invalid = parse('date:31 feb');
  assert.deepEqual(invalid.terms.include, []);
  assert.equal(matchesSearchQuery(listing(), invalid), true);
  assert.match(invalid.notes[0], /not a date/);
  assert.equal(matches('-date:31 feb'), true);
  const seventyFive = { duration: '1.3 hours', playEndAt: '2026-10-10T12:15:00.000Z' }; // 7pm-8:15pm
  assert.equal(matches('dur:75m', seventyFive), true);
  assert.equal(matches('dur:>76m', seventyFive), false);
  const sundayEarly = { playAt: '2026-10-10T16:15:00.000Z', playEndAt: '2026-10-10T17:15:00.000Z' }; // Sun 00:15-01:15 SGT
  assert.equal(matches('date:sun', sundayEarly), true);
  assert.equal(matches('from:22:00 to:02:00', sundayEarly), true);
  assert.equal(matches('date:sun from:22:00 to:02:00', sundayEarly), true);
  assert.equal(matches('date:sun from:22:00 to:00:10', sundayEarly), false);
  assert.equal(matches('venue:nope ,shelton'), true);
  assert.equal(matches('venue:nope , shelton'), true);
});

test('review round 5 (Sol): unspaced comma lists of spaced values, spaced compound durations, decimal-hour noise', () => {
  assert.equal(matches('date:10 oct,11 oct'), true);
  assert.deepEqual(parse('date:10 oct,11 oct').date.include, ['2026-10-10', '2026-10-11']);
  assert.equal(matches('dur:1 hour,2 hours'), true);
  assert.deepEqual(parse('dur:1 hour,2 hours').terms.include, []);
  const bad = parse('date:31 feb,31 apr');
  assert.deepEqual(bad.terms.include, []);
  assert.equal(matchesSearchQuery(listing(), bad), true);
  const ninety = { duration: '1.5 hours', playEndAt: '2026-10-10T12:30:00.000Z' };
  assert.equal(matches('dur:1h 30m', ninety), true);
  assert.equal(matches('dur:1 hour 30 min', ninety), true);
  assert.deepEqual(parse('dur:1h 30m').terms.include, []);
  assert.equal(parseDurationMinutes('2.05h'), 123);
  const oneTwoThree = { duration: '2.1 hours', playEndAt: '2026-10-10T13:03:00.000Z' };
  assert.equal(matches('dur:2.05h', oneTwoThree), true);
  assert.equal(matches('dur:<=2.05h', oneTwoThree), true);
  assert.equal(matches('dur:>2.05h', oneTwoThree), false);
  assert.equal(matches('dur:2h shelton'), true, 'a plain word after hours is not swallowed');
});

test('review round 6 (Sol): continuation stops at finished values, half-typed years are consumed', () => {
  const sixToSeven = { playAt: '2026-10-10T10:00:00.000Z', playEndAt: '2026-10-10T11:00:00.000Z' };
  assert.equal(parse('from:7pm -24').from, '19:00');
  assert.deepEqual(parse('from:7pm -24').terms.exclude, ['24']);
  assert.equal(matches('from:7pm -24', sixToSeven), false);
  assert.deepEqual(parse('price:20-30 -40').terms.exclude, ['40']);
  assert.equal(matches('price:20-30 -40', { price: 100 }), false);
  assert.equal(matches('price:< 30 , > 50'), true);
  const halfYear = parse('date:31 feb 202');
  assert.deepEqual(halfYear.terms.include, []);
  assert.equal(matchesSearchQuery(listing(), halfYear), true);
  assert.deepEqual(parseDates('10 oct 26', NOW), ['2026-10-10']);
  assert.equal(parseDates('10 oct 202', NOW), null);
});

test('review round 6 (Opus): ordinal days and two-digit years after month names', () => {
  assert.equal(matches('date:oct 10th'), true);
  assert.equal(matches('date:10th oct'), true);
  assert.deepEqual(parseDates('1st nov', NOW), ['2026-11-01']);
  assert.deepEqual(parse('date:31 oct 26').date.include, ['2026-10-31']);
  assert.deepEqual(parse('date:31 oct 26').terms.include, []);
  assert.deepEqual(parse('date:oct 10th shelton').terms.include, ['shelton']);
});

test('review round 7 (Opus): zero-length listings are a moment, comma before the year', () => {
  const moment = { playAt: '2026-10-10T11:00:00.000Z', playEndAt: '2026-10-10T11:00:00.000Z' }; // 7pm, no end
  assert.equal(matches('from:7am to:9am', moment), false);
  assert.equal(matches('from:3am to:4am', moment), false);
  assert.equal(matches('-from:6am -to:8am', moment), true);
  assert.equal(matches('from:6pm to:8pm', moment), true);
  assert.equal(matches('date:sat from:7pm', moment), true);
  assert.deepEqual(parse('date:Oct 10, 2027').date.include, ['2027-10-10']);
  assert.deepEqual(parse('date:10 Oct, 2026').notes, []);
  assert.deepEqual(parse('date:sat,sun').date.include, ['2026-10-10', '2026-10-11']);
});

test('review round 8 (Opus): key with a space before an exclusion, complete region lists', () => {
  assert.deepEqual(parse('area: -east').area.exclude, ['east']);
  assert.deepEqual(parse('area: -east').area.include, []);
  assert.equal(matches('area: -east'), true);
  assert.equal(matches('venue: -shelton'), false);
  assert.equal(matches('area:east', { area: 'Bedok' }), true);
  assert.equal(matches('area:west', { area: 'Bukit Panjang' }), true);
  assert.equal(matches('area:central', { area: 'Bukit Merah' }), true);
  assert.equal(matches('area:west', { area: 'Clementi' }), true);
});

test('review round 9 (Opus): month+year, two-day lists, inline negation, next/this, p.m., 24:00', () => {
  const monthYear = parse('date:oct 2026');
  assert.deepEqual(monthYear.date.include, []);
  assert.match(monthYear.notes[0], /not a date/);
  assert.deepEqual(parseDates('oct 10, 2026', NOW), ['2026-10-10']);
  assert.deepEqual(parseDates('oct 10 26', NOW), ['2026-10-10']);
  assert.deepEqual(parse('date:10 oct, 11').date.include, ['2026-10-10']);
  assert.equal(matches('date:10 oct, 11'), true);
  assert.equal(matches('area:-merah'), false);
  assert.deepEqual(parse('area:-east').area.exclude, ['east']);
  assert.equal(matches('venue:-college'), false);
  assert.deepEqual(parse('date:next sat').date.include, ['2026-10-10']);
  assert.deepEqual(parse('date:this weekend').terms.include, []);
  assert.equal(matches('date:next sat'), true);
  assert.equal(parse('from:7 p.m.').from, '19:00');
  assert.equal(parseClock('7p.m.'), '19:00');
  assert.equal(parseClock('24:00'), '00:00');
  assert.equal(matches('to:24:00'), true);
  assert.equal(parseClock('24:30'), null);
});

test('review round 10 (Opus): catalog zone for unknown areas, past explicit years, unknown keys', () => {
  assert.equal(matches('area:west', { area: 'Singapore', zone: 'West' }), true);
  assert.equal(matches('-area:west', { area: 'Singapore', zone: 'West' }), false);
  assert.equal(matches('area:north', { area: 'Singapore', zone: 'Northeast' }), true);
  assert.equal(matches('area:north', { area: 'Bukit Canberra' }), true);
  assert.equal(matches('area:east', { area: 'Serangoon', zone: 'Northeast' }), true, 'known area wins over zone');
  assert.equal(matches('area:east', { area: 'Singapore' }), false);
  const halfYear = parse('date:10 oct 20');
  assert.deepEqual(halfYear.date.include, []);
  assert.equal(matchesSearchQuery(listing(), halfYear), true);
  assert.equal(parseDates('10/10/20', NOW), null);
  assert.match(parse('time:7pm').notes[0], /not a filter/);
  assert.deepEqual(parse('http://x').notes, []);
  assert.deepEqual(parse('9:30').notes, []);
});

test('review round 10 (Sol): spaced compound duration ranges, long mistyped years, comma year only after month dates', () => {
  assert.equal(matches('dur:1h30m - 2h'), true);
  assert.deepEqual(parse('dur:1h30m - 2h').terms.include, []);
  const typo = parse('date:10 oct 20267');
  assert.deepEqual(typo.terms.include, []);
  assert.equal(matchesSearchQuery(listing(), typo), true);
  assert.deepEqual(parse('date:sat,2026').date.include, ['2026-10-10']);
  assert.match(parse('date:sat,2026').notes[0], /not a date/);
  assert.deepEqual(parse('date:2026-10-10,2026').date.include, ['2026-10-10']);
  assert.deepEqual(parse('date:Oct 10, 2027').date.include, ['2027-10-10']);
});

test('review round 11 (Opus): per-value exclusion in lists, lone dash, next weekday on that weekday', () => {
  assert.deepEqual(parse('area:east,-bedok').area, { include: ['east'], exclude: ['bedok'] });
  assert.equal(matches('area:east,-bedok', { area: 'Bedok' }), false);
  assert.equal(matches('area:east, -bedok', { area: 'Tampines' }), true);
  assert.equal(matches('area:-'), true);
  assert.equal(matches('by:-'), true);
  assert.equal(parse('venue:-').hasKeys, false);
  assert.deepEqual(parse('date:sat,-sun').date, { include: ['2026-10-10'], exclude: ['2026-10-11'] });
  const friday = new Date('2026-10-09T02:00:00.000Z');
  assert.deepEqual(parseDates('next fri', friday), ['2026-10-16']);
  assert.deepEqual(parseDates('this fri', friday), ['2026-10-09']);
  assert.deepEqual(parseDates('fri', friday), ['2026-10-09']);
  const saturday = new Date('2026-10-10T02:00:00.000Z');
  assert.deepEqual(parseDates('next weekend', saturday), ['2026-10-17', '2026-10-18']);
  assert.deepEqual(parseDates('this weekend', saturday), ['2026-10-10', '2026-10-11']);
  assert.deepEqual(parseDates('next sat', NOW), ['2026-10-10']);
});

test('review round 11 (Sol): misspelled or half-typed month words, spaced 60m', () => {
  for (const query of ['date:31 februarry', 'date:10 oc', 'date:10 fe']) {
    const parsed = parse(query);
    assert.deepEqual(parsed.terms.include, [], query);
    assert.equal(matchesSearchQuery(listing(), parsed), true, query);
  }
  assert.deepEqual(parse('date:31 shelton').terms.include, ['shelton'], 'non-month words stay text');
  assert.deepEqual(parse('date:sat shelton').terms.include, ['shelton']);
  assert.equal(matches('dur:1h 60m'), matches('dur:1h60m'));
  assert.equal(matches('dur:1h 60m'), true);
});

test('review round 12 (Opus): exclude dates by start day, northeast region', () => {
  const satNight = { playAt: '2026-10-10T15:00:00.000Z', playEndAt: '2026-10-10T17:00:00.000Z' }; // Sat 23:00-Sun 01:00 SGT
  assert.equal(matches('-date:sun', satNight), true);
  assert.equal(matches('date:sat -date:sun', satNight), true);
  assert.equal(matches('-date:sat', satNight), false);
  assert.equal(matches('area:northeast', { area: 'Singapore', zone: 'Northeast' }), true);
  assert.equal(matches('area:north-east', { area: 'Hougang' }), true);
});

test('review round 12 (Sol): exclusion position in lists does not matter, negated spaced dates', () => {
  assert.deepEqual(parse('venue:-tampines,shelton').venue, { include: ['shelton'], exclude: ['tampines'] });
  assert.equal(matches('venue:-tampines,shelton'), true);
  assert.equal(matches('venue:-tampines,shelton', { name: 'Heartbeat Bedok', facility: 'Heartbeat' }), false);
  assert.deepEqual(parse('-venue:a,b').venue.exclude, ['a', 'b']);
  assert.deepEqual(parse('date:sat,-11 oct').date, { include: ['2026-10-10'], exclude: ['2026-10-11'] });
  assert.equal(matches('date:sat,-11 oct'), true);
  const bad = parse('date:sat,-31 feb');
  assert.deepEqual(bad.terms.include, []);
  assert.equal(matchesSearchQuery(listing(), bad), true);
  assert.deepEqual(parse('area:-east').area.exclude, ['east']);
  assert.deepEqual(parse('area: -east').area.exclude, ['east']);
  assert.equal(parse('from:-7pm').notFrom, '19:00');
});

test('review round 13 (Sol): invalid listed time keeps the valid one, phrases do not span fields', () => {
  const morning = { playAt: '2026-10-10T01:00:00.000Z', playEndAt: '2026-10-10T02:00:00.000Z' }; // 09:00-10:00 SGT
  assert.equal(parse('from:7pm,25').from, '19:00');
  assert.equal(matches('from:7pm,25', morning), false);
  assert.equal(matches('-from:7pm,25'), false);
  assert.equal(matches('venue:"college shelton"'), false);
  assert.equal(matches('-venue:"college shelton"'), true);
  assert.equal(matches('by:"fakeowner fake_handle"'), false);
  assert.equal(matches('by:fake_handle'), true);
});
