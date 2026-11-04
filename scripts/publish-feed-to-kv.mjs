import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planFeedPublish } from './lib/feed-publish-plan.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const namespaceId = process.env.COURTLY_FEED_KV_NAMESPACE_ID?.trim();

const plan = planFeedPublish({
  rawFeed: await readFile(resolve(root, 'data', 'telegram-listings.json'), 'utf8'),
  root,
  namespaceId,
});

await access(plan.wranglerPath);
await access(plan.feedPath);

const child = spawn(process.execPath, plan.args, {
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
