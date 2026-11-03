// Canvas2D isometric fallback for the Property View (used when Three.js /
// WebGL is unavailable). Day/night lighting, streets, trees, traffic,
// lit windows, rooftop equipment, construction stages and X-ray racks.

import type { GameState } from '../core/state';
import type { Derived } from '../systems/derive';
export interface PropertyViewLike {
  kind: 'three' | 'iso';
  show(parcelId: string): void;
  hide(): void;
  setXray(v: boolean): void;
  update(): void;
  resize(): void;
}
import { getParcel, PROPERTY_TYPE_INFO, type ParcelDef } from '../world/parcels';
import { parcelState } from '../systems/property';
import { stageOf } from '../systems/construction';
import { blueprintById, equipmentById } from '../config/buildings';
import { getLighting } from '../core/timeOfDay';
import { getCityLayout, districtFrame } from '../world/parcels';
import { getCityscape } from '../world/cityscape';

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, f: number, tint = 0): string {
  const [r, g, b] = rgb(hex);
  const c = (v: number, add: number) => Math.max(0, Math.min(255, Math.round(v * f + add)));
  return `rgb(${c(r, tint * 4)},${c(g, tint * 6)},${c(b, tint * 14)})`;
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export function createIsoView(container: HTMLElement, getS: () => GameState, getD: () => Derived): PropertyViewLike {
  const canvas = document.createElement('canvas');
  canvas.className = 'pv-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let parcel: ParcelDef | null = null;
  interface Nb { x: number; y: number; w: number; d: number; h: number; color: string; kind: string; id: string; parcelId?: string }
  let neighbors: Nb[] = [];
  let streetsLocal: [number, number, boolean][] = [];
  function collectNeighbors() {
    neighbors = [];
    streetsLocal = [];
    if (!parcel) return;
    const cx0 = (parcel.rect.x0 + parcel.rect.x1) / 2, cy0 = (parcel.rect.y0 + parcel.rect.y1) / 2;
    const R = Math.max(parcel.rect.x1 - parcel.rect.x0, parcel.rect.y1 - parcel.rect.y0) * 1.6 + 70;
    const fr = districtFrame(parcel.cityId);
    for (const st of getCityLayout(parcel.cityId).streets) {
      const [ax, ay] = fr.fromLL(st.line[0][0], st.line[0][1]);
      const [bx, by] = fr.fromLL(st.line[1][0], st.line[1][1]);
      const vertical = Math.abs(ax - bx) < 1;
      const off = vertical ? ax - cx0 : ay - cy0;
      if (Math.abs(off) > R * 1.5) continue;
      streetsLocal.push(vertical ? [off, 0, true] : [0, off, false]);
    }
    for (const p of getCityLayout(parcel.cityId).parcels) {
      if (p.id === parcel.id) continue;
      const x = (p.rect.x0 + p.rect.x1) / 2 - cx0, y = (p.rect.y0 + p.rect.y1) / 2 - cy0;
      if (Math.abs(x) > R || Math.abs(y) > R) continue;
      neighbors.push({ x, y, w: p.rect.x1 - p.rect.x0, d: p.rect.y1 - p.rect.y0, h: p.buildingHeight, color: PROPERTY_TYPE_INFO[p.type].color, kind: p.type, id: p.id, parcelId: p.id });
    }
    for (const b of getCityscape(parcel.cityId).buildings) {
      const x = (b.rect.x0 + b.rect.x1) / 2 - cx0, y = (b.rect.y0 + b.rect.y1) / 2 - cy0;
      if (Math.abs(x) > R * 1.4 || Math.abs(y) > R * 1.4) continue;
      neighbors.push({ x, y, w: b.rect.x1 - b.rect.x0, d: b.rect.y1 - b.rect.y0, h: b.height, color: b.color, kind: b.kind, id: b.id });
    }
  }
  let visible = false;
  let xray = false;
  let rot = 0;
  let userRot = 0;
  let zoomK = 1;
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
  }
  new ResizeObserver(resize).observe(container);
  let drag: number | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag !== null) { userRot += (e.clientX - drag) * 0.006; drag = e.clientX; } });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomK = Math.max(0.5, Math.min(2.5, zoomK * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });

  let scale = 3;
  let curNight = 0;
  const iso = (x: number, y: number, z: number): [number, number] => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const rx = x * c - y * s, ry = x * s + y * c;
    return [W / 2 + (rx - ry) * scale * 0.87, H * 0.6 + (rx + ry) * scale * 0.5 - z * scale];
  };
  const poly = (pts: [number, number][], fill: string | CanvasGradient, stroke?: string, lw = 1) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  const quadAt = (x: number, y: number, w: number, d: number, z: number, fill: string | CanvasGradient, stroke?: string) =>
    poly([iso(x - w / 2, y - d / 2, z), iso(x + w / 2, y - d / 2, z), iso(x + w / 2, y + d / 2, z), iso(x - w / 2, y + d / 2, z)], fill, stroke);

  interface BlockOpts { alpha?: number; windows?: 'office' | 'dc' | 'none'; night?: number; seed?: string; tint?: number; glowBand?: string }
  /** Draw an extruded box centred at (x,y) with only visible faces, windows and roof. */
  const block = (x: number, y: number, w: number, d: number, h: number, color: string, z0 = 0, o: BlockOpts = {}) => {
    ctx.globalAlpha = o.alpha ?? 1;
    const tint = o.tint ?? 0;
    const dk = 1 - curNight * 0.5;
    const corners: [number, number][] = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
    const base = corners.map(([a, b]) => iso(a, b, z0));
    const top = corners.map(([a, b]) => iso(a, b, z0 + h));
    const faces = [0, 1, 2, 3].map((i) => ({ i, y: (base[i][1] + base[(i + 1) % 4][1]) / 2 })).sort((p, q) => p.y - q.y).slice(2);
    for (const { i } of faces) {
      const j = (i + 1) % 4;
      const left = base[j][0] < base[i][0];
      const g = ctx.createLinearGradient(0, top[i][1], 0, base[i][1]);
      g.addColorStop(0, shade(color, (left ? 0.95 : 0.75) * dk, tint));
      g.addColorStop(1, shade(color, (left ? 0.7 : 0.52) * dk, tint));
      poly([base[i], base[j], top[j], top[i]], g);
      if (o.windows && o.windows !== 'none' && h > 6) {
        const len = Math.hypot(corners[j][0] - corners[i][0], corners[j][1] - corners[i][1]);
        const rows = Math.min(20, Math.floor(h / (o.windows === 'office' ? 3.8 : 5.5)));
        const cols = Math.max(1, Math.floor(len / (o.windows === 'office' ? 3.5 : 4.5)));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const tt = (c + 0.5) / cols, zz = z0 + ((r + 0.6) / rows) * h * 0.92;
          const wx = corners[i][0] + (corners[j][0] - corners[i][0]) * tt, wy = corners[i][1] + (corners[j][1] - corners[i][1]) * tt;
          const [sx, sy] = iso(wx, wy, zz);
          const lit = hash(`${o.seed}${i}${r}${c}`) < (o.windows === 'dc' ? 0.75 : 0.5);
          const night = o.night ?? 0;
          ctx.fillStyle = lit && night > 0.2 ? (o.windows === 'dc' ? `rgba(125,211,252,${0.5 + night * 0.5})` : `rgba(255,214,140,${0.45 + night * 0.55})`) : 'rgba(170,200,240,0.28)';
          const s = Math.max(1.2, scale * 0.9);
          ctx.fillRect(sx - s * 0.6, sy - s * 0.45, s * 1.2, s * 0.9);
        }
      }
      if (o.glowBand) {
        const [a1, b1] = iso(corners[i][0], corners[i][1], z0 + h - 2.5), [a2, b2] = iso(corners[j][0], corners[j][1], z0 + h - 2.5);
        ctx.save();
        ctx.shadowColor = o.glowBand;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = o.glowBand;
        ctx.lineWidth = Math.max(2, scale * 0.9);
        ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke();
        ctx.restore();
      }
    }
    poly(top, shade(color, 1.08 * dk, tint), 'rgba(0,0,0,0.25)', 0.8);
    ctx.globalAlpha = 1;
  };
  const shadow = (x: number, y: number, w: number, d: number, h: number, strength: number) => {
    const off = h * 0.55;
    ctx.globalAlpha = strength;
    poly([iso(x - w / 2, y - d / 2, 0), iso(x + w / 2 + off, y - d / 2 + off * 0.3, 0), iso(x + w / 2 + off, y + d / 2 + off * 0.3, 0), iso(x - w / 2, y + d / 2, 0)], 'rgba(0,0,0,1)');
    ctx.globalAlpha = 1;
  };
  const tree = (x: number, y: number, s: number, night: number) => {
    const [bx, by] = iso(x, y, 0);
    const [tx, ty] = iso(x, y, 4 * s);
    ctx.strokeStyle = '#4a3424';
    ctx.lineWidth = Math.max(1, scale * 0.35);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    const r = scale * 2.3 * s;
    const g = ctx.createRadialGradient(tx - r * 0.3, ty - r * 0.4, r * 0.1, tx, ty, r);
    g.addColorStop(0, shade('#4a7a3c', 1 - night * 0.5));
    g.addColorStop(1, shade('#1f3a20', 1 - night * 0.5));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(tx, ty - r * 0.3, r, 0, 6.3); ctx.fill();
  };

  function drawNeighbor(nb: Nb, s: GameState, night: number, tint: number, alpha: number) {
    if (nb.parcelId) {
      const st = parcelState(s, nb.parcelId);
      const k = Math.sqrt(PROPERTY_TYPE_INFO[nb.kind as keyof typeof PROPERTY_TYPE_INFO]?.coverage || 0.5);
      quadAt(nb.x, nb.y, nb.w, nb.d, 0.04, shade(st.status === 'cleared' || st.status === 'construction' ? '#4a3c2a' : '#2a313c', 1 - night * 0.5));
      if (st.status === 'existing' && nb.h > 0) block(nb.x, nb.y, nb.w * k, nb.d * k, Math.max(4, nb.h), nb.color, 0, { alpha, windows: nb.h > 6 ? 'office' : 'none', night, seed: nb.id, tint });
      else if (st.status === 'facility' || st.status === 'hq') {
        const col = st.owner === 'player' ? s.company.color : s.competitors.find((c) => c.id === st.owner)?.color ?? '#94a3b8';
        block(nb.x, nb.y, nb.w * 0.7, nb.d * 0.7, 16, '#c9d1dc', 0, { alpha, windows: 'dc', night, seed: nb.id, tint, glowBand: col });
      } else if (st.status === 'construction' || st.status === 'demolishing') block(nb.x, nb.y, nb.w * 0.6, nb.d * 0.6, 6, '#b7791f', 0, { alpha: alpha * 0.7, tint });
      else for (let i = 0; i < 2; i++) tree(nb.x + (hash(nb.id + i) - 0.5) * nb.w * 0.6, nb.y + (hash(nb.id + 'q' + i) - 0.5) * nb.d * 0.6, 0.9, night);
    } else {
      block(nb.x, nb.y, nb.w, nb.d, nb.h, nb.color, 0, { alpha, windows: nb.kind === 'house' || nb.kind === 'warehouse' ? 'none' : 'office', night, seed: nb.id, tint });
    }
  }
  const depth = (x: number, y: number) => { const c = Math.cos(rot), s2 = Math.sin(rot); return (x * c - y * s2) + (x * s2 + y * c); };

  function draw(t: number) {
    requestAnimationFrame(draw);
    if (!visible || !parcel) return;
    const s = getS();
    const L = getLighting(s.settings.timeOfDay ?? 'auto');
    const night = L.night;
    curNight = night;
    if (!s.settings.reduceMotion && drag === null) userRot += 0.0006;
    rot = userRot + Math.sin(t / 9000) * 0.05;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, L.sky.top);
    sky.addColorStop(0.6, L.sky.horizon);
    sky.addColorStop(1, L.sky.ground);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    if (night > 0.3) for (let i = 0; i < 80; i++) { ctx.fillStyle = `rgba(220,230,255,${night * (0.3 + 0.3 * Math.sin(t / 700 + i))})`; ctx.fillRect((i * 137.5) % W, (i * 53.7) % (H * 0.4), 1.4, 1.4); }
    const st = parcelState(s, parcel.id);
    const w = parcel.rect.x1 - parcel.rect.x0, d = parcel.rect.y1 - parcel.rect.y0;
    scale = (Math.min(W, H) / (Math.max(w, d) * 2.6 + 60)) * zoomK;
    const dim = 1 - night * 0.55;
    const tint = night * 2;
    // surrounding ground, streets and sidewalks
    const R = Math.max(w, d) * 1.6 + 120;
    quadAt(0, 0, R * 2.4, R * 2.4, 0, shade('#20402a', dim, tint));
    const road = shade('#1f242d', dim), walk = shade('#5d6470', dim);
    for (const [ox, oy, vertical] of streetsLocal) {
      if (vertical) { quadAt(ox, oy, 32, R * 2.4, 0.01, walk); quadAt(ox, oy, 22, R * 2.4, 0.02, road); }
      else { quadAt(ox, oy, R * 2.4, 32, 0.01, walk); quadAt(ox, oy, R * 2.4, 22, 0.02, road); }
      // lane dashes
      ctx.fillStyle = `rgba(240,236,210,${0.55 * dim + 0.2})`;
      for (let u = -R * 1.2; u < R * 1.2; u += 9) {
        const [a, b] = vertical ? iso(ox, u, 0.03) : iso(u, oy, 0.03);
        ctx.fillRect(a - 1.5, b - 0.6, 3, 1.2);
      }
      // cars
      for (let k = 0; k < 3; k++) {
        const dir = k % 2 ? 1 : -1;
        let u = ((t / 1000) * (10 + k * 3) * dir + hash(`${ox}${oy}${k}`) * R * 2.4) % (R * 2.4);
        if (u < 0) u += R * 2.4;
        u -= R * 1.2;
        const lx = vertical ? ox + dir * 4.5 : u, ly = vertical ? u : oy + dir * 4.5;
        block(lx, ly, vertical ? 1.9 : 4.4, vertical ? 4.4 : 1.9, 1.4, ['#e5e7eb', '#3b82f6', '#ef4444', '#f59e0b'][k % 4], 0.05, { tint });
        if (night > 0.2) {
          const [hx, hy] = iso(lx, ly, 0.6);
          const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, scale * 6);
          g.addColorStop(0, `rgba(255,240,200,${night * 0.5})`);
          g.addColorStop(1, 'rgba(255,240,200,0)');
          ctx.fillStyle = g;
          ctx.fillRect(hx - scale * 6, hy - scale * 6, scale * 12, scale * 12);
        }
      }
    }
    // street lamps glow
    if (night > 0.1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lampPts: number[][] = [];
      for (const [ox, oy, v] of streetsLocal) for (let u = -R; u <= R; u += 40) lampPts.push(v ? [ox + 12, u] : [u, oy + 12]);
      for (const [lx, ly] of lampPts) {
        const [x, y] = iso(lx, ly, 0.1);
        const g = ctx.createRadialGradient(x, y, 0, x, y, scale * 12);
        g.addColorStop(0, `rgba(255,200,130,${night * 0.45})`);
        g.addColorStop(1, 'rgba(255,200,130,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - scale * 12, y - scale * 12, scale * 24, scale * 24);
      }
      ctx.restore();
    }
    // neighbouring buildings behind the property
    const sortedNb = neighbors.map((nb) => ({ nb, dz: depth(nb.x, nb.y) })).sort((a, b) => a.dz - b.dz);
    for (const { nb, dz } of sortedNb) if (dz < 0) drawNeighbor(nb, s, night, tint, 1);
    // the lot
    const lotCol = st.status === 'existing' || st.status === 'facility' || st.status === 'hq' ? '#2e3540' : '#5a4a36';
    quadAt(0, 0, w, d, 0.05, shade(lotCol, dim, tint), st.owner === 'player' ? '#fbbf24' : st.owner ? '#f87171' : '#60a5fa');
    const k = Math.sqrt(PROPERTY_TYPE_INFO[parcel.type].coverage || 0.5);
    const shadowStrength = 0.35 * (1 - night * 0.7);
    let caption = '';
    // corner trees
    const trees: [number, number][] = [[-w / 2 + 3, -d / 2 + 3], [w / 2 - 3, -d / 2 + 3], [-w / 2 + 3, d / 2 - 3], [w / 2 - 3, d / 2 - 3]];
    if (st.status !== 'construction' && st.status !== 'demolishing') trees.forEach(([x, y]) => tree(x, y, 0.9, night));
    if (st.status === 'existing') {
      const h = Math.max(4, parcel.buildingHeight);
      shadow(0, 0, w * k, d * k, h, shadowStrength);
      block(0, 0, w * k, d * k, h, PROPERTY_TYPE_INFO[parcel.type].color, 0, { windows: parcel.type === 'office' || parcel.type === 'premium' ? 'office' : h > 6 ? 'office' : 'none', night, seed: parcel.id, tint });
      caption = PROPERTY_TYPE_INFO[parcel.type].label;
    } else if (st.status === 'demolishing') {
      const pr = st.projectId ? s.projects[st.projectId] : undefined;
      const p = pr ? pr.doneSeconds / pr.totalSeconds : 0.5;
      const jx = (Math.random() - 0.5) * 0.4;
      block(jx, 0, w * k, d * k, Math.max(0.5, parcel.buildingHeight * (1 - p)), '#9a6b2e', 0, { tint });
      block(-w * 0.28, d * 0.25, w * 0.2 * (0.3 + p), d * 0.2 * (0.3 + p), 1 + p * 5, '#6b5b4a', 0, { tint });
      block(w * 0.33, d * 0.36, 6, 3.5, 2.2, '#eab308', 0, { tint });
      ctx.fillStyle = 'rgba(210,195,165,0.22)';
      for (let i = 0; i < 40; i++) {
        const a = t / 900 + i;
        const [x, y] = iso(Math.sin(a * 1.3 + i) * w * 0.35, Math.cos(a + i * 2) * d * 0.35, ((t / 40 + i * 13) % 30));
        ctx.beginPath(); ctx.arc(x, y, scale * (1.2 + (i % 4)), 0, 6.3); ctx.fill();
      }
      caption = `Demolition ${Math.round(p * 100)}%`;
    } else if (st.status === 'construction') {
      const pr = st.projectId ? s.projects[st.projectId] : undefined;
      let floors = 2, fp = 0.5, col = '#94a3b8', prog = 0.3, stageName = 'Construction';
      if (pr?.draft) {
        floors = pr.draft.floors; fp = pr.draft.footprint; col = pr.draft.color;
        prog = pr.doneSeconds / pr.totalSeconds; stageName = stageOf(pr).name;
      } else {
        for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel.id) {
          const bp = blueprintById(site.blueprintId);
          floors = bp.floors; fp = bp.footprint; col = c.color; prog = site.progress / site.total;
        }
      }
      const kk = Math.sqrt(fp), bw = w * kk, bd = d * kk, Hh = floors * 5.5;
      if (prog > 0.08) block(0, 0, bw + 2, bd + 2, 1.2 * Math.min(1, (prog - 0.08) / 0.12), '#a3a3a3', 0, { tint });
      if (prog > 0.2) {
        const hh = Hh * Math.min(1, (prog - 0.2) / 0.2);
        ctx.strokeStyle = shade('#cbd5e1', dim);
        ctx.lineWidth = Math.max(1, scale * 0.3);
        for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
          const x = -bw / 2 + (bw * i) / 5, y = -bd / 2 + (bd * j) / 5;
          const [a, b] = iso(x, y, 1.2), [c2, d2] = iso(x, y, 1.2 + hh);
          ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, d2); ctx.stroke();
        }
        for (let f = 1; f <= floors; f++) if ((f * 5.5) <= hh) quadAt(0, 0, bw, bd, 1.2 + f * 5.5, 'rgba(160,160,160,0.55)');
      }
      if (prog > 0.68) block(0, 0, bw, bd, Hh * Math.min(1, (prog - 0.68) / 0.14), col, 1.2, { alpha: 0.85, tint });
      // crane
      const [mx, my] = iso(bw / 2 + 6, -bd / 2 - 4, 0), [tx, ty] = iso(bw / 2 + 6, -bd / 2 - 4, Hh + 18);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = Math.max(2, scale * 0.8);
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(tx, ty); ctx.stroke();
      const a = Math.sin(t / 2500) * 1.2;
      const [jx, jy] = iso(bw / 2 + 6 + Math.cos(a) * 28, -bd / 2 - 4 + Math.sin(a) * 28, Hh + 18);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(jx, jy); ctx.stroke();
      if (Math.sin(t / 250) > 0) { ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, 6.3); ctx.fill(); }
      caption = `${stageName} · ${Math.round(prog * 100)}%`;
    } else if (st.status === 'facility' || st.status === 'hq') {
      const f = st.facilityId ? s.facilities[st.facilityId] : undefined;
      if (f) {
        const kk = Math.sqrt(f.isHQ ? 0.35 : f.footprint);
        const bw = w * kk, bd = d * kk;
        const Hh = f.isHQ ? 8 + f.floors * 4 : f.floors * 5.5;
        const col = f.color || s.company.color;
        shadow(0, 0, bw, bd, Hh, shadowStrength);
        // parking with cars
        for (let i = 0; i < 8; i++) if (hash(f.id + i) > 0.35) block(-bw * 0.4 + (i * bw * 0.8) / 8, d / 2 - 6, 1.8, 4, 1.3, ['#e5e7eb', '#111827', '#9ca3af', '#1d4ed8'][i % 4], 0.05, { tint });
        block(0, 0, bw, bd, Hh, f.isHQ ? '#9fb4d9' : f.style === 'glass' ? '#7fb4e8' : '#c9d1dc', 0, { alpha: xray ? 0.25 : 1, windows: f.isHQ ? 'office' : 'dc', night, seed: f.id, tint, glowBand: f.isHQ ? undefined : col });
        if (!f.isHQ) {
          // rooftop cooling units with spinning fans
          const coolers = Math.min(12, 2 + (f.equipment.cooling_air ?? 0) + (f.equipment.cooling_adv ?? 0) * 2);
          for (let i = 0; i < coolers; i++) {
            const ux = -bw / 2 + 4 + (i % 4) * (bw - 8) / 3, uy = -bd / 2 + 4 + Math.floor(i / 4) * 6;
            block(ux, uy, 3.4, 3.4, 1.5, '#dde3ea', Hh, { tint });
            const [fx, fy] = iso(ux, uy, Hh + 1.6);
            ctx.save(); ctx.translate(fx, fy); ctx.rotate(t / 120 + i); ctx.fillStyle = '#334155'; ctx.fillRect(-scale * 1.2, -scale * 0.2, scale * 2.4, scale * 0.4); ctx.restore();
            // steam
            ctx.fillStyle = 'rgba(235,240,248,0.06)';
            for (let p = 0; p < 3; p++) { const rise = ((t / 60 + p * 10 + i * 7) % 30); const [sx, sy] = iso(ux + rise * 0.2, uy, Hh + 2 + rise); ctx.beginPath(); ctx.arc(sx, sy, scale * (1 + rise * 0.12), 0, 6.3); ctx.fill(); }
          }
          for (let i = 0; i < Math.min(8, f.equipment.generator ?? 0); i++) block(bw / 2 + 5, bd / 2 - 3 - i * 4, 2.6, 6, 2.6, '#334155', 0, { tint });
          for (let i = 0; i < Math.min(8, (f.equipment.pdu ?? 0) + 2); i++) block(-bw / 2 - 5, -bd / 2 + 2 + i * 3.2, 2, 2.6, 2.4, '#4d7c5a', 0, { tint });
        }
        if (xray && !f.isHQ) {
          let i = 0;
          for (const [id, n] of Object.entries(f.equipment)) {
            const e = equipmentById(id);
            if (e.kind !== 'server') continue;
            const c = e.cap === 'gpu' ? '#a855f7' : e.cap === 'storage' ? '#10b981' : e.cap === 'cpu' ? '#3b82f6' : '#f59e0b';
            for (let j = 0; j < n && i < 500; j++, i++) {
              const per = Math.max(1, Math.floor((bw - 4) / 1.2));
              const row = Math.floor(i / per), cc = i % per;
              const [x, y] = iso(-bw / 2 + 2 + cc * 1.2, -bd / 2 + 2 + row * 3, 0.2);
              ctx.fillStyle = '#111827';
              ctx.fillRect(x - scale * 0.4, y - scale * 2.2, scale * 0.8, scale * 2.2);
              ctx.fillStyle = Math.random() < 0.15 ? '#0b0b0b' : c;
              ctx.fillRect(x - scale * 0.3, y - scale * 1.8, scale * 0.6, scale * 0.35);
            }
          }
        }
        // aviation lights
        if (Math.sin(t / 400) > 0.5) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [x, y] = iso((sx * bw) / 2, (sy * bd) / 2, Hh + 1); ctx.fillStyle = '#ff3333'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.3); ctx.fill(); }
        caption = f.name;
        const warn = getD().fac[f.id]?.warnings.length;
        if (warn) {
          const [x, y] = iso(0, 0, Hh + 6);
          ctx.save(); ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 20;
          ctx.fillStyle = Math.sin(t / 150) > 0 ? '#ef4444' : '#7f1d1d';
          ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.3); ctx.fill(); ctx.restore();
        }
      } else {
        let col = '#ef4444', name = 'Competitor', floors = 3, fp = 0.55;
        for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel.id) { col = c.color; name = c.name; const bp = blueprintById(site.blueprintId); floors = bp.floors; fp = bp.footprint; }
        const kk = Math.sqrt(fp);
        shadow(0, 0, w * kk, d * kk, floors * 5.5, shadowStrength);
        block(0, 0, w * kk, d * kk, floors * 5.5, '#c9d1dc', 0, { windows: 'dc', night, seed: parcel.id, tint, glowBand: col });
        caption = name;
      }
    } else {
      for (let i = 0; i < 6; i++) tree((hash(parcel.id + i) - 0.5) * w * 0.7, (hash(parcel.id + 'y' + i) - 0.5) * d * 0.7, 1, night);
      caption = st.owner === 'player' ? 'Ready to build' : 'Empty land';
    }
    // buildings in front of the property are ghosted so the subject stays visible
    for (const { nb, dz } of sortedNb) if (dz >= 0) drawNeighbor(nb, s, night, tint, 0.45);
    // caption
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(caption).width + 28;
    ctx.fillStyle = 'rgba(6,12,24,0.75)';
    ctx.beginPath();
    (ctx as any).roundRect?.(W / 2 - tw / 2, 64, tw, 30, 15);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(caption, W / 2, 84);
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText('Simplified view — drag to rotate, scroll to zoom (full 3D loads when online)', W / 2, H - 14);
  }
  requestAnimationFrame(draw);

  return {
    kind: 'iso',
    show(id) {
      parcel = getParcel(id) ?? null;
      collectNeighbors();
      visible = true;
      zoomK = 1;
      container.classList.add('visible');
      resize();
    },
    hide() {
      visible = false;
      container.classList.remove('visible');
    },
    setXray(v) { xray = v; },
    update() {},
    resize,
  };
}
