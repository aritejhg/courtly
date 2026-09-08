const SOURCE_URL = 'https://t.me/your_group_invite';

export const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const slugify = (value) => normalize(value).replace(/ /g, '-');
export const fingerprint = (value) => normalize(typeof value === 'string' ? value : (value.listingText || value.rawText || ''));

const singaporeDate = (year, month, day, hour = 0, minute = 0) => new Date(Date.UTC(year, month, day, hour - 8, minute));
const singaporeParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month - 1, day: value.day };
};

const AREA_HINTS = [
  ['anchor green', 'Punggol'], ['edgefield', 'Punggol'], ['gongshang', 'Hougang'], ['wellington', 'Sembawang'],
  ['cantonment', 'Outram'], ['yuhua', 'Jurong East'], ['ang mo kio', 'Ang Mo Kio'], ['amk ', 'Ang Mo Kio'],
  ['bukit gombak', 'Bukit Gombak'], ['clementi', 'Clementi'], ['jurong west', 'Jurong West'], ['tampines', 'Tampines'],
  ['east spring', 'Tampines'], ['loyang view', 'Pasir Ris'], ['dunman high', 'Kallang'], ['sengkang', 'Sengkang'],
  ['yishun', 'Yishun'], ['delta', 'River Valley'], ['toa payoh', 'Toa Payoh'], ['tpy ', 'Toa Payoh'],
];

