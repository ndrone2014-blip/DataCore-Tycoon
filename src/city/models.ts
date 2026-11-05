// Procedural building models. Every parcel and background block becomes real architecture:
// towers with setbacks, office blocks, brick rows, apartments, shops with parking, warehouses
// with loading docks, factories, houses, and fully detailed data centers.

import { Mesh, hex, mixc, scalec, type Mat, type RGB } from './mesh';
import { STYLE as S } from './shaders';
import { mulberry32, hashString } from '../core/rng';
import type { GameState, Facility } from '../core/state';
import type { ParcelDef } from '../world/parcels';
import { blueprintById } from '../config/buildings';
import type { SkyBuilding } from '../world/cityscape';

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export interface Inst { x: number; y: number; z: number; s: number; yaw: number; c: RGB }
export interface Glow { x: number; y: number; z: number; c: RGB; a: number; size: number }

/** Everything one build pass writes into. */
export interface Out {
  m: Mesh; // opaque geometry
  decal: Mesh; // soft contact shadows
  clear: Mesh; // transparent (x-ray shells)
  trees: Inst[];
  cars: Inst[];
  trucks: Inst[];
  glows: Glow[];
  detail: number; // 0 low .. 2 high
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const CONCRETE: RGB = [0.5, 0.49, 0.47];
const ROOF: RGB = [0.46, 0.46, 0.45];
const DARKM: RGB = [0.16, 0.17, 0.19];
const CAR_COLORS: RGB[] = ['#d9dce0', '#14161a', '#8b8f96', '#a31f1f', '#1f3f7a', '#e8e8e8', '#3b3f45', '#6d7f8c', '#2b4a35', '#b98a2f'].map(hex);
const GLASS_TINTS: RGB[] = ['#5f8fb0', '#6fa6b8', '#7d97ad', '#4d7795', '#8aa7b5', '#6b8a8a', '#7890a8'].map(hex);
const OFFICE_WALLS: RGB[] = ['#b6b1a6', '#a9a69d', '#c4bfb2', '#8f9196', '#d0cabb', '#9c9a93'].map(hex);
const BRICKS: RGB[] = ['#8a4a36', '#7c4232', '#96563e', '#6e3b2e', '#a06449', '#83503f'].map(hex);
const STUCCO: RGB[] = ['#c9bda9', '#b9ae9d', '#d6cbb7', '#a89f91', '#c7b49c', '#cfc4b8', '#9fa49f'].map(hex);
const HOUSE: RGB[] = ['#d8cfbe', '#c7bba5', '#b9c2c4', '#d3c1a5', '#a8b0a0', '#e0dbd0'].map(hex);
const SHINGLE: RGB[] = ['#4c4a48', '#5b4436', '#3f454c', '#6a4a3a'].map(hex);
const METAL: RGB[] = ['#9aa1a8', '#868d94', '#a9adb0', '#7c8a93', '#b2b4b0'].map(hex);
const TRUCK_COLS: RGB[] = ['#e8e8e8', '#d4d6d8', '#c9ccd0', '#b9bcc0', '#2a5d9c'].map(hex);
const SIGNS: RGB[] = ['#c8352b', '#1f6fb5', '#e0a020', '#2b8a4b', '#7a3fa0', '#d8532b', '#17807a'].map(hex);
const AWN: RGB[] = ['#a62c26', '#23537a', '#2d6b47', '#c88a1e', '#3b3f45'].map(hex);

function tree(o: Out, r: () => number, x: number, z: number, big = 1) {
  o.trees.push({ x, y: 0, z, s: (0.8 + r() * 0.7) * big, yaw: r() * 6.28, c: mixc(hex('#3f6a2c'), hex('#6c8c3c'), r()) });
}

/** Parapet, plant rooms, ducts, tanks and antennas: what makes a roof read as a roof. */
function rooftop(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, y: number, seed: number, opts: { tank?: boolean; plant?: number; parapet?: number; col?: RGB } = {}) {
  const m = o.m, w = x1 - x0, d = z1 - z0, pw = 0.35, ph = opts.parapet ?? 1.0;
  const col = opts.col ?? mixc(CONCRETE, [0.4, 0.4, 0.4], 0.3);
  const pm: Mat = { st: S.plain, seed };
  m.box(x0, y, z0, x1, y + ph, z0 + pw, col, pm); m.box(x0, y, z1 - pw, x1, y + ph, z1, col, pm);
  m.box(x0, y, z0 + pw, x0 + pw, y + ph, z1 - pw, col, pm); m.box(x1 - pw, y, z0 + pw, x1, y + ph, z1 - pw, col, pm);
  if (o.detail < 1 && Math.min(w, d) < 14) return;
  const n = Math.min(opts.plant ?? 3, Math.floor((w * d) / 70) + 1);
  for (let i = 0; i < n; i++) {
    const uw = 1.6 + r() * 2.6, ud = 1.6 + r() * 2.2, ux = x0 + 1.4 + r() * Math.max(0.1, w - uw - 2.8), uz = z0 + 1.4 + r() * Math.max(0.1, d - ud - 2.8), uh = 1.1 + r() * 1.4;
    m.box(ux, y, uz, ux + uw, y + uh, uz + ud, [0.66, 0.67, 0.68], { st: S.metal, seed: seed + i, bay: 0 });
    if (o.detail > 1) m.cyl(ux + uw / 2, y + uh, uz + ud / 2, Math.min(uw, ud) * 0.3, 0.3, [0.25, 0.26, 0.28], { st: S.plain, seed }, 8);
  }
  if (opts.tank && Math.min(w, d) > 8) {
    const tx = x0 + 2 + r() * (w - 4), tz = z0 + 2 + r() * (d - 4);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box(tx + a - 0.08, y, tz + b - 0.08, tx + a + 0.08, y + 2.6, tz + b + 0.08, DARKM, pm, null);
    m.cyl(tx, y + 2.6, tz, 1.7, 3, hex('#6b5238'), { st: S.plain, seed }, 10);
    m.cyl(tx, y + 5.6, tz, 1.8, 0.5, DARKM, pm, 10);
  }
}

function contact(o: Out, x0: number, z0: number, x1: number, z1: number, h: number) {
  o.decal.contact(x0, z0, x1, z1, Math.min(9, 1.8 + h * 0.2));
}

function aviation(o: Out, x: number, y: number, z: number) {
  o.glows.push({ x, y, z, c: [1, 0.12, 0.08], a: 0.8, size: 26 });
}

export function tower(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, H: number, seed: number, glass: boolean, wall?: RGB) {
  const m = o.m;
  const tint = glass ? pick(r, GLASS_TINTS) : wall ?? pick(r, OFFICE_WALLS);
  const mat: Mat = glass ? { st: S.glass, seed, flr: 3.9, bay: 2.8 + r() } : { st: S.office, seed, flr: 3.7 + r() * 0.4, bay: 3 + r() * 1.2 };
  const roofT = { col: ROOF, m: { st: S.roof, seed } };
  let y = 0;
  const w = x1 - x0, d = z1 - z0;
  // retail podium
  if (H > 28 && Math.min(w, d) > 18) {
    const ph = 7 + Math.floor(r() * 2) * 4;
    m.box(x0, 0, z0, x1, ph, z1, pick(r, SIGNS.slice(0, 3)), { st: S.shop, seed: seed + 1, flr: 5, bay: 6 }, roofT);
    if (o.detail > 0) rooftop(o, r, x0, z0, x1, z1, ph, seed, { plant: 2, parapet: 0.8 });
    const inset = Math.min(w, d) * (0.1 + r() * 0.08);
    x0 += inset; x1 -= inset; z0 += inset; z1 -= inset;
    y = ph;
  }
  const tiers = H > 90 ? 3 : H > 45 ? 2 : 1;
  for (let t = 0; t < tiers; t++) {
    const top = t === tiers - 1 ? H : y + (H - y) * (t === 0 ? 0.55 + r() * 0.15 : 0.6 + r() * 0.15);
    m.box(x0, y, z0, x1, top, z1, tint, mat, roofT);
    // horizontal mechanical band between tiers
    if (t < tiers - 1) m.box(x0 - 0.15, top - 1.2, z0 - 0.15, x1 + 0.15, top, z1 + 0.15, scalec(tint, 0.6), { st: S.plain, seed });
    y = top;
    if (t < tiers - 1) {
      const a = (x1 - x0) * (0.07 + r() * 0.09), b = (z1 - z0) * (0.07 + r() * 0.09);
      x0 += a; x1 -= a; z0 += b; z1 -= b;
    }
  }
  rooftop(o, r, x0, z0, x1, z1, H, seed, { plant: 4, parapet: 1.3, col: glass ? scalec(tint, 0.5) : undefined });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const pw = (x1 - x0) * 0.32, pd = (z1 - z0) * 0.32;
  m.box(cx - pw, H, cz - pd, cx + pw, H + 3.6, cz + pd, glass ? scalec(tint, 0.55) : scalec(tint, 0.85), { st: S.metal, seed, bay: 0 }, roofT);
  if (H > 110) {
    m.cyl(cx, H + 3.6, cz, 0.35, H * 0.14, [0.65, 0.66, 0.68], { st: S.plain, seed }, 6, false);
    aviation(o, cx, H + 3.6 + H * 0.14, cz);
  } else if (H > 60) aviation(o, cx, H + 3.8, cz);
}

export function office(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  if (H > 22 || r() < 0.35) return tower(o, r, x0, z0, x1, z1, H, seed, r() < 0.45);
  const m = o.m;
  const wall = pick(r, OFFICE_WALLS);
  m.box(x0, 0, z0, x1, H, z1, wall, { st: S.office, seed, flr: 3.8, bay: 3.4 + r() }, { col: ROOF, m: { st: S.roof, seed } });
  // glazed lobby at the base of the street front
  const w = x1 - x0;
  m.box(x0 + w * 0.3, 0, z1 - 0.05, x1 - w * 0.3, 4.2, z1 + 0.35, hex('#6f8ea0'), { st: S.glass, seed, flr: 4.2, bay: 2 });
  m.box(x0 + w * 0.26, 4.2, z1, x1 - w * 0.26, 4.7, z1 + 1.8, scalec(wall, 0.7), { st: S.plain, seed });
  rooftop(o, r, x0, z0, x1, z1, H, seed, { plant: 4 });
}

export function apartment(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  const m = o.m;
  const c = pick(r, STUCCO);
  const mat: Mat = { st: S.apartment, seed, flr: 3.1, bay: 3.6 + r() };
  const top = { col: ROOF, m: { st: S.roof, seed } };
  const w = x1 - x0, d = z1 - z0;
  if (Math.min(w, d) > 24 && r() < 0.6) {
    // courtyard (U) plan
    const t = Math.min(w, d) * 0.32;
    m.box(x0, 0, z0, x1, H, z0 + t, c, mat, top);
    m.box(x0, 0, z0 + t, x0 + t, H, z1, c, mat, top);
    m.box(x1 - t, 0, z0 + t, x1, H, z1, c, mat, top);
    rooftop(o, r, x0, z0, x1, z0 + t, H, seed, { plant: 2, tank: true });
    o.m.flat(x0 + t, z0 + t, x1 - t, z1, 0.08, CONCRETE, { st: S.grass, seed });
    if (o.detail > 0) tree(o, r, (x0 + x1) / 2, (z0 + z1 + t) / 2);
  } else {
    m.box(x0, 0, z0, x1, H, z1, c, mat, top);
    rooftop(o, r, x0, z0, x1, z1, H, seed, { plant: 2, tank: r() < 0.5 });
    if (o.detail > 1 && H > 9) {
      // balconies on the street face
      const bays = Math.floor(w / 4.5), floors = Math.floor(H / 3.1);
      for (let f = 1; f < Math.min(floors, 9); f += 1) for (let b = 0; b < bays; b += 2) {
        const bx = x0 + 1 + b * (w - 2) / Math.max(1, bays);
        m.box(bx, f * 3.1 - 0.1, z1, bx + 2.8, f * 3.1 + 0.05, z1 + 1, CONCRETE, { st: S.plain, seed }, undefined, 1);
        m.box(bx, f * 3.1, z1 + 0.92, bx + 2.8, f * 3.1 + 0.9, z1 + 1, DARKM, { st: S.plain, seed }, null, 1);
      }
    }
  }
}

/** A terrace of narrow brick buildings of differing heights: the classic dense city block. */
export function brickRow(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  const m = o.m;
  const alongX = x1 - x0 >= z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(1, Math.round(len / (8 + r() * 5)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * len, b = ((i + 1) / n) * len;
    const h = Math.max(7, H * (0.72 + r() * 0.5));
    const q = alongX ? [x0 + a, z0, x0 + b, z1] : [x0, z0 + a, x1, z0 + b];
    const brick = r() < 0.78;
    const c = brick ? pick(r, BRICKS) : pick(r, STUCCO);
    m.box(q[0], 0, q[1], q[2], h, q[3], c, { st: brick ? S.brick : S.apartment, seed: seed + i * 0.13, flr: 3.3, bay: 2.8 + r() * 0.7 }, { col: ROOF, m: { st: S.roof, seed } });
    // shops on the ground floor of many terraces
    if (r() < 0.5) {
      const sign = pick(r, SIGNS);
      if (alongX) m.box(q[0] + 0.2, 0, z1 - 0.1, q[2] - 0.2, 4, z1 + 0.15, sign, { st: S.shop, seed: seed + i, flr: 3.9, bay: 3 }, null);
      else m.box(x1 - 0.1, 0, q[1] + 0.2, x1 + 0.15, 4, q[3] - 0.2, sign, { st: S.shop, seed: seed + i, flr: 3.9, bay: 3 }, null);
    }
    // cornice and parapet
    m.box(q[0] - 0.12, h, q[1] - 0.12, q[2] + 0.12, h + 0.55, q[3] + 0.12, scalec(c, 0.7), { st: S.plain, seed }, { col: ROOF, m: { st: S.roof, seed } });
    if (o.detail > 0 && r() < 0.4) m.box((q[0] + q[2]) / 2 - 0.5, h + 0.55, (q[1] + q[3]) / 2 - 0.5, (q[0] + q[2]) / 2 + 0.5, h + 1.9, (q[1] + q[3]) / 2 + 0.5, pick(r, BRICKS), { st: S.plain, seed });
    if (o.detail > 1 && r() < 0.25) rooftop(o, r, q[0], q[1], q[2], q[3], h + 0.55, seed + i, { tank: true, plant: 1, parapet: 0.1 });
  }
}

export function house(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m;
  const c = pick(r, HOUSE), roof = pick(r, SHINGLE);
  const floors = r() < 0.5 ? 2 : 1, H = floors * 3;
  const mat: Mat = { st: S.siding, seed, flr: 3, bay: 3.6 };
  m.box(x0, 0, z0, x1, H, z1, c, mat, null);
  m.gable(x0, H, z0, x1, z1, 2.2 + r() * 1.2, roof, c, seed, mat);
  // garage and chimney
  if (o.detail > 0) {
    const gx = x1, gw = Math.min(5, (x1 - x0) * 0.6);
    m.box(gx, 0, z0 + 0.5, gx + gw, 2.8, z0 + 6, c, { st: S.plain, seed }, { col: roof, m: { st: S.shingle, seed } });
    m.box(x0 + 1, H, z0 + 1, x0 + 1.7, H + 3, z0 + 1.7, pick(r, BRICKS), { st: S.plain, seed });
  }
}

function parkingRows(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number, fill = 0.55) {
  fill *= o.detail > 1 ? 0.55 : o.detail > 0 ? 0.32 : 0.15;
  o.m.flat(x0, z0, x1, z1, 0.07, [0.2, 0.2, 0.2], { st: S.parking, seed });
  const rows: number[] = [];
  // stall rows match the shader's painted bays (16 m repeat in world z)
  for (let k = Math.ceil((z0 - 15) / 16); k * 16 < z1; k++) { rows.push(k * 16 + 3, k * 16 + 13); }
  for (const zr of rows) {
    if (zr < z0 + 2.5 || zr > z1 - 2.5) continue;
    for (let i = Math.ceil(x0 / 2.7); (i + 1) * 2.7 < x1; i++) {
      if (r() > fill) continue;
      const cx = (i + 0.5) * 2.7;
      o.cars.push({ x: cx, y: 0.07, z: zr, s: 1, yaw: Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI), c: pick(r, CAR_COLORS) });
    }
  }
}

function fence(o: Out, x0: number, z0: number, x1: number, z1: number, seed: number, h = 2.2, col: RGB = [0.5, 0.52, 0.55]) {
  const m = o.m, t = 0.06, pm: Mat = { st: S.plain, seed };
  m.box(x0, 0, z0, x1, h, z0 + t, col, pm, null, 1); m.box(x0, 0, z1 - t, x1, h, z1, col, pm, null, 1);
  m.box(x0, 0, z0, x0 + t, h, z1, col, pm, null, 1); m.box(x1 - t, 0, z0, x1, h, z1, col, pm, null, 1);
}

function container(o: Out, x: number, y: number, z: number, along: boolean, c: RGB, seed: number) {
  const l = 12, w = 2.45, h = 2.6;
  o.m.box(x, y, z, x + (along ? l : w), y + h, z + (along ? w : l), c, { st: S.metal, seed, bay: 0 });
}

function truck(o: Out, r: () => number, x: number, z: number, yaw: number) {
  o.trucks.push({ x, y: 0.07, z, s: 1, yaw, c: pick(r, TRUCK_COLS) });
}

function shopStrip(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number, floors: number) {
  // shops line the back of the lot, parking faces the street
  const m = o.m, w = x1 - x0, d = z1 - z0;
  const bd = Math.min(d * 0.6, 22);
  const n = Math.max(1, Math.round(w / (10 + r() * 6)));
  const by0 = z0, by1 = z0 + bd;
  for (let i = 0; i < n; i++) {
    const a = x0 + (i / n) * w, b = x0 + ((i + 1) / n) * w;
    const H = 4.6 + (floors - 1) * 3.4 + r() * 0.8;
    const sign = pick(r, SIGNS);
    m.box(a, 0, by0, b, H, by1, sign, { st: S.shop, seed: seed + i * 0.21, flr: 4.4, bay: 3.2 }, { col: ROOF, m: { st: S.roof, seed } });
    // awning and rooftop sign
    m.box(a + 0.4, 3.1, by1, b - 0.4, 3.35, by1 + 1.5, pick(r, AWN), { st: S.plain, seed }, undefined, 1);
    if (r() < 0.5) { m.box(a + (b - a) * 0.2, H, by1 - 0.4, b - (b - a) * 0.2, H + 1.2, by1 - 0.2, sign, { st: S.glow, seed }, null, 1); }
    rooftop(o, r, a, by0, b, by1, H, seed + i, { plant: 1, parapet: 0.6 });
  }
  contact(o, x0, by0, x1, by1, 5);
  if (d - bd > 8) parkingRows(o, r, x0, by1 + 2, x1, z1, seed, 0.5);
  if (o.detail > 0) { tree(o, r, x0 + 1.5, z1 - 1.5, 0.7); tree(o, r, x1 - 1.5, z1 - 1.5, 0.7); }
}

function warehouse(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number, H: number, plant: boolean) {
  const m = o.m, w = x1 - x0, d = z1 - z0;
  o.m.flat(x0, z0, x1, z1, 0.06, [0.42, 0.42, 0.41], { st: S.pavement, seed });
  const bd = d * 0.68;
  const wall = pick(r, METAL);
  const by0 = z0 + 1, by1 = z0 + bd;
  const pitched = r() < 0.5;
  m.box(x0 + 1, 0, by0, x1 - 1, H, by1, wall, { st: S.metal, seed, bay: 9 + r() * 4 }, pitched ? null : { col: ROOF, m: { st: S.roof, seed } });
  if (pitched) m.gable(x0 + 1, H, by0, x1 - 1, by1, Math.min(4, w * 0.05), hex('#6d7277'), wall, seed, { st: S.metal, seed, bay: 0 });
  else rooftop(o, r, x0 + 1, by0, x1 - 1, by1, H, seed, { plant: 3, parapet: 0.5, col: scalec(wall, 0.8) });
  contact(o, x0 + 1, by0, x1 - 1, by1, H);
  // loading yard with trailers at the docks
  const n = Math.floor((w - 6) / 12);
  for (let i = 0; i < n; i++) if (r() < (o.detail > 0 ? 0.3 : 0.12)) truck(o, r, x0 + 7 + i * 12, by1 + 8, Math.PI / 2);
  if (plant) {
    // process plant: stacks, silos and pipes
    const sx = x0 + 3 + r() * (w * 0.3);
    m.cyl(sx, H, by0 + 4, 0.9, 11 + r() * 9, hex('#85807a'), { st: S.plain, seed }, 10);
    m.box(sx - 1.05, H + 8, by0 + 2.95, sx + 1.05, H + 8.6, by0 + 5.05, [0.7, 0.2, 0.15], { st: S.plain, seed });
    for (let i = 0; i < 3; i++) m.cyl(x1 - 5 - i * 6.5, 0, z1 - 5, 2.8, 8 + r() * 3, [0.72, 0.72, 0.7], { st: S.metal, seed, bay: 0 }, 12);
    m.box(x1 - 20, 7, z1 - 5.3, x1 - 3, 7.5, z1 - 4.7, DARKM, { st: S.plain, seed });
  }
}

function yardLot(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number) {
  // working yard: sheds and stacked containers rather than empty land
  const m = o.m, w = x1 - x0, d = z1 - z0;
  m.flat(x0, z0, x1, z1, 0.06, [0.44, 0.42, 0.38], { st: S.gravel, seed });
  fence(o, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, seed);
  const cols: RGB[] = ['#a4502f', '#2a5d9c', '#2e7d4f', '#c9a227', '#8a8f96', '#7a3b2e'].map(hex);
  const rows = Math.floor((d - 8) / 7);
  for (let j = 0; j < rows; j++) {
    const cn = Math.floor((w * 0.55) / 13);
    for (let i = 0; i < cn; i++) {
      if (r() < 0.22) continue;
      const lv = 1 + Math.floor(r() * (o.detail > 0 ? 3 : 2));
      for (let k = 0; k < lv; k++) container(o, x0 + 4 + i * 13, 0.07 + k * 2.6, z0 + 4 + j * 7, true, pick(r, cols), seed + i);
    }
  }
  const sx0 = x0 + w * 0.62, sx1 = x1 - 4;
  if (sx1 - sx0 > 8) {
    const sh = 7 + r() * 3;
    m.box(sx0, 0, z0 + 4, sx1, sh, z0 + Math.min(d - 8, 24), pick(r, METAL), { st: S.metal, seed, bay: 10 }, null);
    m.gable(sx0, sh, z0 + 4, sx1, z0 + Math.min(d - 8, 24), 2.4, hex('#737880'), pick(r, METAL), seed, { st: S.metal, seed, bay: 0 });
    contact(o, sx0, z0 + 4, sx1, z0 + Math.min(d - 8, 24), sh);
  }
  for (let i = 0; i < 2; i++) if (r() < 0.8) truck(o, r, x0 + w * (0.62 + r() * 0.3), z1 - 8, r() * 3.14);
}

/** Vacant ground for sale: worn parking or a fenced gravel lot with a billboard and weeds. */
function vacant(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m, w = x1 - x0;
  if (r() < 0.55) {
    parkingRows(o, r, x0 + 1, z0 + 1, x1 - 1, z1 - 1, seed, 0.28);
    m.box(x0 + 2, 0, z0 + 2, x0 + 4.6, 2.6, z0 + 4, hex('#d9d4c4'), { st: S.siding, seed, flr: 2.6, bay: 2 }, { col: hex('#3f454c'), m: { st: S.plain, seed } });
  } else {
    m.flat(x0, z0, x1, z1, 0.06, [0.42, 0.4, 0.36], { st: S.gravel, seed });
    fence(o, x0 + 0.4, z0 + 0.4, x1 - 0.4, z1 - 0.4, seed);
    const n = Math.min(9, Math.floor((w * (z1 - z0)) / 180));
    for (let i = 0; i < n; i++) tree(o, r, x0 + 3 + r() * (w - 6), z0 + 3 + r() * (z1 - z0 - 6), 0.45);
    if (w > 12) {
      m.box(x0 + 3, 0, z1 - 2, x0 + 3.3, 7, z1 - 1.7, DARKM, { st: S.plain, seed }, null, 1);
      m.box(x0 + 1, 7, z1 - 2, x0 + 9, 10.5, z1 - 1.8, pick(r, SIGNS), { st: S.glow, seed }, null, 1);
    }
  }
}

/** Cleared land owned by someone: a graded, fenced site that's ready to build on. */
function clearedSite(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m;
  m.flat(x0, z0, x1, z1, 0.06, [0.5, 0.4, 0.3], { st: S.dirt, seed });
  fence(o, x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, seed, 2.3, [0.72, 0.65, 0.36]);
  m.box(x0 + 2, 0, z0 + 2, x0 + 8, 2.7, z0 + 4.6, hex('#d8d8d0'), { st: S.siding, seed, flr: 2.7, bay: 2.5 }, { col: hex('#555'), m: { st: S.plain, seed } });
}

// ---------- background city ----------
export function buildSky(o: Out, b: SkyBuilding) {
  const r = mulberry32(hashString(b.id));
  const { x0, y0, x1, y1 } = b.rect;
  const s = b.seed;
  switch (b.kind) {
    case 'tower': tower(o, r, x0, y0, x1, y1, b.height, s, r() < 0.3); break;
    case 'glass': tower(o, r, x0, y0, x1, y1, b.height, s, true); break;
    case 'office': office(o, r, x0, y0, x1, y1, b.height, s); break;
    case 'apartment': apartment(o, r, x0, y0, x1, y1, b.height, s); break;
    case 'brick': brickRow(o, r, x0, y0, x1, y1, b.height, s); break;
    case 'low': if (r() < 0.5) brickRow(o, r, x0, y0, x1, y1, Math.max(6, b.height), s); else apartment(o, r, x0, y0, x1, y1, Math.max(6, b.height), s); break;
    case 'house': house(o, r, x0, y0, x1, y1, s); if (b.yard && o.detail > 0) tree(o, r, x1 + 3 + r() * 3, y0 + r() * (y1 - y0), 1.05); break;
    case 'civic': civicBuilding(o, r, x0, y0, x1, y1, s); break;
    case 'church': church(o, x0, y0, x1, y1, s); break;
    case 'school': school(o, r, x0, y0, x1, y1, b.height, s); break;
    case 'silo': silo(o, x0, y0, x1, y1, b.height, s); break;
    case 'barn': barn(o, x0, y0, x1, y1, s); break;
    case 'watertower': waterTower(o, x0, y0, x1, y1, b.height, s); return;
    case 'pumpjack': pumpjack(o, x0, y0, x1, y1, s); return;
    case 'warehouse': {
      const wall = pick(r, METAL);
      o.m.box(x0, 0, y0, x1, b.height, y1, wall, { st: S.metal, seed: s, bay: 10 }, { col: ROOF, m: { st: S.roof, seed: s } });
      rooftop(o, r, x0, y0, x1, y1, b.height, s, { plant: 2, parapet: 0.5, col: scalec(wall, 0.8) });
      break;
    }
  }
  contact(o, x0, y0, x1, y1, b.height);
}

// ---------- small-town landmarks ----------
function civicBuilding(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m, brick = hex('#94553f'), stone = hex('#c9c3b4'), H = 11;
  const mat: Mat = { st: S.brick, seed, flr: 4.2, bay: 3.4 };
  m.box(x0, 0, z0, x1, H, z1, brick, mat, { col: hex('#3f4347'), m: { st: S.roof, seed } });
  const cx = (x0 + x1) / 2;
  // entrance block with pale stone trim, steps and a flag
  m.box(cx - 7, 0, z1, cx + 7, H + 1.5, z1 + 2.2, stone, { st: S.office, seed, flr: 4.2, bay: 3.5 }, { col: stone, m: { st: S.plain, seed } });
  for (let i = 0; i < 3; i++) m.box(cx - 8 - i, i * -0.0, z1 + 2.2 + i * 0.8, cx + 8 + i, 1.2 - i * 0.4, z1 + 3 + i * 0.8, stone, { st: S.plain, seed }, undefined, 0.8);
  m.box(x0 - 0.15, H - 0.7, z0 - 0.15, x1 + 0.15, H, z1 + 0.15, stone, { st: S.plain, seed });
  m.cyl(cx + 13, 0, z1 + 8, 0.09, 12, [0.75, 0.76, 0.78], { st: S.plain, seed }, 6, false);
  m.box(cx + 13.1, 10.2, z1 + 7.97, cx + 15.8, 11.8, z1 + 8.03, hex('#a8322b'), { st: S.plain, seed }, null, 1);
  if (o.detail > 0) { tree(o, r, x0 - 7, z0 + 4, 1.2); tree(o, r, x1 + 7, z0 + 4, 1.2); tree(o, r, x0 - 7, z1 + 4, 1.1); tree(o, r, x1 + 7, z1 + 4, 1.1); }
}
function church(o: Out, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m, wall = hex('#ddd8cc'), roof = hex('#494b4e'), mat: Mat = { st: S.siding, seed, flr: 5, bay: 4 };
  m.box(x0, 0, z0, x1, 6.5, z1, wall, mat, null);
  m.gable(x0, 6.5, z0, x1, z1, 4.5, roof, wall, seed, mat);
  const cx = (x0 + x1) / 2, t0 = z1 - 5, w = 2.6;
  m.box(cx - w, 0, t0, cx + w, 14, z1 + 1.5, wall, mat, { col: roof, m: { st: S.shingle, seed } });
  m.gable(cx - w, 14, t0, cx + w, z1 + 1.5, 6, roof, wall, seed, mat);
  m.box(cx - 0.12, 19.5, t0 + 3, cx + 0.12, 22, t0 + 3.3, [0.82, 0.82, 0.8], { st: S.plain, seed }, null, 1);
}
function school(o: Out, r: () => number, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  const m = o.m, brick = hex('#a0604a');
  m.box(x0, 0, z0, x1, H, z1, brick, { st: S.brick, seed, flr: 3.9, bay: 3 }, { col: ROOF, m: { st: S.roof, seed } });
  const cx = (x0 + x1) / 2;
  m.box(cx - 5, 0, z1, cx + 5, 5, z1 + 1, hex('#7fa3b5'), { st: S.glass, seed, flr: 5, bay: 2.5 });
  rooftop(o, r, x0, z0, x1, z1, H, seed, { plant: 3, parapet: 0.7 });
  // ball field out back
  m.flat(x0, z1 + 6, x1, z1 + 38, 0.07, [0.28, 0.42, 0.18], { st: S.grass, seed });
  m.flat(x0 + 26, z1 + 12, x1 - 26, z1 + 32, 0.09, hex('#8c6a45'), { st: S.dirt, seed });
}
function silo(o: Out, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  const c = hex('#b9bcbf'), rad = Math.min(x1 - x0, z1 - z0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  o.m.cyl(cx, 0, cz, rad, H, c, { st: S.metal, seed, bay: 2 }, 14);
  o.m.cyl(cx, H, cz, rad * 0.55, rad * 0.45, scalec(c, 0.82), { st: S.metal, seed, bay: 0 }, 14);
}
function barn(o: Out, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const red = hex('#8c3026'), mat: Mat = { st: S.siding, seed, flr: 2.8, bay: 2 };
  o.m.box(x0, 0, z0, x1, 5.2, z1, red, mat, null);
  o.m.gable(x0, 5.2, z0, x1, z1, 3.6, hex('#5a5d60'), red, seed, mat);
}
function waterTower(o: Out, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  const c = hex('#c9ced2'), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rad = (x1 - x0) / 2;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) o.m.cyl(cx + a * rad * 0.7, 0, cz + b * rad * 0.7, 0.32, H - 7, [0.55, 0.57, 0.6], { st: S.plain, seed }, 6, false);
  o.m.cyl(cx, 0, cz, 0.6, H - 7, [0.55, 0.57, 0.6], { st: S.plain, seed }, 6, false);
  o.m.cyl(cx, H - 7, cz, rad, 6, c, { st: S.paint, seed }, 16);
  o.m.cyl(cx, H - 1, cz, rad * 0.5, 1.4, scalec(c, 0.92), { st: S.paint, seed }, 16);
  o.glows.push({ x: cx, y: H + 0.8, z: cz, c: [1, 0.12, 0.08], a: 0.7, size: 22 });
}
function pumpjack(o: Out, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const m = o.m, c = hex('#3f4348'), red = hex('#8a3a2c'), cz = (z0 + z1) / 2, pm: Mat = { st: S.plain, seed };
  m.flat(x0 - 2, z0 - 3, x1 + 2, z1 + 3, 0.05, [0.42, 0.38, 0.3], { st: S.gravel, seed });
  m.box(x0, 0, z0 + 0.5, x1, 0.5, z1 - 0.5, c, pm);
  m.box(x0 + 3.4, 0.5, cz - 0.9, x0 + 3.8, 4.2, cz - 0.6, c, pm, undefined, 1);
  m.box(x0 + 3.4, 0.5, cz + 0.6, x0 + 3.8, 4.2, cz + 0.9, c, pm, undefined, 1);
  m.box(x0 - 0.2, 4, cz - 0.28, x1 - 1, 4.5, cz + 0.28, red, pm, undefined, 1);
  m.box(x0 - 1, 3, cz - 0.4, x0 + 0.1, 5, cz + 0.4, c, pm, undefined, 1);
  m.box(x1 - 2, 0.5, cz - 0.5, x1 - 0.8, 3.4, cz + 0.5, red, pm, undefined, 1);
}

export function buildPark(o: Out, rect: Rect, seed: number) {
  const r = mulberry32(Math.floor(seed * 1e6) + 7);
  const { x0, y0, x1, y1 } = rect;
  o.m.flat(x0, y0, x1, y1, 0.07, [0.3, 0.45, 0.2], { st: S.grass, seed });
  // footpaths
  const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2;
  o.m.flat(cx - 1.5, y0, cx + 1.5, y1, 0.09, [0.68, 0.64, 0.56], { st: S.pavement, seed });
  o.m.flat(x0, cz - 1.5, x1, cz + 1.5, 0.09, [0.68, 0.64, 0.56], { st: S.pavement, seed });
  const n = Math.floor(((x1 - x0) * (y1 - y0)) / (o.detail > 1 ? 180 : o.detail > 0 ? 350 : 800));
  for (let i = 0; i < n; i++) {
    const x = x0 + 4 + r() * (x1 - x0 - 8), z = y0 + 4 + r() * (y1 - y0 - 8);
    if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
    tree(o, r, x, z, 1.1);
  }
}

// ---------- parcels ----------
export interface ParcelRender { status: string; owner: string | null; facility?: Facility; progress: number; color?: string; bp?: string; stage?: string; xray: boolean; slotsInUse?: number; }

/** Writes a parcel's current appearance and returns its tallest point (for picking). */
export function buildParcel(o: Out, p: ParcelDef, st: ParcelRender, s: GameState): number {
  const r = mulberry32(hashString(p.id));
  const seed = r();
  const { x0, y0: z0, x1, y1: z1 } = p.rect;
  const w = x1 - x0, d = z1 - z0;
  const inset = (f: number) => { const k = (1 - Math.sqrt(f)) / 2; return [x0 + w * k, z0 + d * k, x1 - w * k, z1 - d * k]; };

  if (st.status === 'facility' || st.status === 'hq') {
    if (st.facility?.isHQ) return hqBuilding(o, r, p, st.facility, s, seed);
    return dataCenter(o, r, p, st, s, seed);
  }
  if (st.status === 'construction') return constructionSite(o, r, p, st, seed);
  if (st.status === 'demolishing') return demolition(o, r, p, st, seed);
  if (st.status === 'cleared') {
    if (st.owner) { clearedSite(o, r, x0, z0, x1, z1, seed); return 3; }
    vacant(o, r, x0, z0, x1, z1, seed);
    return 4;
  }
  // existing building, chosen from the property type
  const H = Math.max(4, p.buildingHeight);
  o.m.flat(x0, z0, x1, z1, 0.05, [0.44, 0.44, 0.42], { st: S.pavement, seed });
  switch (p.type) {
    case 'premium': {
      const q = inset(0.42);
      tower(o, r, q[0], q[1], q[2], q[3], Math.max(H, 40), seed, r() < 0.7);
      contact(o, q[0], q[1], q[2], q[3], H);
      tree(o, r, x0 + 2, z0 + 2); tree(o, r, x1 - 2, z1 - 2);
      return Math.max(H, 40) * 1.15;
    }
    case 'office': {
      if (p.brick) {
        brickRow(o, r, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Math.max(7, H), seed);
        contact(o, x0 + 1, z0 + 1, x1 - 1, z1 - 1, H);
        return Math.max(7, H) * 1.3;
      }
      if (p.area > 2200) {
        // office park: two or three linked blocks around a plaza
        const n = 2 + (p.area > 4500 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = x0 + (w * i) / n + 2.5, b = x0 + (w * (i + 1)) / n - 2.5;
          const hh = H * (0.75 + r() * 0.45);
          const zz1 = z0 + d * 0.72;
          office(o, r, a, z0 + 2, b, zz1, hh, seed + i * 0.17);
          contact(o, a, z0 + 2, b, zz1, hh);
        }
        parkingRows(o, r, x0 + 2, z0 + d * 0.74, x1 - 2, z1 - 1, seed, 0.6);
        return H * 1.35;
      }
      const q = inset(0.5);
      office(o, r, q[0], q[1], q[2], q[3], H, seed);
      contact(o, q[0], q[1], q[2], q[3], H);
      if (o.detail > 0) { tree(o, r, x0 + 2, z1 - 2, 0.8); tree(o, r, x1 - 2, z1 - 2, 0.8); }
      return H * 1.15;
    }
    case 'retail':
    case 'restaurant':
      if (w < 16 || d < 16 || p.brick) {
        const q = [x0 + 1, z0 + 1, x1 - 1, z1 - 1];
        brickRow(o, r, q[0], q[1], q[2], q[3], Math.max(5, H), seed);
        contact(o, q[0], q[1], q[2], q[3], H);
        return Math.max(5, H) * 1.3;
      }
      shopStrip(o, r, x0 + 1, z0 + 1, x1 - 1, z1 - 1, seed, p.buildingFloors || 1);
      return 8 + (p.buildingFloors || 1) * 3.4;
    case 'shopping_center': {
      // an L-shaped mall with anchor box, glass entrance and a big car park
      const m = o.m, bd = d * 0.46, wall = pick(r, STUCCO), hh = Math.max(9, H);
      m.box(x0 + 2, 0, z0 + 2, x1 - 2, hh, z0 + bd, wall, { st: S.shop, seed, flr: 6, bay: 9 }, { col: ROOF, m: { st: S.roof, seed } });
      rooftop(o, r, x0 + 2, z0 + 2, x1 - 2, z0 + bd, hh, seed, { plant: 6, parapet: 1 });
      m.box(x0 + 2, 0, z0 + bd, x0 + w * 0.26, hh * 0.72, z0 + d * 0.66, wall, { st: S.shop, seed: seed + 0.3, flr: 5, bay: 8 }, { col: ROOF, m: { st: S.roof, seed } });
      const cx = (x0 + x1) / 2;
      m.box(cx - 9, 0, z0 + bd - 0.2, cx + 9, hh + 3, z0 + bd + 1, hex('#7fa3b5'), { st: S.glass, seed, flr: 4, bay: 3 }, { col: scalec(wall, 0.8), m: { st: S.plain, seed } });
      m.box(cx - 8, hh + 3, z0 + bd + 0.9, cx + 8, hh + 5, z0 + bd + 1.05, pick(r, SIGNS), { st: S.glow, seed }, null, 1);
      contact(o, x0 + 2, z0 + 2, x1 - 2, z0 + bd, hh);
      parkingRows(o, r, x0 + w * 0.27, z0 + bd + 3, x1 - 2, z1 - 2, seed, 0.62);
      for (let i = 0; i < 3; i++) tree(o, r, x0 + w * 0.3 + i * w * 0.22, z1 - 1.5, 0.8);
      return hh + 6;
    }
    case 'warehouse': warehouse(o, r, x0, z0, x1, z1, seed, Math.max(8, H), false); return Math.max(8, H) + 5;
    case 'industrial': warehouse(o, r, x0, z0, x1, z1, seed, Math.max(8, H), true); return Math.max(8, H) + 22;
    case 'industrial_land': yardLot(o, r, x0, z0, x1, z1, seed); return 12;
    default: { const q = inset(0.45); office(o, r, q[0], q[1], q[2], q[3], H, seed); contact(o, q[0], q[1], q[2], q[3], H); return H * 1.15; }
  }
}

function constructionSite(o: Out, r: () => number, p: ParcelDef, st: ParcelRender, seed: number): number {
  const { x0, y0: z0, x1, y1: z1 } = p.rect, m = o.m;
  const w = x1 - x0, d = z1 - z0;
  m.flat(x0, z0, x1, z1, 0.06, [0.5, 0.4, 0.3], { st: S.dirt, seed });
  fence(o, x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, seed, 2.4, [0.86, 0.62, 0.16]);
  const pr = Math.max(0, Math.min(1, st.progress));
  const fp = st.facility?.footprint ?? (st.bp ? blueprintById(st.bp).footprint : 0.5);
  const floors = st.facility?.floors ?? (st.bp ? blueprintById(st.bp).floors : 2);
  const k = Math.sqrt(Math.min(0.8, fp));
  const bw = w * k, bd = d * k, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const bx0 = cx - bw / 2, bx1 = cx + bw / 2, bz0 = cz - bd / 2, bz1 = cz + bd / 2;
  const FH = 5.5, H = floors * FH;
  if (pr > 0.12) m.box(bx0 - 0.5, 0, bz0 - 0.5, bx1 + 0.5, 0.5, bz1 + 0.5, CONCRETE, { st: S.pavement, seed }, { col: CONCRETE, m: { st: S.pavement, seed } });
  const stage = (pr - 0.22) / 0.55;
  const built = pr <= 0.22 ? 0 : Math.min(1, stage);
  const y = H * built;
  if (y > 0) {
    // steel frame: columns on a grid and a deck at each finished floor
    const nx = Math.max(2, Math.round(bw / 8)), nz = Math.max(2, Math.round(bd / 8));
    const steel: RGB = [0.34, 0.32, 0.3], sm: Mat = { st: S.plain, seed };
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      if (o.detail < 2 && i > 0 && i < nx && j > 0 && j < nz) continue;
      const qx = bx0 + (bw * i) / nx, qz = bz0 + (bd * j) / nz;
      m.box(qx - 0.16, 0.5, qz - 0.16, qx + 0.16, y, qz + 0.16, steel, sm, null, 1);
    }
    for (let fl = 1; fl * FH <= y + 0.01; fl++) m.box(bx0, fl * FH - 0.3, bz0, bx1, fl * FH, bz1, CONCRETE, sm, { col: CONCRETE, m: { st: S.pavement, seed } }, 1);
    // cladding rises in the last third
    if (pr > 0.7) m.box(bx0, 0.5, bz0, bx1, 0.5 + (y - 0.5) * Math.min(1, (pr - 0.7) / 0.28), bz1, hex('#8f979d'), { st: S.panels, seed, flr: FH }, null, 1);
  } else if (pr < 0.12) {
    m.flat(bx0, bz0, bx1, bz1, 0.08, [0.3, 0.24, 0.18], { st: S.dirt, seed });
  }
  // tower crane
  const tx = bx0 - 3, tz = bz0 - 3, th = H + 14;
  const yellow: RGB = [0.88, 0.66, 0.1], ym: Mat = { st: S.plain, seed };
  m.box(tx - 0.6, 0, tz - 0.6, tx + 0.6, th, tz + 0.6, yellow, ym);
  m.box(tx - 6, th, tz - 0.5, tx + bw * 0.9 + 6, th + 1, tz + 0.5, yellow, ym);
  m.box(tx - 6, th - 2, tz - 1, tx - 2, th, tz + 1, [0.3, 0.3, 0.32], ym);
  const hookX = tx + 4 + bw * 0.7 * ((Math.sin(pr * 30) + 1) / 2);
  m.box(hookX - 0.03, y + 3, tz - 0.03, hookX + 0.03, th, tz + 0.03, DARKM, ym, null, 1);
  m.box(hookX - 1.4, y + 2, tz - 1, hookX + 1.4, y + 3, tz + 1, [0.4, 0.42, 0.44], ym);
  o.glows.push({ x: tx + bw * 0.9 + 6, y: th + 1.2, z: tz, c: [1, 0.4, 0.1], a: 1, size: 50 });
  // each trade leaves its mark, so the site visibly moves through its stages
  if (o.detail > 0) {
    const yard = z1 - 7;
    if (pr > 0.04 && pr < 0.3) for (let i = 0; i < 3; i++) m.box(x1 - 7 - i * 3.4, 0, z0 + 2, x1 - 4.6 - i * 3.4, 0.9 + (i % 2) * 0.7, z0 + 5.4, hex('#8c7a5c'), { st: S.plain, seed }); // pallets of materials
    if (pr > 0.42 && pr < 0.97) {
      m.box(bx1 - 5, 0, yard, bx1 - 1.6, 2.6, yard + 2.6, [0.33, 0.42, 0.35], { st: S.metal, seed, bay: 0 }); // transformer
      for (let i = 0; i < 2; i++) m.cyl(bx1 - 8.5 - i * 2.4, 0, yard + 1.2, 0.95, 1.5, hex('#7a5a36'), { st: S.plain, seed }, 8); // cable drums
    }
    if (pr > 0.56 && pr < 0.97) for (let i = 0; i < 3; i++) m.box(bx0 + 1 + i * 4.4, 0, yard, bx0 + 4.8 + i * 4.4, 2.2, yard + 2.6, [0.78, 0.79, 0.8], { st: S.metal, seed: seed + i, bay: 0 }); // chillers waiting to go up
    if (pr > 0.68 && pr < 0.98 && y > 0) {
      // scaffolding around the cladding
      const pole: RGB = [0.52, 0.53, 0.55], pm: Mat = { st: S.plain, seed };
      for (let lv = 2; lv <= y + 1; lv += 2.2) { m.box(bx0 - 1.2, lv, bz1 + 1, bx1 + 1.2, lv + 0.1, bz1 + 1.5, pole, pm, undefined, 1); m.box(bx0 - 1.2, lv, bz0 - 1.5, bx1 + 1.2, lv + 0.1, bz0 - 1, pole, pm, undefined, 1); }
      for (let q = bx0 - 1; q <= bx1 + 1; q += 5) { m.box(q, 0, bz1 + 1.2, q + 0.1, y + 1.5, bz1 + 1.3, pole, pm, null, 1); m.box(q, 0, bz0 - 1.3, q + 0.1, y + 1.5, bz0 - 1.2, pole, pm, null, 1); }
    }
  }
  // site trailers and a truck
  m.box(x0 + 2, 0, z1 - 5, x0 + 9, 2.7, z1 - 2.4, hex('#e4e0d4'), { st: S.siding, seed, flr: 2.7, bay: 2.5 }, { col: hex('#555'), m: { st: S.plain, seed } });
  truck(o, r, x1 - 8, z1 - 5, 0);
  return Math.max(th + 1, 8);
}

