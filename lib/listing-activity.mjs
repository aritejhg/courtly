/**
 * @param {{ status: string, deletedAt?: string, playAt: string, playEndAt?: string }} listing
 * @param {Date} [now=new Date()]
 */
export function isListingActive(listing, now = new Date()) {
  const start = Date.parse(listing.playAt);
  const end = Date.parse(listing.playEndAt ?? '');
  return listing.status === 'active' && !listing.deletedAt && Number.isFinite(start) && Number.isFinite(end)
    && start > now.getTime() && end > start;
}

/**
 * @template T
 * @param {T[]} listings
 * @param {Date} [now=new Date()]
 * @returns {T[]}
 */
export function getActiveListings(listings, now = new Date()) {
  return listings.filter((listing) => isListingActive(listing, now));
}