export function expandedAliases(venue) {
  const aliases = new Set([venue.canonicalName, ...(venue.aliases || [])]);
  for (const alias of Array.from(aliases)) {
    // Telegram often writes a location-qualified venue as `Name (Location)`
    // when the catalog uses `Name @ Location`. Treat these as equivalent
    // aliases, without broad fuzzy matching or inferred venue data.
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
      // Treat it like the existing hall suffix normalization, but only for
      // verified sport-hall records.
      const withoutActiveSg = alias.replace(/\s+activesg\b/ig, '').trim();
      aliases.add(withoutActiveSg);
      aliases.add(withoutActiveSg.replace(/\s+sports? hall\b/ig, '').trim());
      // Verified venue initialisms are common in Telegram. Generate them
      // only from the canonical sport-hall name, and require at least three
      // letters so incidental short tokens cannot become venues.
      const nameWords = normalize(venue.canonicalName)
        .split(' ')
        .filter((word) => !['sport', 'sports', 'hall', 'activesg'].includes(word));
      if (nameWords.length >= 2) {
        const initials = nameWords.map((word) => word[0]).join('');
        aliases.add(initials);
        aliases.add(`${initials} Sport Hall`);
        aliases.add(`${initials} Sports Hall`);
      }
    }
    if (venue.kind === 'school_sport_hall') {
      // School-hall listings commonly abbreviate Government as `gov` and
      // omit the trailing `school hall` words (for example, `Bukit panjang
      // gov high`). Keep this scoped to verified school-hall records so the
      // shorthand cannot create broad fuzzy venue matches.
      aliases.add(alias.replace(/\bgovernment\b/ig, 'gov').replace(/\s+school hall\b/ig, '').trim());
      // Also accept the common compact form that drops only `school` or
      // `hall`, while retaining the verified school name and its location.
      aliases.add(alias.replace(/\bhigh school\b/ig, 'high').replace(/\s+hall\b/ig, '').trim());
      aliases.add(alias.replace(/\bgovernment\b/ig, 'gov').replace(/\bhigh school\b/ig, 'high').replace(/\s+hall\b/ig, '').trim());
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
  const initialWords = normalize(venue.canonicalName)
    .split(' ')
    .filter((word) => !['at', 'the', 'sport', 'sports', 'hall', 'activesg'].includes(word));
  if (initialWords.length >= 3) aliases.add(initialWords.map((word) => word[0]).join(''));
  // Preserve verified three-letter Telegram abbreviations (for example KFF).
  // Shorter aliases remain excluded to avoid matching incidental fragments.
  return [...aliases].map(normalize).filter((alias) => alias.length >= 3);
}

function catalogVenueMatch(text, venues, { exact = false } = {}) {
  const normalizedText = normalize(text);
  const stripListingMetadata = (line) => normalize(String(line)
    .replace(DATE_TOKEN, ' ')
    .replace(TIME_RANGE, ' ')
    .replace(/\$+\s*\d+(?:\.\d{1,2})?/g, ' ')
    .replace(/\b\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks?)\b/ig, ' ')
    .replace(/^(?:venue|location|place)\s*[:-]?\s*/, '')
    .replace(/[.,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim())
    .replace(/\b(?:today|tonight|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const strictCandidates = new Set([
    normalizedText,
    ...String(text).split(/\r?\n/).flatMap((line) => {
      const normalizedLine = normalize(line)
        .replace(/^(?:venue|location|place)\s*[:-]?\s*/, '')
        .replace(/[.,:;]+$/g, '')
        .trim();
      return [normalizedLine, stripListingMetadata(line)];
    }).filter(Boolean),
  ]);
  const directOwners = new Map();
  for (const venue of venues) {
    for (const directAlias of [venue.canonicalName, ...(venue.aliases || [])]) {
      const key = normalize(directAlias);
      const owners = directOwners.get(key) || new Set();
      owners.add(normalize(venue.canonicalName));
      directOwners.set(key, owners);
    }
  }
  const explicitlyCommunityClub = /\b(?:cc|community\s+(?:club|centre))\b/i.test(normalizedText)
    && !/\b(?:school|pri(?:mary)?|sec(?:ondary)?|sport(?:s)?\s*hall|sh)\b/i.test(normalizedText);
  const hits = [];
  for (const venue of venues) {
    // A bare sport-hall alias such as `Hougang` must not swallow an explicit
    // community-club listing such as `Hougang CC`. Keep uncertain venues
    // extracted instead of attaching the wrong coordinates.
    if (explicitlyCommunityClub && venue.kind !== 'community_club') continue;
    for (const alias of expandedAliases(venue)) {
      const owners = directOwners.get(alias);
      if (owners?.size && !owners.has(normalize(venue.canonicalName))) continue;
      // A verified alias is a strict key. Do not turn a known venue name into
      // a fuzzy match merely because it appears inside an unknown name.
      if (exact && !strictCandidates.has(alias)) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^| )${escaped}( |$)`, 'i').test(normalizedText)) hits.push({ venue, alias, length: alias.length });
    }
  }
  if (!hits.length) return { venue: null, status: 'unmatched' };
  hits.sort((a, b) => b.length - a.length);
  const top = hits.filter((hit) => hit.length === hits[0].length);
  const unique = [...new Map(top.map((hit) => [normalize(hit.venue.canonicalName), hit])).values()];
  if (unique.length !== 1) return { venue: null, status: 'ambiguous', candidates: unique.map((hit) => hit.venue.canonicalName) };
  return { venue: unique[0].venue, status: 'deterministic', alias: unique[0].alias };
}

const VENUE_LINE = /\b(?:cc|community\s+(?:club|centre)|sports?\s*hall|school\s*hall|pri(?:mary)?(?:\s+school)?|sec(?:ondary)?(?:\s+school)?|sh|clubhouse)\b/i;
const VENUE_BRAND = /\b(?:sbh|seh|kff|moe|sports?\s+arina|ace\s+the\s+place)\b/i;
const NON_VENUE_LINE = /\b(?:court\s+to|lett?ing|available|release|take\s*over|price|cost|date|time|today|tomorrow|pm\s+me|dm|whatsapp|interested|keen)\b/i;

function cleanVenueCandidate(line) {
  return String(line || '')
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}]*/u, '')
    .replace(/\bsports?hall\b/ig, (value) => value.toLowerCase().startsWith('sports') ? 'sports hall' : 'sport hall')
    // Compact Telegram shorthand often glues the venue type to the name
    // (`Kaki BukitCC`). Add the separator before candidate matching.
    .replace(/([a-z])(?=(?:cc|sbh|sh)\b)/ig, '$1 ')
    .replace(/^[\s📍*•-]*(?:venue|location|place)\s*[:：-]?\s*/iu, '')
    .replace(/^(?:court\s+(?:to\s+)?let(?:ting)?\s+go|let(?:ting)?\s+go(?:\s+of(?:\s+court)?)?|available\s+court|releasing?\s+at\s+cost)(?:\s+at\s+cost(?:\s+price)?)?\s*(?:at\s+)?[:：-]?\s*/i, '')
    .replace(/\s*\((?:near|beside|opp(?:osite)?|at)?[^)]*\b(?:mrt|lrt)\b[^)]*\)\s*/ig, ' ')
    .replace(/\s*\((?:premium|vip|rubber|aircon)[^)]*\)\s*/ig, ' ')
    .replace(/^\s*\(\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours)\)\s*/i, ' ')
    .replace(/^\s*\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours)\)\s*/i, ' ')
    .replace(/\s+s\(\d+\)/ig, ' ')
    .replace(/\s+-\s+[^\n]*\b(?:mrt|lrt)\b.*$/i, '')
    .replace(/\s+-\s+(?:rubber|aircon)\b.*$/i, '')
    .replace(/\s+badminton\s+court\b.*$/i, '')
    .replace(/\s+court(?:\s+\d+)?\b.*$/i, '')
    .replace(/[.,:;-]+$/g, '')
    .replace(/^\s*(?:today|tonight|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractVenueCandidates(text) {
  const candidates = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    // Dates, times and prices are reliable separators in compact one-line
    // listings. Splitting on them isolates the venue without venue-specific
    // message exceptions.
    const separated = String(rawLine)
      .replace(DATE_TOKEN, '\n')
      .replace(TIME_RANGE, '\n')
      .replace(/\$+\s*\d+(?:\.\d{1,2})?/g, '\n')
      .replace(/\b\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks?)\b/ig, '\n');
    const fragments = separated.split(/\n/);
    const branded = String(rawLine).match(/\b(?:(?:sbh|kff)\s+[@a-z][a-z-]*|moe|oth)\b/ig) || [];
    for (const fragment of [...fragments, ...branded]) {
      const line = cleanVenueCandidate(fragment);
      if (!line || NON_VENUE_LINE.test(line)) continue;
      if (VENUE_LINE.test(line) || VENUE_BRAND.test(line) || /^oth$/i.test(line)) candidates.push(line);
    }
  }
  return [...new Set(candidates.map((candidate) => candidate.trim()))];
}

function provisionalVenue(candidate) {
  const canonicalName = candidate
    .replace(/\bcc\b/ig, 'CC')
    .replace(/\bsbh\b/ig, 'SBH')
    .replace(/\bkff\b/ig, 'KFF')
    .replace(/\bmoe\b/ig, 'MOE')
    .replace(/\bsh\b/ig, 'Sport Hall')
    .replace(/\bpri\b/ig, 'Primary')
    .replace(/\bsec\b/ig, 'Secondary')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedName = normalize(canonicalName);
  return {
    id: `telegram:${slugify(normalizedName)}`,
    canonicalName,
    aliases: [candidate],
    kind: /\bcommunity (?:club|centre)|\bcc\b/i.test(candidate) ? 'community_club'
      : /\bschool|\bpri(?:mary)?\b|\bsec(?:ondary)?\b/i.test(candidate) ? 'school_sport_hall'
        : /\bsports? hall\b/i.test(candidate) ? 'sport_hall' : 'other',
    area: inferArea(candidate),
    provisional: true,
  };
}

export function matchVenue(text, venues) {
  const candidates = extractVenueCandidates(text);
  if (candidates.length === 1) {
    const exact = catalogVenueMatch(candidates[0], venues, { exact: true });
    if (exact.venue) return exact;
    return { venue: provisionalVenue(candidates[0]), status: 'extracted', alias: normalize(candidates[0]) };
  }
  // Multi-listing messages are split before building listings. At this stage
  // only an exact whole-text alias may resolve; never attach a coordinate to a
  // venue found as a substring of a different candidate.
  if (!candidates.length) return catalogVenueMatch(text, venues, { exact: true });
  const exactMatches = candidates.map((candidate) => catalogVenueMatch(candidate, venues, { exact: true }));
  const resolved = [...new Map(exactMatches.filter((match) => match.venue).map((match) => [normalize(match.venue.canonicalName), match.venue])).values()];
  if (resolved.length === 1) return { venue: resolved[0], status: 'deterministic', alias: exactMatches.find((match) => match.venue)?.alias };
  if (resolved.length > 1) return { venue: null, status: 'ambiguous', candidates: resolved.map((venue) => venue.canonicalName) };
  return { venue: null, status: 'unmatched' };
}

export function parsePrice(text) {
  const dollar = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollar) return { value: Number(dollar[1]), status: 'deterministic', source: dollar[0] };
  const sgd = text.match(/\b(?:sgd|s\$)\s*(\d+(?:\.\d{1,2})?)\b/i);
  if (sgd) return { value: Number(sgd[1]), status: 'deterministic', source: sgd[0] };
  const words = text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)\b/i);
  if (words) return { value: Number(words[1]), status: 'deterministic', source: words[0] };
  const looksLikePrice = /(?:\$|s\$|sgd|dollars?|bucks?|(?:price|cost)\s*(?:is|:|=))\s*\d/i.test(text);
  return { value: null, status: looksLikePrice ? 'ambiguous' : 'missing' };
}

export function inferArea(text, venue) {
  if (venue?.area) return venue.area;
  const haystack = normalize(`${venue?.canonicalName || ''} ${text}`);
  return AREA_HINTS.find(([hint]) => haystack.includes(normalize(hint)))?.[1] || 'Singapore';
}

const MONTH_TOKEN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_TOKEN = new RegExp(`(?<![\\d.])\\b(?:today|tonight|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\\d{1,2}(?:st|nd|rd|th)?(?:\\s*(?:/|-)\\s*\\d{1,2}|\\s*-?\\s*(?:${MONTH_TOKEN})))\\b`, 'i');
// Telegram listings sometimes abbreviate PM as a trailing `m` (for example,
// `9-10m`). Accept it only inside a clock expression.
const TIME_RANGE = /(?<![\d.])\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm|m)?\s*(?:-|–|—|to)\s*((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm|m)?\b/i;
const NUMERIC_DATE = /(?<![:\d])\b(\d{1,2})\s*(?:\/|-)\s*(\d{1,2})(?:\s*(?:\/|-)\s*(\d{2,4}))?\b/g;

function isDateLine(value) {
  const text = String(value || '');
  const numericCandidates = [...text.matchAll(NUMERIC_DATE)];
  const timeRanges = [...text.matchAll(new RegExp(TIME_RANGE.source, 'ig'))];
  const hasNonNumericDate = DATE_TOKEN.test(text.replace(NUMERIC_DATE, ' '));
  if (hasNonNumericDate) return true;
  return numericCandidates.some((candidate) => {
    const start = candidate.index ?? 0;
    const end = start + candidate[0].length;
    return !timeRanges.some((range) => {
      const rangeStart = range.index ?? 0;
      const rangeEnd = rangeStart + range[0].length;
      return start < rangeEnd && end > rangeStart;
    });
  });
}

function isValidCalendarDate(year, month, day) {
  const value = singaporeDate(year, month, day, 12);
  const parts = singaporeParts(value);
  return parts.year === year && parts.month === month && parts.day === day;
}

export function parseDate(text, postedAt) {
  const posted = new Date(postedAt);
  const postedParts = singaporeParts(posted);
  const year = postedParts.year;
  const numericCandidates = [...String(text).matchAll(NUMERIC_DATE)];
  const timeRanges = [...String(text).matchAll(new RegExp(TIME_RANGE.source, 'ig'))];
  const numeric = numericCandidates.find((candidate) => {
    if (candidate[3]) return true;
    const start = candidate.index ?? 0;
    const end = start + candidate[0].length;
    const overlapsTimeRange = timeRanges.some((range) => {
      const rangeStart = range.index ?? 0;
      const rangeEnd = rangeStart + range[0].length;
      return start < rangeEnd && end > rangeStart;
    });
    const hasExplicitClockRangeElsewhere = timeRanges.some((range) => {
      const rangeStart = range.index ?? 0;
      const rangeEnd = rangeStart + range[0].length;
      return !(start < rangeEnd && end > rangeStart)
        && (range[2] || range[4] || /[:.]/.test(`${range[1]}${range[3]}`));
    });
    return !overlapsTimeRange || hasExplicitClockRangeElsewhere;
  });
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*-?\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i);
  const weekdayMatch = text.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  let date;
  if (named) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].findIndex((value) => named[2].toLowerCase().startsWith(value));
    const day = Number(named[1]);
    if (!isValidCalendarDate(year, month, day)) return { value: null, status: 'ambiguous', reason: 'invalid calendar date' };
    date = singaporeDate(year, month, day, 12);
  } else if (numeric) {
    const explicitYear = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : year;
    const month = Number(numeric[2]) - 1;
    const day = Number(numeric[1]);
    if (!isValidCalendarDate(explicitYear, month, day)) return { value: null, status: 'ambiguous', reason: 'invalid calendar date' };
    date = singaporeDate(explicitYear, month, day, 12);
  } else if (/\btomorrow\b/i.test(text)) {
    date = new Date(singaporeDate(postedParts.year, postedParts.month, postedParts.day, 12).getTime() + 86400000);
  } else if (/\b(?:today|tonight)\b/i.test(text)) {
    date = singaporeDate(postedParts.year, postedParts.month, postedParts.day, 12);
  } else if (weekdayMatch) {
    const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekdayMatch[1].slice(0, 3).toLowerCase());
    const postedDay = singaporeDate(postedParts.year, postedParts.month, postedParts.day, 12);
    const current = postedDay.getUTCDay();
    const delta = (target - current + 7) % 7;
    date = new Date(postedDay.getTime() + delta * 86400000);
  }
  if (!date || Number.isNaN(date.getTime())) return { value: null, status: 'missing' };
  if (!numeric?.[3] && date < singaporeDate(postedParts.year, postedParts.month, postedParts.day) && posted.getTime() - date.getTime() > 180 * 86400000) {
    const parts = singaporeParts(date);
    date = singaporeDate(parts.year + 1, parts.month, parts.day, 12);
  }
  const weekday = weekdayMatch?.[1]?.slice(0, 3).toLowerCase();
  const actualWeekday = date.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short' }).slice(0, 3).toLowerCase();
  // Explicit calendar dates are stronger than a mistyped weekday label.
  // Keep the mismatch as metadata, but do not discard an otherwise exact date.
  const explicitDate = Boolean(named || numeric || /\b(?:today|tonight|tomorrow)\b/i.test(text));
  return { value: date, status: explicitDate || !weekday || weekday === actualWeekday ? 'deterministic' : 'ambiguous', weekday, actualWeekday };
}

function parseClock(value) {
  if (value.includes(':') || value.includes('.')) return value.split(/[:.]/).map(Number);
  return value.length > 2 ? [Number(value.slice(0, -2)), Number(value.slice(-2))] : [Number(value), 0];
}

function isValidClock(value, meridiem) {
  const [hour, minute] = parseClock(value);
  return Number.isInteger(hour)
    && Number.isInteger(minute)
    && minute >= 0
    && minute <= 59
    && hour >= (meridiem ? 1 : 0)
    && hour <= (meridiem ? 12 : 23);
}

function to24(hour, meridiem) {
  if (!meridiem && hour >= 12) return hour;
  let value = Number(hour) % 12;
  if (meridiem?.toLowerCase() === 'pm') value += 12;
  return value;
}

export function parseTime(text, date, { defaultMeridiem = null } = {}) {
  if (!date) return { value: null, status: 'missing' };
  // Numeric dates such as `10-09-26` also satisfy TIME_RANGE (`10-09`).
  // Mask date tokens before scanning for a clock range so the date cannot
  // steal the match from the actual time later in the message.
  const sourceText = String(text || '');
  const sourceRanges = [...sourceText.matchAll(new RegExp(TIME_RANGE.source, 'ig'))];
  const timeText = sourceText.replace(NUMERIC_DATE, (value, _day, _month, explicitYear, offset) => {
    if (explicitYear) return ' '.repeat(value.length);
    const hasExplicitClockRangeElsewhere = sourceRanges.some((range) => {
      const rangeStart = range.index ?? 0;
      const rangeEnd = rangeStart + range[0].length;
      return !(offset < rangeEnd && offset + value.length > rangeStart)
        && (range[2] || range[4] || /[:.]/.test(`${range[1]}${range[3]}`));
    });
    return hasExplicitClockRangeElsewhere ? ' '.repeat(value.length) : value;
  });
  const match = timeText.match(TIME_RANGE);
  const parts = singaporeParts(date);
  const formatTime = (value) => value.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' });
  const makeStart = (value, meridiem) => {
    const [hour, minute] = parseClock(value);
    return singaporeDate(parts.year, parts.month, parts.day, to24(hour, meridiem), minute);
  };
  const makeResult = (start, end, status = 'deterministic', reason) => {
    const hours = Math.round((end - start) / 3600000 * 10) / 10;
    return { value: { start, end, display: `${formatTime(start)}–${formatTime(end)}`, duration: `${hours} ${hours === 1 ? 'hour' : 'hours'}`, hours }, status, reason };
  };
  if (!match) {
    const single = timeText.match(/\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)\b/i);
    const duration = timeText.match(/\b(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
    if (!single || !duration) return { value: null, status: 'missing' };
    if (!isValidClock(single[1], single[2])) return { value: null, status: 'ambiguous', reason: 'invalid clock value' };
    const start = makeStart(single[1], single[2]);
    return makeResult(start, new Date(start.getTime() + Number(duration[1]) * 3600000));
  }
  const [, startValue, startMeridiemValue, endValue, endMeridiemValue] = match;
  const normalizeMeridiem = (value) => value?.toLowerCase() === 'm' ? 'pm' : value?.toLowerCase();
  let startMeridiem = normalizeMeridiem(startMeridiemValue);
  let endMeridiem = normalizeMeridiem(endMeridiemValue);
  if (!isValidClock(startValue, startMeridiem) || !isValidClock(endValue, endMeridiem)) {
    return { value: null, status: 'ambiguous', reason: 'invalid clock value' };
  }
  const [startHour] = parseClock(startValue);
  const [endHour] = parseClock(endValue);
  let status = 'deterministic';
  let reason;
  if (!startMeridiem && endMeridiem) {
    startMeridiem = endMeridiem;
    if (endMeridiem === 'pm' && startHour > endHour && startHour !== 12) startMeridiem = 'am';
    if (endMeridiem === 'am' && startHour > endHour && endHour !== 12) startMeridiem = 'pm';
  } else if (startMeridiem && !endMeridiem) {
    endMeridiem = startMeridiem;
    if (startMeridiem === 'am' && endHour < startHour) endMeridiem = 'pm';
  } else if (!startMeridiem && !endMeridiem && startHour <= 12 && endHour <= 12) {
    if (defaultMeridiem) {
      startMeridiem = defaultMeridiem;
      endMeridiem = defaultMeridiem;
    } else {
      status = 'ambiguous';
      reason = 'time range has no am/pm marker';
    }
  }
  const start = makeStart(startValue, startMeridiem);
  let end = makeStart(endValue, endMeridiem);
  if (end <= start) end = new Date(end.getTime() + 12 * 3600000);
  const result = makeResult(start, end, status, reason);
  if (result.value.hours <= 0 || result.value.hours > 8) return { ...result, status: 'ambiguous', reason: 'implausible court duration' };
  return result;
}

function availabilitySection(text) {
  let value = String(text || '').trim();
  const have = value.match(/\bi\s+have\s*:\s*/i);
  const need = value.match(/\bi\s+need\s*:\s*/i);
  if (/\bcourt\s+to\s+swap\b/i.test(value) && have) {
    const end = need && need.index > have.index ? need.index : value.length;
    value = value.slice(have.index + have[0].length, end).trim();
  }
  const wanted = value.search(/\b(?:looking for|need(?:ing)?|wanted)\b/i);
  const available = value.search(/\b(?:court\s+to\s+let\s+go|letting\s+go|let\s+go|available\s+court)\b/i);
  if (wanted >= 0 && available > wanted) value = value.slice(available).trim();
  const swapFooter = value.search(/\b(?:will\s+)?prioriti[sz]e\b[^\n]*\b(?:swap|exchange)\b/i);
  if (swapFooter >= 0) value = value.slice(0, swapFooter).trim();
  return value;
}

export function isIgnoredSwapMessage(text) {
  const value = String(text || '');
  const hasSwapIntent = /\b(?:swap(?:ping)?|exchange)\b/i.test(value)
    || /\bi\s+have\b[\s\S]*\bi\s+(?:need|want)\b/i.test(value);
  const hasReleaseIntent = /\b(?:let(?:ting)?\s+go|releas(?:e|ing)|available\s+courts?|take\s+over|at\s+(?:cost|original\s+price))\b/i.test(value);
  return hasSwapIntent && !hasReleaseIntent;
}

function isLocationQualifierLine(line) {
  return /^\s*[([]?\s*(?:near|beside|opp(?:osite)?|at)?[^\n]*\b(?:mrt|lrt)\b/i.test(String(line || ''));
}

function venueOnLine(line, venues) {
  return isLocationQualifierLine(line) ? null : matchVenue(line, venues).venue;
}

export function isPotentialCourtMessage(text, venues) {
  if (isIgnoredSwapMessage(text)) return false;
  const value = availabilitySection(text);
  const wantedOnly = /\b(?:looking for|need(?:ing)?|wanted)\b/i.test(value) && !/\b(?:let(?:ting)?\s+go|court\s+to\s+swap|i\s+have|available)\b/i.test(value);
  if (wantedOnly) return false;
  const hasVenue = Boolean(matchVenue(value, venues).venue) || /\b(?:cc|community club|sports? hall|primary|secondary|pri|sec)\b/i.test(value);
  const hasTime = TIME_RANGE.test(value) || /\b\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours)\b/i.test(value);
  const hasDate = isDateLine(value);
  const hasIntent = /\b(?:let(?:ting)?\s+go|court\s+to\s+swap|court\s+available|take\s+over|at\s+cost)\b/i.test(value);
  return (hasVenue || hasIntent) && hasTime && (hasDate || hasIntent);
}

export function countVenueMentions(text, venues) {
  return availabilitySection(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => Boolean(venueOnLine(line, venues))).length;
}

export function splitMessageListings(message, venues) {
  if (Array.isArray(message.listings) && message.listings.length) return message.listings.map((part) => ({ text: String(part.text || '').trim() })).filter((part) => part.text);
  const text = availabilitySection(message.text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const timeIndexes = lines.flatMap((line, index) => TIME_RANGE.test(line) ? [index] : []);
  const venueIndexes = lines.flatMap((line, index) => venueOnLine(line, venues) ? [index] : []);
  if (timeIndexes.length > venueIndexes.length && timeIndexes.length > 1) {
    let carriedDateLine;
    return timeIndexes.map((timeIndex, position) => {
      const segmentStart = position ? timeIndexes[position - 1] + 1 : 0;
      const segmentEnd = position + 1 < timeIndexes.length ? timeIndexes[position + 1] - 1 : lines.length - 1;
      const nextDateIndex = lines.findIndex((line, index) => index > timeIndex && index <= segmentEnd && isDateLine(line));
      const postTimeEnd = nextDateIndex >= 0 ? nextDateIndex - 1 : segmentEnd;
      const selected = [
        ...lines.slice(segmentStart, timeIndex + 1),
        ...lines.slice(timeIndex + 1, postTimeEnd + 1),
      ];
      const dateBeforeTime = lines.slice(segmentStart, timeIndex + 1).findLast((line) => isDateLine(line));
      if (dateBeforeTime) carriedDateLine = dateBeforeTime;
      if (carriedDateLine && !selected.some((line) => isDateLine(line))) {
        selected.unshift(carriedDateLine);
      }
      return { text: selected.join('\n') };
    });
  }
  if (venueIndexes.length <= 1) return [{ text }];
  const nearest = (anchor, start, end, predicate) => {
    const indexes = [];
    for (let index = start; index <= end; index += 1) if (predicate(lines[index])) indexes.push(index);
    return indexes.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || (a > anchor) - (b > anchor))[0];
  };
  const direction = (predicate) => {
    const index = nearest(venueIndexes[0], 0, lines.length - 1, predicate);
    return index !== undefined && index < venueIndexes[0] ? 'before' : 'after';
  };
  const dateDirection = direction(isDateLine);
  const timeDirection = direction((line) => TIME_RANGE.test(line));
  const priceDirection = direction((line) => parsePrice(line).value != null);
  const directed = (anchor, previousVenue, nextVenue, predicate, preferredDirection) => {
    const start = preferredDirection === 'before' ? previousVenue + 1 : anchor;
    const end = preferredDirection === 'before' ? anchor : nextVenue - 1;
    const candidates = [];
    for (let index = start; index <= end; index += 1) if (predicate(lines[index])) candidates.push(index);
    if (candidates.length) return preferredDirection === 'before' ? candidates.at(-1) : candidates[0];
    if (preferredDirection === 'before') {
      for (let index = anchor; index >= 0; index -= 1) if (predicate(lines[index])) return index;
    }
    return nearest(anchor, previousVenue + 1, nextVenue - 1, predicate);
  };
  const parts = venueIndexes.map((venueIndex, position) => {
    const previousVenue = venueIndexes[position - 1] ?? -1;
    const nextVenue = venueIndexes[position + 1] ?? lines.length;
    const selected = new Set([venueIndex]);
    const dateIndex = directed(venueIndex, previousVenue, nextVenue, isDateLine, dateDirection);
    const timeIndex = directed(venueIndex, previousVenue, nextVenue, (line) => TIME_RANGE.test(line), timeDirection);
    const priceIndex = directed(venueIndex, previousVenue, nextVenue, (line) => parsePrice(line).value != null, priceDirection);
    for (const index of [dateIndex, timeIndex, priceIndex]) if (index !== undefined) selected.add(index);
    return { text: [...selected].sort((a, b) => a - b).map((index) => lines[index]).join('\n') };
  });
  return parts;
}

export function buildListing(message, venues, { now = new Date(), listingText = message.text, listingIndex = 0, partCount = 1 } = {}) {
  const postedAt = message.postedAt || now.toISOString();
  const sourceRawText = String(message.text || '').trim();
  const rawText = String(listingText || '').trim();
  const venueMatch = matchVenue(rawText, venues);
  const date = parseDate(rawText, postedAt);
  const localRange = rawText.match(TIME_RANGE);
  const sourceRanges = [...sourceRawText.matchAll(new RegExp(TIME_RANGE.source, 'ig'))];
  const sourceMeridiems = [...new Set(sourceRanges.flatMap((match) => [match[2], match[4]])
    .filter(Boolean).map((value) => value.toLowerCase() === 'm' ? 'pm' : value.toLowerCase()))];
  const startHour = localRange ? parseClock(localRange[1])[0] : null;
  const contextualMeridiem = sourceMeridiems.length === 1 ? sourceMeridiems[0]
    : venueMatch.venue && startHour != null && startHour <= 6 ? 'pm' : null;
  const time = parseTime(rawText, date.value, {
    // Telegram sport-hall listings commonly omit meridiem for short
    // afternoon/evening slots. Apply the project convention only after a
    // verified sport-hall venue match; context-free times stay ambiguous.
    defaultMeridiem: contextualMeridiem,
  });
  const price = parsePrice(rawText);
  const playAt = time.value?.start || date.value;
  const isDeleted = Boolean(message.deleted || /\b(taken|gone|claimed|deleted|no longer available)\b/i.test(rawText));
  const listing = {
    id: `tg-${message.messageId}${partCount > 1 ? `-${listingIndex + 1}` : ''}-${slugify(venueMatch.venue?.canonicalName || 'unmatched')}`,
    facility: venueMatch.venue?.canonicalName || 'Unmatched venue',
    area: inferArea(rawText, venueMatch.venue),
    sport: /tennis/i.test(rawText) ? 'Tennis' : /basketball|hoops/i.test(rawText) ? 'Basketball' : 'Badminton',
    playAt: playAt?.toISOString() || new Date(0).toISOString(),
    playEndAt: time.value?.end?.toISOString() || playAt?.toISOString() || new Date(0).toISOString(),
    postedAt,
    status: isDeleted ? 'deleted' : playAt && playAt > now ? 'active' : 'expired',
    ...(isDeleted ? { deletedAt: now.toISOString() } : {}),
    sourceMessageId: `${message.messageId}${partCount > 1 ? `:${listingIndex + 1}` : ''}`,
    sourceTelegramMessageId: String(message.messageId),
    ...(partCount > 1 ? { listingIndex: listingIndex + 1 } : {}),
    sourceUrl: message.sourceUrl || SOURCE_URL,
    rawText: sourceRawText,
    listingText: rawText,
    sourceRawText,
    displayDate: date.value ? date.value.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown',
    displayDay: date.value ? date.value.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long' }) : 'Day unknown',
    displayTime: time.value?.display || 'Time unknown',
    duration: time.value?.duration || 'Unknown',
    price: price.value,
    owner: message.owner || 'Telegram member',
    ...(message.ownerUsername ? { ownerUsername: message.ownerUsername } : {}),
    ...(venueMatch.venue?.lat != null && venueMatch.venue?.lng != null
      ? { lat: venueMatch.venue.lat, lng: venueMatch.venue.lng }
      : {}),
    venueId: venueMatch.venue?.id,
    venueMatch: venueMatch.status,
  };
  const issues = [];
  if (venueMatch.status !== 'deterministic') {
    issues.push({ field: 'venue', kind: venueMatch.status, venueId: venueMatch.venue?.id, candidates: venueMatch.candidates || [] });
  }
  if (date.status !== 'deterministic') issues.push({ field: 'date', kind: date.status, expectedWeekday: date.weekday, actualWeekday: date.actualWeekday });
  if (time.status !== 'deterministic') issues.push({ field: 'time', kind: time.status, reason: time.reason });
  if (price.status === 'ambiguous') issues.push({ field: 'price', kind: 'ambiguous' });
  return { listing, venueMatch, issues };
}
