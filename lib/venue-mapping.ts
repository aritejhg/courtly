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
  lat?: number;
  lng?: number;
};

export type VenueMatch = {
  venue: Venue | null;
  status: 'deterministic' | 'ambiguous' | 'unmatched';
  alias?: string;
  candidates?: string[];
};

export const badmintonVenues: Venue[] = [...activeSgVenues, ...overrideVenues] as Venue[];

const AREA_HINTS: Array<[string, string]> = [
  ['anchor green', 'Punggol'], ['edgefield', 'Punggol'], ['gongshang', 'Hougang'], ['wellington', 'Sembawang'],
  ['cantonment', 'Outram'], ['yuhua', 'Jurong East'], ['ang mo kio', 'Ang Mo Kio'], ['amk ', 'Ang Mo Kio'],
  ['bukit gombak', 'Bukit Gombak'], ['clementi', 'Clementi'], ['jurong west', 'Jurong West'], ['tampines', 'Tampines'],
  ['east spring', 'Tampines'], ['loyang view', 'Pasir Ris'], ['dunman high', 'Kallang'], ['sengkang', 'Sengkang'],
  ['yishun', 'Yishun'], ['delta', 'River Valley'], ['toa payoh', 'Toa Payoh'], ['tpy ', 'Toa Payoh'],
];

export function normalizeVenueText(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function inferVenueArea(text: string, venue?: Venue | null) {
  if (venue?.area) return venue.area;
  const haystack = normalizeVenueText(`${venue?.canonicalName ?? ''} ${text}`);
  return AREA_HINTS.find(([hint]) => haystack.includes(normalizeVenueText(hint)))?.[1];
}

function aliasesFor(venue: Venue) {
  const aliases = new Set([venue.canonicalName, ...(venue.aliases ?? [])]);
  for (const alias of Array.from(aliases)) {
    // Telegram often writes a location-qualified venue as `Name (Location)`
    // when the catalog uses `Name @ Location`.
    const atLocation = alias.match(/^(.*?)\s*@\s*(.+)$/);
    if (atLocation) aliases.add(`${atLocation[1]} (${atLocation[2]})`);
    const parenthesizedLocation = alias.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (parenthesizedLocation) aliases.add(`${parenthesizedLocation[1]} @ ${parenthesizedLocation[2]}`);
    if (alias.includes(' - ')) {
      const short = alias.split(' - ')[0];
      aliases.add(short);
      if (/^Our\s+/i.test(short)) aliases.add(short.replace(/^Our\s+/i, ''));
    }
    if (venue.kind === 'sport_hall') {
      const base = alias.replace(/\s+sports? hall\b/ig, '').trim();
      aliases.add(base);
      aliases.add(`${base} SH`);
      // Telegram shorthand commonly omits the ActiveSG source-brand suffix.
      if (/\s+activesg\b/i.test(alias)) {
        const withoutActiveSg = alias.replace(/\s+activesg\b/ig, '').trim();
        aliases.add(withoutActiveSg);
        aliases.add(withoutActiveSg.replace(/\s+sports? hall\b/ig, '').trim());
      }
      const nameWords = normalizeVenueText(venue.canonicalName)
        .split(' ')
        .filter((word) => !['sport', 'sports', 'hall', 'activesg'].includes(word));
      if (nameWords.length >= 2) {
        const initials = nameWords.map((word) => word[0]).join('');
        aliases.add(`${initials} Sport Hall`);
        aliases.add(`${initials} Sports Hall`);
      }
    }
    if (/^Our\s+/i.test(alias)) aliases.add(alias.replace(/^Our\s+/i, ''));
    if (/^Ang Mo Kio\b/i.test(alias)) aliases.add(alias.replace(/^Ang Mo Kio/i, 'AMK'));
    aliases.add(alias.replace(/\s+hall\b/ig, ''));
    aliases.add(alias.replace(/\bsports hall\b/ig, 'sport hall'));
    aliases.add(alias.replace(/\bsport hall\b/ig, 'sports hall'));
    aliases.add(alias.replace(/\bprimary school hall\b/ig, 'pri'));
    aliases.add(alias.replace(/\bsecondary school hall\b/ig, 'sec'));
    aliases.add(alias.replace(/\s+primary school hall\b/ig, ' primary'));
    aliases.add(alias.replace(/\s+secondary school hall\b/ig, ' secondary'));
    aliases.add(alias.replace(/\bprimary school\b/ig, 'pri'));
    aliases.add(alias.replace(/\bsecondary school\b/ig, 'sec'));
    aliases.add(alias.replace(/\bcommunity club\b/ig, 'cc'));
    aliases.add(alias.replace(/\bcc\b/ig, 'community club'));
  }
  // Preserve verified three-letter Telegram abbreviations (for example KFF).
  return [...aliases].map(normalizeVenueText).filter((alias) => alias.length >= 3);
}

export function matchVenue(text: string, venues = badmintonVenues): VenueMatch {
  const normalizedText = normalizeVenueText(text);
  const stripListingMetadata = (value: string) => value
    .replace(/\b(?:today|tonight|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const strictCandidates = new Set([
    normalizedText,
    ...text.split(/\r?\n/).map((line) => normalizeVenueText(line)
      .replace(/^(?:venue|location|place)\s*[:-]?\s*/i, '')
      .replace(/[.,:;]+$/g, '')
      .trim())
      .filter(Boolean),
    ...text.split(/\r?\n/).map((line) => stripListingMetadata(normalizeVenueText(line)
      .replace(/^(?:venue|location|place)\s*[:-]?\s*/i, '')))
      .filter(Boolean),
  ]);
  const directOwners = new Map<string, Set<string>>();
  for (const venue of venues) {
    for (const directAlias of [venue.canonicalName, ...(venue.aliases ?? [])]) {
      const key = normalizeVenueText(directAlias);
      const owners = directOwners.get(key) ?? new Set<string>();
      owners.add(normalizeVenueText(venue.canonicalName));
      directOwners.set(key, owners);
    }
  }
  const explicitlyCommunityClub = /\b(?:cc|community\s+(?:club|centre))\b/i.test(normalizedText)
    && !/\b(?:school|pri(?:mary)?|sec(?:ondary)?|sport(?:s)?\s*hall|sh)\b/i.test(normalizedText);
  const hits: Array<{ venue: Venue; alias: string; length: number }> = [];
  for (const venue of venues) {
    // Do not let a broad sport-hall alias (for example `Hougang`) match an
    // explicit community-club listing (`Hougang CC`) and attach wrong coords.
    if (explicitlyCommunityClub && venue.kind !== 'community_club') continue;
    for (const alias of aliasesFor(venue)) {
      const owners = directOwners.get(alias);
      if (owners?.size && !owners.has(normalizeVenueText(venue.canonicalName))) continue;
      // A verified alias is a strict key. Do not match a known venue as a
      // substring of an unknown venue name.
      if (strictCandidates.has(alias)) hits.push({ venue, alias, length: alias.length });
    }
  }
  if (!hits.length) return { venue: null, status: 'unmatched' };
  hits.sort((a, b) => b.length - a.length);
  const top = hits.filter((hit) => hit.length === hits[0].length);
  const unique = [...new Map(top.map((hit) => [hit.venue.id, hit])).values()];
  if (unique.length !== 1) return { venue: null, status: 'ambiguous', candidates: unique.map((hit) => hit.venue.canonicalName) };
  return { venue: unique[0].venue, status: 'deterministic', alias: unique[0].alias };
}
