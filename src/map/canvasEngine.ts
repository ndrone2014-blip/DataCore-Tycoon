// Canvas2D fallback map engine (Web Mercator, same zoom scale as MapLibre with
// 512px tiles). Works without any network access.

import type { CameraOpts, CityData, FC, LngLat, MapEngine, MapHit, MarkerHandle } from './engine';
import { empty } from './engine';

const TILE = 512;
const MAXLAT = 85;

function project(lng: number, lat: number, ws: number): [number, number] {
  const la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * (Math.PI / 180);
  return [((lng + 180) / 360) * ws, ((1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2) * ws];
}
function unproject(x: number, y: number, ws: number): LngLat {
  const lng = (x / ws) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / ws;
  return [lng, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}
function pip(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polysOf(geom: any): number[][][][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

export function createCanvasEngine(container: HTMLElement): MapEngine {
  container.innerHTML = '';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.className = 'canvas-map';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.append(canvas, overlay);
  const ctx = canvas.getContext('2d')!;

  let center: LngLat = [-40, 28];
  let zoom = 1.6;
  let countries: FC = empty();
  let hl: string | null = null;
  let city: CityData = { plates: empty(), streets: empty(), parcels: empty(), buildings: empty(), zones: empty() };
  let selected: string | null = null;
  let hover: string | null = null;
  let sens = 1;
  let invert = false;
  let dirty = true;
  let anim: { from: CameraOpts; to: CameraOpts; t0: number; dur: number } | null = null;
  const clickCbs: ((h: MapHit) => void)[] = [];
  const moveCbs: (() => void)[] = [];
  let hoverCb: ((h: MapHit | null) => void) | undefined;
  const markers: { el: HTMLElement; ll: LngLat; visible: boolean }[] = [];
  let W = 0, H = 0, dpr = 1;

  const ws = () => TILE * Math.pow(2, zoom);
  const toScreen = (lng: number, lat: number): [number, number] => {
    const w = ws();
    const [cx, cy] = project(center[0], center[1], w);
    const [x, y] = project(lng, lat, w);
    return [x - cx + W / 2, y - cy + H / 2];
  };
  const toLngLat = (sx: number, sy: number): LngLat => {
    const w = ws();
    const [cx, cy] = project(center[0], center[1], w);
    return unproject(sx - W / 2 + cx, sy - H / 2 + cy, w);
  };
  const clampZoom = (z: number) => Math.max(0.8, Math.min(19.5, z));

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function path(ring: number[][]) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = toScreen(ring[i][0], ring[i][1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H));
    g.addColorStop(0, '#0d2243');
    g.addColorStop(1, '#050b18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // graticule
    if (zoom < 7) {
      ctx.strokeStyle = 'rgba(96,165,250,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lng = -180; lng <= 180; lng += 30) {
        const [x1, y1] = toScreen(lng, 80), [x2, y2] = toScreen(lng, -80);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      for (let lat = -60; lat <= 80; lat += 20) {
        const [x1, y1] = toScreen(-180, lat), [x2, y2] = toScreen(180, lat);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    // land / countries
    for (const f of countries.features) {
      const playable = f.properties?.playable;
      const isHl = hl && f.properties?.iso === hl;
      ctx.beginPath();
      for (const poly of polysOf(f.geometry)) path(poly[0]);
      ctx.fillStyle = isHl ? '#24448f' : playable ? '#1a2f63' : '#121c30';
      ctx.fill();
      ctx.strokeStyle = isHl ? '#60a5fa' : '#2a3b5a';
      ctx.lineWidth = isHl ? 2 : 0.7;
      ctx.stroke();
    }
    if (zoom >= 10) drawCity();
  }

  function drawCity() {
    const alpha = Math.min(1, (zoom - 10) / 2);
    ctx.globalAlpha = alpha;
    for (const f of city.plates.features) {
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.fillStyle = '#0c1526';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(37,99,235,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const mpp = (78271.517 * Math.cos((center[1] * Math.PI) / 180)) / Math.pow(2, zoom);
    if (zoom >= 12) {
      ctx.strokeStyle = '#1c273a';
      ctx.lineWidth = Math.max(2, 26 / mpp);
      ctx.lineCap = 'butt';
      for (const f of city.streets.features) {
        const c = f.geometry.coordinates;
        const [x1, y1] = toScreen(c[0][0], c[0][1]), [x2, y2] = toScreen(c[1][0], c[1][1]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    for (const f of city.parcels.features) {
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.fillStyle = f.properties.fill;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = f.properties.line;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const f of city.zones.features) {
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = f.properties.mine ? '#4ade80' : f.properties.comp ? '#f87171' : '#c4b5fd';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // pseudo-3D buildings, painter-sorted by screen y
    const bs = city.buildings.features
      .map((f: any) => ({ f, y: toScreen(f.geometry.coordinates[0][2][0], f.geometry.coordinates[0][2][1])[1] }))
      .sort((a: any, b: any) => a.y - b.y);
    for (const { f } of bs) {
      const ring: number[][] = f.geometry.coordinates[0];
      const h = (f.properties.height - f.properties.base) / mpp * 0.55;
      const b = f.properties.base / mpp * 0.55;
      const pts = ring.map((p) => toScreen(p[0], p[1]));
      const col = f.properties.color as string;
      // walls (front/bottom edges)
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        ctx.beginPath();
        ctx.moveTo(x1, y1 - b);
        ctx.lineTo(x2, y2 - b);
        ctx.lineTo(x2, y2 - b - h);
        ctx.lineTo(x1, y1 - b - h);
        ctx.closePath();
        ctx.fillStyle = shade(col, x2 > x1 ? 0.62 : 0.78);
        ctx.fill();
      }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - b - h) : ctx.moveTo(x, y - b - h)));
      ctx.closePath();
      ctx.fillStyle = shade(col, 1.08);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    const outline = (id: string | null, color: string, w: number) => {
      if (!id) return;
      const f = city.parcels.features.find((x: any) => x.properties.id === id);
      if (!f) return;
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
    };
    outline(hover, '#93c5fd', 2.5);
    outline(selected, '#fbbf24', 3.5);
    ctx.globalAlpha = 1;
  }

  function placeMarkers() {
    for (const m of markers) {
      if (!m.visible) {
        m.el.style.display = 'none';
        continue;
      }
      const [x, y] = toScreen(m.ll[0], m.ll[1]);
      const off = x < -100 || y < -100 || x > W + 100 || y > H + 100;
      m.el.style.display = off ? 'none' : '';
      m.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  function frame(t: number) {
    if (anim) {
      const k = Math.min(1, (t - anim.t0) / anim.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // interpolate zoom with a slight "hop" out like a fly-to
      const hop = Math.sin(Math.PI * e) * Math.min(2.5, Math.abs(anim.to.zoom - anim.from.zoom) * 0.25 + 0.6);
      zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e - hop * (anim.dur > 500 ? 1 : 0);
      center = [anim.from.center[0] + (anim.to.center[0] - anim.from.center[0]) * e, anim.from.center[1] + (anim.to.center[1] - anim.from.center[1]) * e];
      if (k >= 1) {
        zoom = anim.to.zoom;
        center = anim.to.center;
        anim = null;
      }
      dirty = true;
      moveCbs.forEach((cb) => cb());
    }
    if (dirty) {
      draw();
      placeMarkers();
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);

  // ---- interaction ----
  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    anim = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const w = ws();
      const [cx, cy] = project(center[0], center[1], w);
      center = unproject(cx - dx, cy - dy, w);
      center[1] = Math.max(-80, Math.min(80, center[1]));
      dirty = true;
      moveCbs.forEach((cb) => cb());
    } else {
      const h = hitTest(e.clientX - r.left, e.clientY - r.top);
      const id = h.type === 'parcel' ? h.id! : null;
      if (id !== hover) {
        hover = id;
        dirty = true;
      }
      canvas.style.cursor = h.type !== 'none' ? 'pointer' : 'grab';
      hoverCb?.(h.type === 'none' ? null : h);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag && !drag.moved) {
      const h = hitTest(e.clientX - r.left, e.clientY - r.top);
      clickCbs.forEach((cb) => cb(h));
    }
    drag = null;
    canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const before = toLngLat(sx, sy);
    const d = (-e.deltaY * 0.0022 * sens) * (invert ? -1 : 1);
    zoom = clampZoom(zoom + d);
    const w = ws();
    const [bx, by] = project(before[0], before[1], w);
    center = unproject(bx - (sx - W / 2), by - (sy - H / 2), w);
    anim = null;
    dirty = true;
    moveCbs.forEach((cb) => cb());
  }, { passive: false });
  canvas.addEventListener('dblclick', () => flyTo({ center, zoom: clampZoom(zoom + 1), duration: 300 }));

  function hitTest(sx: number, sy: number): MapHit {
    const ll = toLngLat(sx, sy);
    if (zoom >= 12.5) {
      // buildings drawn raised: test parcels by ground position
      for (const f of city.parcels.features) if (pip(ll, f.geometry.coordinates[0])) return { type: 'parcel', id: f.properties.id, lngLat: ll };
      for (const f of city.zones.features) if (pip(ll, f.geometry.coordinates[0])) return { type: 'zone', id: f.properties.id, lngLat: ll };
    }
    if (zoom < 10) {
      for (const f of countries.features) {
        if (!f.properties?.iso) continue;
        for (const poly of polysOf(f.geometry)) if (pip(ll, poly[0])) return { type: 'country', id: f.properties.iso, lngLat: ll };
      }
    }
    return { type: 'none', lngLat: ll };
  }

  function flyTo(c: CameraOpts) {
    const dur = c.duration ?? 1600;
    if (dur <= 0) {
      center = c.center;
      zoom = clampZoom(c.zoom);
      dirty = true;
      moveCbs.forEach((cb) => cb());
      return;
    }
    anim = { from: { center: [...center] as LngLat, zoom }, to: { center: c.center, zoom: clampZoom(c.zoom) }, t0: performance.now(), dur };
  }

  return {
    kind: 'canvas',
    attribution: countries.features.length > 30 ? 'Country boundaries: Natural Earth (world-atlas)' : 'Offline map (simplified geography)',
    flyTo,
    fitBounds: (b, o) => {
      const pad = o?.padding ?? 60;
      const w0 = TILE;
      const [x1, y1] = project(b[0], b[3], w0), [x2, y2] = project(b[2], b[1], w0);
      const zx = Math.log2((W - pad * 2) / Math.max(1e-9, x2 - x1));
      const zy = Math.log2((H - pad * 2) / Math.max(1e-9, y2 - y1));
      const z = Math.min(o?.maxZoom ?? 16, zx, zy);
      flyTo({ center: [(b[0] + b[2]) / 2, unproject((y1 + y2) / 2, (y1 + y2) / 2, w0)[1]], zoom: z, duration: o?.duration ?? 1600 });
    },
    getZoom: () => zoom,
    getCenter: () => center,
    zoomBy: (d) => flyTo({ center, zoom: zoom + d, duration: 350 }),
    setCountries: (fc) => {
      countries = fc;
      dirty = true;
    },
    setHighlightCountry: (iso) => {
      hl = iso;
      dirty = true;
    },
    setCityData: (d) => {
      city = d;
      dirty = true;
    },
    setSelectedParcel: (id) => {
      selected = id;
      dirty = true;
    },
    setHoverInfo: (cb) => (hoverCb = cb),
    addMarker: (el, ll): MarkerHandle => {
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.pointerEvents = 'auto';
      overlay.appendChild(el);
      const m = { el, ll, visible: true };
      markers.push(m);
      dirty = true;
      return {
        el,
        setLngLat: (p) => { m.ll = p; dirty = true; },
        setVisible: (v) => { m.visible = v; dirty = true; },
        remove: () => {
          el.remove();
          const i = markers.indexOf(m);
          if (i >= 0) markers.splice(i, 1);
        },
      };
    },
    onClick: (cb) => clickCbs.push(cb),
    onMove: (cb) => moveCbs.push(cb),
    resize,
    setSensitivity: (v, inv) => {
      sens = v;
      invert = inv;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.innerHTML = '';
    },
  };
}
