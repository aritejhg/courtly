import { TelegramClient, sessions } from 'teleproto';
import readlineSync from 'readline-sync';
import { saveTelegramConfig } from './lib/telegram-client.mjs';

const ask = async (label) => readlineSync.question(label).trim();
const askSecret = async (label) => readlineSync.question(label, { hideEchoBack: true }).trim();

async function main() {
  const apiId = Number(await ask('Telegram api_id: '));
  const apiHash = await askSecret('Telegram api_hash: ');
  const phoneNumber = await ask('Telegram phone number (international format): ');
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !phoneNumber) {
    throw new Error('api_id, api_hash, and phone number are required.');
  }
  const client = new TelegramClient(new sessions.StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => askSecret('Login code: '),
      password: async () => askSecret('Two-step verification password: '),
      emailAddress: async () => ask('Verification email: '),
      emailVerification: async () => ({ code: await askSecret('Email verification code: ') }),
      onError: (error) => console.error(error.message || error),
    });
    const configPath = await saveTelegramConfig({ apiId, apiHash, session: client.session.save() });
    console.log(`Telegram client configured in ${configPath}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
