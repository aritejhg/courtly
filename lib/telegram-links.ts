/** Telegram's t.me/c links use the chat ID without the -100 API prefix. */
export function internalChatId(chatId: string | undefined) {
  return (chatId ?? '').trim().replace(/^-100/, '');
}

export function telegramMessageUrl(chatId: string | undefined, messageId: string | undefined) {
  const internalId = internalChatId(chatId);
  return internalId && messageId ? `https://t.me/c/${internalId}/${messageId}` : null;
}

export function telegramOwnerUrl(username: string | undefined, messageUrl: string | null) {
  return username ? `https://t.me/${username.replace(/^@/, '')}` : messageUrl;
}
