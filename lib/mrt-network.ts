export const MRT_SOURCE_URL = 'https://raw.githubusercontent.com/cheeaun/sgraildata/master/data/v1/sg-rail.geojson';
export const MRT_CACHE_KEY = 'courtly-mrt-network-v1';
export const MRT_CACHE_TTL = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 5 * 60 * 1000;

export const MRT_LINES = [
  { code: 'NS', name: 'North–South', sourceName: 'North South Line', color: '#d42e26' },
  { code: 'EW', name: 'East–West', sourceName: 'East West Line', color: '#009645' },
  { code: 'NE', name: 'North East', sourceName: 'North East Line', color: '#9900aa' },
  { code: 'CC', name: 'Circle', sourceName: 'Circle Line', color: '#d99000' },
  { code: 'DT', name: 'Downtown', sourceName: 'Downtown Line', color: '#005ec4' },
  { code: 'TE', name: 'Thomson–East Coast', sourceName: 'Thomson-East Coast Line', color: '#9d5b25' },
];

type Coordinate = [number, number];
export type MrtNetwork = {
  lines: Array<{ code: string; paths: Coordinate[][] }>;
  stations: Array<{ name: string; codes: string[]; coordinates: Coordinate }>;
};
type CacheEntry = { fetchedAt: number; retryAt?: number; network: MrtNetwork };
type CacheResult = { network: MrtNetwork; stale: boolean };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MRT data');
  return value as Record<string, unknown>;
}

function coordinate(value: unknown): Coordinate {
  if (!Array.isArray(value) || value.length < 2) throw new Error('Invalid MRT coordinate');
  const [lng, lat] = value;
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < 103.5 || lng > 104.1 || lat < 1.1 || lat > 1.5) throw new Error('MRT coordinate outside Singapore');
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

function paths(value: unknown): Coordinate[][] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Invalid MRT paths');
  return value.map((path: unknown) => {
    if (!Array.isArray(path) || path.length < 2 || path.length > 10000) throw new Error('Invalid MRT path');
    return path.map(coordinate);
  });
}

function validateNetwork(value: unknown): MrtNetwork {
  const data = record(value);
  if (!Array.isArray(data.lines) || data.lines.length !== 6 || !Array.isArray(data.stations) || data.stations.length < 100 || data.stations.length > 300) throw new Error('Incomplete MRT network');
  const lines = data.lines.map((value: unknown) => {
    const line = record(value);
    if (typeof line.code !== 'string' || !MRT_LINES.some((item) => item.code === line.code)) throw new Error('Invalid MRT line');
    return { code: line.code, paths: paths(line.paths) };
  });
  if (new Set(lines.map((line) => line.code)).size !== 6) throw new Error('Duplicate MRT lines');
  const stations = data.stations.map((value: unknown) => {
    const station = record(value);
    if (typeof station.name !== 'string' || !station.name.trim() || station.name.length > 100 || !Array.isArray(station.codes) || !station.codes.length || station.codes.length > 4 || !station.codes.every((code: unknown) => typeof code === 'string' && /^(NS|EW|NE|CC|DT|TE|CG)\d{0,2}[A-Z]?$/.test(code))) throw new Error('Invalid MRT station');
    return { name: station.name.trim(), codes: station.codes as string[], coordinates: coordinate(station.coordinates) };
  });
  return { lines, stations };
}

export function parseMrtGeoJson(value: unknown): MrtNetwork {
  const data = record(value);
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid MRT source');
  const lines: MrtNetwork['lines'] = [];
  const stations: MrtNetwork['stations'] = [];
  for (const feature of data.features) {
    const item = record(feature);
    const properties = record(item.properties);
    const geometry = record(item.geometry);
    if (typeof properties.network !== 'string' || !properties.network.includes('singapore-mrt')) continue;
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      const line = MRT_LINES.find((line) => line.sourceName === properties.name);
      if (line) lines.push({ code: line.code, paths: paths(geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates) });
    } else if (geometry.type === 'Point' && properties.stop_type === 'station') {
      if (typeof properties.name !== 'string' || typeof properties.station_codes !== 'string') throw new Error('Invalid MRT station source');
      stations.push({ name: properties.name, codes: properties.station_codes.split('-').filter((code) => /^(NS|EW|NE|CC|DT|TE|CG)/.test(code)), coordinates: coordinate(geometry.coordinates) });
    }
  }
  return validateNetwork({ lines, stations });
}

/** One refresh per day per device; deduplicate requests and preserve usable stale data. */
export class MrtNetworkCache {
  private entry: CacheEntry | null = null;
  private pending: Promise<CacheResult> | null = null;
  private fetcher: typeof fetch;
  private storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  private now: () => number;

  constructor({ fetcher = fetch, storage = () => localStorage, now = Date.now }: { fetcher?: typeof fetch; storage?: () => Pick<Storage, 'getItem' | 'setItem'>; now?: () => number } = {}) {
    this.fetcher = fetcher;
    this.storage = storage;
    this.now = now;
  }

  load(): Promise<CacheResult> {
    if (this.pending) return this.pending;
    if (!this.entry) {
      try {
        const raw = this.storage().getItem(MRT_CACHE_KEY);
        if (raw) {
          const saved = record(JSON.parse(raw));
          if (typeof saved.fetchedAt === 'number' && Number.isFinite(saved.fetchedAt) && saved.fetchedAt <= this.now()) {
            this.entry = { fetchedAt: saved.fetchedAt, network: validateNetwork(saved.network), retryAt: typeof saved.retryAt === 'number' ? Math.min(saved.retryAt, this.now() + RETRY_DELAY) : undefined };
          }
        }
      } catch { /* Ignore corrupt or inaccessible storage, then fetch fresh data. */ }
    }
    const stale = !this.entry || this.now() - this.entry.fetchedAt >= MRT_CACHE_TTL;
    if (this.entry && (!stale || (this.entry.retryAt ?? 0) > this.now())) return Promise.resolve({ network: this.entry.network, stale });
    this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }

  private save() {
    try { this.storage().setItem(MRT_CACHE_KEY, JSON.stringify(this.entry)); } catch { /* In-memory cache still works when device storage is full/disabled. */ }
  }

  private async refresh(): Promise<CacheResult> {
    try {
      // Browser fetch must be called without the cache instance as its receiver.
      const fetcher = this.fetcher;
      const response = await fetcher(MRT_SOURCE_URL, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('MRT source unavailable');
      const network = parseMrtGeoJson(await response.json());
      this.entry = { fetchedAt: this.now(), network };
      this.save();
      return { network, stale: false };
    } catch (error) {
      if (!this.entry) throw error;
      this.entry.retryAt = this.now() + RETRY_DELAY;
      this.save();
      return { network: this.entry.network, stale: true };
    }
  }
}

export const mrtNetworkCache = new MrtNetworkCache();
