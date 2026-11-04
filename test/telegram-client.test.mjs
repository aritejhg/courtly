import test from 'node:test';
import assert from 'node:assert/strict';
import { findDeletedMessageIds, normalizeTelegramMessage, telegramOwner } from '../scripts/lib/telegram-client.mjs';

process.env.COURTLY_TELEGRAM_SOURCE_URL = 'https://t.me/+example';

test('normalizes an MTProto message into the existing ingestion shape', () => {
  const result = normalizeTelegramMessage({
    id: 90100,
    message: 'Sengkang SH 7-9pm $7 taken',
    date: 1788660000,
    sender: { firstName: 'Court', lastName: 'Owner' },
  });
  assert.deepEqual(result, {
    messageId: '90100',
    owner: 'Court Owner',
    text: 'Sengkang SH 7-9pm $7 taken',
    postedAt: new Date(1788660000 * 1000).toISOString(),
    sourceUrl: 'https://t.me/+example',
    deleted: true,
  });
});

test('uses post author and rejects service or media-only messages', () => {
  assert.equal(telegramOwner({ postAuthor: 'Admin', sender: { firstName: 'Ignored' } }), 'Admin');
  assert.equal(normalizeTelegramMessage({ id: 7, message: '', date: 1788660000 }), null);
});

test('detects deleted stored messages only inside the fetched overlap', () => {
  const current = [
    { messageId: '99', deleted: false },
    { messageId: '100', deleted: false },
    { messageId: '101', deleted: false },
    { messageId: '102', deleted: true },
  ];
  const extracted = [{ messageId: '101' }];
  assert.deepEqual(findDeletedMessageIds(current, extracted, { minMessageId: 100, maxMessageId: 102 }), ['100']);
});
