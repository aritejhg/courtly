import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildListing,
  countVenueMentions,
  fingerprint,
  isIgnoredSwapMessage,
  isPotentialCourtMessage,
  splitMessageListings,
} from './lib/telegram-parser.mjs';
import { shouldReplaceDeletedDuplicate, suppressIncompleteSameSlotReposts } from './lib/listing-dedupe.mjs';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const messagesPath = resolve(argument('--messages', 'data/telegram-messages.json'));
const venuesPath = resolve(argument('--venues', 'data/badminton-venues.json'));
const outputPath = resolve(argument('--output', 'data/telegram-listings.json'));
const unmatchedPath = resolve(argument('--unmatched', 'data/unmatched-venue-candidates.json'));
const ambiguitiesPath = resolve(argument('--ambiguities', 'data/parser-ambiguities.json'));
const now = new Date(process.env.INGEST_NOW || Date.now());

const readJson = async (path, fallback, { optional = false } = {}) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return fallback;
    const wrapped = new Error(`Invalid JSON input: ${path}: ${error instanceof Error ? error.message : String(error)}`);
    wrapped.name = 'IngestionInputError';
    wrapped.code = 'INGESTION_INPUT_INVALID';
    wrapped.details = { path, optional, cause: error instanceof Error ? error.message : String(error) };
    wrapped.retryable = false;
    throw wrapped;
  }
};

const [messages, activeSgVenues, overrides, coordinateCache, previousListings, previousUnmatched] = await Promise.all([
  readJson(messagesPath, []),
  readJson(venuesPath, []),
  readJson('data/venue-overrides.json', []),
  readJson('data/venue-coordinate-cache.json', {}, { optional: true }),
  readJson(outputPath, [], { optional: true }),
  readJson(unmatchedPath, [], { optional: true }),
]);
for (const [value, path] of [[messages, messagesPath], [activeSgVenues, venuesPath], [overrides, 'data/venue-overrides.json'], [previousListings, outputPath], [previousUnmatched, unmatchedPath]]) {
  if (!Array.isArray(value)) {
    const error = new Error(`Invalid JSON schema: expected an array in ${path}`);
    error.name = 'IngestionInputError';
    error.code = 'INGESTION_INPUT_SCHEMA_INVALID';
    error.details = { path, expected: 'array', actual: typeof value };
    error.retryable = false;
    throw error;
  }
}
const venues = [...activeSgVenues, ...overrides].map((venue) => {
  const cached = coordinateCache[venue.id];
  return cached && (venue.lat == null || venue.lng == null) ? { ...venue, ...cached } : venue;
});

function parserFailure(message, details) {
  const error = new Error(message);
  error.name = 'ParserValidationError';
  error.code = 'PARSER_VALIDATION_FAILED';
  error.details = details;
  error.retryable = false;
  return error;
}

function validateParsedResult({ listing, venueMatch }) {
  const failures = [];
  const explicitCommunityClub = /\b(?:cc|community\s+(?:club|centre))\b/i.test(listing.listingText || '')
    && !/\b(?:school|pri(?:mary)?|sec(?:ondary)?|sport(?:s)?\s*hall|sh)\b/i.test(listing.listingText || '');
  const venue = venueMatch.venue;
  if (venueMatch.status === 'deterministic') {
    if (!venue?.id || listing.venueId !== venue.id) failures.push({ code: 'VENUE_ID_MISMATCH', venueId: listing.venueId, expectedVenueId: venue?.id });
    if (explicitCommunityClub && venue?.kind !== 'community_club') failures.push({ code: 'COMMUNITY_CLUB_TYPE_MISMATCH', facility: listing.facility, venueKind: venue?.kind });
    if (venue?.lat != null && venue?.lng != null && (listing.lat !== venue.lat || listing.lng !== venue.lng)) {
      failures.push({ code: 'VENUE_COORDINATE_MISMATCH', facility: listing.facility, lat: listing.lat, lng: listing.lng, expectedLat: venue.lat, expectedLng: venue.lng });
    }
  }
  if (venueMatch.status === 'extracted' && ('lat' in listing || 'lng' in listing)) {
    failures.push({ code: 'UNVERIFIED_VENUE_HAS_COORDINATES', facility: listing.facility });
  }
  if (/^\s*[.]?\d{2,4}(?:am|pm)?\s+.+\bcc\b/i.test(listing.facility)) {
    failures.push({ code: 'MALFORMED_VENUE_NAME', facility: listing.facility });
  }
  return failures.length ? {
    sourceMessageId: listing.sourceMessageId,
    sourceTelegramMessageId: listing.sourceTelegramMessageId,
    venueMatch: venueMatch.status,
    facility: listing.facility,
    failures,
  } : null;
}
const listingMessages = messages.filter((message) =>
  !isIgnoredSwapMessage(message.text)
  && (message.deleted || isPotentialCourtMessage(message.text, venues) || Array.isArray(message.listings)));
const parsedResults = listingMessages.flatMap((message) => {
  const parts = splitMessageListings(message, venues);
  const venueMentions = countVenueMentions(message.text, venues);
  return parts.map((part, index) => {
    let parsed;
    try {
      parsed = buildListing(message, venues, { now, listingText: part.text, listingIndex: index, partCount: parts.length });
    } catch (error) {
      error.name = error.name || 'ParserBuildError';
      error.code = error.code || 'PARSER_BUILD_FAILED';
      error.details = {
        sourceMessageId: String(message.messageId),
        listingIndex: index + 1,
        partCount: parts.length,
        textLength: String(part.text || '').length,
      };
      throw error;
    }
    if (index === 0 && venueMentions > parts.length) {
      parsed.issues.push({ field: 'listing_split', kind: 'ambiguous', venueMentions, producedListings: parts.length });
    }
    return { message, ...parsed };
  });
});
const results = suppressIncompleteSameSlotReposts(parsedResults);

