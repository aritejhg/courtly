import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Start with npm run dev -- --port 3100, then npm run test:mrt.
// Fixtures affect only this isolated browser.
const url = process.env.COURTLY_TEST_URL ?? 'http://localhost:3100/';
const port = 9225;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'courtly-mrt-check-'));
const output = path.resolve('outputs/mrt');
await fs.mkdir(output, { recursive: true });
const listings = JSON.parse(await fs.readFile('data/telegram-listings.json', 'utf8'));
const used = new Set();
const fixtures = listings.filter((item) => {
  if (item.venueMatch !== 'deterministic' || !Number.isFinite(item.lat) || !Number.isFinite(item.lng) || used.has(item.venueId)) return false;
  used.add(item.venueId);
  return true;
}).slice(0, 24).map((item) => ({ ...item, status: 'active', deletedAt: undefined, playAt: new Date(Date.now() + 86400000).toISOString(), playEndAt: new Date(Date.now() + 93600000).toISOString() }));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
let socket;
try {
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === 'page'); } catch { return null; }
  }, 'browser');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const requests = new Map();
  const errors = [];
  const failures = [];
  let id = 0;
  let mrtRequests = 0;
  let offline = false;
  function send(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => { requests.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const request = requests.get(message.id);
    if (request) { requests.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') failures.push(message.params.errorText);
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/sg-rail.geojson')) mrtRequests++;
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request: incoming } = message.params;
      const action = incoming.url.includes('/api/listings')
        ? send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ listings: fixtures })).toString('base64') })
        : offline ? send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }) : send('Fetch.continueRequest', { requestId });
      action.catch((error) => errors.push(error.message));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/listings*' }, { urlPattern: '*/sg-rail.geojson' }] });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function click(selector) {
    const point = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing control'); const r = node.getBoundingClientRect(); if (!node.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2))) throw new Error('Control covered: ' + ${JSON.stringify(selector)}); return { x: r.x+r.width/2, y: r.y+r.height/2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  async function screenshot(name) {
    await pause(450);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
  }
  async function clickVisibleMapFeature(selector) {
    const visibleSelector = await evaluate(`(() => {
      for (const node of document.querySelectorAll(${JSON.stringify(selector)})) {
        const r = node.getBoundingClientRect();
        if (r.x < 480 || r.y < 220 || r.right > innerWidth - 30 || r.bottom > innerHeight - 70) continue;
        if (node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) {
          return ${JSON.stringify(selector)} + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')';
        }
      }
      throw new Error('No visible map feature: ' + ${JSON.stringify(selector)});
    })()`);
    await click(visibleSelector);
  }
  async function ready() {
    await until(() => evaluate(`Boolean(document.querySelector('.mrt-toggle:not(:disabled)') && document.querySelectorAll('.court-marker').length)`), 'map ready');
    await pause(500);
  }
  async function overlay() {
    try {
      await until(() => evaluate(`document.querySelectorAll('.mrt-line').length === 6 && document.querySelectorAll('.mrt-station').length >= 140`), 'six MRT lines', 25000);
    } catch (error) {
      await screenshot('mrt-failure');
      console.log({ status: await evaluate("document.querySelector('.mrt-status')?.textContent"), errors, failures, mrtRequests, module: await evaluate("(async () => { try { const m = await import('/lib/mrt-layer.ts'); return Object.keys(m); } catch (e) { return e.stack; } })()") });
      throw error;
    }
  }
  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 800 });
    await send('Page.reload');
    await ready();
    await overlay();
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${width}: horizontal overflow`);
    await screenshot(`mrt-${width}`);
    if (width <= 800) {
      assert.equal(await evaluate("document.querySelector('.mrt-toggle').getBoundingClientRect().width === 44 && getComputedStyle(document.querySelector('.mrt-switch')).display === 'none' && getComputedStyle(document.querySelector('.mrt-info')).display === 'none'"), true, `${width}: mobile toggle must be icon-only`);
      assert.equal(await evaluate("(() => { const mrt = document.querySelector('.mrt-toggle').getBoundingClientRect(); const zoom = document.querySelector('.leaflet-control-zoom').getBoundingClientRect(); return zoom.right < mrt.left && Math.abs(zoom.top - mrt.top) < 2 && zoom.height >= 44; })()"), true, `${width}: zoom/layer controls must fit without overlap`);
      await click('.mobile-drawer-handle');
      await pause(300);
      await screenshot(`mrt-${width}-expanded`);
      await click('.mrt-toggle');
      assert.equal(await evaluate("document.querySelectorAll('.mrt-line').length"), 0);
      await click('.mrt-toggle');
      await overlay();
      await click('.listing-card-main');
      await pause(300);
      await screenshot(`mrt-${width}-detail`);
      assert.equal(await evaluate(`document.querySelector('.detail-drawer').getBoundingClientRect().top >= document.querySelector('.mrt-toggle').getBoundingClientRect().bottom + 5`), true, `${width}: details cover toggle`);
      await click('.mrt-toggle');
      await click('.mrt-toggle');
      await overlay();
      await click('.drawer-close');
      await pause(350);
      await click('.mobile-drawer-handle');
    }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await ready();
  assert.equal(mrtRequests, 0, 'disabled MRT must not fetch data');
  await screenshot('mrt-off-desktop');
  await click('.mrt-toggle');
  await overlay();
  assert.equal(mrtRequests, 1, 'first enable should fetch once');
  await screenshot('mrt-desktop');
  const pinPositions = await evaluate("[...document.querySelectorAll('.court-marker')].map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y]; })");
  await clickVisibleMapFeature('.mrt-station-hit');
  await until(() => evaluate("Boolean(document.querySelector('.mrt-station-popup strong')?.textContent)"), 'station popup');
  await click('.mrt-toggle');
  await click('.mrt-toggle');
  await overlay();
  await clickVisibleMapFeature('.court-marker');
  await until(() => evaluate("Boolean(document.querySelector('.court-marker.selected') && document.querySelector('.detail-drawer'))"), 'court pin selection above MRT');
  assert.equal(await evaluate("document.querySelectorAll('.mrt-line').length"), 6, 'court selection must keep MRT layer visible');
  await click('.drawer-close');
  await pause(300);
  await click('.mrt-info');
  await screenshot('mrt-desktop-legend');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Page.reload');
  await ready();
  await overlay();
  assert.equal(mrtRequests, 1, 'fresh device cache must prevent a reload fetch');
  await click('.mrt-toggle');
  assert.equal(await evaluate("document.querySelectorAll('.mrt-line, .mrt-station, .mrt-station-label').length"), 0, 'off must remove the whole overlay');
  await evaluate("document.querySelector('.mrt-toggle').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await overlay();
  assert.equal(mrtRequests, 1, 'keyboard toggle must reuse cache');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.court-marker')].map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y]; })"), pinPositions, 'toggling/reloading must preserve initial map fit');
  for (let index = 0; index < 3; index++) { await click('.leaflet-control-zoom-in'); await pause(350); }
  await until(() => evaluate("document.querySelectorAll('.mrt-station-label').length > 0"), 'zoomed station labels');
  await pause(500);
  await screenshot('mrt-desktop-zoom');
  assert.equal(await evaluate(`(() => {
    const labels = [...document.querySelectorAll('.mrt-station-label')].map(node => node.getBoundingClientRect());
    return labels.every((a, i) => labels.slice(i + 1).every(b => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
  })()`), true, 'zoomed labels must not overlap');
  await screenshot('mrt-desktop-zoom');
  await click('.listing-card-main');
  await screenshot('mrt-desktop-detail');
  await click('.drawer-close');
  await viewport(375, 812);
  await viewport(320, 667);
  assert.equal(mrtRequests, 1, 'mobile reloads must reuse device cache');
  await evaluate(`(() => { const key = 'courtly-mrt-network-v1'; const saved = JSON.parse(localStorage.getItem(key)); saved.fetchedAt = Date.now() - 86400001; localStorage.setItem(key, JSON.stringify(saved)); })()`);
  offline = true;
  await send('Page.reload');
  await ready();
  await overlay();
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  await click('.mrt-info');
  assert.equal(await evaluate("document.querySelector('.mrt-legend').textContent.includes('Using a saved map')"), true, 'offline refresh must show saved-map status');
  await screenshot('mrt-mobile-offline');
  await send('Page.reload');
  await ready();
  await overlay();
  assert.equal(mrtRequests, 2, 'failed refresh must back off across reloads');
  await evaluate("localStorage.removeItem('courtly-mrt-network-v1')");
  await send('Page.reload');
  await ready();
  await until(() => evaluate("document.querySelector('.mrt-status').textContent.includes('MRT unavailable')"), 'cold failure status');
  await screenshot('mrt-mobile-unavailable');
  await click('.mrt-toggle');
  assert.equal(await evaluate("document.querySelector('.mrt-status').textContent"), '');
  offline = false;
  await click('.mrt-toggle');
  await overlay();
  assert.deepEqual(errors, [], 'browser runtime exceptions');
  console.log('MRT E2E passed: real source, six lines, 146 stations, desktop/mobile rendering, keyboard/touch toggles, reload cache, stale fallback, backoff, failure recovery.');
  console.log(`Screenshots: ${output}`);
} finally {
  socket?.close();
  if (chrome.pid) await new Promise((resolve) => {
    const stop = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    stop.once('close', resolve);
  });
  const relative = path.relative(os.tmpdir(), profile);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
