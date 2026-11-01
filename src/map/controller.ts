// Map controller: owns the 4-level navigation (world → country → city → property),
// translates game state into map layers and markers, and routes clicks.

import type { GameState } from '../core/state';
import type { Derived } from '../systems/derive';
import type { CityData, FC, LngLat, MapEngine, MarkerHandle } from './engine';
import { empty } from './engine';
import { CITIES, COUNTRIES, cityById, countryById } from '../config/world';
import { getCityLayout, getParcel, PROPERTY_TYPE_INFO, type ParcelDef } from '../world/parcels';
import { parcelState } from '../systems/property';
import { blueprintById } from '../config/buildings';
import { createMapLibreEngine, darkify, fallbackStyle } from './maplibreEngine';
import { createCanvasEngine } from './canvasEngine';
import { fallbackLand } from './fallbackGeo';
import { loadMapLibre, loadWorldGeo, fetchJson, CDN } from '../lib/loader';
import { emit, toast } from '../core/bus';
import { esc } from '../core/format';

export type MapLevel = 'world' | 'country' | 'city' | 'property';

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

function scalePoly(poly: [number, number][], k: number): [number, number][] {
  const cx = (poly[0][0] + poly[2][0]) / 2, cy = (poly[0][1] + poly[2][1]) / 2;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

export class MapController {
  engine: MapEngine | null = null;
  level: MapLevel = 'world';
  countryId: string | null = null;
  cityId: string | null = null;
  parcelId: string | null = null;
  zoneId: string | null = null;
  hoverText = '';
  engineError = '';
  private markers = new Map<string, { h: MarkerHandle; cityId?: string }>();
  private lastZoomBand = '';
  private refreshPending = false;

  constructor(private container: HTMLElement, private getS: () => GameState, private getD: () => Derived) {}

  async init(forceFallback: boolean): Promise<void> {
    const worldP = loadWorldGeo();
    let engine: MapEngine | null = null;
    if (!forceFallback) {
      try {
        const ml = await loadMapLibre();
        if (ml) {
          const raw = await fetchJson(CDN.mapStyle, 9000, 'style-positron-v1');
          const style = raw ? darkify(raw) : fallbackStyle();
          engine = await createMapLibreEngine(this.container, ml, style, !raw);
        }
      } catch (err) {
        console.warn('MapLibre unavailable, using canvas fallback', err);
        this.engineError = String(err);
        this.container.innerHTML = '';
        engine = null;
      }
    }
    if (!engine) engine = createCanvasEngine(this.container);
    this.engine = engine;
    const s = this.getS();
    engine.setSensitivity(s.settings.cameraSensitivity, s.settings.invertZoom);
    engine.onClick((h) => this.handleClick(h));
    engine.onMove(() => this.onMove());
    engine.setHoverInfo?.((h) => {
      let t = '';
      if (h?.type === 'parcel' && h.id) {
        const p = getParcel(h.id);
        if (p) t = `${p.name} · ${PROPERTY_TYPE_INFO[p.type].label}`;
      } else if (h?.type === 'country' && h.id) {
        const c = COUNTRIES.find((x) => x.isoNum === h.id || x.id === h.id);
        t = c ? `${c.flag} ${c.name}` : '';
      }
      if (t !== this.hoverText) {
        this.hoverText = t;
        emit('maphover', t);
      }
    });
    // countries
    const world = await worldP;
    const fc: FC = world ?? fallbackLand();
    for (const f of fc.features) {
      const iso = String(f.id ?? f.properties?.iso ?? '').padStart(3, '0');
      const c = COUNTRIES.find((x) => x.isoNum === iso);
      f.properties = { ...(f.properties ?? {}), iso: c ? c.id : '', playable: !!c, name: f.properties?.name ?? '' };
    }
    engine.setCountries(fc);
    this.buildMarkers();
    this.refresh();
    this.flyWorld(0);
  }

  get attribution(): string {
    return this.engine?.attribution ?? '';
  }

  // ---------- navigation ----------
  flyWorld(duration = 1800) {
    const s = this.getS();
    const home = cityById(s.company.startCity);
    this.engine?.flyTo({ center: [home.center[0] + 25, Math.max(10, home.center[1] - 8)], zoom: 1.7, pitch: 0, duration });
  }

  goWorld() {
    this.level = 'world';
    this.countryId = this.cityId = this.parcelId = this.zoneId = null;
    this.engine?.setHighlightCountry(null);
    this.engine?.setSelectedParcel(null);
    this.flyWorld();
    this.changed();
  }

  goCountry(id: string) {
    const c = countryById(id);
    if (!c) return;
    this.level = 'country';
    this.countryId = id;
    this.cityId = this.parcelId = this.zoneId = null;
    this.engine?.setHighlightCountry(id);
    this.engine?.setSelectedParcel(null);
    this.engine?.fitBounds(c.bbox, { padding: 70, duration: 1800, maxZoom: id === 'SG' ? 10 : 7 });
    this.changed();
  }

  goCity(id: string) {
    const c = cityById(id);
    this.level = 'city';
    this.countryId = c.country;
    this.cityId = id;
    this.parcelId = this.zoneId = null;
    this.engine?.setHighlightCountry(null);
    this.engine?.setSelectedParcel(null);
    this.engine?.flyTo({ center: c.district, zoom: this.engine.kind === 'canvas' ? 15.4 : 14.6, pitch: 45, bearing: -15, duration: 2600 });
    this.changed();
  }

  goProperty(parcelId: string): void {
    const p = getParcel(parcelId);
    if (!p) return;
    const ps = this.getS().parcels[parcelId];
    if (ps?.mergedInto) return this.goProperty(ps.mergedInto);
    this.level = 'property';
    this.cityId = p.cityId;
    this.countryId = cityById(p.cityId).country;
    this.parcelId = parcelId;
    this.zoneId = p.zoneId ?? null;
    this.engine?.setSelectedParcel(parcelId);
    this.engine?.flyTo({ center: p.center, zoom: (p.area > 12000 ? 16.6 : 17.4) + (this.engine.kind === 'canvas' ? 0.6 : 0), pitch: 58, bearing: -20, duration: 1400 });
    this.changed();
  }

  selectZone(zoneId: string) {
    this.zoneId = zoneId;
    this.parcelId = null;
    this.level = 'city';
    this.engine?.setSelectedParcel(null);
    this.changed();
  }

  back() {
    if (this.level === 'property') this.cityId ? this.goCity(this.cityId) : this.goWorld();
    else if (this.level === 'city') this.countryId ? this.goCountry(this.countryId) : this.goWorld();
    else if (this.level === 'country') this.goWorld();
  }

  private changed() {
    emit('mapstate');
    this.updateMarkerVisibility(true);
  }

  private handleClick(h: { type: string; id?: string; lngLat: LngLat }) {
    if (h.type === 'parcel' && h.id) {
      const ps = parcelState(this.getS(), h.id);
      if (ps.mergedInto) return this.goProperty(ps.mergedInto);
      return this.goProperty(h.id);
    }
    if (h.type === 'zone' && h.id) return this.selectZone(h.id);
    if (h.type === 'country' && h.id) {
      const z = this.engine!.getZoom();
      if (z < 9) return this.goCountry(h.id);
    }
    if (h.type === 'country' && !h.id && this.engine!.getZoom() < 5) toast({ title: 'No markets here yet', body: 'Playable countries are highlighted in blue.', kind: 'info', icon: '🌐' });
    if (this.level === 'property' && h.type === 'none') {
      this.level = 'city';
      this.parcelId = null;
      this.engine?.setSelectedParcel(null);
      this.changed();
    }
  }

  private onMove() {
    const z = this.engine!.getZoom();
    // keep breadcrumb in sync when the player zooms manually
    if (this.level === 'city' && z < 9.5) {
      this.level = this.countryId ? 'country' : 'world';
      this.cityId = null;
      this.changed();
    } else if (this.level === 'country' && z < 2.6) {
      this.level = 'world';
      this.countryId = null;
      this.engine?.setHighlightCountry(null);
      this.changed();
    } else if ((this.level === 'world' || this.level === 'country') && z > 12) {
      const c = this.engine!.getCenter();
      const near = CITIES.map((x) => ({ x, d: Math.hypot(x.district[0] - c[0], x.district[1] - c[1]) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 0.2) {
        this.level = 'city';
        this.cityId = near.x.id;
        this.countryId = near.x.country;
        this.changed();
      }
    }
    this.updateMarkerVisibility();
  }

  // ---------- data → layers ----------
  requestRefresh() {
    if (this.refreshPending) return;
    this.refreshPending = true;
    setTimeout(() => {
      this.refreshPending = false;
      this.refresh();
    }, 250);
  }

  refresh() {
    if (!this.engine) return;
    this.engine.setCityData(this.buildCityData());
    this.updateMarkers();
  }

  private buildCityData(): CityData {
    const s = this.getS();
    const compById = new Map(s.competitors.map((c) => [c.id, c]));
    const compSite = new Map<string, { progress: number; total: number; stage: string; bp: string; color: string }>();
    for (const c of s.competitors) for (const site of c.sites) compSite.set(site.parcelId, { progress: site.progress, total: site.total, stage: site.stage, bp: site.blueprintId, color: c.color });
    const plates: any[] = [], streets: any[] = [], parcels: any[] = [], buildings: any[] = [], zones: any[] = [];
    const bg = '#0c1526';
    const me = s.company.color;
    for (const city of CITIES) {
      const lay = getCityLayout(city.id);
      const unlocked = s.unlockedCities.includes(city.id);
      plates.push({ type: 'Feature', properties: { id: city.id }, geometry: { type: 'Polygon', coordinates: [lay.plate] } });
      for (const st of lay.streets) streets.push({ type: 'Feature', properties: { name: st.name }, geometry: { type: 'LineString', coordinates: st.line } });
      const allP: ParcelDef[] = [...lay.parcels, ...lay.sites];
      for (const p of allP) {
        const ps = s.parcels[p.id];
        if (p.isSite && ps?.owner !== 'player') continue;
        if (ps?.mergedInto) continue;
        const st = parcelState(s, p.id);
        let fill: string, line: string;
        if (st.owner === 'player') {
          fill = mix(me, bg, 0.45);
          line = me;
        } else if (st.owner) {
          const c = compById.get(st.owner);
          fill = mix(c?.color ?? '#ef4444', bg, 0.62);
          line = c?.color ?? '#ef4444';
        } else {
          fill = mix(PROPERTY_TYPE_INFO[p.type].color, bg, unlocked ? 0.62 : 0.82);
          line = unlocked ? '#3b4f6e' : '#1f2a3d';
        }
        parcels.push({ type: 'Feature', properties: { id: p.id, fill, line, status: st.status, owner: st.owner ?? '' }, geometry: { type: 'Polygon', coordinates: [p.poly] } });
        // building extrusions
        const foot = p.footprintPoly;
        let height = 0, base = 0, color = '#64748b', poly = foot;
        if (st.status === 'existing') {
          height = Math.max(3, p.buildingHeight);
          color = mix(PROPERTY_TYPE_INFO[p.type].color, '#1e293b', 0.35);
        } else if (st.status === 'demolishing') {
          const pr = st.projectId ? s.projects[st.projectId] : undefined;
          const cs = compSite.get(p.id);
          const prog = pr ? pr.doneSeconds / pr.totalSeconds : cs ? cs.progress / cs.total : 0.5;
          height = Math.max(1, p.buildingHeight * (1 - prog));
          color = '#a16207';
        } else if (st.status === 'construction') {
          const pr = st.projectId ? s.projects[st.projectId] : undefined;
          const cs = compSite.get(p.id);
          const prog = pr ? pr.doneSeconds / pr.totalSeconds : cs && cs.stage === 'build' ? cs.progress / cs.total : 0.1;
          const floors = pr?.draft?.floors ?? (cs ? blueprintById(cs.bp).floors : 2);
          const fp = pr?.draft?.footprint ?? (cs ? blueprintById(cs.bp).footprint : 0.5);
          poly = scalePoly(p.poly, Math.sqrt(fp));
          height = Math.max(1.5, floors * 5.5 * Math.min(1, prog * 1.15));
          color = '#f59e0b';
        } else if (st.status === 'facility' || st.status === 'hq') {
          if (st.owner === 'player' && st.facilityId) {
            const f = s.facilities[st.facilityId];
            if (f) {
              poly = scalePoly(p.poly, Math.sqrt(f.isHQ ? 0.35 : f.footprint));
              height = f.isHQ ? 8 + f.floors * 4 : f.floors * 5.5 + 2;
              color = f.isHQ ? mix(me, '#ffffff', 0.15) : f.color || me;
            }
          } else {
            const cs = compSite.get(p.id);
            if (cs) {
              const bp = blueprintById(cs.bp);
              poly = scalePoly(p.poly, Math.sqrt(bp.footprint));
              height = bp.floors * 5.5 + 2;
              color = mix(cs.color, '#cbd5e1', 0.25);
            }
          }
        }
        if (height > 0) buildings.push({ type: 'Feature', properties: { id: p.id, height, base, color }, geometry: { type: 'Polygon', coordinates: [poly] } });
      }
      for (const z of lay.zones) {
        const owners = new Set(z.parcelIds.map((pid) => parcelState(s, pid).owner));
        const mine = owners.size === 1 && owners.has('player');
        const comp = [...owners].some((o) => o && o !== 'player');
        zones.push({ type: 'Feature', properties: { id: z.id, mine, comp }, geometry: { type: 'Polygon', coordinates: [z.poly] } });
      }
    }
    const fc = (f: any[]): FC => ({ type: 'FeatureCollection', features: f });
    return { plates: fc(plates), streets: fc(streets), parcels: fc(parcels), buildings: fc(buildings), zones: fc(zones) };
  }

  // ---------- markers ----------
  private buildMarkers() {
    if (!this.engine) return;
    for (const city of CITIES) {
      const el = document.createElement('div');
      el.className = 'map-marker city-marker';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.goCity(city.id);
      });
      const h = this.engine.addMarker(el, city.center);
      this.markers.set('city:' + city.id, { h, cityId: city.id });
    }
    const hq = document.createElement('div');
    hq.className = 'map-marker hq-marker';
    hq.innerHTML = '<span>★</span>';
    hq.title = 'Headquarters';
    this.markers.set('hq', { h: this.engine.addMarker(hq, [0, 0]) });
    this.markers.get('hq')!.h.setVisible(false);
  }

  private updateMarkers() {
    const s = this.getS();
    const d = this.getD();
    for (const city of CITIES) {
      const m = this.markers.get('city:' + city.id);
      if (!m) continue;
      const unlocked = s.unlockedCities.includes(city.id);
      const mine = Object.values(s.facilities).filter((f) => f.cityId === city.id && !f.isHQ).length;
      const building = Object.values(s.projects).filter((p) => p.cityId === city.id).length;
      const comps = s.competitors.filter((c) => c.sites.some((x) => x.cityId === city.id));
      const price = d.cityPrice[city.id] ?? 1;
      const band = this.zoomBand();
      const detail = band === 'country';
      m.h.el.className = `map-marker city-marker ${unlocked ? 'unlocked' : 'locked'} ${mine ? 'mine' : ''} ${detail ? 'detail' : ''} ${band === 'world' && !unlocked ? 'nolabel' : ''}`;
      m.h.el.innerHTML = `
        <div class="cm-pin">${unlocked ? (mine ? mine : '◉') : '🔒'}</div>
        <div class="cm-label">
          <b>${esc(city.name)}</b>
          ${detail ? `<small>${unlocked ? `${mine} DCs${building ? ` · ${building} building` : ''} · $${city.powerPrice.toFixed(2)}/kWh · market ${Math.round(price * 100)}%` : `Level ${city.unlockLevel} · license $${(city.license / 1e6).toFixed(1)}M`}</small>` : ''}
          ${comps.length ? `<span class="cm-comps">${comps.map((c) => `<i style="background:${c.color}" title="${esc(c.name)}"></i>`).join('')}</span>` : ''}
        </div>`;
    }
    const hq = this.markers.get('hq');
    if (hq) {
      const f = s.company.hqFacility ? s.facilities[s.company.hqFacility] : undefined;
      const p = f ? getParcel(f.parcelId) : undefined;
      if (p) {
        hq.h.setLngLat(cityById(p.cityId).center);
        hq.h.el.style.setProperty('--c', s.company.color);
        hq.h.el.innerHTML = `<span>${esc(s.company.logo)}</span><small>HQ</small>`;
      }
    }
    this.updateMarkerVisibility(true);
  }

  private zoomBand(): 'world' | 'country' | 'city' {
    const z = this.engine?.getZoom() ?? 1;
    return z < 3.2 ? 'world' : z < 10.5 ? 'country' : 'city';
  }

  private updateMarkerVisibility(force = false) {
    const band = this.zoomBand();
    if (!force && band === this.lastZoomBand) return;
    const changedBand = band !== this.lastZoomBand;
    this.lastZoomBand = band;
    const s = this.getS();
    for (const [key, m] of this.markers) {
      if (key === 'hq') {
        m.h.setVisible(!!s.company.hqFacility && band !== 'city' && this.level !== 'property');
        continue;
      }
      m.h.setVisible(band !== 'city' && this.level !== 'property');
    }
    if (changedBand && !force) this.updateMarkers();
  }

  destroy() {
    this.engine?.destroy();
    this.markers.clear();
  }
}

export { empty };
