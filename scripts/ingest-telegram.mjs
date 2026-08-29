import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_URL = 'https://t.me/your_group_invite';
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const messagesPath = resolve(argument('--messages', 'data/telegram-messages.json'));
const venuesPath = resolve(argument('--venues', 'data/badminton-venues.json'));
const outputPath = resolve(argument('--output', 'data/telegram-listings.json'));
const unmatchedPath = resolve(argument('--unmatched', 'data/unmatched-venue-candidates.json'));
const now = new Date(process.env.INGEST_NOW || Date.now());

const normalize = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } };
const slugify = (value) => normalize(value).replace(/ /g, '-');
const fingerprint = (value) => normalize(value);
const singaporeDate = (year, month, day, hour = 0, minute = 0) => new Date(Date.UTC(year, month, day, hour - 8, minute));
const singaporeParts = (date) => ({ year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() });
const AREA_HINTS = [
  ['anchor green', 'Punggol'], ['edgefield', 'Punggol'], ['gongshang', 'Hougang'], ['wellington', 'Sembawang'],
  ['cantonment', 'Outram'], ['yuhua', 'Jurong East'], ['ang mo kio', 'Ang Mo Kio'], ['amk ', 'Ang Mo Kio'],
  ['bukit gombak', 'Bukit Gombak'], ['clementi', 'Clementi'], ['jurong west', 'Jurong West'], ['tampines', 'Tampines'],
  ['east spring', 'Tampines'], ['loyang view', 'Pasir Ris'], ['dunman high', 'Kallang'], ['sengkang', 'Sengkang'],
  ['yishun', 'Yishun'], ['delta', 'River Valley'], ['toa payoh', 'Toa Payoh'], ['tpy ', 'Toa Payoh'],
];

