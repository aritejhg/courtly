const singaporeDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
});
const singaporeTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function singaporeDateKey(value) {
  const parts = singaporeDateFormatter.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function singaporeMinutes(value) {
  const parts = singaporeTimeFormatter.formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return Number(fields.hour) * 60 + Number(fields.minute);
}

function clockMinutes(value) {
  if (!value) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

function singaporeDayStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), -8);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function matchesListingDateTime(listing, filter = {}) {
  if (!validTimestamp(listing.playAt)) return false;
  const requestedStart = clockMinutes(filter.startTime);
  const requestedEnd = clockMinutes(filter.endTime);
  if (requestedStart === null || requestedEnd === null) return false;
  const listingStart = new Date(listing.playAt).getTime();
  const listingEnd = validTimestamp(listing.playEndAt)
    ? new Date(listing.playEndAt).getTime()
    : listingStart + 1;
  if (!filter.date && !filter.startTime && !filter.endTime) return true;
  if (filter.date) {
    const dayStart = singaporeDayStart(filter.date);
    if (dayStart === null) return false;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    if (listingEnd <= dayStart || listingStart >= dayEnd) return false;
    if (!filter.startTime && !filter.endTime) return true;
    const windowStart = dayStart + (requestedStart ?? 0) * 60 * 1000;
    let windowEnd = dayStart + (requestedEnd ?? 24 * 60) * 60 * 1000;
    if (requestedStart != null && requestedEnd != null && windowEnd <= windowStart) windowEnd += 24 * 60 * 60 * 1000;
    return listingStart < windowEnd && listingEnd > windowStart;
  }
  const windowStart = requestedStart ?? 0;
  const windowEnd = requestedEnd ?? 24 * 60;
  const normalizedWindowEnd = requestedStart != null && requestedEnd != null && windowEnd <= windowStart
    ? windowEnd + 24 * 60
    : windowEnd;
  const start = singaporeMinutes(listing.playAt);
  const end = singaporeMinutes(listing.playEndAt);
  const normalizedEnd = end <= start ? end + 24 * 60 : end;
  return start < normalizedWindowEnd && normalizedEnd > windowStart;
}
