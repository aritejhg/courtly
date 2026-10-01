import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const runtimeFiles = new Set([
  '.courtly-source-commit', 'tsconfig.tsbuildinfo', 'data/build-info.json',
  'data/ambiguity-review-history.json', 'data/parser-ambiguities.json',
  'data/telegram-listings.json', 'data/telegram-messages.json',
  'data/unmatched-venue-candidates.json', 'data/venue-coordinate-cache.json',
]);
const managed = (file) => !runtimeFiles.has(file) && !file.startsWith('work/');
const git = async (source, args) => (await exec('git', ['-C', source, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;

export async function assertSourceSyncSafe(source, app, target, deployed) {
  const changed = new Set([
    ...(await git(source, ['diff', '--name-only', '-z', 'HEAD'])).split('\0'),
    ...(await git(source, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0'),
  ].filter((file) => file && managed(file)));
  if (changed.size) throw new Error(`Source sync blocked: uncommitted source edits: ${[...changed].join(', ')}. Commit and push the repair to GitHub first.`);
  try { await git(source, ['merge-base', '--is-ancestor', 'HEAD', target]); }
  catch { throw new Error('Source sync blocked: local commits are not in GitHub main. Preserve and push/reconcile them before syncing.'); }
  if (!deployed) {
    // An existing app needs a known baseline before its source can be replaced.
    try { await readFile(join(app, 'package.json')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error('Source sync blocked: existing app has no deployed commit marker. Verify its baseline before syncing.');
  }
  const tree = (await git(source, ['ls-tree', '-r', '-z', deployed])).split('\0').filter(Boolean);
  const tracked = new Set();
  const drift = [];
  for (const row of tree) {
    const [metadata, file] = row.split('\t');
    tracked.add(file);
    if (!managed(file)) continue;
    const [, type, expected] = metadata.split(' ');
    if (type !== 'blob') throw new Error(`Source sync blocked: unsupported source entry: ${file}`);
    try {
      const bytes = await readFile(join(app, file));
      const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (actual !== expected) drift.push(file);
    } catch (error) { if (error.code === 'ENOENT') drift.push(file); else throw error; }
  }
  const extras = await git(source, ['--work-tree', app, 'ls-files', '--others', '--exclude-standard', '-z']);
  drift.push(...extras.split('\0').filter((file) => file && managed(file) && !tracked.has(file)));
  if (drift.length) throw new Error(`Source sync blocked: deployed source differs from ${deployed}: ${[...new Set(drift)].join(', ')}. Preserve the edits and commit them to GitHub first.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await assertSourceSyncSafe(...process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
