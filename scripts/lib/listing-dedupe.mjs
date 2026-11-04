export function shouldReplaceDeletedDuplicate(existing, candidate) {
  return existing?.status === 'deleted' && candidate?.status !== 'deleted';
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