function expandedAliases(venue) {
  const aliases = new Set([venue.canonicalName, ...(venue.aliases || [])]);
  for (const alias of Array.from(aliases)) {
    if (alias.includes(' - ')) {
      const short = alias.split(' - ')[0];
      aliases.add(short);
      if (/^Our\s+/i.test(short)) aliases.add(short.replace(/^Our\s+/i, ''));
    }
    if (venue.kind === 'sport_hall') aliases.add(alias.replace(/\s+sports? hall\b/ig, ''));
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

function matchVenue(text, venues) {
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
  const unique = [...new Map(top.map((hit) => [hit.venue.id, hit])).values()];
  if (unique.length !== 1) return { venue: null, status: 'ambiguous', candidates: unique.map((hit) => hit.venue.canonicalName) };
  return { venue: unique[0].venue, status: 'deterministic', alias: unique[0].alias };
}

function parsePrice(text) {
  const match = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function inferArea(text, venue) {
  if (venue?.area) return venue.area;
  const haystack = normalize(`${venue?.canonicalName || ''} ${text}`);
  return AREA_HINTS.find(([hint]) => haystack.includes(normalize(hint)))?.[1] || 'Singapore';
}

function parseDate(text, postedAt) {
  const posted = new Date(postedAt);
  const year = posted.getFullYear();
  const numeric = text.match(/\b(\d{1,2})\s*(?:\/|-)\s*(\d{1,2})(?:\s*(?:\/|-)\s*(\d{2,4}))?\b/);
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+|-)(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i);
  let date;
  if (numeric) {
    const explicitYear = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : year;
    date = singaporeDate(explicitYear, Number(numeric[2]) - 1, Number(numeric[1]), 12);
  }
  else if (named) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].findIndex((value) => named[2].toLowerCase().startsWith(value));
    date = singaporeDate(year, month, Number(named[1]), 12);
  } else if (/\btomorrow\b/i.test(text)) {
    const parts = singaporeParts(posted); date = new Date(singaporeDate(parts.year, parts.month, parts.day, 12).getTime() + 86400000);
  } else if (/\btoday\b/i.test(text)) {
    const parts = singaporeParts(posted); date = singaporeDate(parts.year, parts.month, parts.day, 12);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const postedParts = singaporeParts(posted);
  if (!numeric?.[3] && date < singaporeDate(postedParts.year, postedParts.month, postedParts.day)) {
    const parts = singaporeParts(date); date = singaporeDate(parts.year + 1, parts.month, parts.day, 12);
  }
  return date;
}

function parseTime(text, date) {
  const match = text.match(/\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)?\s*(?:-|–|—|to)\s*((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)?\b/i);
  if (!date) return null;
  const parseClock = (value) => value.includes(':') || value.includes('.') ? value.split(/[:.]/).map(Number) : value.length > 2 ? [Number(value.slice(0, -2)), Number(value.slice(-2))] : [Number(value), 0];
  const to24 = (hour, meridiem) => { let value = Number(hour) % 12; if (meridiem?.toLowerCase() === 'pm') value += 12; return value; };
  const parts = singaporeParts(date);
  const formatTime = (value) => value.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' });
  const makeStart = (value, meridiem) => { const [hour, minute] = parseClock(value); return singaporeDate(parts.year, parts.month, parts.day, to24(hour, meridiem), minute); };
  const makeResult = (start, end) => {
    const hours = Math.round((end - start) / 3600000 * 10) / 10;
    return { start, end, display: `${formatTime(start)}–${formatTime(end)}`, duration: `${hours} ${hours === 1 ? 'hour' : 'hours'}` };
  };
  if (!match) {
    const single = text.match(/\b((?:\d{3,4})|(?:\d{1,2}(?:(?::|\.)\d{2})?))\s*(am|pm)\b/i);
    const duration = text.match(/\b(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
    if (!single || !duration) return null;
    const start = makeStart(single[1], single[2]);
    return makeResult(start, new Date(start.getTime() + Number(duration[1]) * 3600000));
  }
  const [, startValue, startMeridiemValue, endValue, endMeridiemValue] = match;
  let startMeridiem = startMeridiemValue;
  let endMeridiem = endMeridiemValue;
  startMeridiem ||= endMeridiem; endMeridiem ||= startMeridiem;
  const start = makeStart(startValue, startMeridiem);
  let end = makeStart(endValue, endMeridiem);
  if (end <= start) end = new Date(end.getTime() + 12 * 3600000);
  return makeResult(start, end);
}

function buildListing(message, venues) {
  const postedAt = message.postedAt || now.toISOString();
  const rawText = String(message.text || '').trim();
  const venueMatch = matchVenue(rawText, venues);
  const date = parseDate(rawText, postedAt);
  const time = parseTime(rawText, date);
  const playAt = time?.start || date;
  const isDeleted = Boolean(message.deleted || /\b(taken|gone|claimed|deleted|no longer available)\b/i.test(rawText));
  const listing = {
    id: `tg-${message.messageId}-${slugify(venueMatch.venue?.canonicalName || 'unmatched')}`,
    facility: venueMatch.venue?.canonicalName || 'Unmatched venue',
    area: inferArea(rawText, venueMatch.venue),
    sport: /tennis/i.test(rawText) ? 'Tennis' : /basketball|hoops/i.test(rawText) ? 'Basketball' : 'Badminton',
    playAt: playAt?.toISOString() || new Date(0).toISOString(),
    postedAt,
    status: isDeleted ? 'deleted' : 'active',
    ...(isDeleted ? { deletedAt: now.toISOString() } : {}),
    sourceMessageId: String(message.messageId),
    sourceUrl: message.sourceUrl || SOURCE_URL,
    rawText,
    displayDate: date ? date.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown',
    displayDay: date ? date.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long' }) : 'Day unknown',
    displayTime: time?.display || 'Time unknown',
    duration: time?.duration || 'Unknown',
    price: parsePrice(rawText),
    owner: message.owner || 'Telegram member',
    lat: venueMatch.venue?.lat || 1.3521,
    lng: venueMatch.venue?.lng || 103.8198,
    venueId: venueMatch.venue?.id,
    venueMatch: venueMatch.status,
  };
  return { listing, venueMatch };
}

const [messages, activeSgVenues, overrides, previousListings, unmatched] = await Promise.all([
  readJson(messagesPath, []), readJson(venuesPath, []), readJson('data/venue-overrides.json', []), readJson(outputPath, []), readJson(unmatchedPath, []),
]);
const venues = [...activeSgVenues, ...overrides];
const results = messages.map((message) => buildListing(message, venues));
const byMessage = new Map(previousListings.map((listing) => [listing.sourceMessageId, listing]));
const byFingerprint = new Map(previousListings.map((listing) => [fingerprint(listing.rawText), listing]));
const currentUnmatched = [];
let newCount = 0; let duplicateCount = 0;
for (const { listing, venueMatch } of results) {
  if (byMessage.has(listing.sourceMessageId)) {
    byMessage.set(listing.sourceMessageId, listing);
    if (!venueMatch.venue) currentUnmatched.push({ text: listing.rawText, sourceMessageId: listing.sourceMessageId, status: venueMatch.status, candidates: venueMatch.candidates || [], firstSeenAt: now.toISOString() });
    continue;
  }
  if (byFingerprint.has(fingerprint(listing.rawText))) {
    duplicateCount += 1;
    continue;
  }
  newCount += 1;
  byMessage.set(listing.sourceMessageId, listing);
  byFingerprint.set(fingerprint(listing.rawText), listing);
  if (!venueMatch.venue) currentUnmatched.push({ text: listing.rawText, sourceMessageId: listing.sourceMessageId, status: venueMatch.status, candidates: venueMatch.candidates || [], firstSeenAt: now.toISOString() });
}
const currentMessageIds = new Set(results.map(({ listing }) => listing.sourceMessageId));
const retainedUnmatched = unmatched.filter((item) => !currentMessageIds.has(item.sourceMessageId));
const dedupedUnmatched = [...new Map([...retainedUnmatched, ...currentUnmatched].map((item) => [`${item.sourceMessageId}:${item.text}`, item])).values()];
const nextListings = [...byMessage.values()].sort((a, b) => new Date(a.playAt) - new Date(b.playAt));
const deletedCount = nextListings.filter((listing) => listing.status === 'deleted').length;
const expiredCount = nextListings.filter((listing) => listing.status === 'active' && new Date(listing.playAt) <= now).length;
await mkdir('data', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(nextListings, null, 2)}\n`);
await writeFile(unmatchedPath, `${JSON.stringify(dedupedUnmatched, null, 2)}\n`);
console.log(JSON.stringify({ messages: messages.length, new: newCount, active: nextListings.filter((l) => l.status === 'active' && new Date(l.playAt) > now).length, expired: expiredCount, deleted: deletedCount, duplicates: duplicateCount, unmatched: results.filter(({ venueMatch }) => !venueMatch.venue).length, venueCount: venues.length, output: outputPath }));
