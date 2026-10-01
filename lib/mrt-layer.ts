import L from 'leaflet';
import { MRT_LINES, type MrtNetwork } from './mrt-network';

export { MRT_LINES, mrtNetworkCache } from './mrt-network';

const ATTRIBUTION = 'MRT: <a href="https://github.com/cheeaun/sgraildata">SG Rail Data</a>';

function stationContent(station: MrtNetwork['stations'][number]) {
  const content = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = station.name;
  const codes = document.createElement('small');
  codes.textContent = station.codes.join(' · ');
  content.appendChild(name);
  content.appendChild(codes);
  return content;
}

/** Native geographic layer: sits below court pins and never changes the map view. */
export function createMrtLayer(map: L.Map, network: MrtNetwork) {
  const linePane = map.getPane('mrt-lines') ?? map.createPane('mrt-lines');
  linePane.style.zIndex = '410';
  linePane.style.pointerEvents = 'none';
  const stationPane = map.getPane('mrt-stations') ?? map.createPane('mrt-stations');
  stationPane.style.zIndex = '450';
  const labelPane = map.getPane('mrt-labels') ?? map.createPane('mrt-labels');
  labelPane.style.zIndex = '460';
  labelPane.style.pointerEvents = 'none';

  const layer = L.layerGroup();
  const labels = L.layerGroup().addTo(layer);
  const lineLayers: Array<{ casing: L.Polyline; line: L.Polyline }> = [];
  for (const line of network.lines) {
    const color = MRT_LINES.find((item) => item.code === line.code)!.color;
    const paths = line.paths.map((path) => path.map(([lng, lat]) => L.latLng(lat, lng)));
    const casing = L.polyline(paths, {
      pane: 'mrt-lines', color: '#fff', weight: 6.5, opacity: 0.9,
      interactive: false, className: 'mrt-line-casing',
    }).addTo(layer);
    const stroke = L.polyline(paths, {
      pane: 'mrt-lines', color, weight: 3.5, opacity: 0.95,
      interactive: false, className: `mrt-line mrt-line-${line.code.toLowerCase()}`,
    }).addTo(layer);
    lineLayers.push({ casing, line: stroke });
  }

  const stations = [...network.stations].sort((a, b) => b.codes.length - a.codes.length);
  const stationLayers: Array<{ marker: L.CircleMarker; interchange: boolean }> = [];
  for (const station of stations) {
    const [lng, lat] = station.coordinates;
    const interchange = station.codes.length > 1;
    const lineCode = station.codes[0].slice(0, 2);
    const color = MRT_LINES.find((line) => line.code === (lineCode === 'CG' ? 'EW' : lineCode))?.color;
    const marker = L.circleMarker([lat, lng], {
      pane: 'mrt-stations', radius: interchange ? 4.5 : 3,
      color: interchange ? '#37483f' : color, weight: interchange ? 2 : 1.5,
      fillColor: '#fff', fillOpacity: 1, interactive: false, className: 'mrt-station',
    }).addTo(layer);
    stationLayers.push({ marker, interchange });
    // Invisible hit area makes station taps easier without enlarging the dots.
    L.circleMarker([lat, lng], { pane: 'mrt-stations', radius: 9, stroke: false, fillOpacity: 0, className: 'mrt-station-hit' })
      .bindTooltip(() => stationContent(station), { className: 'mrt-station-tooltip', direction: 'top' })
      .bindPopup(() => stationContent(station), { className: 'mrt-station-popup', closeButton: false })
      .addTo(layer);
  }

  function updateLabels() {
    labels.clearLayers();
    const compact = map.getZoom() < 12;
    for (const item of lineLayers) {
      item.casing.setStyle({ weight: compact ? 4.5 : 6.5 });
      item.line.setStyle({ weight: compact ? 2.5 : 3.5 });
    }
    for (const { marker, interchange } of stationLayers) {
      marker.setRadius(compact ? (interchange ? 3 : 1.8) : (interchange ? 4.5 : 3));
    }
    // At island scale, dots show the network without burying the courts in text.
    if (map.getZoom() < 14) return;
    const size = map.getSize();
    const mapRect = map.getContainer().getBoundingClientRect();
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const station of stations) {
      const [lng, lat] = station.coordinates;
      const position = L.latLng(lat, lng);
      const point = map.latLngToContainerPoint(position);
      if (point.x < 0 || point.y < 0 || point.x > size.x || point.y > size.y) continue;
      const tooltip = L.tooltip({ pane: 'mrt-labels', permanent: true, direction: 'right', offset: [8, 0], opacity: 1, className: 'mrt-station-label' })
        .setLatLng(position).setContent(stationContent(station)).addTo(labels);
      // Measure rendered text: font metrics and station names vary by device.
      const rect = tooltip.getElement()!.getBoundingClientRect();
      const box = { x: rect.x - mapRect.x, y: rect.y - mapRect.y, width: rect.width, height: rect.height };
      if (box.x < 0 || box.y < 0 || box.x + box.width > size.x || box.y + box.height > size.y || occupied.some((other) => box.x < other.x + other.width + 8 && box.x + box.width + 8 > other.x && box.y < other.y + other.height + 6 && box.y + box.height + 6 > other.y)) {
        labels.removeLayer(tooltip);
      } else {
        occupied.push(box);
      }
    }
  }

  layer.on('add', () => {
    map.attributionControl.addAttribution(ATTRIBUTION);
    map.on('zoomend moveend resize', updateLabels);
    updateLabels();
  });
  layer.on('remove', () => {
    map.attributionControl.removeAttribution(ATTRIBUTION);
    map.off('zoomend moveend resize', updateLabels);
    labels.clearLayers();
  });
  return layer;
}
