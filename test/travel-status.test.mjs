import test from 'node:test';
import assert from 'node:assert/strict';
import { travelUnavailableMessage } from '../lib/travel-status.mjs';

test('explains missing origin before route calculation', () => {
  assert.equal(
    travelUnavailableMessage({ hasOrigin: false, hasPlayAt: true, hasDestination: true }),
    'Add a start location to calculate travel time',
  );
});

test('distinguishes missing listing time and destination coordinates', () => {
  assert.equal(
    travelUnavailableMessage({ hasOrigin: true, hasPlayAt: false, hasDestination: true }),
    'Listing time unavailable',
  );
  assert.equal(
    travelUnavailableMessage({ hasOrigin: true, hasPlayAt: true, hasDestination: false }),
    'Verified coordinates unavailable for this venue',
  );
});
