'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import {
  ArrowUpRight,
  CarFront,
  Check,
  CalendarDays,
  ChevronDown,
  Clock3,
  MapPin,
  Menu,
  MessageCircle,
  Navigation,
  Plus,
  Search,
  TrainFront,
  X,
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getActiveListings } from '@/lib/ingestion';
import { matchesListingDateTime } from '@/lib/listing-filters';
import { telegramListings } from '@/lib/telegram-listings';
import { badmintonVenues, inferVenueArea, matchVenue } from '@/lib/venue-mapping';

type Sport = 'Badminton';
type TransitMode = 'Public transport' | 'Drive' | 'Walk';
type Court = {
  id: string;
  name: string;
  area: string;
  sport: Sport;
  date: string;
  day: string;
  time: string;
  duration: string;
  playAt: string;
  price: number | null;
  owner: string;
  available: string;
  lat?: number;
  lng?: number;
  sourceUrl: string;
  sourceMessageId: string;
  postedAt: string;
  ownerUsername?: string;
};
type SavedLocation = {
  id: string;
  name: string;
  address: string;
  color: string;
};
type RoutePlan = {
  minutes: number;
  leaveAt: string;
  arriveAt: string;
  source: 'OneMap' | 'Estimate';
};
type BackendStatus = 'checking' | 'connected' | 'unavailable';

const TELEGRAM_URL = 'https://t.me/your_group_invite';
const TELEGRAM_INTERNAL_CHAT_ID = '9876543210';
const LOCATIONS_STORAGE_KEY = 'courtly-locations';
const ORIGIN_STORAGE_KEY = 'courtly-origin-id';
const INITIAL_LOCATIONS: SavedLocation[] = [];
const RETIRED_LOCATION_IDS = new Set(['studio', 'work']);
const areas = ['All areas', 'Central', 'East', 'North', 'West'];
const areaMap: Record<string, string[]> = {
  Central: [
    'Clementi',
    'River Valley',
    'Outram',
    'Tiong Bahru',
    'Tanjong Pagar',
    'Toa Payoh',
    'Kallang',
    'Kolam Ayer',
    'Newton',
  ],
  East: ['East', 'Expo', 'Tampines', 'Pasir Ris', 'Serangoon'],
  North: [
    'Hougang',
    'Punggol',
    'Yishun',
    'Woodlands',
    'Sembawang',
    'Ang Mo Kio',
    'Sengkang',
  ],
  West: ['Jurong West', 'Jurong East', 'Bukit Gombak'],
};
const modeIcon = (mode: TransitMode) =>
  mode === 'Public transport' ? (
    <TrainFront size={14} />
  ) : mode === 'Drive' ? (
    <CarFront size={14} />
  ) : (
    <Navigation size={14} />
  );
const calendarDateKey = (value: Date) =>
  [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-');
const calendarDateFromKey = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : undefined;
};
const courts: Court[] = telegramListings.map((listing) => {
  const listingText = listing.listingText ?? listing.rawText;
  const persistedVenue = listing.venueId
    ? badmintonVenues.find((candidate) => candidate.id === listing.venueId)
    : undefined;
  const venue = listing.venueMatch === 'deterministic'
    ? persistedVenue ?? matchVenue(listingText).venue
    : listing.venueMatch
      ? undefined
      : persistedVenue ?? matchVenue(listingText).venue;
  const area = inferVenueArea(listingText, venue) ?? listing.area;
  return {
    id: listing.id,
    name: venue?.canonicalName ?? listing.facility,
    area,
    sport: 'Badminton',
    date: listing.displayDate,
    day: listing.displayDay,
    time: listing.displayTime,
    duration: listing.duration,
    playAt: listing.playAt,
    price: listing.price,
    owner: listing.owner,
    available: `${listing.displayDay} · ${listing.displayTime}`,
    lat: venue?.lat ?? listing.lat,
    lng: venue?.lng ?? listing.lng,
    sourceUrl: listing.sourceUrl,
    sourceMessageId: listing.sourceMessageId,
    postedAt: listing.postedAt,
    ownerUsername: listing.ownerUsername,
  };
});
const formatSingaporeTime = (value: Date) =>
  value.toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: 'numeric',
    minute: '2-digit',
  });
