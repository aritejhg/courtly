import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesListingDateTime, singaporeDateKey } from '../lib/listing-filters.ts';

test('uses Singapore local date keys for UTC timestamps', () => {
  assert.equal(singaporeDateKey('2026-09-09T16:30:00.000Z'), '2026-09-10');
});

test('matches a listing when its time interval overlaps a selected window', () => {
  const listing = {
    playAt: '2026-09-10T09:30:00.000Z', // 5:30pm Singapore
    playEndAt: '2026-09-10T11:30:00.000Z', // 7:30pm Singapore
  };
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-10', startTime: '08:00', endTime: '12:00' }), false);
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-10', startTime: '18:00', endTime: '20:00' }), true);
});

test('does not match a different local date or invalid time window', () => {
  const listing = {
    playAt: '2026-09-10T02:00:00.000Z',
    playEndAt: '2026-09-10T04:00:00.000Z',
  };
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-11' }), false);
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-10', startTime: 'invalid' }), false);
});

test('supports custom ranges that cross midnight', () => {
  const listing = {
    playAt: '2026-09-10T15:30:00.000Z', // 11:30pm Singapore
    playEndAt: '2026-09-10T17:00:00.000Z', // 1:00am Singapore
  };
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-10', startTime: '22:00', endTime: '01:30' }), true);
});

test('matches an overnight listing on the following Singapore-local date', () => {
  const listing = {
    playAt: '2026-09-10T15:30:00.000Z', // 11:30pm Singapore
    playEndAt: '2026-09-10T17:00:00.000Z', // 1:00am Singapore on Sep 11
  };
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-11' }), true);
  assert.equal(matchesListingDateTime(listing, { date: '2026-09-11', startTime: '00:30', endTime: '01:30' }), true);
});