function demolition(o: Out, r: () => number, p: ParcelDef, st: ParcelRender, seed: number): number {
  const { x0, y0: z0, x1, y1: z1 } = p.rect, m = o.m;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  m.flat(x0, z0, x1, z1, 0.06, [0.46, 0.38, 0.3], { st: S.dirt, seed });
  fence(o, x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, seed, 2.4, [0.86, 0.62, 0.16]);
  const pr = Math.max(0, Math.min(1, st.progress));
  const H = Math.max(4, p.buildingHeight) * (1 - pr);
  const bw = w * 0.55, bd = d * 0.55;
  if (H > 0.6) {
    m.box(cx - bw / 2, 0, cz - bd / 2, cx + bw / 2, H, cz + bd / 2, pick(r, OFFICE_WALLS), { st: S.office, seed, flr: 3.8, bay: 3.6 }, { col: [0.25, 0.25, 0.25], m: { st: S.dirt, seed } });
  }
  // growing rubble piles
  const piles = Math.floor(10 * Math.min(1, pr + 0.3));
  for (let i = 0; i < piles; i++) {
    const x = cx + (r() - 0.5) * (bw + 8), z = cz + (r() - 0.5) * (bd + 8), q = 1 + r() * 2.4;
    m.box(x - q, 0, z - q, x + q * 0.8, q * (0.5 + r()), z + q * 0.7, mixc([0.48, 0.45, 0.4], [0.3, 0.27, 0.23], r()), { st: S.plain, seed }, undefined, 0.7);
  }
  // excavator
  const ex = x0 + 5, ez = z1 - 7, ye: RGB = [0.85, 0.6, 0.08], em: Mat = { st: S.plain, seed };
  m.box(ex - 2.2, 0.8, ez - 1.5, ex + 2.2, 2.9, ez + 1.5, ye, em);
  m.box(ex - 2.4, 0, ez - 1.7, ex + 2.4, 0.8, ez + 1.7, DARKM, em);
  m.box(ex + 1.6, 2.4, ez - 0.3, ex + 7, 3.1, ez + 0.3, ye, em);
  m.box(ex + 6.5, 0.9, ez - 0.3, ex + 7.1, 3, ez + 0.3, ye, em);
  return Math.max(H, 5);
}

