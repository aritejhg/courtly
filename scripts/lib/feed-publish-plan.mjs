import { join } from 'node:path';
import { assertNotSampleFeed } from './sample-data.mjs';
import { assertPublishableFeed, FEED_KEY } from '../../lib/listing-feed-validation.mjs';

/**
 * Decides what publishing would do, without doing it: validates the feed, then
 * returns the Wrangler arguments. Throws for anything that must not be published.
 */
export function planFeedPublish({ rawFeed, root, namespaceId }) {
  if (!namespaceId) {
    throw new Error('COURTLY_FEED_KV_NAMESPACE_ID is required to publish the live listing feed.');
  }
  let feed;
  try {
    feed = JSON.parse(rawFeed);
  } catch {
    throw new Error('The listing feed is not valid JSON; refusing to publish it.');
  }
  assertPublishableFeed(feed);
  assertNotSampleFeed(feed);

  const feedPath = join(root, 'data', 'telegram-listings.json');
  const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return {
    feedPath,
    wranglerPath,
    args: ['--no-warnings', wranglerPath, 'kv', 'key', 'put', FEED_KEY, '--namespace-id', namespaceId, '--path', feedPath, '--remote'],
  };
}
