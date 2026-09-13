import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const feedPath = join(root, 'data', 'telegram-listings.json');
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const namespaceId = process.env.COURTLY_FEED_KV_NAMESPACE_ID?.trim();
const feedKey = 'courtly:listings';

if (!namespaceId) {
  throw new Error('COURTLY_FEED_KV_NAMESPACE_ID is required to publish the live listing feed.');
}

const rawFeed = await readFile(feedPath, 'utf8');
let feed;
try {
  feed = JSON.parse(rawFeed);
} catch {
  throw new Error('The listing feed is not valid JSON; refusing to publish it.');
}

if (
  !Array.isArray(feed) ||
  feed.length === 0 ||
  !feed.every((listing) => listing && typeof listing === 'object' && typeof listing.id === 'string')
) {
  throw new Error('The listing feed is empty or malformed; refusing to publish it.');
}

await access(wranglerPath);
await access(feedPath);

const args = [
  '--no-warnings',
  wranglerPath,
  'kv',
  'key',
  'put',
  feedKey,
  '--namespace-id',
  namespaceId,
  '--path',
  feedPath,
  '--remote',
];
const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  shell: false,
  windowsHide: true,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  child.on('error', rejectPromise);
  child.on('exit', (code) => resolvePromise(code ?? 1));
});

if (exitCode !== 0) process.exitCode = exitCode;
