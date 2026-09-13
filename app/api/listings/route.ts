import fallbackListings from '@/data/telegram-listings.json';
import type { CourtListing } from '@/lib/ingestion';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const FEED_KEY = 'courtly:listings';

function isListingFeed(value: unknown): value is CourtListing[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const listing = item as Partial<CourtListing>;
    return (
      typeof listing.id === 'string' &&
      typeof listing.playAt === 'string' &&
      typeof listing.status === 'string' &&
      typeof listing.sourceMessageId === 'string'
    );
  });
}

export async function GET() {
  const runtimeEnv = env as unknown as { COURTLY_FEED?: KVNamespace };

  // Local development can use the checked-in fixture. Production must have
  // the binding and must fail closed if the live feed is unavailable.
  if (!runtimeEnv.COURTLY_FEED) {
    return Response.json(
      { listings: fallbackListings, source: 'local-fallback' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const listings = await runtimeEnv.COURTLY_FEED.get<CourtListing[]>(FEED_KEY, 'json');
    if (!isListingFeed(listings)) {
      return Response.json(
        { error: 'Live listing feed is missing or invalid.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      { listings, source: 'cloudflare-kv' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Live listing feed is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
