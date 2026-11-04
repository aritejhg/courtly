import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReservedSampleUrl } from './sample-data.mjs';

const defaultEnvFile = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.env');

// The ingestion VM keeps its configuration in an owner-only `.env` that source
// sync preserves. Read it directly so these values resolve however the runner
// was started, and take only the named key rather than loading the whole file.
function readEnvFile(name, envFile) {
  let content;
  try {
    content = readFileSync(envFile, 'utf8');
  } catch {
    return '';
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

function readValue(name, { env = process.env, envFile = defaultEnvFile } = {}) {
  return env[name]?.trim() || readEnvFile(name, envFile);
}

export function getTelegramSourceUrl(options) {
  return readValue('COURTLY_TELEGRAM_SOURCE_URL', options);
}

/** Resolves the source chat, failing clearly before any Telegram connection is made. */
export function requireTelegramSource(options) {
  const chatId = readValue('COURTLY_TELEGRAM_CHAT_ID', options);
  const sourceUrl = getTelegramSourceUrl(options);
  const problems = [];
  if (!/^-100\d+$/.test(chatId)) problems.push('COURTLY_TELEGRAM_CHAT_ID must be a -100-prefixed Telegram chat ID');
  if (!/^https:\/\/t\.me\/\S+$/.test(sourceUrl)) problems.push('COURTLY_TELEGRAM_SOURCE_URL must be an https://t.me/ link');
  else if (isReservedSampleUrl(sourceUrl)) problems.push('COURTLY_TELEGRAM_SOURCE_URL is the reserved sample URL; use the real source link');
  if (problems.length) {
    const error = new Error(`Telegram source is not configured: ${problems.join('; ')}. Set them in the environment or .env.`);
    error.name = 'TelegramSourceConfigError';
    error.code = 'TELEGRAM_SOURCE_NOT_CONFIGURED';
    error.retryable = false;
    throw error;
  }
  return { chatId, sourceUrl };
}
