import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertSourceSyncSafe } from '../scripts/lib/source-sync-guard.mjs';

const exec = promisify(execFile);
test('source sync preserves unpublished repairs and permits clean source plus runtime feed changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'courtly-sync-guard-'));
  const source = path.join(root, 'source');
  const app = path.join(root, 'app');
  const git = async (...args) => (await exec('git', ['-C', source, ...args])).stdout.trim();
  try {
    await mkdir(source);
    await git('init');
    await git('config', 'user.name', 'Sync guard test');
    await git('config', 'user.email', 'sync-test@example.invalid');
    await mkdir(path.join(source, 'scripts'));
    await mkdir(path.join(source, 'data'));
    await writeFile(path.join(source, 'scripts', 'parser.mjs'), 'export const alias = "old";\n');
    await writeFile(path.join(source, 'package.json'), '{}\n');
    await writeFile(path.join(source, 'data', 'telegram-listings.json'), '[]\n');
    await git('add', '.');
    await git('commit', '-m', 'Baseline');
    const baseline = await git('rev-parse', 'HEAD');
    await cp(source, app, { recursive: true, filter: (file) => path.basename(file) !== '.git' });
    await writeFile(path.join(app, 'data', 'telegram-listings.json'), '[{"live":true}]\n');
    await writeFile(path.join(source, 'data', 'telegram-listings.json'), '[{"runtime":true}]\n');
    await assertSourceSyncSafe(source, app, baseline, baseline);

    await writeFile(path.join(source, 'scripts', 'parser.mjs'), 'export const alias = "unpublished";\n');
    await assert.rejects(assertSourceSyncSafe(source, app, baseline, baseline), /uncommitted source edits/);
    await git('add', 'scripts/parser.mjs');
    await assert.rejects(assertSourceSyncSafe(source, app, baseline, baseline), /uncommitted source edits/);
    await git('commit', '-m', 'Repair');
    const repair = await git('rev-parse', 'HEAD');
    await assert.rejects(assertSourceSyncSafe(source, app, baseline, baseline), /local commits/);
    await assertSourceSyncSafe(source, app, repair, baseline);

    await writeFile(path.join(app, 'scripts', 'parser.mjs'), 'export const alias = "VM-only";\n');
    await assert.rejects(assertSourceSyncSafe(source, app, repair, baseline), /deployed source differs/);
    assert.match(await readFile(path.join(app, 'scripts', 'parser.mjs'), 'utf8'), /VM-only/);
    await cp(path.join(source, 'scripts', 'parser.mjs'), path.join(app, 'scripts', 'parser.mjs'));
    await assertSourceSyncSafe(source, app, repair, repair);
    await writeFile(path.join(app, 'scripts', 'new-fix.mjs'), 'export const fix = true;\n');
    await assert.rejects(assertSourceSyncSafe(source, app, repair, repair), /new-fix.mjs/);
    await assert.rejects(assertSourceSyncSafe(source, app, repair, ''), /no deployed commit marker/);
  } finally {
    const relative = path.relative(os.tmpdir(), root);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await rm(root, { recursive: true, force: true });
  }
});
