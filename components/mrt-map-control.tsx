'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LayerGroup, Map } from 'leaflet';
import type { MrtNetwork } from '@/lib/mrt-network';
import { Info, TrainFront } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const STORAGE_KEY = 'courtly-mrt-overlay';

export function MrtMapControl({ mapRef, mapReady }: { mapRef: RefObject<Map | null>; mapReady: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'stale' | 'error'>('idle');
  const [lines, setLines] = useState<Array<{ code: string; name: string; color: string }>>([]);
  const layerRef = useRef<{ map: Map; layer: LayerGroup; network: MrtNetwork } | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try { setEnabled(localStorage.getItem(STORAGE_KEY) === 'true'); } catch { /* Storage can be disabled. */ }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Toggle still works without storage. */ }
  }, [enabled, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !enabled) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setStatus('loading'); });
    void import('@/lib/mrt-layer').then(async ({ createMrtLayer, MRT_LINES, mrtNetworkCache }) => {
      const { network, stale } = await mrtNetworkCache.load();
      if (cancelled) return;
      if (layerRef.current?.map !== map || layerRef.current.network !== network) {
        layerRef.current?.layer.remove();
        layerRef.current = { map, layer: createMrtLayer(map, network), network };
      }
      layerRef.current.layer.addTo(map);
      setLines(MRT_LINES);
      setStatus(stale ? 'stale' : 'ready');
    }).catch(() => {
      if (!cancelled) {
        layerRef.current?.layer.remove();
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
      layerRef.current?.layer.remove();
    };
  }, [enabled, mapReady, mapRef]);

  return (
    <div className="map-layer-controls">
      <button
        type="button"
        className={`mrt-toggle${enabled ? ' is-active' : ''}`}
        aria-label="MRT overlay"
        aria-pressed={enabled}
        title={enabled ? 'Hide MRT overlay' : 'Show MRT overlay'}
        disabled={!mapReady || !loaded}
        onClick={() => setEnabled((value) => !value)}
      >
        <TrainFront size={17} aria-hidden="true" />
        <span className="mrt-toggle-label">MRT</span>
        <span className="mrt-switch" aria-hidden="true"><span /></span>
      </button>
      {enabled && (status === 'ready' || status === 'stale') && (
        <Popover>
          <PopoverTrigger className="mrt-info" aria-label="MRT line colours">
            <Info size={18} />
          </PopoverTrigger>
          <PopoverContent className="mrt-legend" align="end">
            <strong>MRT lines</strong>
            <ul>
              {lines.map((line) => (
                <li key={line.code}>
                  <span className="mrt-line-badge" style={{ background: line.color }}>{line.code}</span>
                  {line.name}
                </li>
              ))}
            </ul>
            <p>Tap a station for its name. Zoom in for labels.</p>
            <p>{status === 'stale' ? 'Using a saved map. Refresh temporarily unavailable.' : 'Saved on this device. Refreshes once a day.'}</p>
            <small>Indicative alignments · <a href="https://github.com/cheeaun/sgraildata" target="_blank" rel="noreferrer">SG Rail Data</a></small>
          </PopoverContent>
        </Popover>
      )}
      <output className="mrt-status" aria-live="polite">
        {enabled && status === 'loading' ? 'Loading MRT…' : enabled && status === 'error' ? 'MRT unavailable. Toggle to retry.' : ''}
      </output>
    </div>
  );
}
