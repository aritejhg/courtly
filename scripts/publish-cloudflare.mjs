import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = join(root, 'dist', 'server', 'wrangler.json');
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const dryRun = process.argv.includes('--dry-run');
const workerName = process.env.COURTLY_WORKER_NAME || 'courtly-sg';

if (!dryRun && !process.env.CLOUDFLARE_API_TOKEN) {
  throw new Error('Cloudflare publishing is not configured. Set CLOUDFLARE_API_TOKEN for this Windows user.');
}

await access(configPath);
await access(wranglerPath);

const args = ['--no-warnings', wranglerPath, 'deploy', '--config', configPath, '--name', workerName];
if (dryRun) args.push('--dry-run');
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
