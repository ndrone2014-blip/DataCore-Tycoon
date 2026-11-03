// MapLibre GL implementation: real-world vector tiles (OpenFreeMap / OpenStreetMap),
// globe projection at world zoom, 3D fill-extrusions for game buildings.

import type { CameraOpts, CityData, FC, LngLat, MapEngine, MapHit, MarkerHandle } from './engine';
import { empty } from './engine';

const DARK = {
  background: '#050a14',
  water: '#0b1d36',
  land: '#0b1220',
  park: '#0d1a1e',
  road: '#1f2a3d',
  roadMajor: '#2b3a55',
  boundary: '#3a4b6b',
  text: '#8ea2c0',
  halo: '#050a14',
};

/** Recolor any vector style into the game's dark navy palette. */
export function darkify(style: any): any {
  const s = JSON.parse(JSON.stringify(style));
  for (const l of s.layers ?? []) {
    const id: string = (l.id ?? '').toLowerCase();
    l.paint = l.paint ?? {};
    l.layout = l.layout ?? {};
    if (l.type === 'background') l.paint['background-color'] = DARK.background;
    else if (/building/.test(id)) l.layout.visibility = 'none';
    else if (l.type === 'fill') {
      if (/water|ocean|sea|lake|river/.test(id)) l.paint['fill-color'] = DARK.water;
      else if (/park|wood|forest|grass|green|landcover|nature/.test(id)) { l.paint['fill-color'] = DARK.park; l.paint['fill-opacity'] = 0.6; }
      else { l.paint['fill-color'] = DARK.land; l.paint['fill-opacity'] = 0.7; }
      delete l.paint['fill-pattern'];
      delete l.paint['fill-outline-color'];
    } else if (l.type === 'line') {
      if (/water|river|stream|canal/.test(id)) l.paint['line-color'] = DARK.water;
      else if (/boundary|admin|border/.test(id)) { l.paint['line-color'] = DARK.boundary; l.paint['line-opacity'] = 0.8; }
      else if (/motorway|trunk|primary|major|highway/.test(id)) l.paint['line-color'] = DARK.roadMajor;
      else l.paint['line-color'] = DARK.road;
      delete l.paint['line-pattern'];
    } else if (l.type === 'symbol') {
      if (/poi|housenum|shield|oneway/.test(id)) l.layout.visibility = 'none';
      else {
        l.paint['text-color'] = DARK.text;
        l.paint['text-halo-color'] = DARK.halo;
        l.paint['text-halo-width'] = 1.2;
        delete l.paint['icon-color'];
      }
    } else if (l.type === 'fill-extrusion') l.layout.visibility = 'none';
  }
  return s;
}

export function fallbackStyle(): any {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': DARK.water } }] };
}

