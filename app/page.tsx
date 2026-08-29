'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, ArrowUpRight, Bus, Check, ChevronDown, MapPin, Menu, MessageCircle, Navigation, Plus, Search, TrainFront, X } from 'lucide-react';
import { getActiveListings } from '@/lib/ingestion';
import { telegramListings } from '@/lib/telegram-listings';

type Sport = 'Badminton' | 'Tennis' | 'Basketball';
type TransitMode = 'MRT' | 'Bus' | 'Walk';
type Court = { id: string; name: string; area: string; sport: Sport; date: string; day: string; time: string; duration: string; price: number | null; owner: string; available: string; lat: number; lng: number; transit: Record<string, Record<TransitMode, number>> };
type SavedLocation = { id: string; name: string; address: string; color: string };

const TELEGRAM_URL = 'https://t.me/your_group_invite';
const INITIAL_LOCATIONS: SavedLocation[] = [
  { id: 'home', name: 'Home', address: '323108', color: 'coral' },
  { id: 'studio', name: 'Studio', address: 'One-North', color: 'mint' },
  { id: 'work', name: 'Work', address: 'Raffles Place', color: 'sun' },
];
const areas = ['All areas', 'Central', 'East', 'North', 'West'];
const areaMap: Record<string, string[]> = { Central: ['Clementi', 'River Valley', 'Outram', 'Tiong Bahru', 'Tanjong Pagar', 'Toa Payoh', 'Kallang', 'Kolam Ayer', 'Newton'], East: ['East', 'Expo', 'Tampines', 'Pasir Ris', 'Serangoon'], North: ['Hougang', 'Punggol', 'Yishun', 'Woodlands', 'Sembawang', 'Ang Mo Kio', 'Sengkang'], West: ['Jurong West', 'Jurong East', 'Bukit Gombak'] };
const modeIcon = (mode: TransitMode) => mode === 'MRT' ? <TrainFront size={14} /> : mode === 'Bus' ? <Bus size={14} /> : <Navigation size={14} />;
const transitFor = (area: string): Record<string, Record<TransitMode, number>> => {
  const base: Record<string, number> = { Central: 22, East: 40, North: 35, West: 35, 'South West': 28 };
  const key = areaMap.Central.includes(area) ? 'Central' : areaMap.East.includes(area) ? 'East' : areaMap.North.includes(area) ? 'North' : 'West';
  const minutes = base[key] ?? 30;
  return { home: { MRT: minutes, Bus: minutes + 10, Walk: minutes * 2 + 12 }, studio: { MRT: minutes + 7, Bus: minutes + 17, Walk: minutes * 2 + 25 }, work: { MRT: Math.max(12, minutes - 4), Bus: minutes + 6, Walk: minutes * 2 + 18 } };
};
const courts: Court[] = telegramListings.map((listing) => ({ id: listing.id, name: listing.facility, area: listing.area, sport: listing.sport === 'Other' ? 'Badminton' : listing.sport, date: listing.displayDate, day: listing.displayDay, time: listing.displayTime, duration: listing.duration, price: listing.price, owner: listing.owner, available: `${listing.displayDay} · ${listing.displayTime}`, lat: listing.lat, lng: listing.lng, transit: transitFor(listing.area) }));

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const [selectedId, setSelectedId] = useState('queenstown');
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<'All sports' | Sport>('All sports');
  const [area, setArea] = useState('All areas');
  const [originId, setOriginId] = useState('home');
  const [mode, setMode] = useState<TransitMode>('MRT');
  const [locations, setLocations] = useState<SavedLocation[]>(() => { if (typeof window === 'undefined') return INITIAL_LOCATIONS; const stored = window.localStorage.getItem('courtly-locations'); const parsed = stored ? JSON.parse(stored) : INITIAL_LOCATIONS; return parsed.map((location: SavedLocation) => location.id === 'home' ? { ...location, address: '323108' } : location); });
  const [manageLocations, setManageLocations] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [now] = useState(() => new Date());
  const activeListings = useMemo(() => getActiveListings(telegramListings, now), [now]);
  const visibleCourts = useMemo(() => courts.filter((court) => activeListings.some((listing) => listing.id === court.id)), [activeListings]);
  const filteredCourts = useMemo(() => visibleCourts.filter((court) => { const text = `${court.name} ${court.area} ${court.sport}`.toLowerCase(); return (!query.trim() || text.includes(query.toLowerCase().trim())) && (sport === 'All sports' || court.sport === sport) && (area === 'All areas' || areaMap[area]?.includes(court.area)); }), [area, query, sport, visibleCourts]);
  const selectedCourt = visibleCourts.find((court) => court.id === selectedId) ?? visibleCourts[0] ?? courts[0];
  const origin = locations.find((location) => location.id === originId) ?? locations[0];
  const eta = selectedCourt.transit[origin?.id ?? 'home']?.[mode] ?? selectedCourt.transit.home[mode];

  useEffect(() => { localStorage.setItem('courtly-locations', JSON.stringify(locations)); }, [locations]);
  useEffect(() => { if (!mapElement.current || mapRef.current) return; const map = L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: true }).setView([1.3521, 103.8198], 11); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map); L.control.zoom({ position: 'bottomright' }).addTo(map); markerLayer.current = L.layerGroup().addTo(map); mapRef.current = map; return () => { map.remove(); mapRef.current = null; markerLayer.current = null; }; }, []);
  useEffect(() => { if (!mapRef.current || !markerLayer.current) return; markerLayer.current.clearLayers(); const positions = new Map<string, number>(); filteredCourts.forEach((court) => { const key = `${court.lat},${court.lng}`; const duplicateIndex = positions.get(key) ?? 0; positions.set(key, duplicateIndex + 1); const angle = duplicateIndex * 1.4; const lat = court.lat + (duplicateIndex ? Math.sin(angle) * 0.0012 : 0); const lng = court.lng + (duplicateIndex ? Math.cos(angle) * 0.0012 : 0); const marker = L.marker([lat, lng], { icon: L.divIcon({ className: `court-marker ${court.id === selectedId ? 'selected' : ''}`, html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }); marker.bindTooltip(court.name, { direction: 'top', offset: [0, -10] }); marker.on('click', () => setSelectedId(court.id)); marker.addTo(markerLayer.current!); }); }, [filteredCourts, selectedId]);
  function addLocation() { const name = newLocationName.trim(); if (!name) return; const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`; setLocations((current) => [...current, { id, name, address: newLocationAddress.trim() || 'Saved location', color: 'lavender' }]); setOriginId(id); setNewLocationName(''); setNewLocationAddress(''); }
  function updateLocation(id: string, field: 'name' | 'address', value: string) { setLocations((current) => current.map((location) => location.id === id ? { ...location, [field]: value } : location)); }
  function removeLocation(id: string) { if (locations.length === 1) return; const next = locations.filter((location) => location.id !== id); setLocations(next); if (originId === id) setOriginId(next[0].id); }

  return <main className="utility-shell">
    <header className="utility-header"><a className="utility-brand" href="#map"><span className="utility-brand-mark"><MapPin size={15} /></span>SG courts</a><div className="header-controls"><a className="group-link" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Telegram group <ArrowUpRight size={13} /></a><button className="menu-button" aria-label="Menu"><Menu size={19} /></button></div></header>
    <section className="toolbar" aria-label="Court filters"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courts" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</label><div className="select-box"><select value={sport} onChange={(event) => setSport(event.target.value as 'All sports' | Sport)} aria-label="Filter by sport"><option>All sports</option><option>Badminton</option><option>Tennis</option><option>Basketball</option></select><ChevronDown size={14} /></div><div className="select-box"><select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Filter by area">{areas.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div><span className="active-count">{filteredCourts.length} active</span></section>
    <section className="utility-layout" id="map"><div className="map-wrap"><div ref={mapElement} className="real-map" aria-label="OpenStreetMap of Singapore with court locations" /><div className="map-note"><span><span className="map-dot" />{activeListings.length} active listings</span><span>Click a pin for details</span></div></div><aside className="detail-panel"><div className="detail-top"><span className="route-label">Selected listing</span><span className="active-badge"><span />Active</span></div><div className="detail-title"><h1>{selectedCourt.name}</h1><span>{selectedCourt.area} · {selectedCourt.sport}</span></div><div className="detail-grid"><div><small>Date</small><strong>{selectedCourt.date}</strong><span>{selectedCourt.day}</span></div><div><small>Time</small><strong>{selectedCourt.time}</strong><span>{selectedCourt.duration}</span></div><div><small>Price</small><strong>{selectedCourt.price === null ? '—' : `$${selectedCourt.price.toFixed(2)}`}</strong><span>per court</span></div><div><small>Owner</small><strong>{selectedCourt.owner}</strong><span>via Telegram</span></div></div><div className="detail-actions"><a className="primary-action" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open message</a><a className="secondary-action" href={TELEGRAM_URL} target="_blank" rel="noreferrer">Talk to owner <ArrowUpRight size={14} /></a></div><div className="transit-section"><div className="transit-heading"><span className="route-label">Get there</span><span>{origin?.name} → {selectedCourt.area}</span></div><div className="origin-line"><div className="select-box location-box"><span className={`location-dot ${origin?.color}`} /><select value={originId} onChange={(event) => setOriginId(event.target.value)} aria-label="Choose saved location">{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.address}</option>)}</select><ChevronDown size={13} /></div><button className="add-place" onClick={() => setManageLocations(true)}><Plus size={13} /> Edit locations</button></div><div className="transit-bottom"><div className="mode-switcher" role="tablist">{(['MRT', 'Bus', 'Walk'] as TransitMode[]).map((item) => <button key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)} role="tab" aria-selected={mode === item}>{modeIcon(item)}{item}</button>)}</div><div className="eta"><strong>{eta}</strong><span>min</span></div><a className="directions" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedCourt.name + ', Singapore')}`} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a></div></div><a className="back-link" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><ArrowLeft size={14} /> Back to group</a></aside></section>
    <section className="saved-row" id="saved"><div className="saved-row-heading"><span className="route-label">Saved locations</span><button className="manage-button" onClick={() => setManageLocations((current) => !current)}>{manageLocations ? 'Done' : 'Edit locations'}</button></div>{manageLocations ? <div className="location-manager">{locations.map((location) => <div className="location-editor" key={location.id}><input value={location.name} onChange={(event) => updateLocation(location.id, 'name', event.target.value)} aria-label={`${location.name} name`} /><input value={location.address} onChange={(event) => updateLocation(location.id, 'address', event.target.value)} aria-label={`${location.name} address`} /><button onClick={() => removeLocation(location.id)} disabled={locations.length === 1} aria-label={`Delete ${location.name}`}><X size={14} /></button></div>)}<div className="location-editor new-location"><input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="Name" aria-label="New location name" /><input value={newLocationAddress} onChange={(event) => setNewLocationAddress(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addLocation()} placeholder="Postal code or address" aria-label="New location address" /><button onClick={addLocation} aria-label="Add location"><Plus size={14} /></button></div></div> : <div className="saved-list">{locations.map((location) => <button key={location.id} className={originId === location.id ? 'selected' : ''} onClick={() => setOriginId(location.id)}><span className={`location-dot ${location.color}`} /><span><strong>{location.name}</strong><small>{location.address}</small></span>{originId === location.id && <Check size={13} />}</button>)}</div>}</section>
  </main>;
}
