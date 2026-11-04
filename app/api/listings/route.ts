import { resolveListingFeed } from '@/lib/listing-feed';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runtimeEnv = env as unknown as { COURTLY_FEED?: KVNamespace };
  const { status, body } = await resolveListingFeed({
    store: runtimeEnv.COURTLY_FEED,
    isDevelopment: import.meta.env.DEV,
    // Imported only in development, so built Workers do not bundle the sample data.
    loadSample: async () =>
      import.meta.env.DEV ? (await import('@/data/telegram-listings.json')).default : [],
  });
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
