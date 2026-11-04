import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTelegramSourceUrl, requireTelegramSource } from './telegram-source-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultConfigPath = join(root, 'work', 'telegram-client.json');
const defaultStatePath = join(root, 'work', 'telegram-client-state.json');

async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function telegramOwner(message) {
  if (message.postAuthor) return String(message.postAuthor).trim();
  const sender = message.sender;
  if (!sender) return 'Telegram member';
  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim();
  return fullName || sender.title || sender.username || 'Telegram member';
}

export function normalizeTelegramMessage(message, sourceUrl = getTelegramSourceUrl()) {
  const text = String(message.message || '').trim();
  if (!message.id || !text) return null;
  const timestamp = message.date instanceof Date
    ? message.date
    : new Date(Number(message.date) * 1000);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`Telegram message ${message.id} has an invalid timestamp.`);
  return {
    messageId: String(message.id),
    owner: telegramOwner(message),
    ...(message.sender?.username ? { ownerUsername: String(message.sender.username).replace(/^@/, '') } : {}),
    text,
    postedAt: timestamp.toISOString(),
    sourceUrl,
    deleted: /\b(taken|gone|claimed|deleted|no longer available)\b/i.test(text),
  };
}

export function findDeletedMessageIds(current, extracted, reconcileRange) {
  if (!reconcileRange) return [];
  const fetchedIds = new Set(extracted.map((message) => String(message.messageId)));
  return current
    .filter((message) => {
      const numericId = Number(message.messageId);
      return Number.isFinite(numericId)
        && numericId >= reconcileRange.minMessageId
        && numericId <= reconcileRange.maxMessageId
        && !fetchedIds.has(String(message.messageId))
        && !message.deleted;
    })
    .map((message) => String(message.messageId));
}

export async function loadTelegramConfig(configPath = process.env.COURTLY_TELEGRAM_CONFIG || defaultConfigPath) {
  const fileConfig = await readJson(configPath);
  const apiId = Number(process.env.COURTLY_TELEGRAM_API_ID || fileConfig.apiId);
  const apiHash = process.env.COURTLY_TELEGRAM_API_HASH || fileConfig.apiHash;
  const session = process.env.COURTLY_TELEGRAM_SESSION || fileConfig.session;
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) {
    throw new Error('Telegram client is not configured. Run `npm run telegram:setup` once.');
  }
  return { apiId, apiHash: String(apiHash), session: String(session), configPath };
}

export async function readTelegramFromClient({
  configPath,
  statePath = process.env.COURTLY_TELEGRAM_STATE || defaultStatePath,
  historyLimit = Number(process.env.COURTLY_TELEGRAM_HISTORY_LIMIT || 5000),
  overlap = Number(process.env.COURTLY_TELEGRAM_OVERLAP || 500),
} = {}) {
  const { chatId, sourceUrl } = requireTelegramSource();
  const { apiId, apiHash, session } = await loadTelegramConfig(configPath);
  const { TelegramClient, sessions } = await import('teleproto');
  const client = new TelegramClient(new sessions.StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
  try {
    await client.connect();
    if (!await client.checkAuthorization()) {
      throw new Error('Telegram session expired. Run `npm run telegram:setup` again.');
    }
    const entity = await client.getEntity(Number(chatId));
    const state = await readJson(statePath);
    const lastMessageId = Number(state.lastMessageId || 0);
    const minId = lastMessageId > 0 ? Math.max(0, lastMessageId - overlap) : 0;
    const fetched = await client.getMessages(entity, {
      limit: Number.isFinite(historyLimit) && historyLimit > 0 ? historyLimit : 5000,
      ...(minId ? { minId } : {}),
    });
    const messages = [];
    for (const message of fetched) {
      if (!message.sender && typeof message.getSender === 'function') {
        try { await message.getSender(); } catch {}
      }
      const normalized = normalizeTelegramMessage(message, sourceUrl);
      if (normalized) messages.push(normalized);
    }
    const numericIds = messages.map((message) => Number(message.messageId)).filter(Number.isFinite);
    const maxMessageId = numericIds.length ? Math.max(...numericIds) : lastMessageId;
    const minMessageId = numericIds.length ? Math.min(...numericIds) : 0;
    return {
      messages,
      reconcileRange: minMessageId && maxMessageId ? { minMessageId, maxMessageId } : null,
      nextState: { statePath, lastMessageId: maxMessageId },
    };
  } finally {
    await client.disconnect();
  }
}

export async function saveTelegramState({ statePath = defaultStatePath, lastMessageId }) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({ lastMessageId, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

export async function saveTelegramConfig({ apiId, apiHash, session }, configPath = defaultConfigPath) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ apiId, apiHash, session }, null, 2)}\n`, { mode: 0o600 });
  return configPath;
}
