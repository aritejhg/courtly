import activeSgVenues from '@/data/badminton-venues.json';
import overrideVenues from '@/data/venue-overrides.json';

export type Venue = {
  id: string;
  canonicalName: string;
  aliases?: string[];
  source: string;
  sourceUrl?: string;
  kind: string;
  area?: string;
  address?: string;
  zone?: string;
  lat: number;
  lng: number;
};

export type VenueMatch = {
  venue: Venue | null;
  status: 'deterministic' | 'ambiguous' | 'unmatched';
  alias?: string;
  candidates?: string[];
};

export const badmintonVenues: Venue[] = [...activeSgVenues, ...overrideVenues] as Venue[];

export function normalizeVenueText(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function aliasesFor(venue: Venue) {
  const aliases = new Set([venue.canonicalName, ...(venue.aliases ?? [])]);
  for (const alias of Array.from(aliases)) {
    if (alias.includes(' - ')) aliases.add(alias.split(' - ')[0]);
    if (venue.kind === 'sport_hall') aliases.add(alias.replace(/\s+sports? hall\b/ig, ''));
    if (/^Our\s+/i.test(alias)) aliases.add(alias.replace(/^Our\s+/i, ''));
    aliases.add(alias.replace(/\s+hall\b/ig, ''));
    aliases.add(alias.replace(/\bsports hall\b/ig, 'sport hall'));
    aliases.add(alias.replace(/\bsport hall\b/ig, 'sports hall'));
    aliases.add(alias.replace(/\bprimary school hall\b/ig, 'pri'));
    aliases.add(alias.replace(/\bsecondary school hall\b/ig, 'sec'));
    aliases.add(alias.replace(/\bprimary school\b/ig, 'pri'));
    aliases.add(alias.replace(/\bsecondary school\b/ig, 'sec'));
    aliases.add(alias.replace(/\bcommunity club\b/ig, 'cc'));
    aliases.add(alias.replace(/\bcc\b/ig, 'community club'));
  }
  return [...aliases].map(normalizeVenueText).filter((alias) => alias.length >= 4);
}

export function matchVenue(text: string, venues = badmintonVenues): VenueMatch {
  const normalizedText = normalizeVenueText(text);
  const hits: Array<{ venue: Venue; alias: string; length: number }> = [];
  for (const venue of venues) {
    for (const alias of aliasesFor(venue)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^| )${escaped}( |$)`, 'i').test(normalizedText)) hits.push({ venue, alias, length: alias.length });
    }
  }
  if (!hits.length) return { venue: null, status: 'unmatched' };
  hits.sort((a, b) => b.length - a.length);
  const top = hits.filter((hit) => hit.length === hits[0].length);
  const unique = [...new Map(top.map((hit) => [hit.venue.id, hit])).values()];
  if (unique.length !== 1) return { venue: null, status: 'ambiguous', candidates: unique.map((hit) => hit.venue.canonicalName) };
  return { venue: unique[0].venue, status: 'deterministic', alias: unique[0].alias };
}
