import type { CourtListing } from './ingestion';

export type ListingDateTimeFilter = {
  date?: string;
  startTime?: string;
  endTime?: string;
};

const singaporeDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const singaporeTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function singaporeDateKey(value: string | Date) {
  const parts = singaporeDateFormatter.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function singaporeMinutes(value: string) {
  const parts = singaporeTimeFormatter.formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return Number(fields.hour) * 60 + Number(fields.minute);
}

function clockMinutes(value: string | undefined) {
  if (!value) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function validTimestamp(value: string | undefined): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function singaporeDayStart(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), -8);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function matchesListingDateTime(
  listing: Pick<CourtListing, 'playAt' | 'playEndAt'>,
  filter: ListingDateTimeFilter,
) {
  if (!validTimestamp(listing.playAt)) return false;
  const requestedStart = clockMinutes(filter.startTime);
  const requestedEnd = clockMinutes(filter.endTime);
  if (requestedStart === null || requestedEnd === null) return false;
  const listingStart = new Date(listing.playAt).getTime();
  // A listing without a real end (missing or equal to its start) counts as a moment, not a full day.
  const listingEnd = Math.max(
    validTimestamp(listing.playEndAt) ? new Date(listing.playEndAt).getTime() : listingStart,
    listingStart + 1,
  );
  if (!filter.date && !filter.startTime && !filter.endTime) return true;
  if (filter.date) {
    const dayStart = singaporeDayStart(filter.date);
    if (dayStart === null) return false;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    if (listingEnd <= dayStart || listingStart >= dayEnd) return false;
    if (!filter.startTime && !filter.endTime) return true;
    const windowStart = dayStart + (requestedStart ?? 0) * 60 * 1000;
    // An end of 00:00 means end of day, not minute zero.
    let windowEnd = dayStart + (requestedEnd || 24 * 60) * 60 * 1000;
    const overnight = requestedStart != null && requestedEnd != null && windowEnd <= windowStart;
    if (overnight) windowEnd += 24 * 60 * 60 * 1000;
    if (listingStart < windowEnd && listingEnd > windowStart) return true;
    // Overnight windows also cover this date's early morning (the tail of the previous night's window).
    return overnight && listingStart < windowEnd - 24 * 60 * 60 * 1000 && listingEnd > windowStart - 24 * 60 * 60 * 1000;
  }
  const windowStart = requestedStart ?? 0;
  const windowEnd = requestedEnd || 24 * 60;
  const normalizedWindowEnd = requestedStart != null && requestedEnd != null && windowEnd <= windowStart
    ? windowEnd + 24 * 60
    : windowEnd;
  const start = singaporeMinutes(listing.playAt);
  const normalizedEnd = start + Math.max(1, Math.round((listingEnd - listingStart) / 60000));
  if (start < normalizedWindowEnd && normalizedEnd > windowStart) return true;
  // Midnight wrap on either side: compare the listing a day later (window crosses midnight)
  // and a day earlier (listing crosses midnight into an early-morning window).
  if (normalizedWindowEnd > 24 * 60 && start + 24 * 60 < normalizedWindowEnd && normalizedEnd + 24 * 60 > windowStart) return true;
  return normalizedEnd > 24 * 60 && start - 24 * 60 < normalizedWindowEnd && normalizedEnd - 24 * 60 > windowStart;
}
