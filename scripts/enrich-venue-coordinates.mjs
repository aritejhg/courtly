import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const overridesPath = resolve('data/venue-overrides.json');
const cachePath = resolve('data/venue-coordinate-cache.json');
const endpoint = 'https://www.onemap.gov.sg/api/common/elastic/search';

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
};
const writeJsonAtomic = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const variants = (value) => {
  const normalized = normalize(value);
  return [normalized, normalized.replace(/\bcommunity club\b/g, 'cc'), normalized.replace(/\bcc\b/g, 'community club')];
};

const overrides = await readJson(overridesPath, []);
const cache = await readJson(cachePath, {});
const unresolved = [];
let resolved = 0;

for (const venue of overrides) {
  if (Number.isFinite(venue.lat) && Number.isFinite(venue.lng)) continue;
  const queries = [...new Set([venue.address, venue.canonicalName, venue.canonicalName.replace(/\bCC\b/ig, 'Community Club'), `${venue.canonicalName} Singapore`].filter(Boolean))];
  let payload;
  let sourceQuery = queries[0];
  for (const query of queries) {
    const url = `${endpoint}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    for (let attempt = 0; attempt < 3 && !payload; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { 'user-agent': 'CourtlySG venue coordinate audit/1.0' } });
        const body = await response.text();
        if (body.trimStart().startsWith('<')) throw new Error('non_json_response');
        payload = JSON.parse(body);
      } catch (error) {
        if (attempt === 2 && query === queries.at(-1)) unresolved.push({ id: venue.id, canonicalName: venue.canonicalName, reason: `request_failed:${error.message}` });
        await sleep(1200 * (attempt + 1));
      }
    }
    if (payload?.results?.length) { sourceQuery = query; break; }
  }
  if (!payload) {
    continue;
  }
  const candidates = (payload.results || []).filter((item) => Number.isFinite(Number(item.LATITUDE)) && Number.isFinite(Number(item.LONGITUDE)));
  const wanted = variants(venue.canonicalName);
  const exact = candidates.filter((item) => {
    const text = normalize(`${item.SEARCHVAL} ${item.BUILDING} ${item.ADDRESS}`);
    return wanted.some((variant) => text.includes(variant)) || (venue.address && text.includes(normalize(venue.address)));
  });
  const chosen = exact.length ? exact.sort((a, b) => Number(Boolean(b.BUILDING)) - Number(Boolean(a.BUILDING)))[0] : candidates.length === 1 ? candidates[0] : null;
  if (!chosen) {
    unresolved.push({ id: venue.id, canonicalName: venue.canonicalName, reason: exact.length > 1 ? 'ambiguous' : 'no_unique_result' });
    continue;
  }
  cache[venue.id] = {
    lat: Number(chosen.LATITUDE),
    lng: Number(chosen.LONGITUDE),
    address: chosen.ADDRESS || venue.address,
    source: 'OneMap search',
    sourceQuery,
    resolvedAt: new Date().toISOString(),
  };
  resolved += 1;
}

await writeJsonAtomic(cachePath, cache);
console.log(JSON.stringify({ checked: overrides.length, resolved, cached: Object.keys(cache).length, unresolved }));
