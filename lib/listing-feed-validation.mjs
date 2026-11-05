// Shared by the Worker that reads the live feed and the script that publishes
// it, so a feed the reader would reject can never overwrite the live one.

/** The KV key the publisher writes and the Worker reads. */
export const FEED_KEY = 'courtly:listings';

const isText = (value) => typeof value === 'string';
const isTimestamp = (value) => isText(value) && Number.isFinite(Date.parse(value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const optional = (check) => (value) => value === undefined || value === null || check(value);

// The fields the page reads without a guard. Everything else is optional or nullable,
// because ingestion omits or nulls it for listings it could not fully parse.
const REQUIRED = {
  id: isText,
  facility: isText,
  area: isText,
  playAt: isTimestamp,
  postedAt: isTimestamp,
  status: (value) => value === 'active' || value === 'incomplete' || value === 'expired' || value === 'deleted',
  sourceMessageId: isText,
  sourceUrl: isText,
  rawText: isText,
  displayDate: isText,
  displayDay: isText,
  displayTime: isText,
  duration: isText,
  owner: isText,
  price: (value) => value === null || isNumber(value),
};
const OPTIONAL = {
  playEndAt: optional(isTimestamp),
  listingText: optional(isText),
  deletedAt: optional(isTimestamp),
  ownerUsername: optional(isText),
  venueId: optional(isText),
  venueMatch: optional(isText),
  lat: optional(isNumber),
  lng: optional(isNumber),
};

/** One listing carrying the fields the reader and the page need; other fields may be null. */
export function isValidListing(item) {
  if (!item || typeof item !== 'object') return false;
  return (
    Object.entries(REQUIRED).every(([field, check]) => check(item[field])) &&
    Object.entries(OPTIONAL).every(([field, check]) => check(item[field]))
  );
}

export function isListingFeed(value) {
  return Array.isArray(value) && value.every(isValidListing);
}

/** Stricter than reading: an empty feed is valid to serve but never worth publishing. */
export function assertPublishableFeed(feed) {
  if (!isListingFeed(feed) || feed.length === 0) {
    throw new Error('The listing feed is empty or malformed; refusing to publish it.');
  }
}
