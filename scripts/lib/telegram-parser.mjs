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
    if (alias.includes(' - ')) {
      const short = alias.split(' - ')[0];
      aliases.add(short);
      if (/^Our\s+/i.test(short)) aliases.add(short.replace(/^Our\s+/i, ''));
    }
    if (venue.kind === 'sport_hall') {
      const base = alias.replace(/\s+sports? hall\b/ig, '').trim();
      aliases.add(base);
      aliases.add(`${base} SH`);
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
  return [...aliases].map(normalize).filter((alias) => alias.length >= 4);
}

export function matchVenue(text, venues) {
  const normalizedText = normalize(text);
  const hits = [];
  for (const venue of venues) {
    for (const alias of expandedAliases(venue)) {
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

const DATE_TOKEN = /\b(?:today|tonight|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{1,2}(?:st|nd|rd|th)?\s*(?:\/|-|\s)\s*(?:\d{1,2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b/i;
const TIME_RANGE = /\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)?\s*(?:-|–|—|to)\s*((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)?\b/i;

export function parseDate(text, postedAt) {
  const posted = new Date(postedAt);
  const postedParts = singaporeParts(posted);
  const year = postedParts.year;
  const numeric = text.match(/(?<![:\d])\b(\d{1,2})\s*(?:\/|-)\s*(\d{1,2})(?:\s*(?:\/|-)\s*(\d{2,4}))?\b/);
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+|-)(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i);
  const weekdayMatch = text.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  let date;
  if (named) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].findIndex((value) => named[2].toLowerCase().startsWith(value));
    date = singaporeDate(year, month, Number(named[1]), 12);
  } else if (numeric) {
    const explicitYear = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : year;
    date = singaporeDate(explicitYear, Number(numeric[2]) - 1, Number(numeric[1]), 12);
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
  return { value: date, status: weekday && weekday !== actualWeekday ? 'ambiguous' : 'deterministic', weekday, actualWeekday };
}

function parseClock(value) {
  if (value.includes(':') || value.includes('.')) return value.split(/[:.]/).map(Number);
  return value.length > 2 ? [Number(value.slice(0, -2)), Number(value.slice(-2))] : [Number(value), 0];
}

function to24(hour, meridiem) {
  if (!meridiem && hour > 12) return hour;
  let value = Number(hour) % 12;
  if (meridiem?.toLowerCase() === 'pm') value += 12;
  return value;
}

export function parseTime(text, date) {
  if (!date) return { value: null, status: 'missing' };
  const match = text.match(TIME_RANGE);
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
    const single = text.match(/\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)\b/i);
    const duration = text.match(/\b(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
    if (!single || !duration) return { value: null, status: 'missing' };
    const start = makeStart(single[1], single[2]);
    return makeResult(start, new Date(start.getTime() + Number(duration[1]) * 3600000));
  }
  const [, startValue, startMeridiemValue, endValue, endMeridiemValue] = match;
  let startMeridiem = startMeridiemValue?.toLowerCase();
  let endMeridiem = endMeridiemValue?.toLowerCase();
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
    status = 'ambiguous';
    reason = 'time range has no am/pm marker';
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
  return value;
}

export function isPotentialCourtMessage(text, venues) {
  const value = availabilitySection(text);
  const wantedOnly = /\b(?:looking for|need(?:ing)?|wanted)\b/i.test(value) && !/\b(?:let(?:ting)?\s+go|court\s+to\s+swap|i\s+have|available)\b/i.test(value);
  if (wantedOnly) return false;
  const hasVenue = Boolean(matchVenue(value, venues).venue) || /\b(?:cc|community club|sports? hall|primary|secondary|pri|sec)\b/i.test(value);
  const hasTime = TIME_RANGE.test(value) || /\b\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours)\b/i.test(value);
  const hasDate = DATE_TOKEN.test(value);
  const hasIntent = /\b(?:let(?:ting)?\s+go|court\s+to\s+swap|court\s+available|take\s+over|at\s+cost)\b/i.test(value);
  return (hasVenue || hasIntent) && hasTime && (hasDate || hasIntent);
}

export function countVenueMentions(text, venues) {
  return availabilitySection(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => Boolean(matchVenue(line, venues).venue)).length;
}

export function splitMessageListings(message, venues) {
  if (Array.isArray(message.listings) && message.listings.length) return message.listings.map((part) => ({ text: String(part.text || '').trim() })).filter((part) => part.text);
  const text = availabilitySection(message.text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const venueIndexes = lines.flatMap((line, index) => matchVenue(line, venues).venue ? [index] : []);
  if (venueIndexes.length <= 1) return [{ text }];
  const parts = [];
  let currentDate = '';
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hasDate = DATE_TOKEN.test(line);
    const hasVenue = Boolean(matchVenue(line, venues).venue);
    if (hasDate && !hasVenue && current && TIME_RANGE.test(current.join('\n'))) {
      parts.push({ text: current.join('\n') });
      current = null;
    }
    if (hasDate) currentDate = line;
    if (hasVenue) {
      if (current) parts.push({ text: current.join('\n') });
      current = currentDate && currentDate !== line ? [currentDate, line] : [line];
    } else if (current && line !== currentDate) {
      current.push(line);
    }
  }
  if (current) parts.push({ text: current.join('\n') });
  return parts.length === venueIndexes.length ? parts : [{ text }];
}

export function buildListing(message, venues, { now = new Date(), listingText = message.text, listingIndex = 0, partCount = 1 } = {}) {
  const postedAt = message.postedAt || now.toISOString();
  const sourceRawText = String(message.text || '').trim();
  const rawText = String(listingText || '').trim();
  const venueMatch = matchVenue(rawText, venues);
  const date = parseDate(rawText, postedAt);
  const time = parseTime(rawText, date.value);
  const price = parsePrice(rawText);
  const playAt = time.value?.start || date.value;
  const isDeleted = Boolean(message.deleted || /\b(taken|gone|claimed|deleted|no longer available)\b/i.test(rawText));
  const listing = {
    id: `tg-${message.messageId}${partCount > 1 ? `-${listingIndex + 1}` : ''}-${slugify(venueMatch.venue?.canonicalName || 'unmatched')}`,
    facility: venueMatch.venue?.canonicalName || 'Unmatched venue',
    area: inferArea(rawText, venueMatch.venue),
    sport: /tennis/i.test(rawText) ? 'Tennis' : /basketball|hoops/i.test(rawText) ? 'Basketball' : 'Badminton',
    playAt: playAt?.toISOString() || new Date(0).toISOString(),
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
    lat: venueMatch.venue?.lat || 1.3521,
    lng: venueMatch.venue?.lng || 103.8198,
    venueId: venueMatch.venue?.id,
    venueMatch: venueMatch.status,
  };
  const issues = [];
  if (!venueMatch.venue) issues.push({ field: 'venue', kind: venueMatch.status, candidates: venueMatch.candidates || [] });
  if (date.status !== 'deterministic') issues.push({ field: 'date', kind: date.status, expectedWeekday: date.weekday, actualWeekday: date.actualWeekday });
  if (time.status !== 'deterministic') issues.push({ field: 'time', kind: time.status, reason: time.reason });
  if (price.status === 'ambiguous') issues.push({ field: 'price', kind: 'ambiguous' });
  return { listing, venueMatch, issues };
}