function dataCenter(o: Out, r: () => number, p: ParcelDef, st: ParcelRender, s: GameState, seed: number): number {
  const { x0, y0: z0, x1, y1: z1 } = p.rect, m = o.m;
  const w = x1 - x0, d = z1 - z0;
  const f = st.facility;
  const bp = st.bp ? blueprintById(st.bp) : f ? blueprintById(f.blueprintId) : undefined;
  const floors = f?.floors ?? bp?.floors ?? 2;
  const fp = Math.min(0.75, f?.footprint ?? bp?.footprint ?? 0.5);
  const style = f?.style ?? 'concrete';
  const accent = hex(f?.color ?? st.color ?? s.company.color);
  const k = Math.sqrt(fp);
  // bias the building toward the back of the lot to leave a mechanical yard and car park
  const bw = w * k, bd = d * k, cx = (x0 + x1) / 2;
  const bx0 = cx - bw / 2, bx1 = cx + bw / 2, bz0 = z0 + Math.max(2, (d - bd) * 0.28), bz1 = bz0 + bd;
  const FH = 5.5, H = Math.max(6, floors * FH);
  m.flat(x0, z0, x1, z1, 0.06, CONCRETE, { st: S.pavement, seed });
  const wallCol: RGB = style === 'glass' ? hex('#6c93a8') : style === 'metal' ? hex('#aeb4b8') : style === 'modular' ? hex('#c5c9cc') : hex('#a9a9a4');
  const wallMat: Mat = style === 'glass' ? { st: S.glass, seed, flr: FH, bay: 3.2 } : { st: S.panels, seed, flr: FH, bay: 3 };
  const useClear = st.xray;
  if (style === 'modular' && floors <= 1 && !useClear) {
    // rows of prefabricated container modules
    const rows = Math.max(1, Math.floor(bd / 4));
    const cols = Math.max(1, Math.floor(bw / 13));
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      const qx = bx0 + a * (bw / cols), qz = bz0 + b * (bd / rows);
      m.box(qx + 0.3, 0.3, qz + 0.3, qx + bw / cols - 0.3, 3.2, qz + bd / rows - 0.3, wallCol, { st: S.panels, seed: seed + a, flr: 3, bay: 2.4 }, { col: [0.72, 0.72, 0.72], m: { st: S.roof, seed } });
      m.box(qx + 0.3, 3.2, qz + 0.9, qx + 2.4, 4.1, qz + bd / rows - 0.9, [0.55, 0.57, 0.6], { st: S.metal, seed, bay: 0 });
    }
  } else if (useClear) {
    o.clear.box(bx0, 0.2, bz0, bx1, H, bz1, accent, { st: S.xray, seed }, undefined, 1);
    racks(o, f, bx0, bz0, bx1, bz1, H, seed);
  } else {
    m.box(bx0, 0, bz0, bx1, H, bz1, wallCol, wallMat, { col: [0.6, 0.6, 0.6], m: { st: S.roof, seed } });
    // branded accent band and sign
    m.box(bx0 - 0.08, H - 1.5, bz0 - 0.08, bx1 + 0.08, H - 0.9, bz1 + 0.08, accent, { st: S.glow, seed }, null, 1);
    const sw = Math.min(bw * 0.5, 18);
    m.box(cx - sw / 2, H - 4.6, bz1 + 0.02, cx + sw / 2, H - 2.2, bz1 + 0.3, accent, { st: S.glow, seed }, null, 1);
    // entrance
    m.box(cx - 4, 0, bz1, cx + 4, 4.4, bz1 + 0.5, hex('#70909f'), { st: S.glass, seed, flr: 4.4, bay: 2 });
    m.box(cx - 5, 4.4, bz1, cx + 5, 4.8, bz1 + 3, wallCol, { st: S.plain, seed });
    // roller doors at the loading bay
    m.box(bx1 - 12, 0, bz1 - 0.05, bx1 - 2, 4.5, bz1 + 0.1, hex('#3b4048'), { st: S.metal, seed, bay: 5 }, null);
    rooftop(o, r, bx0, bz0, bx1, bz1, H, seed, { plant: 0, parapet: 1.1, col: scalec(wallCol, 0.85) });
    if (o.detail > 0) {
      // structural piers and air intakes break up long walls; cable trays run across the roof
      const pier = scalec(wallCol, 0.8), pm: Mat = { st: S.plain, seed };
      const span = Math.max(6, bw / Math.min(10, Math.ceil(bw / 7)));
      for (let q = bx0; q <= bx1 + 0.01; q += span) { m.box(q - 0.22, 0, bz1, q + 0.22, H - 1.6, bz1 + 0.28, pier, pm, null, 1); m.box(q - 0.22, 0, bz0 - 0.28, q + 0.22, H - 1.6, bz0, pier, pm, null, 1); }
      for (let q = bz0 + 3; q < bz1 - 4; q += Math.max(7, bd / 4)) m.box(bx0 - 0.3, H * 0.55, q, bx0, H * 0.55 + 2.2, q + 3.6, [0.24, 0.26, 0.29], { st: S.metal, seed, bay: 0 }, null, 1);
      if (o.detail > 1) { m.box(bx0 + 1.6, H + 0.15, (bz0 + bz1) / 2 - 0.3, bx1 - 1.6, H + 0.4, (bz0 + bz1) / 2 + 0.3, [0.55, 0.56, 0.58], { st: S.metal, seed, bay: 0 }, undefined, 1); }
    }
    // chillers: more cooling gear means a busier roof
    const eq = f?.equipment ?? {};
    const units = Math.min(36, 4 + (eq.cooling_air ?? 0) * 2 + (eq.cooling_adv ?? 0) * 3 + (eq.liquid ?? 0) * 5 + (bp ? Math.floor(bp.slots / 60) : 0));
    const cols = Math.max(1, Math.floor((bw - 4) / 5)), rows = Math.max(1, Math.ceil(units / cols));
    for (let i = 0; i < units; i++) {
      const a = i % cols, b = Math.floor(i / cols);
      const qx = bx0 + 2.4 + a * ((bw - 4.8) / cols), qz = bz0 + 2.4 + b * Math.min(5, (bd - 4.8) / rows);
      m.box(qx, H, qz, qx + 3.6, H + 2, qz + 2.6, [0.78, 0.79, 0.8], { st: S.metal, seed: seed + i, bay: 0 });
      if (o.detail > 0) { m.cyl(qx + 1, H + 2, qz + 1.3, 0.75, 0.15, [0.14, 0.15, 0.17], { st: S.plain, seed }, 10); m.cyl(qx + 2.6, H + 2, qz + 1.3, 0.75, 0.15, [0.14, 0.15, 0.17], { st: S.plain, seed }, 10); }
    }
  }
  contact(o, bx0, bz0, bx1, bz1, H);
  // yard along the front: generators, transformers, fence and gatehouse
  const eq = f?.equipment ?? {};
  const yardZ = bz1 + 3, yardDepth = z1 - yardZ - 1.5;
  if (yardDepth > 4) {
    const gens = Math.min(10, (eq.generator ?? 0) + (eq.generator_x ?? 0) * 2 || (bp && bp.slots > 50 ? 2 : 0));
    let gx = bx0;
    for (let i = 0; i < gens && gx < bx1 - 7; i++, gx += 7.2) {
      m.box(gx, 0, yardZ, gx + 6.2, 2.9, yardZ + 2.4, [0.82, 0.8, 0.72], { st: S.metal, seed: seed + i, bay: 0 });
      m.cyl(gx + 1, 2.9, yardZ + 1.2, 0.2, 1.8, [0.3, 0.3, 0.3], { st: S.plain, seed }, 6);
    }
    const subs = Math.min(5, (eq.substation ?? 0) * 2 + (eq.pdu ?? 0));
    for (let i = 0; i < subs && yardDepth > 9; i++) {
      const tx = x0 + 4 + i * 6;
      m.box(tx, 0, z1 - 6, tx + 3.4, 2.8, z1 - 3, [0.42, 0.47, 0.42], { st: S.metal, seed, bay: 0 });
      m.cyl(tx + 0.9, 2.8, z1 - 4.5, 0.18, 1.8, [0.65, 0.5, 0.35], { st: S.plain, seed }, 6);
      m.cyl(tx + 2.4, 2.8, z1 - 4.5, 0.18, 1.8, [0.65, 0.5, 0.35], { st: S.plain, seed }, 6);
    }
    if (yardDepth > 12) parkingRows(o, r, bx0 + bw * 0.45, yardZ + 4, x1 - 2, z1 - 2, seed, 0.4);
  }
  // utility service: poles and a pad transformer appear once the electric company has been out
  if (f && (!f.hookups || f.hookups.power === 0) && o.detail > 0) {
    const pole = [0.3, 0.22, 0.15] as RGB;
    m.cyl(x0 + 2, 0, z1 - 1.6, 0.16, 8.4, pole, { st: S.plain, seed }, 6, false);
    m.box(x0 + 0.7, 7.7, z1 - 1.68, x0 + 3.3, 7.86, z1 - 1.52, pole, { st: S.plain, seed }, undefined, 1);
    m.box(x0 + 3.2, 0, z1 - 4.2, x0 + 5.6, 1.7, z1 - 2.2, [0.28, 0.37, 0.3], { st: S.metal, seed, bay: 0 });
  }
  if (f && (!f.hookups || f.hookups.net === 0) && o.detail > 0) m.box(x1 - 3.4, 0, z0 + 1.2, x1 - 2.4, 1.2, z0 + 2, hex('#d07a1e'), { st: S.paint, seed }, undefined, 1);
  fence(o, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, seed, 2.6, [0.34, 0.36, 0.38]);
  if (eq.security || w > 30) m.box(x1 - 6, 0, z1 - 4, x1 - 2.5, 2.8, z1 - 1, hex('#c8c9c5'), { st: S.shop, seed, flr: 2.8, bay: 2 }, { col: DARKM, m: { st: S.plain, seed } });
  return H + 3;
}

