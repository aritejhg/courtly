import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { accessGate } from './lib/access-gate';

export async function middleware(request: Request) {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const response = await accessGate(request, runtimeEnv.COURTLY_ACCESS_CODE as string | undefined);
  return response ?? NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
