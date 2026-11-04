import { env } from 'cloudflare:workers';
import { telegramConfigResponse } from '@/lib/telegram-config';

export const dynamic = 'force-dynamic';

export function GET() {
  return telegramConfigResponse(env as unknown as Record<string, unknown>);
}