export async function createMapLibreEngine(container: HTMLElement, ml: any, style: any, usedFallbackStyle: boolean): Promise<MapEngine> {
  const map = new ml.Map({
    container,
    style,
    center: [-40, 28],
    zoom: 1.4,
    minZoom: 0.8,
    maxZoom: 19.5,
    maxPitch: 70,
    attributionControl: { compact: true },
    renderWorldCopies: false,
    fadeDuration: 150,
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('map load timeout')), 20000);
    map.once('load', () => {
      clearTimeout(t);
      resolve();
    });
    map.on('error', (e: any) => {
      // tile/sprite errors are non-fatal; the load timeout handles real failures
      console.warn('MapLibre:', e?.error?.message ?? e);
    });
  });
  try {
    map.setProjection({ type: 'globe' });
  } catch {
    /* older MapLibre: mercator */
  }
  if (usedFallbackStyle) {
    map.addSource('land', { type: 'geojson', data: empty() });
  }

  map.addSource('countries', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'countries-fill', type: 'fill', source: 'countries', maxzoom: 9, paint: {
    'fill-color': ['case', ['get', 'playable'], '#1e3a8a', usedFallbackStyle ? '#101b30' : '#0f172a'],
    'fill-opacity': usedFallbackStyle ? ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'playable'], 0.85, 1], 9, 0.9] : ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'playable'], 0.32, 0.0], 6, ['case', ['get', 'playable'], 0.12, 0], 9, 0],
  } });
  map.addLayer({ id: 'countries-line', type: 'line', source: 'countries', maxzoom: 10, paint: { 'line-color': '#3b5b8f', 'line-width': 0.6, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'countries-hl', type: 'line', source: 'countries', filter: ['==', ['get', 'iso'], '__none'], paint: { 'line-color': '#60a5fa', 'line-width': 2.2 } });
  map.addLayer({ id: 'countries-hl-fill', type: 'fill', source: 'countries', filter: ['==', ['get', 'iso'], '__none'], maxzoom: 9, paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 } });

  map.addSource('fiber', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'fiber-lines', type: 'line', source: 'fiber', maxzoom: 10, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    'line-color': ['get', 'color'],
    'line-width': ['get', 'width'],
    'line-opacity': ['case', ['get', 'live'], ['case', ['get', 'mine'], 0.95, 0.4], 0.35],
  } });
  for (const id of ['sky-ground', 'sky-parks', 'sky-buildings']) map.addSource(id, { type: 'geojson', data: empty() });
  map.addLayer({ id: 'sky-ground', type: 'fill', source: 'sky-ground', minzoom: 10, paint: { 'fill-color': '#0d1626', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 0.97] } });
  map.addLayer({ id: 'sky-parks', type: 'fill', source: 'sky-parks', minzoom: 11, paint: { 'fill-color': '#14301f', 'fill-opacity': 0.95 } });
  for (const id of ['plates', 'streets', 'zones', 'parcels', 'buildings']) map.addSource(id, { type: 'geojson', data: empty() });
  map.addLayer({ id: 'plates', type: 'fill', source: 'plates', minzoom: 10, paint: { 'fill-color': '#0c1526', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 0.96] } });
  map.addLayer({ id: 'plates-line', type: 'line', source: 'plates', minzoom: 10, paint: { 'line-color': '#2563eb', 'line-width': 1.5, 'line-opacity': 0.6, 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'streets', type: 'line', source: 'streets', minzoom: 12, paint: { 'line-color': '#1c273a', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 4, 18, 70] } });
  map.addLayer({ id: 'streets-center', type: 'line', source: 'streets', minzoom: 15, paint: { 'line-color': '#3d4b63', 'line-width': 1, 'line-dasharray': [4, 4] } });
  map.addLayer({ id: 'parcels-fill', type: 'fill', source: 'parcels', minzoom: 12, paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 0.85] } });
  map.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', minzoom: 13, paint: { 'line-color': ['get', 'line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 2] } });
  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', minzoom: 12, paint: { 'fill-color': ['case', ['get', 'mine'], '#22c55e', ['get', 'comp'], '#ef4444', '#a78bfa'], 'fill-opacity': 0.06 } });
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', minzoom: 12, paint: { 'line-color': ['case', ['get', 'mine'], '#4ade80', ['get', 'comp'], '#f87171', '#c4b5fd'], 'line-width': 2.2, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'sky-buildings', type: 'fill-extrusion', source: 'sky-buildings', minzoom: 12, paint: {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, ['get', 'height']],
    'fill-extrusion-base': 0,
    'fill-extrusion-opacity': 0.88,
    'fill-extrusion-vertical-gradient': true,
  } });
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'buildings', minzoom: 13, paint: {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-opacity': 0.92,
  } });
  map.addLayer({ id: 'parcels-glow', type: 'line', source: 'parcels', minzoom: 12, filter: ['!=', ['get', 'glow'], ''], paint: {
    'line-color': ['get', 'glow'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 16],
    'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 12],
    'line-opacity': 0.55,
  } }, 'buildings');
  try {
    map.setSky({ 'sky-color': '#0b1a3a', 'horizon-color': '#1f3f80', 'fog-color': '#08122a', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 1, 11, 0] });
  } catch { /* sky needs MapLibre v5 */ }
  try {
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.32, position: [1.4, 210, 35] });
  } catch { /* ignore */ }
  let glowOn = true;
  let glowFeatures = 0;
  const pulse = setInterval(() => {
    // setPaintProperty repaints the whole map, so only pulse when the glow can actually be seen
    if (!glowOn || !glowFeatures || document.hidden || map.getZoom() < 12 || !container.offsetParent || !map.getLayer('parcels-glow')) return;
    const v = glowOn ? 0.4 + 0.3 * Math.sin(performance.now() / 500) : 0;
    try { map.setPaintProperty('parcels-glow', 'line-opacity', v); } catch { /* ignore */ }
  }, 120);
  map.addLayer({ id: 'parcels-hover', type: 'line', source: 'parcels', filter: ['==', ['get', 'id'], '__none'], paint: { 'line-color': '#93c5fd', 'line-width': 2.5 } });
  map.addLayer({ id: 'parcels-sel', type: 'line', source: 'parcels', filter: ['==', ['get', 'id'], '__none'], paint: { 'line-color': '#fbbf24', 'line-width': 3.5 } });

  const clickCbs: ((h: MapHit) => void)[] = [];
  const moveCbs: (() => void)[] = [];
  let hoverCb: ((h: MapHit | null) => void) | undefined;

  const hitAt = (point: any, lngLat: LngLat): MapHit => {
    const layers = ['buildings', 'parcels-fill', 'zones-fill', 'countries-fill'].filter((l) => map.getLayer(l));
    const feats = map.queryRenderedFeatures(point, { layers });
    const b = feats.find((f: any) => f.layer.id === 'buildings' || f.layer.id === 'parcels-fill');
    if (b && map.getZoom() >= 13) return { type: 'parcel', id: b.properties.id, lngLat };
    const z = feats.find((f: any) => f.layer.id === 'zones-fill');
    if (z && map.getZoom() >= 12) return { type: 'zone', id: z.properties.id, lngLat };
    const c = feats.find((f: any) => f.layer.id === 'countries-fill');
    if (c) return { type: 'country', id: c.properties.iso, lngLat };
    return { type: 'none', lngLat };
  };

  map.on('click', (e: any) => {
    const h = hitAt(e.point, [e.lngLat.lng, e.lngLat.lat]);
    clickCbs.forEach((cb) => cb(h));
  });
  let hoverId: string | null = null;
  map.on('mousemove', (e: any) => {
    const h = hitAt(e.point, [e.lngLat.lng, e.lngLat.lat]);
    const id = h.type === 'parcel' ? h.id! : null;
    map.getCanvas().style.cursor = h.type !== 'none' ? 'pointer' : '';
    if (id !== hoverId) {
      hoverId = id;
      map.setFilter('parcels-hover', ['==', ['get', 'id'], id ?? '__none']);
    }
    hoverCb?.(h.type === 'none' ? null : h);
  });
  map.on('mouseout', () => hoverCb?.(null));
  map.on('move', () => moveCbs.forEach((cb) => cb()));

  const setData = (id: string, fc: FC) => map.getSource(id)?.setData(fc);

  return {
    kind: 'maplibre',
    attribution: usedFallbackStyle ? 'Country data: Natural Earth via world-atlas' : '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    flyTo: (c: CameraOpts) => map.flyTo({ center: c.center, zoom: c.zoom, pitch: c.pitch ?? 0, bearing: c.bearing ?? 0, duration: c.duration ?? 2200, essential: true }),
    fitBounds: (b, o) => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: o?.padding ?? 60, pitch: o?.pitch ?? 0, duration: o?.duration ?? 2000, maxZoom: o?.maxZoom ?? 16, bearing: 0 }),
    getZoom: () => map.getZoom(),
    getCenter: () => {
      const c = map.getCenter();
      return [c.lng, c.lat];
    },
    zoomBy: (d) => map.easeTo({ zoom: map.getZoom() + d, duration: 400 }),
    setCountries: (fc) => setData('countries', fc),
    setHighlightCountry: (iso) => {
      map.setFilter('countries-hl', ['==', ['get', 'iso'], iso ?? '__none']);
      map.setFilter('countries-hl-fill', ['==', ['get', 'iso'], iso ?? '__none']);
    },
    setCityData: (d: CityData) => {
      setData('plates', d.plates);
      setData('streets', d.streets);
      setData('parcels', d.parcels);
      glowFeatures = d.parcels.features.length;
      setData('buildings', d.buildings);
      setData('zones', d.zones);
    },
    setCityscape: (d) => {
      setData('sky-ground', d.ground);
      setData('sky-parks', d.parks);
      setData('sky-buildings', d.buildings);
    },
    setFiber: (fc) => setData('fiber', fc),
    setSelectedParcel: (id) => map.setFilter('parcels-sel', ['==', ['get', 'id'], id ?? '__none']),
    setHoverInfo: (cb) => (hoverCb = cb),
    addMarker: (el: HTMLElement, ll: LngLat): MarkerHandle => {
      const m = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat(ll).addTo(map);
      return {
        el,
        setLngLat: (p) => m.setLngLat(p),
        setVisible: (v) => (el.style.display = v ? '' : 'none'),
        remove: () => m.remove(),
      };
    },
    onClick: (cb) => clickCbs.push(cb),
    onMove: (cb) => moveCbs.push(cb),
    resize: () => map.resize(),
    setSensitivity: (v: number) => {
      try {
        map.scrollZoom.setWheelZoomRate((1 / 450) * v);
        map.scrollZoom.setZoomRate((1 / 100) * v);
      } catch { /* ignore */ }
    },
    setEffects: (o) => {
      glowOn = o.glow;
      try {
        const night = o.timeOfDay === 'night' ? 0.18 : o.timeOfDay === 'sunset' ? 0.26 : 0.34;
        map.setLight({ anchor: 'viewport', color: o.timeOfDay === 'sunset' ? '#ffd2a1' : o.timeOfDay === 'night' ? '#9fb4ff' : '#ffffff', intensity: night, position: [1.4, 210, 35] });
      } catch { /* ignore */ }
    },
    destroy: () => {
      clearInterval(pulse);
      map.remove();
    },
  };
}
