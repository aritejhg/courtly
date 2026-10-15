import type { CourtListing } from './ingestion';
import { matchesListingDateTime, singaporeDateKey } from './listing-filters.ts';

// Every area name the venue catalog and parser produce, grouped by URA region (Serangoon kept in East as before).
export const AREA_REGIONS: Record<string, string[]> = {
  Central: [
    'River Valley', 'Outram', 'Tiong Bahru', 'Tanjong Pagar', 'Toa Payoh', 'Kallang', 'Kolam Ayer', 'Newton',
    'Bukit Merah', 'Telok Blangah', 'Mount Faber', 'Henderson', 'Queenstown', 'Holland Drive', 'Ghim Moh',
    'Geylang', 'Macpherson', 'Potong Pasir', 'Bidadari', 'Thomson', 'Marymount',
  ],
  East: ['East', 'Expo', 'Tampines', 'Pasir Ris', 'Serangoon', 'Bedok', 'Bedok North', 'Siglap', 'Simei'],
  North: ['Hougang', 'Punggol', 'Yishun', 'Woodlands', 'Sembawang', 'Ang Mo Kio', 'Sengkang', 'Bukit Canberra'],
  West: ['Jurong West', 'Jurong East', 'Bukit Gombak', 'Bukit Batok', 'Bukit Panjang', 'Choa Chu Kang', 'Tengah', 'Clementi'],
};

const KNOWN_AREAS = new Set(Object.values(AREA_REGIONS).flat());

/** A known area decides its region; otherwise (e.g. area "Singapore") the venue catalog zone does. */
export function inRegion(region: string, area: string, zone?: string) {
  if (KNOWN_AREAS.has(area)) return AREA_REGIONS[region]?.includes(area) ?? false;
  return (zone === 'Northeast' ? 'North' : zone) === region;
}

export type NumberRange = { min?: number; max?: number; minInclusive: boolean; maxInclusive: boolean; label: string };
type Bucket<T> = { include: T[]; exclude: T[] };

export type ParsedSearch = {
  terms: Bucket<string>;
  venue: Bucket<string>;
  area: Bucket<string>;
  by: Bucket<string>;
  date: Bucket<string>;
  price: Bucket<NumberRange>;
  dur: Bucket<NumberRange>;
  from?: string;
  to?: string;
  notFrom?: string;
  notTo?: string;
  hasKeys: boolean;
  summary: string[];
  notes: string[];
};

export type SearchableListing = Pick<
  CourtListing,
  'facility' | 'owner' | 'ownerUsername' | 'price' | 'duration' | 'playAt' | 'playEndAt'
> & { name: string; area: string; zone?: string };

const KEYS = new Set(['venue', 'area', 'by', 'date', 'price', 'dur', 'from', 'to']);
const KEY_ALIASES: Record<string, string> = { duration: 'dur' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 24 * 60 * 60 * 1000;

const bucket = <T>(): Bucket<T> => ({ include: [], exclude: [] });
const pad = (value: number) => String(value).padStart(2, '0');

type SearchKey = 'venue' | 'area' | 'by' | 'date' | 'price' | 'dur' | 'from' | 'to';

function keyOf(token: string): SearchKey | undefined {
  const match = /^-?([a-z]+):/i.exec(token);
  if (!match) return undefined;
  const key = match[1].toLowerCase();
  const canonical = KEY_ALIASES[key] ?? key;
  return KEYS.has(canonical) ? (canonical as SearchKey) : undefined;
}

export function parseClock(input: string) {
  const value = input.toLowerCase().replace(/\s+/g, '').replace(/([ap])\.m\.?$/, '$1m');
  if (value === 'noon') return '12:00';
  if (value === 'midnight') return '00:00';
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm)?$/.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (match[3] === 'pm' ? 12 : 0);
  }
  // 24:00 is end of day, which the matcher already reads from 00:00.
  if (hours === 24 && minutes === 0 && !match[3]) return '00:00';
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