const validationFailures = results.map(validateParsedResult).filter(Boolean);
if (validationFailures.length) {
  throw parserFailure(`Parser validation failed for ${validationFailures.length} listing(s).`, {
    count: validationFailures.length,
    failures: validationFailures.slice(0, 25),
  });
}

const byMessage = new Map(previousListings.map((listing) => [listing.sourceMessageId, listing]));
const currentSourceIds = new Set(results.map(({ listing }) => listing.sourceMessageId));
const knownMessageIds = new Set(messages.map((message) => String(message.messageId)));
for (const [sourceMessageId, listing] of byMessage) {
  const parentId = listing.sourceTelegramMessageId || listing.sourceMessageId;
  if (knownMessageIds.has(String(parentId)) && !currentSourceIds.has(sourceMessageId)) byMessage.delete(sourceMessageId);
}

const byFingerprint = new Map(previousListings.map((listing) => [fingerprint(listing), listing]));
const currentUnmatched = [];
const parserAmbiguities = [];
let newCount = 0;
let duplicateCount = 0;
for (const { listing, venueMatch, issues } of results) {
  if (issues.length) {
    parserAmbiguities.push({
      sourceMessageId: listing.sourceMessageId,
      sourceTelegramMessageId: listing.sourceTelegramMessageId,
      postedAt: listing.postedAt,
      owner: listing.owner,
      text: listing.listingText,
      rawText: listing.rawText,
      issues,
    });
  }
  if (venueMatch.status !== 'deterministic') {
    currentUnmatched.push({
      text: listing.listingText,
      sourceMessageId: listing.sourceMessageId,
      sourceTelegramMessageId: listing.sourceTelegramMessageId,
      status: venueMatch.status,
      venueId: venueMatch.venue?.id,
      candidates: venueMatch.candidates || [],
      firstSeenAt: now.toISOString(),
    });
  }
  if (byMessage.has(listing.sourceMessageId)) {
    const previous = byMessage.get(listing.sourceMessageId);
    byMessage.set(listing.sourceMessageId, listing.status === 'deleted' && previous?.deletedAt
      ? { ...listing, deletedAt: previous.deletedAt }
      : listing);
    continue;
  }
  const listingFingerprint = fingerprint(listing);
  const duplicate = byFingerprint.get(listingFingerprint);
  if (duplicate) {
    if (shouldReplaceDeletedDuplicate(duplicate, listing)) {
      byMessage.delete(duplicate.sourceMessageId);
      byMessage.set(listing.sourceMessageId, listing);
      byFingerprint.set(listingFingerprint, listing);
      newCount += 1;
    } else {
      duplicateCount += 1;
    }
    continue;
  }
  newCount += 1;
  byMessage.set(listing.sourceMessageId, listing);
  byFingerprint.set(listingFingerprint, listing);
}

// A single source message can yield multiple listings (`123:1`, `123:2`).
// Treat those as resolving the parent message's old unmatched record too.
const currentMessageIds = new Set(results.map(({ listing }) => listing.sourceMessageId));
const currentParentMessageIds = new Set([...currentMessageIds].map((id) => String(id).split(':', 1)[0]));
const ignoredCurrentMessageIds = new Set(messages
  .filter((message) => isIgnoredSwapMessage(message.text))
  .map((message) => String(message.messageId)));
const retainedUnmatched = previousUnmatched.filter((item) => {
  const id = String(item.sourceMessageId);
  const parentId = id.split(':', 1)[0];
  return !currentMessageIds.has(id)
    && !currentParentMessageIds.has(parentId)
    && !ignoredCurrentMessageIds.has(parentId);
});
const dedupedUnmatched = [...new Map([...retainedUnmatched, ...currentUnmatched]
  .map((item) => [`${item.sourceMessageId}:${item.text}`, item])).values()];
const nextListings = [...byMessage.values()].sort((a, b) => new Date(a.playAt) - new Date(b.playAt));
const deletedCount = nextListings.filter((listing) => listing.status === 'deleted').length;
const expiredCount = nextListings.filter((listing) => listing.status === 'expired').length;
const activeCount = nextListings.filter((listing) => listing.status === 'active' && new Date(listing.playAt) > now).length;

await mkdir('data', { recursive: true });
const writeJsonAtomic = async (path, value) => {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    try { await rename(temporaryPath, `${temporaryPath}.failed`); } catch {}
    throw error;
  }
};
await writeJsonAtomic(outputPath, nextListings);
await writeJsonAtomic(unmatchedPath, dedupedUnmatched);
await writeJsonAtomic(ambiguitiesPath, parserAmbiguities);
console.log(JSON.stringify({
  messages: messages.length,
  listingMessages: listingMessages.length,
  new: newCount,
  active: activeCount,
  expired: expiredCount,
  deleted: deletedCount,
  duplicates: duplicateCount,
  unmatched: currentUnmatched.length,
  ambiguities: parserAmbiguities.length,
  venueCount: venues.length,
  output: outputPath,
}));
