// Checked-in data/telegram-*.json files are invented sample data for development
// and CI. Every record carries this source URL so it can never pass as a live feed.
export const SAMPLE_SOURCE_URL = 'https://t.me/your_group_invite';

export const isSampleListing = (listing) => listing?.sourceUrl === SAMPLE_SOURCE_URL;

export function assertNotSampleFeed(feed) {
  const count = feed.filter(isSampleListing).length;
  if (count) throw new Error(`The listing feed contains ${count} sample listing(s); refusing to publish it.`);
}

/**
 * On a fresh install the checked-in samples sit where live data will go, and
 * ingestion would merge real messages into them. Empty the message and listing
 * files, but only when every record in both is a marked sample. Any other record
 * means the files hold live data, and nothing is touched.
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
  if (![...messages, ...listings].every(isSampleListing)) return { initialized: false, reason: 'live-data' };
  await writeJson(messagesPath, []);
  await writeJson(listingsPath, []);
  return { initialized: true, reason: 'samples', removed: messages.length + listings.length };
}
