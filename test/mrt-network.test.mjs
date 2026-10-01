import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MRT_LINES, MRT_CACHE_KEY, MRT_CACHE_TTL, MrtNetworkCache } from '../lib/mrt-network.ts';

const source = () => ({ type: 'FeatureCollection', features: [
  ...MRT_LINES.map((line) => ({ properties: { network: 'singapore-mrt', name: line.sourceName }, geometry: { type: 'LineString', coordinates: [[103.8, 1.3], [103.85, 1.35]] } })),
  ...Array.from({ length: 146 }, (_, index) => ({ properties: { network: 'singapore-mrt', name: `Station ${index}`, stop_type: 'station', station_codes: 'NS1' }, geometry: { type: 'Point', coordinates: [103.8, 1.3] } })),
] });

function harness() {
  let now = Date.UTC(2026, 9, 1);
  let calls = 0;
  let failure = false;
  let payload = source();
  const saved = new Map();
  const storage = () => ({ getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) });
  const fetcher = async () => { calls++; if (failure) throw new Error('offline'); return Response.json(payload); };
  const create = () => new MrtNetworkCache({ storage, fetcher, now: () => now });
  return { create, saved, get calls() { return calls; }, advance(ms) { now += ms; }, offline() { failure = true; }, invalid() { payload = { type: 'FeatureCollection', features: [] }; } };
}

test('MRT cache deduplicates concurrent loads and survives a page reload for 24 hours', async () => {
  const h = harness();
  const cache = h.create();
  const results = await Promise.all([cache.load(), cache.load(), cache.load()]);
  assert.equal(h.calls, 1);
  assert.equal(results[0].network.lines.length, 6);
  assert.equal(results[0].network.stations.length, 146);
  assert.equal(results[0].stale, false);
  h.advance(MRT_CACHE_TTL - 1);
  await h.create().load();
  assert.equal(h.calls, 1);
  h.advance(1);
  await h.create().load();
  assert.equal(h.calls, 2);
});

test('offline refresh preserves the saved map and backs off across reloads', async () => {
  const h = harness();
  const first = await h.create().load();
  h.advance(MRT_CACHE_TTL);
  h.offline();
  const fallback = await h.create().load();
  assert.equal(fallback.stale, true);
  assert.deepEqual(fallback.network, first.network);
  assert.equal(h.calls, 2);
  assert.equal((await h.create().load()).stale, true);
  assert.equal(h.calls, 2);
  h.advance(5 * 60 * 1000);
  await h.create().load();
  assert.equal(h.calls, 3);
});

test('malformed refresh cannot replace a valid saved map', async () => {
  const h = harness();
  const first = await h.create().load();
  h.advance(MRT_CACHE_TTL);
  h.invalid();
  const next = await h.create().load();
  assert.equal(next.stale, true);
  assert.deepEqual(next.network, first.network);
  assert.deepEqual(JSON.parse(h.saved.get(MRT_CACHE_KEY)).network, first.network);
});

test('corrupt device cache is repaired; cold failures reject and can retry', async () => {
  const h = harness();
  h.saved.set(MRT_CACHE_KEY, '{broken');
  await h.create().load();
  assert.equal(h.calls, 1);
  assert.doesNotThrow(() => JSON.parse(h.saved.get(MRT_CACHE_KEY)));
  const empty = harness();
  empty.offline();
  const cache = empty.create();
  await assert.rejects(cache.load(), /offline/);
  await assert.rejects(cache.load(), /offline/);
  assert.equal(empty.calls, 2);
});

test('blocked storage still permits toggles without repeated fetches in the same tab', async () => {
  let calls = 0;
  const cache = new MrtNetworkCache({ storage: () => { throw new Error('Storage disabled'); }, fetcher: async () => { calls++; return Response.json(source()); } });
  await cache.load();
  await cache.load();
  assert.equal(calls, 1);
});
