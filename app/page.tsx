'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-autofocus */

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bookmark, Bus, Check, ChevronDown, Clock3, ExternalLink, MapPin, Menu, MessageCircle, Navigation, Plus, Search, TrainFront, UserRound, X } from 'lucide-react';
import { getActiveListings } from '@/lib/ingestion';
import { seedListings } from '@/lib/listings';

type Sport = 'Badminton' | 'Tennis' | 'Basketball';
type TransitMode = 'MRT' | 'Bus' | 'Walk';
type Court = { id: string; name: string; area: string; sport: Sport; available: string; note: string; position: { left: string; top: string }; transit: Record<string, Record<TransitMode, number>> };
type SavedLocation = { id: string; name: string; address: string; color: string };

const TELEGRAM_URL = 'https://t.me/sgbadm';
const initialLocations: SavedLocation[] = [
  { id: 'home', name: 'Home', address: 'Tiong Bahru', color: 'coral' },
  { id: 'studio', name: 'Studio', address: 'One-North', color: 'mint' },
  { id: 'work', name: 'Work', address: 'Raffles Place', color: 'sun' },
];
const courts: Court[] = [
  { id: 'queenstown', name: 'Queenstown Sports Centre', area: 'Queenstown', sport: 'Badminton', available: 'Today · 7:00 PM', note: '1 court swap posted', position: { left: '30%', top: '52%' }, transit: { home: { MRT: 23, Bus: 31, Walk: 58 }, studio: { MRT: 18, Bus: 26, Walk: 44 }, work: { MRT: 21, Bus: 28, Walk: 66 } } },
  { id: 'tampines', name: 'Our Tampines Hub', area: 'Tampines', sport: 'Badminton', available: 'Sat · 10:00 AM', note: '4 swap offers', position: { left: '76%', top: '52%' }, transit: { home: { MRT: 35, Bus: 46, Walk: 88 }, studio: { MRT: 52, Bus: 65, Walk: 112 }, work: { MRT: 39, Bus: 53, Walk: 94 } } },
  { id: 'toapayoh', name: 'Toa Payoh Sports Hall', area: 'Toa Payoh', sport: 'Badminton', available: 'Tomorrow · 8:00 PM', note: 'Popular this week', position: { left: '50%', top: '31%' }, transit: { home: { MRT: 17, Bus: 24, Walk: 45 }, studio: { MRT: 31, Bus: 39, Walk: 76 }, work: { MRT: 14, Bus: 21, Walk: 52 } } },
  { id: 'canberra', name: 'Bukit Canberra', area: 'Sembawang', sport: 'Tennis', available: 'Sun · 9:00 AM', note: '2 swap offers', position: { left: '48%', top: '10%' }, transit: { home: { MRT: 43, Bus: 55, Walk: 110 }, studio: { MRT: 61, Bus: 75, Walk: 142 }, work: { MRT: 46, Bus: 62, Walk: 126 } } },
  { id: 'jurong', name: 'Jurong West Sports Centre', area: 'Jurong West', sport: 'Basketball', available: 'Fri · 6:30 PM', note: '3 swap offers', position: { left: '13%', top: '48%' }, transit: { home: { MRT: 37, Bus: 49, Walk: 92 }, studio: { MRT: 26, Bus: 35, Walk: 66 }, work: { MRT: 42, Bus: 58, Walk: 101 } } },
  { id: 'kallang', name: 'Kallang Tennis Centre', area: 'Kallang', sport: 'Tennis', available: 'Today · 8:30 PM', note: 'New listing', position: { left: '65%', top: '34%' }, transit: { home: { MRT: 25, Bus: 33, Walk: 61 }, studio: { MRT: 37, Bus: 45, Walk: 82 }, work: { MRT: 12, Bus: 18, Walk: 44 } } },
];
const areas = ['All areas', 'Central', 'East', 'North', 'West'];
const areaMap: Record<string, string[]> = { Central: ['Queenstown', 'Toa Payoh', 'Kallang'], East: ['Tampines'], North: ['Sembawang'], West: ['Jurong West'] };
const iconForMode = (mode: TransitMode) => mode === 'MRT' ? <TrainFront size={15} /> : mode === 'Bus' ? <Bus size={15} /> : <Navigation size={15} />;

