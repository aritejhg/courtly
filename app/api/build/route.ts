import buildInfo from '@/data/build-info.json';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { commit: String(buildInfo.commit || 'unknown') },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
