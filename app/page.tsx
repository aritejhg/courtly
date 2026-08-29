'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, ArrowUpRight, Bus, Check, ChevronDown, Clock3, ExternalLink, MapPin, Menu, MessageCircle, Navigation, Plus, Search, TrainFront, X } from 'lucide-react';
import { getActiveListings } from '@/lib/ingestion';
import { seedListings } from '@/lib/listings';

type Sport = 'Badminton' | 'Tennis' | 'Basketball';
type TransitMode = 'MRT' | 'Bus' | 'Walk';
type Court = { id: string; name: string; area: string; sport: Sport; date: string; day: string; time: string; duration: string; price: number; owner: string; available: string; lat: number; lng: number; transit: Record<string, Record<TransitMode, number>> };
type SavedLocation = { id: string; name: string; address: string; color: string };

const TELEGRAM_URL = 'https://t.me/your_group_invite';
const INITIAL_LOCATIONS: SavedLocation[] = [
  { id: 'home', name: 'Home', address: 'Tiong Bahru', color: 'coral' },
  { id: 'studio', name: 'Studio', address: 'One-North', color: 'mint' },
  { id: 'work', name: 'Work', address: 'Raffles Place', color: 'sun' },
];
const courts: Court[] = [
  { id: 'queenstown', name: 'Queenstown Sports Centre', area: 'Queenstown', sport: 'Badminton', date: '30 Aug 2026', day: 'Sunday', time: '7:00–9:00 PM', duration: '2 hours', price: 9.20, owner: 'Sample Owner', available: 'Today · 7:00 PM', lat: 1.3022, lng: 103.7977, transit: { home: { MRT: 23, Bus: 31, Walk: 58 }, studio: { MRT: 18, Bus: 26, Walk: 44 }, work: { MRT: 21, Bus: 28, Walk: 66 } } },
  { id: 'tampines', name: 'Our Tampines Hub', area: 'Tampines', sport: 'Badminton', date: '1 Sep 2026', day: 'Tuesday', time: '10:00 AM–12:00 PM', duration: '2 hours', price: 8.50, owner: 'Sample Owner', available: 'Tue · 10:00 AM', lat: 1.3526, lng: 103.9404, transit: { home: { MRT: 35, Bus: 46, Walk: 88 }, studio: { MRT: 52, Bus: 65, Walk: 112 }, work: { MRT: 39, Bus: 53, Walk: 94 } } },
  { id: 'toapayoh', name: 'Toa Payoh Sports Hall', area: 'Toa Payoh', sport: 'Badminton', date: '30 Aug 2026', day: 'Sunday', time: '8:00–9:00 PM', duration: '1 hour', price: 6.80, owner: 'Sample Owner', available: 'Sun · 8:00 PM', lat: 1.3329, lng: 103.8511, transit: { home: { MRT: 17, Bus: 24, Walk: 45 }, studio: { MRT: 31, Bus: 39, Walk: 76 }, work: { MRT: 14, Bus: 21, Walk: 52 } } },
  { id: 'canberra', name: 'Bukit Canberra', area: 'Sembawang', sport: 'Tennis', date: '30 Aug 2026', day: 'Sunday', time: '9:00–11:00 AM', duration: '2 hours', price: 12.00, owner: 'Sample Owner', available: 'Sun · 9:00 AM', lat: 1.445, lng: 103.8185, transit: { home: { MRT: 43, Bus: 55, Walk: 110 }, studio: { MRT: 61, Bus: 75, Walk: 142 }, work: { MRT: 46, Bus: 62, Walk: 126 } } },
  { id: 'jurong', name: 'Jurong West Sports Centre', area: 'Jurong West', sport: 'Basketball', date: '4 Sep 2026', day: 'Friday', time: '6:30–8:30 PM', duration: '2 hours', price: 7.00, owner: 'Sample Owner', available: 'Fri · 6:30 PM', lat: 1.3423, lng: 103.7044, transit: { home: { MRT: 37, Bus: 49, Walk: 92 }, studio: { MRT: 26, Bus: 35, Walk: 66 }, work: { MRT: 42, Bus: 58, Walk: 101 } } },
  { id: 'kallang', name: 'Kallang Tennis Centre', area: 'Kallang', sport: 'Tennis', date: '30 Aug 2026', day: 'Sunday', time: '8:30–10:00 PM', duration: '1.5 hours', price: 10.00, owner: 'Sample Owner', available: 'Sun · 8:30 PM', lat: 1.3107, lng: 103.8727, transit: { home: { MRT: 25, Bus: 33, Walk: 61 }, studio: { MRT: 37, Bus: 45, Walk: 82 }, work: { MRT: 12, Bus: 18, Walk: 44 } } },
];
const areas = ['All areas', 'Central', 'East', 'North', 'West'];
const areaMap: Record<string, string[]> = { Central: ['Queenstown', 'Toa Payoh', 'Kallang'], East: ['Tampines'], North: ['Sembawang'], West: ['Jurong West'] };
const modeIcon = (mode: TransitMode) => mode === 'MRT' ? <TrainFront size={14} /> : mode === 'Bus' ? <Bus size={14} /> : <Navigation size={14} />;

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
  const [locations, setLocations] = useState<SavedLocation[]>(() => { if (typeof window === 'undefined') return INITIAL_LOCATIONS; const stored = window.localStorage.getItem('courtly-locations'); return stored ? JSON.parse(stored) : INITIAL_LOCATIONS; });
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [now] = useState(() => new Date());
  const activeListings = useMemo(() => getActiveListings(seedListings, now), [now]);
  const visibleCourts = useMemo(() => courts.filter((court) => activeListings.some((listing) => listing.facility === court.name)), [activeListings]);
  const filteredCourts = useMemo(() => visibleCourts.filter((court) => { const text = `${court.name} ${court.area} ${court.sport}`.toLowerCase(); return (!query.trim() || text.includes(query.toLowerCase().trim())) && (sport === 'All sports' || court.sport === sport) && (area === 'All areas' || areaMap[area]?.includes(court.area)); }), [area, query, sport, visibleCourts]);
  const selectedCourt = visibleCourts.find((court) => court.id === selectedId) ?? visibleCourts[0] ?? courts[0];
  const origin = locations.find((location) => location.id === originId) ?? locations[0];
  const eta = selectedCourt.transit[origin?.id ?? 'home']?.[mode] ?? selectedCourt.transit.home[mode];

  useEffect(() => { localStorage.setItem('courtly-locations', JSON.stringify(locations)); }, [locations]);
  useEffect(() => { if (!mapElement.current || mapRef.current) return; const map = L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: true }).setView([1.3521, 103.8198], 11); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map); L.control.zoom({ position: 'bottomright' }).addTo(map); markerLayer.current = L.layerGroup().addTo(map); mapRef.current = map; return () => { map.remove(); mapRef.current = null; markerLayer.current = null; }; }, []);
  useEffect(() => { if (!mapRef.current || !markerLayer.current) return; markerLayer.current.clearLayers(); filteredCourts.forEach((court) => { const marker = L.marker([court.lat, court.lng], { icon: L.divIcon({ className: `court-marker ${court.id === selectedId ? 'selected' : ''}`, html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }); marker.bindTooltip(court.name, { direction: 'top', offset: [0, -10] }); marker.on('click', () => setSelectedId(court.id)); marker.addTo(markerLayer.current!); }); }, [filteredCourts, selectedId]);
  function selectCourt(court: Court) { setSelectedId(court.id); mapRef.current?.flyTo([court.lat, court.lng], 14, { duration: .45 }); }
  function addLocation() { const name = newLocationName.trim(); if (!name) return; const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); setLocations((current) => [...current, { id, name, address: 'Saved location', color: 'lavender' }]); setOriginId(id); setNewLocationName(''); setLocationFormOpen(false); }

  return <main className="utility-shell">
    <header className="utility-header"><a className="utility-brand" href="#map"><span className="utility-brand-mark"><MapPin size={15} /></span>SG courts</a><div className="header-controls"><a className="group-link" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Telegram group <ArrowUpRight size={13} /></a><button className="menu-button" aria-label="Menu"><Menu size={19} /></button></div></header>
    <section className="toolbar" aria-label="Court filters"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courts" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</label><div className="select-box"><select value={sport} onChange={(event) => setSport(event.target.value as 'All sports' | Sport)} aria-label="Filter by sport"><option>All sports</option><option>Badminton</option><option>Tennis</option><option>Basketball</option></select><ChevronDown size={14} /></div><div className="select-box"><select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Filter by area">{areas.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div><span className="active-count">{filteredCourts.length} active</span></section>
    <section className="utility-layout" id="map"><div className="map-wrap"><div ref={mapElement} className="real-map" aria-label="OpenStreetMap of Singapore with court locations" /><div className="map-note"><span><span className="map-dot" />{activeListings.length} active listings</span><span>Click a pin for details</span></div></div><aside className="detail-panel"><div className="detail-top"><span className="route-label">Selected listing</span><span className="active-badge"><span />Active</span></div><div className="detail-title"><h1>{selectedCourt.name}</h1><span>{selectedCourt.area} · {selectedCourt.sport}</span></div><div className="detail-grid"><div><small>Date</small><strong>{selectedCourt.date}</strong><span>{selectedCourt.day}</span></div><div><small>Time</small><strong>{selectedCourt.time}</strong><span>{selectedCourt.duration}</span></div><div><small>Price</small><strong>${selectedCourt.price.toFixed(2)}</strong><span>per court</span></div><div><small>Owner</small><strong>{selectedCourt.owner}</strong><span>via Telegram</span></div></div><div className="detail-actions"><a className="primary-action" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open message</a><a className="secondary-action" href={TELEGRAM_URL} target="_blank" rel="noreferrer">Talk to owner <ArrowUpRight size={14} /></a></div><div className="transit-section"><div className="transit-heading"><span className="route-label">Get there</span><span>{origin?.name} → {selectedCourt.area}</span></div><div className="origin-line"><div className="select-box location-box"><span className={`location-dot ${origin?.color}`} /><select value={originId} onChange={(event) => setOriginId(event.target.value)} aria-label="Choose saved location">{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.address}</option>)}</select><ChevronDown size={13} /></div>{locationFormOpen ? <div className="add-form"><input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addLocation()} placeholder="New place" /><button onClick={addLocation} aria-label="Save place"><Check size={14} /></button><button onClick={() => setLocationFormOpen(false)} aria-label="Cancel"><X size={14} /></button></div> : <button className="add-place" onClick={() => setLocationFormOpen(true)}><Plus size={13} /> Add</button>}</div><div className="transit-bottom"><div className="mode-switcher" role="tablist">{(['MRT', 'Bus', 'Walk'] as TransitMode[]).map((item) => <button key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)} role="tab" aria-selected={mode === item}>{modeIcon(item)}{item}</button>)}</div><div className="eta"><strong>{eta}</strong><span>min</span></div><a className="directions" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedCourt.name + ', Singapore')}`} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a></div></div><a className="back-link" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><ArrowLeft size={14} /> Back to group</a></aside></section>
    <section className="saved-row" id="saved"><span className="route-label">Saved locations</span><div className="saved-list">{locations.map((location) => <button key={location.id} className={originId === location.id ? 'selected' : ''} onClick={() => setOriginId(location.id)}><span className={`location-dot ${location.color}`} /><span><strong>{location.name}</strong><small>{location.address}</small></span>{originId === location.id && <Check size={13} />}</button>)}</div></section>
  </main>;
}