/** X-ray interior: server rows coloured by what's installed. */
function racks(o: Out, f: Facility | undefined, x0: number, z0: number, x1: number, z1: number, H: number, seed: number) {
  if (!f) return;
  const COL: Record<string, RGB> = { cpu: hex('#3b82f6'), gpu: hex('#a855f7'), storage: hex('#10b981') };
  const items: RGB[] = [];
  for (const [id, n] of Object.entries(f.equipment)) {
    const c = id.startsWith('gpu') || id.startsWith('accel') ? COL.gpu : id.startsWith('cpu') ? COL.cpu : id.startsWith('storage') ? COL.storage : id.startsWith('network') ? hex('#f59e0b') : null;
    if (c) for (let i = 0; i < n; i++) items.push(c);
  }
  o.m.flat(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, 0.3, [0.25, 0.27, 0.3], { st: S.plain, seed });
  const shown = items.slice(0, 420);
  const floors = Math.max(1, f.floors), perFloor = Math.ceil(shown.length / floors);
  const cols = Math.max(1, Math.floor((x1 - x0 - 2) / 1.6));
  shown.forEach((c, i) => {
    const fl = Math.floor(i / perFloor), n = i - fl * perFloor;
    const a = n % cols, b = Math.floor(n / cols);
    const x = x0 + 1 + a * 1.6, z = z0 + 1 + b * 3.2, y = 0.3 + fl * (H / floors);
    if (z + 1 > z1 - 0.5) return;
    o.m.box(x, y, z, x + 1, y + 2.2, z + 1.2, c, { st: S.racks, seed: seed + i * 0.01 }, undefined, 1);
  });
  for (let fl = 1; fl < floors; fl++) o.clear.box(x0 + 0.2, fl * (H / floors) + 0.1, z0 + 0.2, x1 - 0.2, fl * (H / floors) + 0.3, z1 - 0.2, [0.5, 0.6, 0.8], { st: S.xray, seed }, undefined, 1);
}

