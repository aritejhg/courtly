import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildListing,
  countVenueMentions,
  fingerprint,
  isPotentialCourtMessage,
  splitMessageListings,
} from './lib/telegram-parser.mjs';

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

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
};

const [messages, activeSgVenues, overrides, previousListings, previousUnmatched] = await Promise.all([
  readJson(messagesPath, []),
  readJson(venuesPath, []),
  readJson('data/venue-overrides.json', []),
  readJson(outputPath, []),
  readJson(unmatchedPath, []),
]);
const venues = [...activeSgVenues, ...overrides];
const listingMessages = messages.filter((message) =>
  message.deleted || isPotentialCourtMessage(message.text, venues) || Array.isArray(message.listings));
const results = listingMessages.flatMap((message) => {
  const parts = splitMessageListings(message, venues);
  const venueMentions = countVenueMentions(message.text, venues);
  return parts.map((part, index) => {
    const parsed = buildListing(message, venues, { now, listingText: part.text, listingIndex: index, partCount: parts.length });
    if (index === 0 && venueMentions > parts.length) {
      parsed.issues.push({ field: 'listing_split', kind: 'ambiguous', venueMentions, producedListings: parts.length });
    }
    return { message, ...parsed };
  });
});

const byMessage = new Map(previousListings.map((listing) => [listing.sourceMessageId, listing]));
const splitParentIds = new Set(listingMessages
  .filter((message) => splitMessageListings(message, venues).length > 1)
  .map((message) => String(message.messageId)));
const currentSourceIds = new Set(results.map(({ listing }) => listing.sourceMessageId));
for (const [sourceMessageId, listing] of byMessage) {
  const parentId = listing.sourceTelegramMessageId || listing.sourceMessageId;
  if (splitParentIds.has(String(parentId)) && !currentSourceIds.has(sourceMessageId)) byMessage.delete(sourceMessageId);
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
  if (!venueMatch.venue) {
    currentUnmatched.push({
      text: listing.listingText,
      sourceMessageId: listing.sourceMessageId,
      sourceTelegramMessageId: listing.sourceTelegramMessageId,
      status: venueMatch.status,
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
  if (byFingerprint.has(fingerprint(listing))) {
    duplicateCount += 1;
    continue;
  }
  newCount += 1;
  byMessage.set(listing.sourceMessageId, listing);
  byFingerprint.set(fingerprint(listing), listing);
}

const currentMessageIds = new Set(results.map(({ listing }) => listing.sourceMessageId));
const retainedUnmatched = previousUnmatched.filter((item) => !currentMessageIds.has(item.sourceMessageId));
const dedupedUnmatched = [...new Map([...retainedUnmatched, ...currentUnmatched]
  .map((item) => [`${item.sourceMessageId}:${item.text}`, item])).values()];
const nextListings = [...byMessage.values()].sort((a, b) => new Date(a.playAt) - new Date(b.playAt));
const deletedCount = nextListings.filter((listing) => listing.status === 'deleted').length;
const expiredCount = nextListings.filter((listing) => listing.status === 'expired').length;
const activeCount = nextListings.filter((listing) => listing.status === 'active' && new Date(listing.playAt) > now).length;

await mkdir('data', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(nextListings, null, 2)}\n`);
await writeFile(unmatchedPath, `${JSON.stringify(dedupedUnmatched, null, 2)}\n`);
await writeFile(ambiguitiesPath, `${JSON.stringify(parserAmbiguities, null, 2)}\n`);
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
