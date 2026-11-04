// Checked-in data/telegram-*.json files are invented sample data for development
// and CI. Every record carries this source URL so it can never pass as a live feed.
export const SAMPLE_SOURCE_URL = 'https://t.me/your_group_invite';

export const isSampleListing = (listing) => listing?.sourceUrl === SAMPLE_SOURCE_URL;

export function assertNotSampleFeed(feed) {
  const count = feed.filter(isSampleListing).length;
  if (count) throw new Error(`The listing feed contains ${count} sample listing(s); refusing to publish it.`);
}
