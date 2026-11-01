// Canvas2D fallback map engine (Web Mercator, same zoom scale as MapLibre with
// 512px tiles). Works without any network access.

import type { CameraOpts, CityData, FC, LngLat, MapEngine, MapHit, MarkerHandle } from './engine';
import { empty } from './engine';
import { getLighting } from '../core/timeOfDay';

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
  // oblique "camera tilt" at city zoom so building heights read clearly
  const tiltK = () => (zoom <= 11 ? 1 : zoom >= 13 ? 0.7 : 1 - ((zoom - 11) / 2) * 0.3);
  const toScreen = (lng: number, lat: number): [number, number] => {
    const w = ws();
    const [cx, cy] = project(center[0], center[1], w);
    const [x, y] = project(lng, lat, w);
    return [x - cx + W / 2, (y - cy) * tiltK() + H / 2 + (1 - tiltK()) * H * 0.12];
  };
  const toLngLat = (sx: number, sy: number): LngLat => {
    const w = ws();
    const [cx, cy] = project(center[0], center[1], w);
    return unproject(sx - W / 2 + cx, (sy - H / 2 - (1 - tiltK()) * H * 0.12) / tiltK() + cy, w);
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

  // ---- visual helpers ----
  let glow = true;
  let tod = 'auto';
  let lighting = getLighting('auto');
  const patterns: Record<string, CanvasPattern | null> = {};
  function pattern(kind: string): CanvasPattern | null {
    if (kind in patterns) return patterns[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const speck = (base: string, cols: string[], n: number, r: number) => {
      x.fillStyle = base;
      x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < n; i++) {
        x.fillStyle = cols[i % cols.length];
        x.globalAlpha = 0.25 + Math.random() * 0.4;
        x.beginPath();
        x.arc(Math.random() * 64, Math.random() * 64, Math.random() * r + 0.3, 0, 6.3);
        x.fill();
      }
      x.globalAlpha = 1;
    };
    if (kind === 'grass') speck('#1d3324', ['#24402b', '#16291c', '#2c4a31'], 160, 1.6);
    else if (kind === 'dirt') speck('#3d3223', ['#4a3c2a', '#2f261a', '#5a4a35'], 160, 1.6);
    else if (kind === 'asphalt') speck('#141b27', ['#1a2230', '#0f1520', '#222b3a'], 120, 1);
    else if (kind === 'parking') {
      speck('#1a2130', ['#202838', '#141a26'], 80, 1);
      x.strokeStyle = 'rgba(200,210,225,0.25)';
      x.lineWidth = 1;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 8, 0); x.lineTo(i * 8, 24); x.moveTo(i * 8, 40); x.lineTo(i * 8, 64); x.stroke(); }
    } else if (kind === 'plate') {
      speck('#0c1526', ['#0f1a2e', '#0a1220'], 60, 1);
      x.strokeStyle = 'rgba(59,130,246,0.06)';
      for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16, 64); x.moveTo(0, i * 16); x.lineTo(64, i * 16); x.stroke(); }
    } else if (kind === 'hazard') {
      x.fillStyle = '#3a2a0a';
      x.fillRect(0, 0, 64, 64);
      x.strokeStyle = 'rgba(245,158,11,0.45)';
      x.lineWidth = 7;
      for (let i = -64; i < 128; i += 18) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 64, 0); x.stroke(); }
    }
    patterns[kind] = ctx.createPattern(c, 'repeat');
    return patterns[kind];
  }
  const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lighting = getLighting(tod as any);
    // deep ocean
    const g = ctx.createRadialGradient(W * 0.45, H * 0.4, 30, W / 2, H / 2, Math.max(W, H) * 0.9);
    g.addColorStop(0, '#0f2a52');
    g.addColorStop(0.55, '#081a36');
    g.addColorStop(1, '#030915');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // graticule
    if (zoom < 8) {
      ctx.strokeStyle = 'rgba(96,165,250,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lng = -180; lng <= 180; lng += 15) {
        const [x1, y1] = toScreen(lng, 82), [x2, y2] = toScreen(lng, -82);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      for (let lat = -75; lat <= 80; lat += 15) {
        const [x1, y1] = toScreen(-180, lat), [x2, y2] = toScreen(180, lat);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    // coastline glow pass
    if (glow && zoom < 9) {
      ctx.save();
      ctx.shadowColor = 'rgba(56,140,255,0.55)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#0f1a2e';
      ctx.beginPath();
      for (const f of countries.features) for (const poly of polysOf(f.geometry)) path(poly[0]);
      ctx.fill();
      ctx.restore();
    }
    // land / countries with relief gradient
    const lg = ctx.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#16233a');
    lg.addColorStop(1, '#0f1a2c');
    const pg = ctx.createLinearGradient(0, 0, W, H);
    pg.addColorStop(0, '#1d3f86');
    pg.addColorStop(1, '#173270');
    for (const f of countries.features) {
      const playable = f.properties?.playable;
      const isHl = hl && f.properties?.iso === hl;
      ctx.beginPath();
      for (const poly of polysOf(f.geometry)) path(poly[0]);
      ctx.fillStyle = isHl ? '#2a55b8' : playable ? pg : lg;
      ctx.fill();
      ctx.strokeStyle = isHl ? '#93c5fd' : playable ? 'rgba(96,165,250,0.55)' : 'rgba(80,110,160,0.35)';
      ctx.lineWidth = isHl ? 2.2 : playable ? 1 : 0.6;
      ctx.stroke();
    }
    if (hl && glow) {
      ctx.save();
      ctx.shadowColor = '#3b82f6';
      ctx.shadowBlur = 24;
      ctx.strokeStyle = 'rgba(147,197,253,0.9)';
      ctx.lineWidth = 2;
      for (const f of countries.features) {
        if (f.properties?.iso !== hl) continue;
        ctx.beginPath();
        for (const poly of polysOf(f.geometry)) path(poly[0]);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (zoom >= 10) drawCity();
    // night overlay + vignette
    if (zoom >= 10 && lighting.night > 0.05) {
      ctx.fillStyle = `rgba(4,8,22,${lighting.night * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCity() {
    const now = performance.now();
    const alpha = Math.min(1, (zoom - 10) / 2);
    const night = lighting.night;
    ctx.globalAlpha = alpha;
    const mpp = (78271.517 * Math.cos((center[1] * Math.PI) / 180)) / Math.pow(2, zoom);
    const pxm = 1 / mpp; // pixels per meter
    // district plate
    for (const f of city.plates.features) {
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.save();
      if (glow) { ctx.shadowColor = 'rgba(37,99,235,0.6)'; ctx.shadowBlur = 30; }
      ctx.fillStyle = '#0b1424';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = pattern('plate') ?? '#0c1526';
      ctx.fill();
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = 'rgba(59,130,246,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // streets: sidewalks, asphalt, lane dashes
    if (zoom >= 12) {
      const roadW = Math.max(2, 22 * pxm), walkW = Math.max(3, 30 * pxm);
      const segs = city.streets.features.map((f: any) => {
        const c = f.geometry.coordinates;
        return [toScreen(c[0][0], c[0][1]), toScreen(c[1][0], c[1][1])] as [number, number][];
      });
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#2a3445';
      ctx.lineWidth = walkW;
      for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.strokeStyle = pattern('asphalt') ?? '#151c28';
      ctx.lineWidth = roadW;
      for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      if (zoom >= 14.5) {
        ctx.strokeStyle = 'rgba(230,226,200,0.55)';
        ctx.lineWidth = Math.max(0.6, 0.35 * pxm);
        ctx.setLineDash([4 * pxm, 5 * pxm]);
        for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // street lamps at night
      if (night > 0.1 && zoom >= 13.5) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const [a, b] of segs) {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const step = 40 * pxm;
          for (let u = step / 2; u < len; u += step) {
            const x = a[0] + ((b[0] - a[0]) * u) / len, y = a[1] + ((b[1] - a[1]) * u) / len;
            if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
            const r = 14 * pxm;
            const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
            gg.addColorStop(0, `rgba(255,200,120,${0.35 * night * alpha})`);
            gg.addColorStop(1, 'rgba(255,200,120,0)');
            ctx.fillStyle = gg;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }
        }
        ctx.restore();
      }
      // traffic
      if (zoom >= 13.5) {
        segs.forEach(([a, b], si) => {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1) return;
          const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
          for (let k = 0; k < 6; k++) {
            const dir = k % 2 ? 1 : -1;
            const speed = 0.00004 + hash(`${si}-${k}`) * 0.00004;
            let tt = (hash(`t${si}-${k}`) + now * speed * dir) % 1;
            if (tt < 0) tt += 1;
            const off = dir * 4.5 * pxm;
            const x = a[0] + (b[0] - a[0]) * tt - uy * off, y = a[1] + (b[1] - a[1]) * tt + ux * off;
            if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
            const cl = Math.max(2, 4.4 * pxm), cw = Math.max(1.2, 2 * pxm);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.atan2(uy, ux) + (dir < 0 ? Math.PI : 0));
            ctx.fillStyle = ['#e5e7eb', '#60a5fa', '#f87171', '#fbbf24', '#9ca3af'][(si + k) % 5];
            ctx.fillRect(-cl / 2, -cw / 2, cl, cw);
            if (night > 0.2) {
              ctx.globalCompositeOperation = 'lighter';
              ctx.fillStyle = `rgba(255,240,200,${night * 0.6})`;
              ctx.beginPath();
              ctx.moveTo(cl / 2, 0);
              ctx.lineTo(cl / 2 + 10 * pxm, -3 * pxm);
              ctx.lineTo(cl / 2 + 10 * pxm, 3 * pxm);
              ctx.fill();
            }
            ctx.restore();
          }
        });
      }
    }
    // parcels: textured ground per status
    for (const f of city.parcels.features) {
      const pr = f.properties;
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.globalAlpha = alpha;
      const pat = pr.status === 'cleared' || pr.status === 'demolishing' ? pattern('dirt') : pr.status === 'construction' ? pattern('hazard') : pr.status === 'facility' || pr.status === 'hq' || pr.status === 'existing' ? pattern('parking') : pattern('grass');
      ctx.fillStyle = pat ?? pr.fill;
      ctx.fill();
      ctx.globalAlpha = alpha * (pr.owner ? 0.55 : 0.35);
      ctx.fillStyle = pr.fill;
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = pr.line;
      ctx.lineWidth = pr.owner ? 1.6 : 0.8;
      ctx.stroke();
      if (glow && pr.glow) {
        ctx.save();
        ctx.shadowColor = pr.glow;
        ctx.shadowBlur = pr.mine ? 14 + Math.sin(now / 450) * 6 : 8;
        ctx.strokeStyle = pr.glow;
        ctx.globalAlpha = alpha * (pr.mine ? 0.9 : 0.5);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const f of city.zones.features) {
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      ctx.setLineDash([8, 5]);
      ctx.lineDashOffset = -now / 60;
      ctx.strokeStyle = f.properties.mine ? '#4ade80' : f.properties.comp ? '#f87171' : '#c4b5fd';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    // buildings: shadows first, then painter-sorted 2.5D blocks
    const lift = 1.05;
    const items = city.buildings.features.map((f: any) => {
      const ring: number[][] = f.geometry.coordinates[0];
      const pts = ring.map((p) => toScreen(p[0], p[1]));
      return { f, pts, y: Math.max(...pts.map((p) => p[1])) };
    }).filter((it: any) => it.pts.some(([x, y]: number[]) => x > -200 && y > -400 && x < W + 200 && y < H + 200))
      .sort((a: any, b: any) => a.y - b.y);
    // ground shadows (sun from the upper-left)
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.35 * (1 - night * 0.6)})`;
    for (const { f, pts } of items) {
      const h = f.properties.height * pxm * lift;
      const sx = h * 0.55, sy = h * 0.25;
      ctx.beginPath();
      pts.forEach(([x, y]: number[], i: number) => (i ? ctx.lineTo(x + sx, y + sy) : ctx.moveTo(x + sx, y + sy)));
      pts.slice().reverse().forEach(([x, y]: number[]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    for (const { f, pts } of items) {
      const pr = f.properties;
      const h = (pr.height - pr.base) * pxm * lift;
      const b = pr.base * pxm * lift;
      const col = pr.color as string;
      const construction = pr.kind === 'construction';
      const demo = pr.kind === 'demolishing';
      // walls
      const edges = [];
      for (let i = 0; i < pts.length - 1; i++) edges.push(i);
      edges.sort((ea, eb) => (pts[ea][1] + pts[ea + 1][1]) - (pts[eb][1] + pts[eb + 1][1]));
      for (const i of edges) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        ctx.beginPath();
        ctx.moveTo(x1, y1 - b);
        ctx.lineTo(x2, y2 - b);
        ctx.lineTo(x2, y2 - b - h);
        ctx.lineTo(x1, y1 - b - h);
        ctx.closePath();
        const wg = ctx.createLinearGradient(0, Math.min(y1, y2) - b - h, 0, Math.max(y1, y2) - b);
        const sideF = x2 > x1 ? 0.62 : 0.8;
        wg.addColorStop(0, shade(col, sideF * 1.08));
        wg.addColorStop(1, shade(col, sideF * 0.7));
        ctx.fillStyle = construction ? 'rgba(245,158,11,0.18)' : wg;
        ctx.fill();
        if (construction) {
          ctx.strokeStyle = 'rgba(250,204,21,0.8)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        // windows
        if (!construction && !demo && h > 8 && zoom >= 14) {
          const rows = Math.min(14, Math.floor(h / (pr.kind === 'office' ? 6 : 9)));
          const cols = Math.max(1, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 7));
          for (let r = 1; r <= rows; r++) {
            for (let c = 0; c < cols; c++) {
              const tt = (c + 0.5) / cols, vv = r / (rows + 1);
              const wx = x1 + (x2 - x1) * tt, wy = y1 + (y2 - y1) * tt - b - h * vv;
              const lit = hash(`${pr.id}${i}${r}${c}`) < (pr.kind === 'facility' || pr.kind === 'hq' ? 0.85 : 0.55);
              if (night > 0.15 && lit) {
                ctx.fillStyle = pr.kind === 'facility' ? `rgba(125,211,252,${0.5 + night * 0.5})` : `rgba(255,214,140,${0.4 + night * 0.6})`;
              } else ctx.fillStyle = 'rgba(160,190,230,0.22)';
              const ws2 = Math.max(1.6, Math.min(4, 1.6 * pxm));
              ctx.fillRect(wx - ws2 * 0.8, wy - ws2 * 0.55, ws2 * 1.6, ws2 * 1.1);
            }
          }
        }
      }
      // roof
      ctx.beginPath();
      pts.forEach(([x, y]: number[], i: number) => (i ? ctx.lineTo(x, y - b - h) : ctx.moveTo(x, y - b - h)));
      ctx.closePath();
      ctx.fillStyle = construction ? 'rgba(250,204,21,0.15)' : shade(col, 1.12);
      ctx.fill();
      ctx.strokeStyle = construction ? 'rgba(250,204,21,0.9)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      const cx = pts.slice(0, -1).reduce((a: number, p: number[]) => a + p[0], 0) / (pts.length - 1);
      const cy = pts.slice(0, -1).reduce((a: number, p: number[]) => a + p[1], 0) / (pts.length - 1) - b - h;
      // rooftop details
      if (zoom >= 15 && (pr.kind === 'facility' || pr.kind === 'existing')) {
        ctx.fillStyle = pr.kind === 'facility' ? '#e2e8f0' : 'rgba(200,205,215,0.7)';
        const u = Math.max(2, 3.4 * pxm);
        for (let k = 0; k < (pr.kind === 'facility' ? 6 : 3); k++) ctx.fillRect(cx - u * 3 + (k % 3) * u * 2.2, cy - u + Math.floor(k / 3) * u * 2.2, u * 1.4, u * 1.4);
      }
      // facility glow band + pulse halo
      if ((pr.kind === 'facility' || pr.kind === 'hq') && glow) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = (20 + Math.sin(now / 500 + hash(pr.id) * 6) * 4) * pxm * (pr.mine ? 1.4 : 0.9);
        const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gg.addColorStop(0, pr.mine ? 'rgba(96,165,250,0.35)' : 'rgba(248,113,113,0.2)');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      }
      if (construction && zoom >= 14) {
        // blinking warning light + crane arm
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + 6 * pxm, cy + h * 0.4);
        ctx.lineTo(cx + 6 * pxm, cy - 18 * pxm);
        ctx.lineTo(cx + 26 * pxm * Math.cos(now / 2500), cy - 18 * pxm);
        ctx.stroke();
        if (Math.sin(now / 250) > 0) {
          ctx.fillStyle = '#fb923c';
          ctx.beginPath();
          ctx.arc(cx + 6 * pxm, cy - 18 * pxm, 2.2, 0, 6.3);
          ctx.fill();
        }
      }
      if (demo && zoom >= 14) {
        ctx.fillStyle = 'rgba(200,184,154,0.25)';
        for (let k = 0; k < 6; k++) {
          const a = now / 700 + k;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * 8 * pxm, cy - ((now / 30 + k * 20) % 30) * pxm * 0.4, (4 + k) * pxm * 0.6, 0, 6.3);
          ctx.fill();
        }
      }
    }
    const outline = (id: string | null, color: string, w: number) => {
      if (!id) return;
      const f = city.parcels.features.find((x: any) => x.properties.id === id);
      if (!f) return;
      ctx.save();
      ctx.beginPath();
      path(f.geometry.coordinates[0]);
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.restore();
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
    if (zoom >= 12 && t - lastAnim > 33) {
      lastAnim = t;
      dirty = true;
    }
    if (dirty) {
      draw();
      placeMarkers();
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }
  let lastAnim = 0;
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
      center = unproject(cx - dx, cy - dy / tiltK(), w);
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
    const tk = tiltK();
    center = unproject(bx - (sx - W / 2), by - (sy - H / 2 - (1 - tk) * H * 0.12) / tk, w);
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
    setEffects: (o) => {
      glow = o.glow;
      tod = o.timeOfDay;
      dirty = true;
    },
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
