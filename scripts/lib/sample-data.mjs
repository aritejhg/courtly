// Checked-in data/telegram-*.json files are invented sample data for development
// and CI. Every record carries this source URL so it can never pass as a live feed.
export const SAMPLE_SOURCE_URL = 'https://t.me/your_group_invite';

// The exact records in the checked-in sample files. test/sample-data-init.test.mjs
// fails if these drift from the files, so a sample change cannot go unnoticed.
const SAMPLE_MESSAGE_IDS = Array.from({ length: 12 }, (_, index) => String(1001 + index));
const SAMPLE_LISTING_IDS = [
  'tg-1001-queenstown-cc',
  'tg-1002-delta-sport-hall',
  'tg-1003-geylang-serai-cc',
  'tg-1004-kff-guillemard',
  'tg-1005-1-yishun-sport-hall',
  'tg-1005-2-clementi-sport-hall',
  'tg-1006-kampong-glam-cc',
  'tg-1007-bukit-panjang-government-high-school-hall',
  'tg-1008-heartbeat-bedok-activesg-sport-hall',
  'tg-1009-henderson-cc',
  'tg-1010-unmatched',
  'tg-1011-potong-pasir-cc',
  'tg-1012-sengkang-sport-hall',
];

export const isSampleListing = (listing) => listing?.sourceUrl === SAMPLE_SOURCE_URL;

/** True for the sample URL, however a query, fragment, trailing slash, or case disguises it. */
export const isReservedSampleUrl = (url) =>
  String(url).trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() === SAMPLE_SOURCE_URL.toLowerCase();

const isExactSampleSet = (records, idField, expectedIds) =>
  records.every(isSampleListing)
  && JSON.stringify(records.map((record) => record?.[idField]).sort()) === JSON.stringify([...expectedIds].sort());

export function assertNotSampleFeed(feed) {
  const count = feed.filter(isSampleListing).length;
  if (count) throw new Error(`The listing feed contains ${count} sample listing(s); refusing to publish it.`);
}

/**
 * On a fresh install the checked-in samples sit where live data will go, and
 * ingestion would merge real messages into them. Empty the message and listing
 * files, but only when both hold exactly the checked-in sample records. The URL
 * alone is not proof. Anything else, including a missing or empty counterpart, is
 * left untouched.
 */
export async function initializeSampleData({ messagesPath, listingsPath, readFile, writeJson }) {
  const read = async (path) => {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      return null;
    }
  };
  const [messages, listings] = await Promise.all([read(messagesPath), read(listingsPath)]);
  if (!Array.isArray(messages) || !Array.isArray(listings)) return { initialized: false, reason: 'unreadable' };
  if (messages.length + listings.length === 0) return { initialized: false, reason: 'empty' };
  if (!isExactSampleSet(messages, 'messageId', SAMPLE_MESSAGE_IDS) || !isExactSampleSet(listings, 'id', SAMPLE_LISTING_IDS)) {
    return { initialized: false, reason: 'unrecognized-data' };
  }
  await writeJson(messagesPath, []);
  await writeJson(listingsPath, []);
  return { initialized: true, reason: 'samples', removed: messages.length + listings.length };
}
