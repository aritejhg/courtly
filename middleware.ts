import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { accessGate } from './lib/access-gate';

export async function middleware(request: Request) {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const response = await accessGate(request, runtimeEnv.COURTLY_ACCESS_CODE as string | undefined);
  return response ?? NextResponse.next();
}

export const config = {
  // The client bundle contains the authenticated Telegram feed. Protect static
  // chunks too; otherwise an unauthenticated caller can fetch the data without
  // passing through the page gate.
  matcher: ['/((?!favicon.ico).*)'],
};
