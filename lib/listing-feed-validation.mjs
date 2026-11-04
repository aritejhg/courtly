// Shared by the Worker that reads the live feed and the script that publishes
// it, so a feed the reader would reject can never overwrite the live one.

/** One listing carrying the fields the reader needs; other fields may be null. */
export function isValidListing(item) {
  return (
    Boolean(item) &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.playAt === 'string' &&
    typeof item.status === 'string' &&
    typeof item.sourceMessageId === 'string'
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
