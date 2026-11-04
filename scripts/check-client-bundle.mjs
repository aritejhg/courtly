// Fails if a private Telegram value reached the build output. Static client assets
// bypass the access gate, so anything in them is public. Build first with synthetic
// Telegram values, then pass the same values here as markers (see ci.yml).
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function findMarkers(directory, markers) {
  const hits = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const content = await readFile(file);
    for (const marker of markers) if (content.includes(marker)) hits.push({ file, marker });
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const markers = [process.env.COURTLY_MARKER_SOURCE_URL, process.env.COURTLY_MARKER_CHAT_ID];
  if (markers.some((marker) => !marker)) {
    throw new Error('Set COURTLY_MARKER_SOURCE_URL and COURTLY_MARKER_CHAT_ID to the synthetic values used in the build.');
  }
  const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
  if (!(await stat(join(dist, 'client'))).isDirectory()) throw new Error('dist/client is missing. Build first.');
  const hits = await findMarkers(dist, markers);
  for (const { file } of hits) console.error(`Private Telegram value found in ${file}`);
  if (hits.length) process.exit(1);
  console.log('No private Telegram values in the build output.');
}
