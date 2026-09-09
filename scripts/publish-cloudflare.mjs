import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = join(root, 'dist', 'server', 'wrangler.json');
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const dryRun = process.argv.includes('--dry-run');
const workerName = process.env.COURTLY_WORKER_NAME || 'courtly-sg';
const publishEnv = { ...process.env };

if (!publishEnv.CLOUDFLARE_API_TOKEN && process.platform === 'win32') {
  const powershellPath = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const tokenLookup = spawnSync(
    powershellPath,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')",
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const userToken = tokenLookup.status === 0 ? tokenLookup.stdout.trim() : '';
  if (userToken) {
    publishEnv.CLOUDFLARE_API_TOKEN = userToken;
    console.log('Using CLOUDFLARE_API_TOKEN from the Windows user environment.');
  }
}

if (!dryRun && !publishEnv.CLOUDFLARE_API_TOKEN) {
  throw new Error(
    'Cloudflare publishing is not configured. Set CLOUDFLARE_API_TOKEN in this process or the Windows user environment.',
  );
}

await access(configPath);
await access(wranglerPath);

const args = ['--no-warnings', wranglerPath, 'deploy', '--config', configPath, '--name', workerName];
if (dryRun) args.push('--dry-run');
const child = spawn(process.execPath, args, {
  cwd: root,
  env: publishEnv,
  shell: false,
  windowsHide: true,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  child.on('error', rejectPromise);
  child.on('exit', (code) => resolvePromise(code ?? 1));
});

if (exitCode !== 0) process.exitCode = exitCode;
