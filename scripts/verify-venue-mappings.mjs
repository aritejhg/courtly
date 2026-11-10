import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expandedAliases, matchVenue, normalize } from './lib/telegram-parser.mjs';

const root = resolve('.');
const readJson = async (relativePath) => JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
const [activeSgVenues, overrides, sportsgCensusVenues, messages, listings] = await Promise.all([
  readJson('data/badminton-venues.json'),
  readJson('data/venue-overrides.json'),
  readJson('data/sportsg-badminton-census.json'),
  readJson('data/telegram-messages.json'),
  readJson('data/telegram-listings.json'),
]);
const venues = [...activeSgVenues, ...overrides, ...sportsgCensusVenues];
const byId = new Map(venues.map((venue) => [venue.id, venue]));
const failures = [];
const directAliases = new Map();
const expandedAliasCollisions = new Map();

for (const venue of venues) {
  if (!venue.id || !venue.canonicalName) failures.push({ code: 'VENUE_ID_OR_NAME_MISSING', venue });
  if ((venue.lat == null) !== (venue.lng == null)) failures.push({ code: 'PARTIAL_COORDINATES', venue: venue.canonicalName });
  if (venue.lat != null && (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lng))) failures.push({ code: 'INVALID_COORDINATES', venue: venue.canonicalName });
  for (const alias of [venue.canonicalName, ...(venue.aliases || [])]) {
    const key = normalize(alias);
    const entries = directAliases.get(key) || new Map();
    entries.set(venue.canonicalName, venue.id);
    directAliases.set(key, entries);
  }
  for (const alias of expandedAliases(venue)) {
    const entries = expandedAliasCollisions.get(alias) || new Set();
    entries.add(venue.canonicalName);
    expandedAliasCollisions.set(alias, entries);
  }
}

const directCollisions = [...directAliases]
  .filter(([, entries]) => entries.size > 1)
  .map(([alias, entries]) => ({ alias, venues: [...entries.keys()] }));
const derivedCollisions = [...expandedAliasCollisions]
  .filter(([, names]) => names.size > 1)
  .map(([alias, names]) => ({ alias, venues: [...names] }));
if (directCollisions.length) failures.push({ code: 'STRICT_ALIAS_COLLISION', collisions: directCollisions });

const directAliasFailures = [];
for (const venue of venues) {
  for (const alias of [venue.canonicalName, ...(venue.aliases || [])]) {
    const result = matchVenue(alias, venues);
    if (result.status !== 'deterministic' || result.venue?.canonicalName !== venue.canonicalName) {
      directAliasFailures.push({ alias, expected: venue.canonicalName, status: result.status, actual: result.venue?.canonicalName });
    }
  }
}
if (directAliasFailures.length) failures.push({ code: 'STRICT_ALIAS_UNRESOLVED', aliases: directAliasFailures });

const coordinateMismatches = [];
const invalidDeterministic = [];
const unverifiedWithCoordinates = [];
for (const listing of listings) {
  if (listing.venueMatch === 'deterministic') {
    const venue = byId.get(listing.venueId);
    if (!venue || venue.canonicalName !== listing.facility) {
      invalidDeterministic.push({ sourceMessageId: listing.sourceMessageId, venueId: listing.venueId, facility: listing.facility });
      continue;
    }
    if (venue.lat != null && (listing.lat !== venue.lat || listing.lng !== venue.lng)) {
      coordinateMismatches.push({ sourceMessageId: listing.sourceMessageId, facility: listing.facility, lat: listing.lat, lng: listing.lng, expectedLat: venue.lat, expectedLng: venue.lng });
    }
    if (venue.lat == null && ('lat' in listing || 'lng' in listing)) {
      coordinateMismatches.push({ sourceMessageId: listing.sourceMessageId, facility: listing.facility, reason: 'coordinate-free venue has coordinates' });
    }
  } else if ('lat' in listing || 'lng' in listing) {
    unverifiedWithCoordinates.push({ sourceMessageId: listing.sourceMessageId, venueMatch: listing.venueMatch, facility: listing.facility });
  }
}
if (invalidDeterministic.length) failures.push({ code: 'INVALID_DETERMINISTIC_LISTING', listings: invalidDeterministic });
if (coordinateMismatches.length) failures.push({ code: 'VENUE_COORDINATE_MISMATCH', listings: coordinateMismatches });
if (unverifiedWithCoordinates.length) failures.push({ code: 'UNVERIFIED_VENUE_HAS_COORDINATES', listings: unverifiedWithCoordinates });

const sourceVenueMatches = messages.flatMap((message) => {
  const result = matchVenue(message.text, venues);
  return [{ sourceMessageId: String(message.messageId), status: result.status, venueId: result.venue?.id }];
});
const countBy = (items, field) => Object.fromEntries(Object.entries(items.reduce((counts, item) => {
  const key = item[field] || 'none';
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {})).sort(([a], [b]) => a.localeCompare(b)));

const report = {
  venues: venues.length,
  coordinateVerifiedVenues: venues.filter((venue) => venue.lat != null && venue.lng != null).length,
  identityOnlyVenues: venues.filter((venue) => venue.lat == null || venue.lng == null).length,
  strictAliasCollisions: directCollisions.length,
  strictAliasFailures: directAliasFailures.length,
  derivedAliasCollisions: derivedCollisions.length,
  messages: messages.length,
  sourceVenueStatuses: countBy(sourceVenueMatches, 'status'),
  listings: listings.length,
  feedVenueStatuses: countBy(listings, 'venueMatch'),
  verifiedListings: listings.filter((listing) => listing.venueMatch === 'deterministic').length,
  unresolvedListings: listings.filter((listing) => listing.venueMatch !== 'deterministic').length,
  coordinateMismatches: coordinateMismatches.length,
  unverifiedWithCoordinates: unverifiedWithCoordinates.length,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
