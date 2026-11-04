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

export function suppressDuplicateActiveSlotReposts(results) {
  const slots = new Map();
  const keyFor = ({ listing, venueMatch }) => {
    const owner = String(listing?.owner || '').trim().toLowerCase();
    if (venueMatch?.status !== 'deterministic'
      || listing?.status !== 'active'
      || listing?.deletedAt
      || !owner
      || !listing?.venueId
      || !Number.isFinite(listing?.lat)
      || !Number.isFinite(listing?.lng)
      || !listing?.playAt
      || !listing?.playEndAt
      || !Number.isFinite(Date.parse(listing.playAt))
      || !Number.isFinite(Date.parse(listing.playEndAt))
      || Date.parse(listing.playEndAt) < Date.parse(listing.playAt)) return null;
    const explicitCourt = String(listing.listingText || '').match(/\b(?:court|ct)\s*(\d+)\b/i)?.[1] || null;
    return JSON.stringify([
      owner,
      listing.venueId,
      listing.lat,
      listing.lng,
      listing.playAt,
      listing.playEndAt,
      listing.sport,
      explicitCourt,
    ]);
  };
  const parentIdFor = ({ listing }) => String(listing.sourceTelegramMessageId || listing.sourceMessageId || '').split(':', 1)[0];

  results.forEach((result, index) => {
    const key = keyFor(result);
    if (!key) return;
    const parentId = parentIdFor(result);
    const slot = slots.get(key) || { parents: new Set(), latest: null };
    slot.parents.add(parentId);
    const postedAt = Date.parse(result.listing.postedAt || '');
    const latestPostedAt = slot.latest ? Date.parse(slot.latest.result.listing.postedAt || '') : Number.NEGATIVE_INFINITY;
    if (!slot.latest || (Number.isFinite(postedAt) && (!Number.isFinite(latestPostedAt) || postedAt >= latestPostedAt))) {
      slot.latest = { index, parentId, result };
    }
    slots.set(key, slot);
  });

  const winnerBySlot = new Map([...slots]
    .filter(([, slot]) => slot.parents.size > 1)
    .map(([key, slot]) => [key, slot.latest.parentId]));
  return results.filter((result) => {
    const key = keyFor(result);
    const winner = key && winnerBySlot.get(key);
    return !winner || parentIdFor(result) === winner;
  });
}