export default function Home() {
  const [selectedId, setSelectedId] = useState('queenstown');
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<'All sports' | Sport>('All sports');
  const [area, setArea] = useState('All areas');
  const [originId, setOriginId] = useState('home');
  const [mode, setMode] = useState<TransitMode>('MRT');
  const [saved] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['queenstown'];
    const stored = window.localStorage.getItem('courtly-saved');
    return stored ? JSON.parse(stored) : ['queenstown'];
  });
  const [locations, setLocations] = useState<SavedLocation[]>(() => {
    if (typeof window === 'undefined') return initialLocations;
    const stored = window.localStorage.getItem('courtly-locations');
    return stored ? JSON.parse(stored) : initialLocations;
  });
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [now] = useState(() => new Date());
  const activeListings = useMemo(() => getActiveListings(seedListings, now), [now]);
  const activeIds = useMemo(() => new Set(activeListings.map((listing) => listing.facility)), [activeListings]);
  const visibleCourts = useMemo(() => courts.filter((court) => activeListings.some((listing) => listing.facility === court.name)), [activeListings]);
  const filteredCourts = useMemo(() => visibleCourts.filter((court) => {
    const text = `${court.name} ${court.area} ${court.sport}`.toLowerCase();
    return (!query.trim() || text.includes(query.toLowerCase().trim())) && (sport === 'All sports' || court.sport === sport) && (area === 'All areas' || areaMap[area]?.includes(court.area));
  }), [area, query, sport, visibleCourts]);
  const selectedCourt = visibleCourts.find((court) => court.id === selectedId) ?? visibleCourts[0] ?? courts[0];
  const origin = locations.find((location) => location.id === originId) ?? locations[0];
  const eta = selectedCourt.transit[origin?.id ?? 'home']?.[mode] ?? selectedCourt.transit.home[mode];

  useEffect(() => { localStorage.setItem('courtly-locations', JSON.stringify(locations)); }, [locations]);
  function addLocation() { const name = newLocationName.trim(); if (!name) return; const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); setLocations((current) => [...current, { id, name, address: 'Saved location', color: 'lavender' }]); setOriginId(id); setNewLocationName(''); setLocationFormOpen(false); }

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#map"><span className="brand-mark"><MapPin size={17} strokeWidth={2.6} /></span><span>Courtly</span><span className="brand-dot">SG</span></a><nav className="main-nav"><a className="active" href="#map">Explore map</a><a href="#saved">Saved places <span className="nav-count">{saved.length}</span></a><a href="#about">How it works</a></nav><div className="topbar-actions"><span className="live-status"><span className="live-dot" />Live swap board</span><a className="telegram-button" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Join Telegram <ArrowUpRight size={15} /></a><button className="icon-button profile-button" aria-label="Profile"><UserRound size={18} /></button></div><button className="icon-button mobile-menu" aria-label="Open menu"><Menu size={21} /></button></header>
    <section className="intro-row"><div><p className="eyebrow"><span className="eyebrow-line" /> Singapore court swaps</p><h1>Find your next<br /><em>good game.</em></h1><p className="intro-copy">See court swaps around Singapore, check the journey from your usual spots, and get there on time.</p></div><div className="intro-stat"><strong>{activeListings.length}</strong><span>active swaps<br />right now</span></div></section>
    <section className="workspace" id="map"><aside className="control-panel"><div className="panel-heading"><div><span className="section-kicker">Browse nearby</span><h2>Courts & swaps</h2></div><span className="result-count">{filteredCourts.length} places</span></div><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search court or area" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}</label><div className="filter-group"><span className="filter-label">Sport</span><div className="chip-row">{(['All sports', 'Badminton', 'Tennis', 'Basketball'] as const).map((item) => <button key={item} className={`filter-chip ${sport === item ? 'selected' : ''}`} onClick={() => setSport(item)}>{item === 'All sports' ? 'All' : item}</button>)}</div></div><div className="filter-group area-filter"><span className="filter-label">Area</span><div className="area-select-wrap"><select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Filter by area">{areas.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></div><div className="court-list">{filteredCourts.length ? filteredCourts.map((court) => <button key={court.id} className={`court-row ${selectedId === court.id ? 'selected' : ''}`} onClick={() => setSelectedId(court.id)}><span className={`court-icon ${court.sport.toLowerCase()}`}><MapPin size={17} /></span><span className="court-row-copy"><strong>{court.name}</strong><span>{court.area} <i /> {court.sport}</span></span><span className="court-row-meta"><small>{court.note}</small><span>{court.available}</span></span><span className="row-arrow"><ArrowUpRight size={16} /></span></button>) : <div className="empty-state"><Search size={20} /><strong>No courts found</strong><span>Try another search or filter.</span></div>}</div><a className="telegram-card" href={TELEGRAM_URL} target="_blank" rel="noreferrer"><span className="telegram-icon"><MessageCircle size={18} /></span><span><strong>See every swap</strong><small>Join the SG Courts Telegram board</small></span><ArrowUpRight size={16} /></a></aside>
      <div className="map-column"><div className="map-card"><div className="map-toolbar"><div className="map-legend"><span className="legend-pill"><span className="legend-dot coral" />Swap available</span><span className="legend-pill"><span className="legend-dot mint" />Open court</span></div><button className="map-locate" type="button" onClick={() => setOriginId('home')}><Navigation size={15} /> Use Home</button></div><div className="map-canvas" aria-label="Stylized map of Singapore with court markers" role="img"><div className="map-label island-label">SINGAPORE</div><div className="water-label west-water">STRAITS OF<br />MALACCA</div><div className="water-label east-water">SINGAPORE<br />STRAIT</div><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" /><div className="map-road road-four" /><div className="map-line line-north" /><div className="map-line line-east" /><div className="map-line line-west" /><span className="map-place place-woodlands">WOODLANDS</span><span className="map-place place-jurong">JURONG EAST</span><span className="map-place place-pasir">PASIR RIS</span><span className="map-place place-city">CITY HALL</span><span className="map-place place-changi">CHANGI</span>{courts.map((court) => <button key={court.id} className={`map-pin ${selectedId === court.id ? 'active' : ''} ${saved.includes(court.id) ? 'is-saved' : ''} ${!activeIds.has(court.name) ? 'expired' : ''}`} style={{ left: court.position.left, top: court.position.top }} onClick={() => setSelectedId(court.id)} aria-label={`Select ${court.name}`}><span>{saved.includes(court.id) ? <Bookmark size={13} fill="currentColor" /> : <MapPin size={16} fill="currentColor" />}</span></button>)}</div><div className="map-footer"><span><span className="map-footer-dot" />Showing {filteredCourts.length} active courts</span><span className="map-updated">Listings expire after play time · Updated 4 min ago</span></div></div>
        <section className="route-panel" id="route-panel"><div className="route-header"><div><span className="section-kicker">Your journey</span><h2>Getting to {selectedCourt.name}</h2></div><span className="route-updated"><Clock3 size={14} />Typical weekday estimate</span></div><div className="route-content"><div className="route-from"><span className="filter-label">From saved place</span><div className="location-select-wrap"><span className={`location-dot ${origin?.color}`} /><select value={originId} onChange={(event) => setOriginId(event.target.value)} aria-label="Choose saved origin">{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.address}</option>)}</select><ChevronDown size={15} /></div>{locationFormOpen ? <div className="add-location-form"><input autoFocus value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addLocation()} placeholder="e.g. Parents' place" /><button onClick={addLocation} aria-label="Save location"><Check size={15} /></button><button onClick={() => setLocationFormOpen(false)} aria-label="Cancel"><X size={15} /></button></div> : <button className="add-location" onClick={() => setLocationFormOpen(true)}><Plus size={14} /> Add saved location</button>}</div><div className="mode-tabs" role="tablist">{(['MRT', 'Bus', 'Walk'] as TransitMode[]).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)} role="tab" aria-selected={mode === item}>{iconForMode(item)} {item}</button>)}</div><div className="eta-block"><span className="eta-number">{eta}</span><span className="eta-unit">min</span><span className="eta-label">door to door<br /><small>from {origin?.name}</small></span></div><a className="directions-link" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedCourt.name + ', Singapore')}`} target="_blank" rel="noreferrer">Open directions <ExternalLink size={14} /></a></div></section></div></section>
    <section className="saved-strip" id="saved"><div><span className="section-kicker">Your shortcuts</span><h2>Saved places</h2></div><div className="saved-location-list">{locations.map((location) => <button key={location.id} className={`saved-location ${originId === location.id ? 'selected' : ''}`} onClick={() => setOriginId(location.id)}><span className={`location-dot ${location.color}`} /><span><strong>{location.name}</strong><small>{location.address}</small></span>{originId === location.id && <Check size={15} />}</button>)}</div></section>
    <section className="about-strip" id="about"><div className="about-copy"><span className="section-kicker">Built for the swap</span><h2>Less scrolling.<br /><em>More playing.</em></h2></div><p>Courtly turns the fast-moving Telegram swap board into a calmer way to decide where to play. Pick a place, check the trip, then jump into the conversation.</p><a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Open SG Courts Telegram <ArrowUpRight size={15} /></a></section><footer><span>© 2026 Courtly SG</span><span>Community-powered · Estimates are indicative</span></footer>
  </main>;
}