function hqBuilding(o: Out, r: () => number, p: ParcelDef, f: Facility, s: GameState, seed: number): number {
  const { x0, y0: z0, x1, y1: z1 } = p.rect, m = o.m;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const H = 8 + f.floors * 4 + s.company.hqTier * 10;
  const k = Math.sqrt(0.35), bw = w * k, bd = d * k;
  const a = cx - bw / 2, b = cx + bw / 2, c = cz - bd / 2, e = cz + bd / 2;
  const accent = hex(s.company.color);
  m.flat(x0, z0, x1, z1, 0.06, [0.66, 0.65, 0.62], { st: S.pavement, seed });
  tower(o, r, a, c, b, e, H, seed, true);
  m.box(a - 0.1, H - 1.6, c - 0.1, b + 0.1, H - 0.8, e + 0.1, accent, { st: S.glow, seed }, null, 1);
  contact(o, a, c, b, e, H);
  for (const [tx, tz] of [[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3]]) tree(o, r, tx, tz);
  return H * 1.15;
}

// ---------- reusable instanced models ----------
export function treeModel(m: Mesh) {
  m.reset();
  const trunk: RGB = [0.27, 0.2, 0.14], tm: Mat = { st: S.plain, seed: 0.3 };
  m.cyl(0, 0, 0, 0.26, 3, trunk, tm, 6, false);
  const leaf: Mat = { st: S.foliage, seed: 0.4 };
  m.blob(0, 5.1, 0, 2.9, [1, 1, 1], leaf, 1);
  m.blob(1.5, 4.2, 0.6, 1.9, [0.86, 0.9, 0.82], leaf, 0.9);
  m.blob(-1.2, 4.4, -1, 2, [1, 0.98, 0.9], leaf, 0.9);
  return m;
}

