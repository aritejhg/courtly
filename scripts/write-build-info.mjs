import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markerPath = join(root, '.courtly-source-commit');
const outputPath = join(root, 'data', 'build-info.json');

async function firstNonEmpty(...values) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) ?? '';
}

let commit = await firstNonEmpty(process.env.COURTLY_BUILD_COMMIT, process.env.GITHUB_SHA);
if (!commit) {
  try {
    commit = await firstNonEmpty((await readFile(markerPath, 'utf8')));
  } catch {}
}
if (!commit) {
  try {
    commit = await firstNonEmpty((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout);
  } catch {}
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ commit: commit || 'local' }, null, 2)}\n`);
