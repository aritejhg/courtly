/**
 * Canonical boundary for court-swap data.
 *
 * A Telegram bot/webhook can pass messages through ingestTelegramMessage().
 * The UI should only consume getActiveListings(), which applies deletion and
 * play-time expiry rules in one place.
 */

export type ListingStatus = 'active' | 'deleted';

export type CourtListing = {
  id: string;
  facility: string;
  area: string;
  sport: 'Badminton' | 'Tennis' | 'Basketball' | 'Other';
  playAt: string;
  postedAt: string;
  status: ListingStatus;
  deletedAt?: string;
  sourceMessageId: string;
  sourceUrl: string;
  rawText: string;
  displayDate: string;
  displayDay: string;
  displayTime: string;
  duration: string;
  price: number | null;
  owner: string;
  lat: number;
  lng: number;
};

export type TelegramMessage = {
  messageId: string | number;
  text: string;
  postedAt?: string;
  deleted?: boolean;
  sourceUrl?: string;
};

const SPORT_ALIASES: Array<[CourtListing['sport'], RegExp]> = [
  ['Badminton', /badminton|court\s*swap/i],
  ['Tennis', /tennis/i],
  ['Basketball', /basketball|hoops/i],
];

const AREA_NAMES = [
  'Queenstown', 'Tampines', 'Toa Payoh', 'Sembawang', 'Jurong West',
  'Kallang', 'Kolam Ayer', 'Bukit Canberra', 'Tiong Bahru', 'Woodlands', 'Pasir Ris',
];

export function inferSport(text: string): CourtListing['sport'] {
  return SPORT_ALIASES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'Other';
}

export function inferArea(text: string): string {
  return AREA_NAMES.find((area) => text.toLowerCase().includes(area.toLowerCase())) ?? 'Singapore';
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function inferFacility(text: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? 'Singapore court';
  return firstLine.replace(/^(court\s*(swap|to let go)|swap)[:\-\s]*/i, '').slice(0, 80);
}

/** Parse one Telegram message into the canonical listing format. */
export function ingestTelegramMessage(message: TelegramMessage, now = new Date()): CourtListing {
  const postedAt = message.postedAt ?? now.toISOString();
  const id = String(message.messageId);
  const rawText = message.text.trim();

  // The first usable version accepts ISO timestamps, which makes the webhook
  // deterministic. A production adapter can normalize Telegram's local date
  // strings before calling this function.
  const isoDate = rawText.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)\b/)?.[1];
  const playAt = isoDate ? new Date(isoDate).toISOString() : new Date(0).toISOString();
  const facility = inferFacility(rawText);

  return {
    id: `tg-${id}-${slugify(facility)}`,
    facility,
    area: inferArea(rawText),
    sport: inferSport(rawText),
    playAt,
    postedAt,
    status: message.deleted ? 'deleted' : 'active',
    deletedAt: message.deleted ? now.toISOString() : undefined,
    sourceMessageId: id,
    sourceUrl: message.sourceUrl ?? 'https://t.me/your_group_invite',
    rawText,
    displayDate: isoDate ? new Date(isoDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown',
    displayDay: isoDate ? new Date(isoDate).toLocaleDateString('en-SG', { weekday: 'long' }) : 'Day unknown',
    displayTime: isoDate ? new Date(isoDate).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }) : 'Time unknown',
    duration: 'Unknown',
    price: null,
    owner: 'Sample Owner',
    lat: 1.3521,
    lng: 103.8198,
  };
}

export function isListingActive(listing: CourtListing, now = new Date()) {
  return listing.status !== 'deleted' && !listing.deletedAt && new Date(listing.playAt).getTime() > now.getTime();
}

export function getActiveListings(listings: CourtListing[], now = new Date()) {
  return listings.filter((listing) => isListingActive(listing, now));
}

/** Apply a Telegram delete/update event without removing audit history. */
export function markListingDeleted(listing: CourtListing, deletedAt = new Date().toISOString()): CourtListing {
  return { ...listing, status: 'deleted', deletedAt };
}
