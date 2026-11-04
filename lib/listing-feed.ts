import { FEED_KEY, isListingFeed } from './listing-feed-validation.mjs';

export { FEED_KEY };

type FeedStore = { get(key: string, type: 'json'): Promise<unknown> };
type FeedOptions = {
  store?: FeedStore;
  /** True only on the Vite dev server; never true in a built Worker. */
  isDevelopment: boolean;
  loadSample: () => Promise<unknown[]>;
};
type FeedResult = { status: number; body: Record<string, unknown> };

/**
 * Sample listings are invented, so they are served only by the dev server. A
 * built Worker must fail closed rather than present them as real courts.
 */
export async function resolveListingFeed({ store, isDevelopment, loadSample }: FeedOptions): Promise<FeedResult> {
  if (!store) {
    if (isDevelopment) return { status: 200, body: { listings: await loadSample(), source: 'local-fallback' } };
    return { status: 503, body: { error: 'Live listing feed is not configured.' } };
  }
  try {
    const listings = await store.get(FEED_KEY, 'json');
    if (!isListingFeed(listings)) return { status: 503, body: { error: 'Live listing feed is missing or invalid.' } };
    return { status: 200, body: { listings, source: 'cloudflare-kv' } };
  } catch {
    return { status: 503, body: { error: 'Live listing feed is temporarily unavailable.' } };
  }
}
