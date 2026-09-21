import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const serverPort = 3100;
const cdpPort = 9223;
const appUrl = `http://[::1]:${serverPort}/`;
const profileDir = path.join(os.tmpdir(), `courtly-responsive-${process.pid}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools.')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
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

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  }
  return result?.result?.value;
}

async function readCdpTarget() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
  const targets = await response.json();
  return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

function chromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (!executable) throw new Error('Google Chrome executable not found');
  return executable;
}

async function inspectViewport(cdp, width, height, screenshotPath) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1800);
  await evaluate(cdp, `document.querySelector('[aria-label="Filter by area"]')?.click()`);
  await sleep(250);

  if (screenshotPath) {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }

  return waitFor(async () => evaluate(cdp, `(() => {
    const rect = (node) => {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const toolbar = document.querySelector('.toolbar');
    const area = document.querySelector('.area-filter');
    const duration = document.querySelector('.duration-filter');
    const date = document.querySelector('.date-filter');
    const time = document.querySelector('.time-filter');
    const search = document.querySelector('.search-box');
    const menu = [...document.querySelectorAll('.filter-menu')]
      .find((node) => node.textContent?.includes('All areas') && rect(node)?.width > 0);
    const allAreas = menu ? [...menu.querySelectorAll('button')].find((node) => node.textContent?.includes('All areas')) : null;
    if (!toolbar || !area || !duration || !date || !time || !search || !menu || !allAreas) return null;
    return {
      toolbar: rect(toolbar),
      rows: { search: rect(search), time: rect(time), area: rect(area), duration: rect(duration), date: rect(date) },
      menu: rect(menu),
      allAreas: rect(allAreas),
      allAreasHit: allAreas.contains(document.elementFromPoint(rect(allAreas).x + 12, rect(allAreas).y + rect(allAreas).height / 2)),
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`), 8000, `${width}x${height} filter menu`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verify(result, width, height) {
  const { rows, menu, allAreas, toolbar } = result;
  const sameRow = (a, b) => Math.abs(a.y - b.y) <= 2;
  assert(sameRow(rows.search, rows.time), `${width}px: search and time are not on row 1`);
  assert(sameRow(rows.area, rows.duration) && sameRow(rows.duration, rows.date), `${width}px: area, duration, and date are not on row 2`);
  assert(rows.area.y > rows.search.y + 30, `${width}px: filters did not wrap into a second row`);
  assert(toolbar.height < 115, `${width}px: toolbar grew beyond two filter rows (${toolbar.height}px)`);
  for (const [name, rect] of Object.entries(rows)) {
    assert(rect.width > 0 && rect.height > 0, `${width}px: ${name} control is not visible`);
    assert(rect.x >= 0 && rect.right <= width + 1, `${width}px: ${name} control overflows viewport`);
  }
  assert(menu.y >= rows.area.bottom - 1, `${width}px: area menu opens above its trigger`);
  assert(menu.y >= rows.time.bottom - 1, `${width}px: area menu overlaps the time filter row`);
  assert(allAreas.y >= menu.y && allAreas.bottom <= height + 1, `${width}px: top area option is clipped`);
  assert(result.allAreasHit, `${width}px: top area option is covered by another element`);
  console.log(`responsive ${width}x${height}: passed (two rows, visible menu, clickable top option)`);
}

const server = spawn(process.execPath, [
  path.join(root, 'node_modules/vinext/dist/cli.js'),
  'dev',
  '--host',
  '127.0.0.1',
  '--port',
  String(serverPort),
], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
});
let chrome;
let cdp;

try {
  await waitFor(async () => {
    const response = await fetch(appUrl);
    return response.ok;
  }, 30000, 'local dev server');

  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });
  chrome = spawn(chromeExecutable(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    appUrl,
  ], { stdio: 'ignore', windowsHide: true });

  const target = await waitFor(readCdpTarget, 30000, 'Chrome DevTools page');
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const screenshotDir = process.env.COURTLY_SCREENSHOT_DIR;
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
  for (const [width, height] of [[375, 812], [320, 667]]) {
    const screenshotPath = screenshotDir && width === 375 ? path.join(screenshotDir, 'courtly-mobile.png') : undefined;
    verify(await inspectViewport(cdp, width, height, screenshotPath), width, height);
  }
  if (screenshotDir) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1800);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(screenshotDir, 'courtly-desktop.png'), Buffer.from(screenshot.data, 'base64'));
  }
} finally {
  cdp?.close();
  if (chrome?.pid) spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