const lastUpdated = telegramListings.reduce((latest, listing) => Math.max(latest, Date.parse(listing.postedAt)), 0);
const geocodeCache = new Map<string, { lat: number; lng: number }>();
async function geocodeSavedLocation(address: string) {
  const query = `${address.trim()}, Singapore`;
  const cached = geocodeCache.get(query);
  if (cached) return cached;
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=sg&q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error('Could not find that saved location');
  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
  }>;
  const first = results[0];
  if (!first) throw new Error('Could not find that saved location');
  const point = { lat: Number(first.lat), lng: Number(first.lon) };
  geocodeCache.set(query, point);
  return point;
}
async function routeWithOneMap(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  playAt: Date,
  token: string,
) {
  const date = playAt
    .toLocaleDateString('en-GB', {
      timeZone: 'Asia/Singapore',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replaceAll('/', '-');
  const time = playAt.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Singapore',
    hour12: false,
  });
  const params = new URLSearchParams({
    date,
    mode: 'TRANSIT',
    maxWalkDistance: '1000',
    numItineraries: '1',
    routeType: 'pt',
    time,
    start: `${origin.lat},${origin.lng}`,
    end: `${destination.lat},${destination.lng}`,
  });
  const response = await fetch(
    `https://www.onemap.gov.sg/api/public/routingsvc/route?${params}`,
    { headers: { Authorization: token } },
  );
  if (!response.ok) throw new Error('OneMap route unavailable');
  const payload = (await response.json()) as {
    route_summary?: { total_time?: number };
    plan?: { itineraries?: Array<{ duration?: number }> };
  };
  const seconds =
    payload.route_summary?.total_time ??
    payload.plan?.itineraries?.[0]?.duration;
  if (!seconds) throw new Error('OneMap returned no route');
  return Math.max(1, Math.ceil(seconds / 60));
}
function fallbackTransitMinutes(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: TransitMode,
) {
  const latDelta = (destination.lat - origin.lat) * 111;
  const lngDelta =
    (destination.lng - origin.lng) *
    111 *
    Math.cos((origin.lat * Math.PI) / 180);
  const km = Math.sqrt(latDelta ** 2 + lngDelta ** 2);
  if (mode === 'Walk') return Math.max(1, Math.ceil(km / 0.08));
  if (mode === 'Drive') return Math.max(5, Math.ceil(km / 0.42 + 5));
  return Math.max(12, Math.ceil(km / 0.32 + 12));
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayer = useRef<LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('All areas');
  const [dateFilter, setDateFilter] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [originId, setOriginId] = useState('');
  const [mode, setMode] = useState<TransitMode>('Public transport');
  const [locations, setLocations] = useState<SavedLocation[]>(INITIAL_LOCATIONS);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [manageLocations, setManageLocations] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [backendCommit, setBackendCommit] = useState('');
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [listingEtaById, setListingEtaById] = useState<Record<string, number>>({});
  const [now] = useState(() => new Date());
  const activeListings = useMemo(
    () => getActiveListings(telegramListings, now),
    [now],
  );
  const dateTimeFilteredListings = useMemo(
    () => activeListings.filter((listing) => matchesListingDateTime(listing, {
      date: dateFilter,
      startTime: timeFrom,
      endTime: timeTo,
    })),
    [activeListings, dateFilter, timeFrom, timeTo],
  );
  const visibleCourts = useMemo(
    () =>
      courts.filter((court) =>
        dateTimeFilteredListings.some((listing) => listing.id === court.id),
      ),
    [dateTimeFilteredListings],
  );
  const filteredCourts = useMemo(
    () =>
      visibleCourts.filter((court) => {
        const text = `${court.name} ${court.area} ${court.sport}`.toLowerCase();
        return (
          (!query.trim() || text.includes(query.toLowerCase().trim())) &&
          (area === 'All areas' || areaMap[area]?.includes(court.area))
        );
      }),
    [area, query, visibleCourts],
  );
  const sortedCourts = useMemo(
    () => [...filteredCourts].sort((a, b) => Date.parse(a.playAt) - Date.parse(b.playAt)),
    [filteredCourts],
  );
  const selectedCourt = sortedCourts.find((court) => court.id === selectedId);
  const origin =
    locations.find((location) => location.id === originId) ?? locations[0];
  const messageId = selectedCourt?.sourceMessageId.split(':')[0];
  const messageUrl = messageId ? `https://t.me/c/${TELEGRAM_INTERNAL_CHAT_ID}/${messageId}` : '#';
  const ownerUrl = selectedCourt?.ownerUsername
    ? `https://t.me/${selectedCourt.ownerUsername.replace(/^@/, '')}`
    : messageUrl;
  const hasVerifiedCoordinates = Boolean(selectedCourt) && Number.isFinite(selectedCourt?.lat) && Number.isFinite(selectedCourt?.lng);
  const directionsUrl = hasVerifiedCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${selectedCourt?.lat},${selectedCourt?.lng}&travelmode=${mode === 'Public transport' ? 'transit' : mode === 'Drive' ? 'driving' : 'walking'}${origin?.address ? `&origin=${encodeURIComponent(origin.address + ', Singapore')}` : ''}`
    : null;

  useEffect(() => {
    let cancelled = false;
    async function calculateRoute() {
      if (
        !origin?.address ||
        !selectedCourt?.playAt ||
        !Number.isFinite(selectedCourt.lat) ||
        !Number.isFinite(selectedCourt.lng)
      ) {
        setRoutePlan(null);
        setRouteError('Verified coordinates unavailable for this venue');
        return;
      }
      setRouteLoading(true);
      setRoutePlan(null);
      setRouteError('');
      try {
        const originPoint = await geocodeSavedLocation(origin.address);
        const destination = { lat: selectedCourt.lat!, lng: selectedCourt.lng! };
        const playAt = new Date(selectedCourt.playAt);
        const token = (
          import.meta as ImportMeta & { env?: Record<string, string> }
        ).env?.VITE_ONEMAP_TOKEN;
        const minutes =
          token && mode === 'Public transport'
            ? await routeWithOneMap(originPoint, destination, playAt, token)
            : fallbackTransitMinutes(originPoint, destination, mode);
        const leaveAt = new Date(playAt.getTime() - (minutes + 10) * 60000);
        if (!cancelled)
          setRoutePlan({
            minutes,
            leaveAt: formatSingaporeTime(leaveAt),
            arriveAt: formatSingaporeTime(playAt),
            source:
              token && mode === 'Public transport' ? 'OneMap' : 'Estimate',
          });
      } catch (error) {
        if (!cancelled) {
          setRoutePlan(null);
          setRouteError(
            error instanceof Error
              ? error.message
              : 'Could not calculate route',
          );
        }
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    }
    void calculateRoute();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    origin?.address,
    selectedCourt?.id,
    selectedCourt?.lat,
    selectedCourt?.lng,
    selectedCourt?.playAt,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function calculateListingEtas() {
      if (!origin?.address) {
        setListingEtaById({});
        return;
      }
      try {
        const originPoint = await geocodeSavedLocation(origin.address);
        const next = Object.fromEntries(
          sortedCourts
            .filter((court) => Number.isFinite(court.lat) && Number.isFinite(court.lng))
            .map((court) => [
              court.id,
              fallbackTransitMinutes(originPoint, { lat: court.lat!, lng: court.lng! }, 'Public transport'),
            ]),
        );
        if (!cancelled) setListingEtaById(next);
      } catch {
        if (!cancelled) setListingEtaById({});
      }
    }
    void calculateListingEtas();
    return () => {
      cancelled = true;
    };
  }, [origin?.address, sortedCourts]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void fetch('/api/build', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok
        ? response.json() as Promise<{ commit?: string }>
        : Promise.reject(new Error('Build info unavailable')))
      .then((payload) => {
        if (!cancelled && payload.commit) {
          setBackendCommit(payload.commit);
          setBackendStatus('connected');
        } else if (!cancelled) {
          setBackendStatus('unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) setBackendStatus('unavailable');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCATIONS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SavedLocation[];
        const valid = parsed.filter(
          (location) =>
            typeof location?.id === 'string' &&
            !RETIRED_LOCATION_IDS.has(location.id) &&
            typeof location?.name === 'string' &&
            typeof location?.address === 'string' &&
            Boolean(location.name.trim()) &&
            Boolean(location.address.trim()),
        );
        if (valid.length) {
          setLocations(valid);
          const storedOriginId = localStorage.getItem(ORIGIN_STORAGE_KEY);
          setOriginId(
            storedOriginId && valid.some((location) => location.id === storedOriginId)
              ? storedOriginId
              : valid[0].id,
          );
        }
      }
    } catch {
      // Ignore malformed browser data and retain the safe defaults.
    } finally {
      setLocationsLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (!locationsLoaded) return;
    localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(locations));
  }, [locations, locationsLoaded]);
  useEffect(() => {
    if (!locationsLoaded || !originId) return;
    localStorage.setItem(ORIGIN_STORAGE_KEY, originId);
  }, [locationsLoaded, originId]);
  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    let cancelled = false;
    let map: LeafletMap | null = null;
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !mapElement.current) return;
      map = L.map(mapElement.current, {
        zoomControl: false,
        scrollWheelZoom: true,
      }).setView([1.3521, 103.8198], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      markerLayer.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerLayer.current = null;
      setMapReady(false);
    };
  }, []);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !markerLayer.current) return;
    let cancelled = false;
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !markerLayer.current) return;
      markerLayer.current.clearLayers();
      const positions = new Map<string, number>();
      sortedCourts.forEach((court) => {
        if (!Number.isFinite(court.lat) || !Number.isFinite(court.lng)) return;
        const key = `${court.lat},${court.lng}`;
        const duplicateIndex = positions.get(key) ?? 0;
        positions.set(key, duplicateIndex + 1);
        const angle = duplicateIndex * 1.4;
         const lat = court.lat! + (duplicateIndex ? Math.sin(angle) * 0.0012 : 0);
         const lng = court.lng! + (duplicateIndex ? Math.cos(angle) * 0.0012 : 0);
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: `court-marker ${court.id === selectedId ? 'selected' : ''}`,
            html: '<span></span>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        });
        marker.bindTooltip(court.name, { direction: 'top', offset: [0, -10] });
        marker.on('click', () => setSelectedId(court.id));
        marker.addTo(markerLayer.current!);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sortedCourts, mapReady, selectedId]);
  function addLocation() {
    const name = newLocationName.trim();
    const address = newLocationAddress.trim();
    if (!name || !address) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    setLocations((current) => [
      ...current,
      {
        id,
        name,
        address,
        color: 'lavender',
      },
    ]);
    setOriginId(id);
    setNewLocationName('');
    setNewLocationAddress('');
  }
  function updateLocation(
    id: string,
    field: 'name' | 'address',
    value: string,
  ) {
    setLocations((current) =>
      current.map((location) =>
        location.id === id ? { ...location, [field]: value } : location,
      ),
    );
  }
  function removeLocation(id: string) {
    if (locations.length === 1) return;
    const next = locations.filter((location) => location.id !== id);
    setLocations(next);
    if (originId === id) setOriginId(next[0].id);
  }

  return (
    <main className="utility-shell">
      <header className="utility-header">
        <a className="utility-brand" href="#map">
          <span className="utility-brand-mark">
            <MapPin size={15} />
          </span>
          SG courts
        </a>
        <div className="header-controls">
          <span className="last-updated">Updated {lastUpdated ? new Date(lastUpdated).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'recently'}</span>
          <a
            className="group-link"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={15} /> Telegram group{' '}
            <ArrowUpRight size={13} />
          </a>
          <button className="menu-button" aria-label="Menu">
            <Menu size={19} />
          </button>
        </div>
      </header>
      <section className="toolbar" aria-label="Court filters">
        <label className={`search-box${query ? ' is-active' : ''}`}>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search courts"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <div className={`select-box${area !== 'All areas' ? ' is-active' : ''}`}>
          <select
            value={area}
            onChange={(event) => setArea(event.target.value)}
            aria-label="Filter by area"
          >
            {areas.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <div className={`date-filter${dateFilter ? ' is-active' : ''}`}>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger className="date-filter-trigger" aria-label="Choose date">
              <CalendarDays size={16} />
              <span>{dateFilter ? format(calendarDateFromKey(dateFilter)!, 'd MMM yyyy') : 'Any date'}</span>
            </PopoverTrigger>
            <PopoverContent className="date-popover" align="start">
              <Calendar
                mode="single"
                selected={calendarDateFromKey(dateFilter)}
          onSelect={(value) => {
            setDateFilter(value ? calendarDateKey(value) : '');
            setCalendarOpen(false);
          }}
          captionLayout="dropdown"
        />
              {dateFilter && (
                <button
                  className="calendar-clear"
                  onClick={() => {
                    setDateFilter('');
                    setCalendarOpen(false);
                  }}
                >
                  Clear date
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <div className={`time-filter${timeFrom || timeTo ? ' is-active' : ''}`} aria-label="Filter by time">
          <Clock3 size={16} />
          <input
            type="time"
            value={timeFrom}
            onChange={(event) => setTimeFrom(event.target.value)}
            aria-label="Start time"
          />
          <span>–</span>
          <input
            type="time"
            value={timeTo}
            onChange={(event) => setTimeTo(event.target.value)}
            aria-label="End time"
          />
        </div>
        {(dateFilter || timeFrom || timeTo) && (
          <button
            className="clear-filters"
            onClick={() => {
              setDateFilter('');
              setTimeFrom('');
              setTimeTo('');
            }}
          >
            Clear
          </button>
        )}
        <span className="active-count">{filteredCourts.length} active</span>
      </section>
      <section className={`utility-layout ${selectedCourt ? 'has-drawer' : ''}`} id="map">
        <section className="listing-rail" aria-label="Matching listings">
          <div className="listing-rail-heading">
            <div>
              <span className="eyebrow">Matched listings</span>
              <h2>{sortedCourts.length} available courts</h2>
            </div>
            <span className="sort-note">Earliest first</span>
          </div>
          <div className="listing-results-list">
            {sortedCourts.length ? sortedCourts.map((court) => {
              const courtMessageId = court.sourceMessageId.split(':')[0];
              const courtMessageUrl = `https://t.me/c/${TELEGRAM_INTERNAL_CHAT_ID}/${courtMessageId}`;
              const courtOwnerUrl = court.ownerUsername
                ? `https://t.me/${court.ownerUsername.replace(/^@/, '')}`
                : courtMessageUrl;
              const eta = court.id === selectedCourt?.id && routePlan ? routePlan.minutes : listingEtaById[court.id];
              return (
                <article className={`listing-card ${court.id === selectedCourt?.id ? 'selected' : ''}`} key={court.id}>
                  <button className="listing-card-main" type="button" onClick={() => setSelectedId((current) => current === court.id ? '' : court.id)} aria-expanded={court.id === selectedCourt?.id}>
                    <span className="listing-card-title">
                      <span className="listing-card-name">{court.name}</span>
                      <span className="listing-card-locality">({court.area})</span>
                    </span>
                    <span className="listing-card-meta"><Clock3 size={13} />{court.date} · {court.time}</span>
                    <span className="listing-card-facts"><strong>{court.price === null ? 'Price on request' : `$${court.price.toFixed(2)} / court`}</strong><span className="listing-eta"><TrainFront size={13} />{eta ? `${eta} min` : '—'}</span></span>
                  </button>
                  <div className="listing-card-actions">
                    <a href={courtMessageUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={`Open message for ${court.name}`} title="Open Telegram message"><MessageCircle size={15} /></a>
                    <a href={courtOwnerUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={`Contact ${court.owner}`} title="Contact owner"><ArrowUpRight size={15} /></a>
                  </div>
                </article>
              );
            }) : <output className="listing-empty">No listings match these filters.</output>}
          </div>
        </section>
        {selectedCourt ? (
          <aside className="detail-panel detail-drawer" aria-label="Selected listing details">
            <button className="drawer-close" type="button" onClick={() => setSelectedId('')} aria-label="Close listing details" title="Close listing details"><X size={16} /></button>
          <div className="detail-title">
            <h1>{selectedCourt.name}</h1>
            <span>
              {selectedCourt.area} · {selectedCourt.sport}
            </span>
          </div>
          <div className="detail-grid">
            <div>
              <small>Date</small>
              <strong>{selectedCourt.date}</strong>
              <span>{selectedCourt.day}</span>
            </div>
            <div>
              <small>Time</small>
              <strong>{selectedCourt.time}</strong>
              <span>{selectedCourt.duration}</span>
            </div>
            <div>
              <small>Price</small>
              <strong>
                {selectedCourt.price === null
                  ? '—'
                  : `$${selectedCourt.price.toFixed(2)}`}
              </strong>
              <span>per court</span>
            </div>
            <div>
              <small>Owner</small>
              <strong>{selectedCourt.owner}</strong>
              <span>via Telegram</span>
            </div>
          </div>
          <div className="detail-actions">
            <a
              className="primary-action"
              href={messageUrl}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={15} /> Open message
            </a>
            <a
              className="secondary-action"
              href={ownerUrl}
              target="_blank"
              rel="noreferrer"
            >
              Talk to owner <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="transit-section">
            <div className="transit-heading">
              <span className="route-label">
                Arrive by {formatSingaporeTime(new Date(selectedCourt.playAt))}
              </span>
              <span>
                {origin?.name} → {selectedCourt.name}
              </span>
            </div>
            <div className="origin-line">
              <div className="select-box location-box">
                <select
                  value={originId}
                  onChange={(event) => setOriginId(event.target.value)}
                  aria-label="Choose saved location"
                >
                  {locations.length === 0 && (
                    <option value="" disabled>Add a location</option>
                  )}
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} · {location.address}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
              <button
                className="add-place"
                onClick={() => setManageLocations((current) => !current)}
              >
                {manageLocations ? <Check size={15} /> : <Plus size={15} />}
                {manageLocations ? 'Done' : 'Edit locations'}
              </button>
            </div>
            {manageLocations && (
              <div className="location-manager inline-location-manager">
                {locations.map((location) => (
                  <div className="location-editor" key={location.id}>
                    <input value={location.name} onChange={(event) => updateLocation(location.id, 'name', event.target.value)} aria-label={`${location.name} name`} />
                    <input value={location.address} onChange={(event) => updateLocation(location.id, 'address', event.target.value)} aria-label={`${location.name} address`} />
                    <button onClick={() => removeLocation(location.id)} disabled={locations.length === 1} aria-label={`Delete ${location.name}`}><X size={16} /></button>
                  </div>
                ))}
                <div className="location-editor new-location">
                  <input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="Name" aria-label="New location name" />
                  <input value={newLocationAddress} onChange={(event) => setNewLocationAddress(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addLocation()} placeholder="Postal code or address" aria-label="New location address" />
                  <button onClick={addLocation} disabled={!newLocationName.trim() || !newLocationAddress.trim()} aria-label="Add location" title={!newLocationName.trim() || !newLocationAddress.trim() ? 'Enter a name and postal code or address' : 'Save location'}><Plus size={16} /></button>
                </div>
              </div>
            )}
            <div className="transit-bottom">
              <div className="mode-switcher" role="tablist">
                {(['Public transport', 'Drive', 'Walk'] as TransitMode[]).map((item) => (
                  <button
                    key={item}
                    className={mode === item ? 'selected' : ''}
                    onClick={() => setMode(item)}
                    role="tab"
                    aria-selected={mode === item}
                  >
                    {modeIcon(item)}
                    {item}
                  </button>
                ))}
              </div>
              <div className="eta">
                <strong>
                  {routeLoading ? '…' : (routePlan?.minutes ?? '—')}
                </strong>
                <span>min</span>
              </div>
              {routePlan && (
                <div className="route-leave">
                  <strong>Leave by {routePlan.leaveAt}</strong>
                  <small>
                    Arrive {routePlan.arriveAt} · {routePlan.source}
                  </small>
                </div>
              )}
              {!routePlan && !routeLoading && (
                <div className="route-leave">
                  <strong>{routeError || 'Calculating route…'}</strong>
                  <small>Uses saved location</small>
                </div>
              )}
              {directionsUrl ? (
                <a
                  className="directions"
                  href={directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={13} /> Directions
                </a>
              ) : (
                <span className="directions disabled" aria-disabled="true">
                  <Navigation size={13} /> Directions unavailable
                </span>
              )}
            </div>
          </div>
          </aside>
        ) : null}
        <div className="map-wrap">
          <div
            ref={mapElement}
            className="real-map"
            aria-label="OpenStreetMap of Singapore with court locations"
          />
          <div className="map-note">
            <span>
              <span className="map-dot" />
              {filteredCourts.length} matching listings
            </span>
            <span>Click a pin for details</span>
          </div>
        </div>
      </section>
      <footer className="build-footer" aria-label="Backend build version">
        <output className={`build-footer-status ${backendStatus}`}>
          <span className="build-footer-dot" aria-hidden="true" />
          {backendStatus === 'connected' ? (
            <>Backend build <code>{backendCommit}</code></>
          ) : backendStatus === 'checking' ? (
            'Checking backend…'
          ) : (
            'Backend unavailable'
          )}
        </output>
      </footer>
    </main>
  );
}
