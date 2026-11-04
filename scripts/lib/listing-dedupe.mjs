import { fingerprint } from './telegram-parser.mjs';

export function listingDeduplicationKey(listing) {
  return JSON.stringify([
    fingerprint(listing),
    listing?.venueId ?? null,
    listing?.playAt ?? null,
    listing?.playEndAt ?? null,
    listing?.price ?? null,
  ]);
}

export function shouldReplaceDuplicate(existing, candidate) {
  const rank = { deleted: 0, expired: 1, active: 2 };
  const existingRank = rank[existing?.status] ?? 0;
  const candidateRank = rank[candidate?.status] ?? 0;
  if (existingRank !== candidateRank) return candidateRank > existingRank;

  const existingPostedAt = Date.parse(existing?.postedAt || '');
  const candidatePostedAt = Date.parse(candidate?.postedAt || '');
  return Number.isFinite(candidatePostedAt)
    && (!Number.isFinite(existingPostedAt) || candidatePostedAt > existingPostedAt);
}

export function dedupeListings(listings) {
  const byFingerprint = new Map();
  for (const listing of listings) {
    const key = listingDeduplicationKey(listing);
    const existing = byFingerprint.get(key);
    if (!existing || shouldReplaceDuplicate(existing, listing)) byFingerprint.set(key, listing);
  }
  return [...byFingerprint.values()];
}

export function suppressIncompleteSameSlotReposts(results) {
  const keyFor = ({ listing, venueMatch }) => {
    if (venueMatch?.status !== 'deterministic'
      || listing?.status !== 'active'
      || !String(listing?.owner || '').trim()
      || !listing?.venueId
      || !Number.isFinite(listing?.lat)
      || !Number.isFinite(listing?.lng)
      || !listing?.playAt
      || !listing?.playEndAt) return null;
    return [
      String(listing.owner).trim().toLowerCase(),
      listing.venueId,
      listing.playAt,
      listing.playEndAt,
      listing.sport,
    ].join('|');
  };
  const slotPrices = new Map();
  for (const result of results) {
    const key = keyFor(result);
    if (!key || result.listing.price == null) continue;
    const prices = slotPrices.get(key) || new Set();
    prices.add(result.listing.price);
    slotPrices.set(key, prices);
  }
  return results.filter((result) => {
    if (result.listing.price != null) return true;
    const key = keyFor(result);
    return !key || slotPrices.get(key)?.size !== 1;
  });
}
