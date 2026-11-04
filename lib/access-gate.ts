const COOKIE_NAME = 'courtly_access';
const TOKEN_MESSAGE = 'courtly-access-v2';
const MAX_AGE_SECONDS = 2592000;

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signature(secret: string, expiresAt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${TOKEN_MESSAGE}:${expiresAt}`),
  );
  return bytesToHex(new Uint8Array(mac));
}

async function issueToken(secret: string, nowMs: number): Promise<string> {
  const expiresAt = String(Math.floor(nowMs / 1000) + MAX_AGE_SECONDS);
  return `${expiresAt}.${await signature(secret, expiresAt)}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

// A token is `<expiry in epoch seconds>.<HMAC of the version and expiry>`.
async function isValidToken(token: string, secret: string, nowMs: number): Promise<boolean> {
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const [, expiresAt, presented] = match;
  if (!constantTimeEqual(presented, await signature(secret, expiresAt))) return false;
  return Number(expiresAt) * 1000 > nowMs;
}

function loginPage(error = false): Response {
  const message = error ? '<p class="error">Wrong access code.</p>' : '';
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>SG courts</title><style>body{font:16px system-ui;max-width:26rem;margin:15vh auto;padding:1.5rem;background:#111;color:#eee}input,button{font:inherit;padding:.7rem;border-radius:.5rem;border:1px solid #666}input{width:100%;box-sizing:border-box;margin:.8rem 0;background:#222;color:#fff}button{background:#f08070;color:#111;font-weight:700;cursor:pointer}.error{color:#ff968b}</style><h1>SG courts</h1><p>Enter the access code to continue.</p>${message}<form method="post"><input name="code" type="password" autocomplete="current-password" autofocus required><button>Continue</button></form>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export async function accessGate(
  request: Request,
  secret: string | undefined,
  { isDevelopment = false, now = Date.now() }: { isDevelopment?: boolean; now?: number } = {},
): Promise<Response | null> {
  if (!secret) {
    // Never decide this from the Host header: only the dev server may run ungated.
    return isDevelopment
      ? null
      : new Response('Access gate is not configured.', { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const currentToken = cookieValue(request.headers.get('cookie'), COOKIE_NAME);
  if (currentToken && (await isValidToken(currentToken, secret, now))) return null;

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const code = form?.get('code');
    if (typeof code === 'string' && constantTimeEqual(code, secret)) {
      const headers = new Headers({ location: new URL(request.url).pathname || '/' });
      headers.append(
        'set-cookie',
        `${COOKIE_NAME}=${encodeURIComponent(await issueToken(secret, now))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`,
      );
      return new Response(null, { status: 303, headers });
    }
    return loginPage(true);
  }

  return loginPage();
}
