export type TelegramConfig = { sourceUrl: string | null; chatId: string | null };

export const EMPTY_TELEGRAM_CONFIG: TelegramConfig = { sourceUrl: null, chatId: null };

/**
 * Reads the Telegram link settings from runtime Worker secrets. They are served
 * only behind the access gate, so they must never reach a build-time bundle:
 * static client assets are public even when the page is gated.
 */
export function resolveTelegramConfig(env: Record<string, unknown>): TelegramConfig {
  const read = (name: string) => (typeof env[name] === 'string' ? (env[name] as string).trim() : '');
  const sourceUrl = read('COURTLY_TELEGRAM_SOURCE_URL');
  const chatId = read('COURTLY_TELEGRAM_CHAT_ID');
  return {
    sourceUrl: /^https:\/\/t\.me\/\S+$/.test(sourceUrl) ? sourceUrl : null,
    chatId: chatId || null,
  };
}

export function telegramConfigResponse(env: Record<string, unknown>): Response {
  return Response.json(resolveTelegramConfig(env), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