export function carModel(m: Mesh) {
  m.reset();
  const paint: Mat = { st: S.paint, seed: 0.1 }, glass: Mat = { st: S.darkGlass, seed: 0.1 }, tire: Mat = { st: S.plain, seed: 0 };
  const w: RGB = [1, 1, 1], t: RGB = [0.04, 0.04, 0.045];
  m.box(-2.2, 0.32, -0.88, 2.2, 0.92, 0.88, w, paint, { col: w, m: paint }, 1);
  m.box(-1.15, 0.92, -0.78, 1.0, 1.42, 0.78, t, glass, { col: w, m: paint }, 1);
  for (const [x, z] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) m.box(x - 0.33, 0, z - 0.14, x + 0.33, 0.62, z + 0.14, t, tire, undefined, 1);
  return m;
}

export function truckModel(m: Mesh) {
  m.reset();
  const paint: Mat = { st: S.paint, seed: 0.2 }, white: RGB = [0.92, 0.92, 0.92], t: RGB = [0.05, 0.05, 0.055];
  m.box(-6, 1.1, -1.25, 3.2, 3.9, 1.25, white, { st: S.metal, seed: 0.2, bay: 0 }, undefined, 1);
  m.box(3.5, 0.9, -1.2, 6, 3.2, 1.2, [1, 1, 1], paint, undefined, 1);
  m.box(5.2, 2, -1.1, 6.02, 3, 1.1, t, { st: S.darkGlass, seed: 0.2 }, null, 1);
  m.box(-6, 0.7, -1.15, 6, 1.1, 1.15, t, { st: S.plain, seed: 0 }, undefined, 1);
  for (const x of [-4.8, -3.4, 2, 4.8]) { m.box(x - 0.5, 0, -1.3, x + 0.5, 1, -1.05, t, { st: S.plain, seed: 0 }, undefined, 1); m.box(x - 0.5, 0, 1.05, x + 0.5, 1, 1.3, t, { st: S.plain, seed: 0 }, undefined, 1); }
  return m;
}

