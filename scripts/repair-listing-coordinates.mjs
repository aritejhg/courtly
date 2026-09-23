import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { matchVenue, normalize } from './lib/telegram-parser.mjs';

const listingsPath = resolve('data/telegram-listings.json');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export function repairListings(listings, venues) {
  let repaired = 0;
  const matchMention = (text) => {
    const normalizedText = ` ${normalize(text)} `;
    const mentions = new Map();
    for (const venue of venues) {
      for (const alias of [venue.canonicalName, ...(venue.aliases || [])]) {
        const normalizedAlias = normalize(alias);
        const isVenueLike = /\b(?:cc|community club|community centre|school|hall|sport|sports|sbh|kff)\b/.test(normalizedAlias);
        const isSpecificAlias = normalizedAlias.length >= 10 && normalizedAlias.split(' ').length >= 2;
        if (!isVenueLike && !isSpecificAlias) continue;
        if (!normalizedText.includes(` ${normalizedAlias} `)) continue;
        const match = matchVenue(alias, venues);
        if (match.status === 'deterministic') mentions.set(match.venue.id, match.venue);
      }
    }
    return mentions.size === 1 ? [...mentions.values()][0] : null;
  };
  const next = listings.map((listing) => {
    let match = matchVenue(listing.facility, venues);
    if (match.status !== 'deterministic' && ['unmatched', 'extracted'].includes(listing.venueMatch)) {
      match = matchVenue(listing.listingText, venues);
    }
    const venue = match.status === 'deterministic'
      ? match.venue
      : ['unmatched', 'extracted'].includes(listing.venueMatch) ? matchMention(listing.listingText) : null;
    if (!venue || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)) return listing;
    if (listing.venueMatch === 'deterministic' && listing.venueId && listing.venueId !== venue.id) return listing;

    const unchanged = listing.venueMatch === 'deterministic'
      && listing.venueId === venue.id
      && listing.facility === venue.canonicalName
      && listing.lat === venue.lat
      && listing.lng === venue.lng;
    if (unchanged) return listing;
    repaired += 1;
    return {
      ...listing,
      facility: venue.canonicalName,
      venueId: venue.id,
      venueMatch: 'deterministic',
      lat: venue.lat,
      lng: venue.lng,
    };
  });
  return { listings: next, repaired };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [listings, activeSgVenues, overrides] = await Promise.all([
    readJson(listingsPath),
    readJson(resolve('data/badminton-venues.json')),
    readJson(resolve('data/venue-overrides.json')),
  ]);
  const result = repairListings(listings, [...activeSgVenues, ...overrides]);
  if (result.repaired) {
    const temporaryPath = `${listingsPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${JSON.stringify(result.listings, null, 2)}\n`);
    await rename(temporaryPath, listingsPath);
  }
  console.log(JSON.stringify({ checked: listings.length, repaired: result.repaired }));
}
