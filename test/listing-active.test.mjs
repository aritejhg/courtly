import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveListings } from '../lib/listing-activity.mjs';

test('requires a positive time window before exposing an active listing', () => {
  const now = new Date('2036-01-01T00:00:00.000Z');
  const complete = { status: 'active', playAt: '2036-01-02T10:00:00.000Z', playEndAt: '2036-01-02T11:00:00.000Z' };
  const missingEnd = { ...complete, playEndAt: complete.playAt };
  const incomplete = { ...complete, status: 'incomplete' };

  assert.deepEqual(getActiveListings([complete, missingEnd, incomplete], now), [complete]);
});
