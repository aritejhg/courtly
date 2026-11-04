import { requireTelegramSource } from './telegram-source-config.mjs';

async function listTargets(cdpBase) {
  const response = await fetch(`${cdpBase}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
  return response.json();
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to the Chrome tab.')), { once: true });
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() { socket.close(); },
  };
}

const extractMessages = (sourceUrl) => `(() => {
  const now = new Date();
  const weekdayIndex = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  function groupDate(label) {
    const clean = String(label || '').trim().toLowerCase();
    const result = new Date(now);
    if (clean === 'today') return result;
    if (clean === 'yesterday') { result.setDate(result.getDate() - 1); return result; }
    const day = weekdayIndex[clean.slice(0, 3)];
    if (day !== undefined) {
      const delta = (result.getDay() - day + 7) % 7;
      result.setDate(result.getDate() - delta);
      return result;
    }
    const parsed = new Date(label);
    return Number.isNaN(parsed.getTime()) ? result : parsed;
  }
  return Array.from(document.querySelectorAll('.messages-container .Message[data-message-id]')).map((node) => {
    const messageId = node.getAttribute('data-message-id');
    const owner = node.querySelector('.message-title-name')?.textContent?.trim() || 'Telegram member';
    const timeNode = node.querySelector('.message-time');
    const explicitTimestamp = timeNode?.getAttribute('title');
    const clone = node.querySelector('.text-content')?.cloneNode(true);
    clone?.querySelectorAll('.MessageMeta, .message-time, .reactions, button').forEach((item) => item.remove());
    const text = (clone?.innerText || '').trim();
    const group = node.closest('.message-date-group');
    const label = group?.querySelector(':scope > .sticky-date')?.textContent?.trim() || 'Today';
    let posted = explicitTimestamp ? new Date(explicitTimestamp) : groupDate(label);
    const clock = String(timeNode?.textContent || '').trim().match(/(\\d{1,2}):(\\d{2})/);
    if (clock) posted.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return { messageId, owner, text, postedAt: posted.toISOString(), sourceUrl: ${JSON.stringify(sourceUrl)}, deleted: /\\b(taken|gone|claimed|deleted|no longer available)\\b/i.test(text) };
  }).filter((message) => message.messageId && message.text);
})()`;

export async function readTelegramFromChrome({
  cdpBase = process.env.COURTLY_CHROME_CDP_URL || 'http://127.0.0.1:9222',
} = {}) {
  const { chatId, sourceUrl } = requireTelegramSource();
  const telegramUrl = `https://web.telegram.org/a/#${chatId}`;
  let targets;
  try {
    targets = await listTargets(cdpBase);
  } catch {
    throw new Error('Chrome is not exposing the existing tab to local CDP. Open the existing Telegram tab in a Chrome session started with --remote-debugging-port=9222.');
  }
  let target = targets.find((item) => item.type === 'page' && item.url?.includes(`web.telegram.org/a/#${chatId}`))
    || targets.find((item) => item.type === 'page' && item.url?.includes('web.telegram.org'));
  if (!target?.webSocketDebuggerUrl) throw new Error('The existing Chrome window has no Telegram Web tab. Open the existing group tab, then retry.');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    if (!target.url?.includes(`#${chatId}`)) {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: telegramUrl });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    await cdp.send('Runtime.enable');
    const result = await cdp.send('Runtime.evaluate', { expression: extractMessages(sourceUrl), returnByValue: true, awaitPromise: true });
    const messages = result?.result?.value || [];
    if (!messages.length) throw new Error('Telegram Web is open but no chat messages are readable. Sign in once in the Courtly Chrome profile and open the group.');
    return messages;
  } finally {
    cdp.close();
  }
}