export function pumpkinModel(m: Mesh) {
  m.reset();
  const skin: Mat = { st: S.paint, seed: 0.3 };
  m.blob(0, 0.3, 0, 0.42, [1, 1, 1], skin, 0.72);
  m.box(-0.04, 0.52, -0.04, 0.04, 0.68, 0.04, [0.22, 0.3, 0.12], { st: S.plain, seed: 0.1 }, undefined, 1);
  return m;
}

/** Hay bale with a shock of corn stalks tied behind it. */
export function hayModel(m: Mesh) {
  m.reset();
  const straw: Mat = { st: S.plain, seed: 0.5 };
  m.box(-0.75, 0, -0.4, 0.75, 0.62, 0.4, [1, 1, 1], straw, { col: [1.1, 1.05, 0.9], m: straw }, 0.75);
  m.cyl(0.1, 0, -0.7, 0.3, 1.9, [0.8, 0.72, 0.5], { st: S.foliage, seed: 0.6 }, 6, false);
  return m;
}

/** Autumn colours for a green tree, chosen by position so a tree keeps its colour. */
export function autumnTint(x: number, z: number): RGB {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  if (h < 0.3) return [0.52, 0.27, 0.08];
  if (h < 0.5) return [0.47, 0.17, 0.07];
  if (h < 0.76) return [0.56, 0.42, 0.1];
  return [0.34, 0.38, 0.13];
}

export function lampModel(m: Mesh) {
  m.reset();
  const c: RGB = [0.2, 0.21, 0.23], pm: Mat = { st: S.plain, seed: 0 };
  m.cyl(0, 0, 0, 0.09, 8, c, pm, 6, false);
  m.box(-0.06, 7.9, 0, 0.06, 8, 2.2, c, pm, undefined, 1);
  m.box(-0.22, 7.8, 1.8, 0.22, 7.95, 2.5, [0.9, 0.85, 0.7], pm, undefined, 1);
  return m;
}