function dateKey(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

// Year accepts any digit count so a half-typed or mistyped year ("31 feb 202") is consumed and reported, not left as free text.
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]{3,})\.?(?:,?\s*(\d+))?$/;
const MONTH_DAY = /^([a-z]{3,})\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d+))?$/;
// Parsing needs a separator before the year so "oct 2026" is not read as 20 Oct '26.
const MONTH_DAY_STRICT = /^([a-z]{3,})\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:(?:,\s*|\s+)(\d+))?$/;
const monthOf = (word: string) => MONTHS.findIndex((name) => name.startsWith(word)) + 1;
/** A month-name date with no year yet, so a following ", 2027" can attach to it. */
function monthDateWithoutYear(input: string) {
  const value = input.toLowerCase().trim();
  const dayMonth = DAY_MONTH.exec(value);
  const monthDay = MONTH_DAY_STRICT.exec(value);
  return Boolean((dayMonth && monthOf(dayMonth[2]) && !dayMonth[3]) || (monthDay && monthOf(monthDay[1]) && !monthDay[3]));
}
/** Shape only (not validity), so "31 feb" is consumed whole and reported, not split into free text. */
function looksLikeMonthDate(input: string) {
  const value = input.toLowerCase().trim();
  // Month-ish: a prefix of a month being typed ("fe") or a misspelling sharing its first 3 letters ("februarry").
  const monthish = (word: string) =>
    MONTHS.some((name) => name.startsWith(word) || (word.length >= 3 && name.startsWith(word.slice(0, 3))));
  const dayMonth = /^(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)\.?(?:,?\s*\d+)?$/.exec(value);
  const monthDay = /^([a-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*\d+)?$/.exec(value);
  return Boolean((dayMonth && monthish(dayMonth[2])) || (monthDay && monthish(monthDay[1])));
}

/** Returns Singapore date keys (YYYY-MM-DD) for a date expression, or null when invalid. */
export function parseDates(input: string, now: Date): string[] | null {
  // "this sat" = the coming Saturday (today included); "next sat" skips today's.
  const lowered = input.toLowerCase().trim();
  const skipToday = /^next\s+/.test(lowered);
  const value = lowered.replace(/^(next|this)\s+/, '');
  const today = singaporeDateKey(now);
  if (value === 'today') return [today];
  if (value === 'tomorrow' || value === 'tmr') return [addDays(today, 1)];
  const [year, month, day] = today.split('-').map(Number);
  const todayWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const nextWeekday = (target: number) => addDays(today, (target - todayWeekday + 7) % 7 || (skipToday ? 7 : 0));
  if (value === 'weekend') {
    const inWeekend = todayWeekday === 0 || todayWeekday === 6;
    const saturday = addDays(today, (todayWeekday === 0 ? -1 : 6 - todayWeekday) + (skipToday && inWeekend ? 7 : 0));
    return [saturday, addDays(saturday, 1)];
  }
  if (value.length >= 3) {
    const weekday = WEEKDAYS.findIndex((name) => name.startsWith(value));
    if (weekday >= 0) return [nextWeekday(weekday)];
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const key = dateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return key ? [key] : null;
  }
  // Day-first numbers (10/10, 9-10-26) or month names the way cards show dates (10 Oct, Oct 10, 10 Oct 2026).
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(value);
  const dayMonth = DAY_MONTH.exec(value);
  const monthDay = MONTH_DAY_STRICT.exec(value);
  const [parsedDay, parsedMonth, yearText] = numeric
    ? [Number(numeric[1]), Number(numeric[2]), numeric[3]]
    : dayMonth
      ? [Number(dayMonth[1]), monthOf(dayMonth[2]), dayMonth[3]]
      : monthDay
        ? [Number(monthDay[2]), monthOf(monthDay[1]), monthDay[3]]
        : [0, 0, undefined];
  if (!parsedMonth) return null;
  if (yearText) {
    if (yearText.length !== 2 && yearText.length !== 4) return null;
    const parsedYear = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const key = dateKey(parsedYear, parsedMonth, parsedDay);
    // A past explicit year is almost always a half-typed one (10 oct 20 -> 2026): report it, don't filter.
    return key && key >= today ? [key] : null;
  }
  const thisYear = dateKey(year, parsedMonth, parsedDay);
  if (thisYear && thisYear >= today) return [thisYear];
  const nextYear = dateKey(year + 1, parsedMonth, parsedDay);
  return nextYear ? [nextYear] : null;
}

/** Duration in minutes: "2h", "2", "1.5 hours", "90m", "1h30m". Bare numbers are hours. */
export function parseDurationMinutes(input: string) {
  const value = input.toLowerCase().replace(/\s+/g, '');
  const combined = /^(\d+(?:\.\d+)?)(h|hrs?|hours?)?(?:(\d+)(?:m|mins?|minutes?)?)?$/.exec(value);
  if (combined && (combined[3] === undefined || combined[2])) {
    const exact = Number(combined[1]) * 60 + Number(combined[3] ?? 0);
    // Snap float noise from decimal hours (2.05h -> 122.99999999999999) to the whole minute.
    const minutes = Math.abs(exact - Math.round(exact)) < 1e-6 ? Math.round(exact) : exact;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }
  const minutesOnly = /^(\d+)(?:m|min|mins|minute|minutes)$/.exec(value);
  if (minutesOnly && Number.isFinite(Number(minutesOnly[1])) && Number(minutesOnly[1]) > 0) return Number(minutesOnly[1]);
  return null;
}

const parsePrice = (input: string) => {
  const value = input.replace(/^\$/, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

// Two decimals for cents, but never round away precision the user typed ($7.4005 stays $7.4005).
const formatPrice = (value: number) =>
  `$${Number.isInteger(value) ? value : Number(value.toFixed(2)) === value ? value.toFixed(2) : value}`;
const formatDuration = (minutes: number) =>
  minutes % 60 ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60}m` : `${minutes / 60}h`;

function parseRange(
  input: string,
  parseValue: (value: string) => number | null,
  format: (value: number) => string,
): NumberRange | null {
  const value = input.replace(/\s+/g, '');
  const comparison = /^(<=|>=|<|>|=)(.+)$/.exec(value);
  if (comparison) {
    const amount = parseValue(comparison[2]);
    if (amount === null) return null;
    const operator = comparison[1];
    if (operator === '=') return { min: amount, max: amount, minInclusive: true, maxInclusive: true, label: format(amount) };
    if (operator.startsWith('<')) {
      return { max: amount, minInclusive: true, maxInclusive: operator === '<=', label: `${operator.replace('<=', '≤')} ${format(amount)}` };
    }
    return { min: amount, minInclusive: operator === '>=', maxInclusive: true, label: `${operator.replace('>=', '≥')} ${format(amount)}` };
  }
  const between = /^([^-]+)-([^-]+)$/.exec(value);
  if (between) {
    const low = parseValue(between[1]);
    const high = parseValue(between[2]);
    if (low === null || high === null) return null;
    const [min, max] = low <= high ? [low, high] : [high, low];
    return { min, max, minInclusive: true, maxInclusive: true, label: `${format(min)}–${format(max)}` };
  }
  const exact = parseValue(value);
  if (exact === null) return null;
  return { min: exact, max: exact, minInclusive: true, maxInclusive: true, label: format(exact) };
}

function inRange(value: number | null | undefined, range: NumberRange) {
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  if (range.min !== undefined && (range.minInclusive ? value < range.min : value <= range.min)) return false;
  if (range.max !== undefined && (range.maxInclusive ? value > range.max : value >= range.max)) return false;
  return true;
}

const foldApostrophes = (value: string) => value.replace(/[‘’‛′]/g, "'");

/** Splits on whitespace while keeping quoted runs (closed or still being typed) inside one token. */
function tokenize(input: string) {
  return input.match(/(?:[^\s"]+|"[^"]*(?:"|$))+/g) ?? [];
}

export function parseSearchQuery(input: string, now: Date): ParsedSearch {
  const parsed: ParsedSearch = {
    terms: bucket(),
    venue: bucket(),
    area: bucket(),
    by: bucket(),
    date: bucket(),
    price: bucket(),
    dur: bucket(),
    hasKeys: false,
    summary: [],
    notes: [],
  };
  const normalized = foldApostrophes(input.replace(/[“”„‟″〃]/g, '"'));
  const tokens = tokenize(normalized);
  const addUnique = <T>(list: T[], value: T, same: (a: T, b: T) => boolean) => {
    if (!list.some((existing) => same(existing, value))) list.push(value);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let negate = token.length > 1 && token.startsWith('-');
    const body = negate ? token.slice(1) : token;
    const key = keyOf(body);

    if (!key) {
      const unknownKey = /^([a-z]+):./i.exec(body);
      if (unknownKey && !/^[a-z]+:\/\//i.test(body)) {
        parsed.notes.push(`"${unknownKey[1].toLowerCase()}:" is not a filter (use venue area by date from to price dur), searched as text`);
      }
      const term = body.replace(/"/g, '').trim().toLowerCase();
      if (!term || term === '-') continue;
      const target = negate ? parsed.terms.exclude : parsed.terms.include;
      addUnique(target, term, (a, b) => a === b);
      continue;
    }

    let rawValue = body.slice(body.indexOf(':') + 1);
    // "venue: shelton" takes the next word; "area: -east" reads as -area:east.
    if (!rawValue && index + 1 < tokens.length && !keyOf(tokens[index + 1])) {
      index += 1;
      rawValue = tokens[index];
    }
    // "area:-east" and "area: -east" both read as -area:east.
    // List keys handle "-" per value below (venue:-a,b excludes only a); others flip the whole key.
    const listKey = key === 'venue' || key === 'area' || key === 'by' || key === 'date';
    if (!listKey && rawValue.length > 1 && rawValue.startsWith('-') && !((key === 'price' || key === 'dur') && /^-\$?\d/.test(rawValue))) {
      negate = !negate;
      rawValue = rawValue.slice(1);
    }
    // A lone "-" is a negation still being typed (area:-), not a value.
    if (rawValue.trim() === '-') continue;
    // Values typed with spaces continue into the next word when it is clearly part of the value:
    // lists (area:east, west), dates (date:10 oct), times/units (from:7 pm, dur:1 hour, 2 hours),
    // and operators/ranges (price:< 10, > 30, price:20 - 30).
    const numeric = key === 'from' || key === 'to' || key === 'price' || key === 'dur';
    const continues = (next: string) => {
      if (rawValue.endsWith(',')) return true;
      const lastValue = rawValue.slice(rawValue.lastIndexOf(',') + 1).trim().replace(/^-/, '');
      if (next.startsWith(',')) return true;
      // Only the part of the next word before its first comma decides: "oct,11" -> "oct".
      const head = next.split(',')[0];
      if (key === 'date') return /^(next|this)$/i.test(lastValue) || looksLikeMonthDate(`${lastValue} ${head}`);
      if (!numeric) return false;
      // Times only take a trailing am/pm: from:7 pm. Anything else (e.g. -24) is a separate term.
      if (key === 'from' || key === 'to') return /^\d{1,2}([:.]?\d{2})?$/.test(lastValue) && /^[ap]\.?m\.?$/i.test(head);
      // Unfinished operator or range: price:< 30, price:20 - 30.
      if (/[<>=-]$/.test(lastValue)) return true;
      // A bare amount can start a range with the next word (price:20 -30, dur:1h -2h), but a finished
      // range or comparison cannot, so price:20-30 -40 keeps -40 as an exclusion.
      const bareAmount = key === 'dur'
        ? parseDurationMinutes(lastValue) !== null
        : /^\$?\d+(\.\d+)?$/.test(lastValue);
      if (bareAmount && (head === '-' || /^-\$?\d/.test(head))) return true;
      if (key === 'dur' && /\d$/.test(lastValue) && /^(h|hrs?|hours?|m|mins?|minutes?)$/i.test(head)) return true;
      // Minutes after hours: dur:1h 30m, dur:1 hour 30 min.
      return key === 'dur' && /(h|hrs?|hours?)$/i.test(lastValue) && /^\d{1,3}(m|mins?|minutes?)?$/i.test(head);
    };
    while (index + 1 < tokens.length && !keyOf(tokens[index + 1]) && continues(tokens[index + 1])) {
      index += 1;
      rawValue += ` ${tokens[index]}`;
    }
    // Commas split values only outside quotes: venue:"a, b",c -> ["a, b", "c"].
    const values = (rawValue.match(/(?:"[^"]*"?|[^,"])+/g) ?? [])
      .map((value) => value.replace(/"/g, '').trim())
      .filter(Boolean)
      // "Oct 10, 2027": a year on its own after a comma belongs to the date before it.
      .reduce<string[]>((list, value) => {
        if (key === 'date' && list.length && /^\d{4}$/.test(value) && monthDateWithoutYear(list[list.length - 1].replace(/^-/, ''))) list[list.length - 1] += ` ${value}`;
        else list.push(value);
        return list;
      }, []);
    if (!values.length) continue;
    parsed.hasKeys = true;

    if (key === 'from' || key === 'to') {
      const field = negate ? (key === 'from' ? 'notFrom' : 'notTo') : key;
      // One time per key: invalid values are skipped, the last valid one wins.
      for (const value of values) {
        const clock = parseClock(value);
        if (!clock) {
          parsed.notes.push(`${key}: "${value}" is not a time, ignored`);
          continue;
        }
        if (parsed[field] && parsed[field] !== clock) parsed.notes.push(`${key}: takes one time, using ${clock}`);
        parsed[field] = clock;
      }
      continue;
    }

    for (const listed of values) {
      // Per-value exclusion inside a list: area:east,-bedok.
      const flip = listKey && listed.startsWith('-');
      const value = flip ? listed.slice(1).trim() : listed;
      if (!value) continue;
      const exclude = flip ? !negate : negate;
      if (key === 'venue' || key === 'area' || key === 'by') {
        const normalizedValue = (key === 'by' ? value.replace(/^@/, '') : value).toLowerCase();
        if (!normalizedValue) continue;
        addUnique(exclude ? parsed[key].exclude : parsed[key].include, normalizedValue, (a, b) => a === b);
      } else if (key === 'date') {
        const dates = parseDates(value, now);
        if (!dates) {
          parsed.notes.push(`date: "${value}" is not a date, ignored`);
          continue;
        }
        for (const date of dates) addUnique(exclude ? parsed.date.exclude : parsed.date.include, date, (a, b) => a === b);
      } else {
        const range = key === 'price'
          ? parseRange(value, parsePrice, formatPrice)
          : parseRange(value, parseDurationMinutes, formatDuration);
        if (!range) {
          parsed.notes.push(`${key}: "${value}" not understood, ignored`);
          continue;
        }
        addUnique(negate ? parsed[key].exclude : parsed[key].include, range, (a, b) =>
          a.min === b.min && a.max === b.max && a.minInclusive === b.minInclusive && a.maxInclusive === b.maxInclusive);
      }
    }
  }

  const describe = (label: string, { include, exclude }: Bucket<string | NumberRange>, joiner = ' or ') => {
    const text = (value: string | NumberRange) => (typeof value === 'string' ? value : value.label);
    if (include.length) parsed.summary.push(`${label} ${include.map(text).join(joiner)}`);
    if (exclude.length) parsed.summary.push(`not ${label} ${exclude.map(text).join(' or ')}`);
  };
  describe('venue', parsed.venue);
  describe('area', parsed.area);
  describe('by', parsed.by);
  describe('date', parsed.date);
  const timeRange = (from?: string, to?: string) => `${from ?? '00:00'}–${!to || to === '00:00' ? '24:00' : to}`;
  if (parsed.from || parsed.to) parsed.summary.push(`time ${timeRange(parsed.from, parsed.to)}`);
  if (parsed.notFrom || parsed.notTo) parsed.summary.push(`not time ${timeRange(parsed.notFrom, parsed.notTo)}`);
  describe('price', parsed.price);
  describe('duration', parsed.dur);
  if (parsed.hasKeys) describe('text', parsed.terms, ' and ');
  parsed.notes = [...new Set(parsed.notes)];
  return parsed;
}

function listingDurationMinutes(listing: SearchableListing) {
  // Timestamps first: display text is rounded ("1.3 hours" for 75 minutes).
  const start = Date.parse(listing.playAt);
  const end = Date.parse(listing.playEndAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Math.round((end - start) / 60000);
  return parseDurationMinutes(listing.duration);
}

// The catalog's Northeast zone is folded into North, so accept that name too.
const regionFor = (value: string) => {
  const name = value.replace(/^north[\s-]?east$/, 'north');
  return Object.keys(AREA_REGIONS).find((region) => region.toLowerCase() === name);
};

function passes<T>({ include, exclude }: Bucket<T>, matches: (value: T) => boolean) {
  return (!include.length || include.some(matches)) && !exclude.some(matches);
}

export function matchesSearchQuery(listing: SearchableListing, parsed: ParsedSearch) {
  const fold = (value: string) => foldApostrophes(value).toLowerCase();
  const text = fold(`${listing.name} ${listing.area}`);
  // Match each field on its own so a phrase can't span two fields.
  const venues = [fold(listing.name), fold(listing.facility)];
  const area = fold(listing.area);
  const owners = [fold(listing.owner), fold(listing.ownerUsername?.replace(/^@/, '') ?? '')];
  const window = { startTime: parsed.from, endTime: parsed.to };
  // Free-text words all have to match (AND), unlike keyed values (OR).
  if (!parsed.terms.include.every((term) => text.includes(term))) return false;
  if (parsed.terms.exclude.some((term) => text.includes(term))) return false;
  if (!passes(parsed.venue, (value) => venues.some((field) => field.includes(value)))) return false;
  if (!passes(parsed.area, (value) => {
    const region = regionFor(value);
    return region ? inRegion(region, listing.area, listing.zone) : area.includes(value);
  })) return false;
  if (!passes(parsed.by, (value) => owners.some((field) => field.includes(value)))) return false;
  if (!passes(parsed.price, (range) => inRange(listing.price, range))) return false;
  const duration = listingDurationMinutes(listing);
  if (!passes(parsed.dur, (range) => inRange(duration, range))) return false;
  if ((parsed.notFrom || parsed.notTo) && matchesListingDateTime(listing, { startTime: parsed.notFrom, endTime: parsed.notTo })) return false;
  // Exclude by the day a game starts (the day its card shows), so -date:sun keeps a Sat 23:00-01:00 game.
  if (parsed.date.exclude.includes(singaporeDateKey(listing.playAt))) return false;
  if (parsed.date.include.length) {
    return parsed.date.include.some((date) => matchesListingDateTime(listing, { date, ...window }));
  }
  return parsed.from || parsed.to ? matchesListingDateTime(listing, window) : true;
}
