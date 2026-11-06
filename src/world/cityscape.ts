// Procedural surrounding city: non-purchasable buildings, parks and plazas that fill
// the blocks around each tech district so towns feel dense and alive.
// Towers rise toward the real city centre; the outskirts are low-rise.

import { CITIES } from '../config/world';
import { hashString, mulberry32 } from '../core/rng';
import { districtFrame, CITY_RINGS, TOWN, townCellKind, townPlan, townRiverX } from './parcels';

export type SkyKind = 'tower' | 'glass' | 'office' | 'apartment' | 'brick' | 'low' | 'house' | 'warehouse' | 'civic' | 'church' | 'school' | 'silo' | 'barn' | 'watertower' | 'pumpjack';

export interface SkyBuilding {
  id: string;
  rect: { x0: number; y0: number; x1: number; y1: number };
  poly: [number, number][];
  height: number;
  kind: SkyKind;
  color: string;
  seed: number;
  /** Shade tree in the yard. */
  yard?: boolean;
}

export interface Cityscape {
  cityId: string;
  buildings: SkyBuilding[];
  parks: { rect: { x0: number; y0: number; x1: number; y1: number }; poly: [number, number][] }[];
  ground: [number, number][];
}

const PALETTE: Record<SkyKind, string[]> = {
  tower: ['#5b7db8', '#4c6aa0', '#6a8cc6', '#3f5f96'],
  glass: ['#6fa3d8', '#5d93cc', '#7fb2e0', '#4f86c2'],
  office: ['#8a96aa', '#7c889c', '#9aa5b6', '#6f7b90'],
  apartment: ['#b09a86', '#a38d7a', '#c2ab96', '#8f7c6b'],
  brick: ['#9c5a46', '#8a4f3e', '#a8664f', '#7d4637'],
  low: ['#9aa1ab', '#878e98', '#a8aeb7'],
  house: ['#c9b79c', '#b8a68c', '#d4c3a8', '#a99880'],
  warehouse: ['#8b919c', '#7d838e', '#969ca6'],
  civic: ['#9c5a46'], church: ['#d8d4c8'], school: ['#a0604a'], silo: ['#b9bcbf'], barn: ['#8c3026'], watertower: ['#c9ced2'], pumpjack: ['#3f4348'],
};

const cache = new Map<string, Cityscape>();

export function getCityscape(cityId: string): Cityscape {
  const hit = cache.get(cityId);
  if (hit) return hit;
  const f = districtFrame(cityId);
  if (f.town) { const town = townScape(cityId, f); cache.set(cityId, town); return town; }
  const r = mulberry32(hashString('skyline:' + cityId));
  const { BW, BH, ST, BX, BY, toLL, fromLL, totalW, totalH } = f;
  const rectPoly = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [toLL(x0, y0), toLL(x1, y0), toLL(x1, y1), toLL(x0, y1), toLL(x0, y0)];
  // direction (in district meters) toward the real downtown
  const [dcx, dcy] = fromLL(f.city.center[0], f.city.center[1]);
  const midX = totalW / 2, midY = totalH / 2;
  let dirX = dcx - midX, dirY = dcy - midY;
  const dl = Math.hypot(dirX, dirY) || 1;
  dirX /= dl;
  dirY /= dl;
  const downtownDist = dl;
  const buildings: SkyBuilding[] = [];
  const parks: Cityscape['parks'] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  let n = 0;
  const inner = 2; // purchasable rings
  for (let j = -inner - CITY_RINGS; j < BY + inner + CITY_RINGS; j++) {
    for (let i = -inner - CITY_RINGS; i < BX + inner + CITY_RINGS; i++) {
      if (i >= -inner && i < BX + inner && j >= -inner && j < BY + inner) continue;
      const bx0 = ST + i * (BW + ST) + 4, by0 = ST + j * (BH + ST) + 4;
      const bx1 = bx0 + BW - 8, by1 = by0 + BH - 8;
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      // urban intensity: towards downtown + closer to the district core
      const along = ((cx - midX) * dirX + (cy - midY) * dirY) / 1500;
      const ringDist = Math.max(Math.abs(i - BX / 2) - BX / 2 - inner, Math.abs(j - BY / 2) - BY / 2 - inner);
      const intensity = Math.max(0, Math.min(1, 0.42 + along * 0.45 + (downtownDist < 6000 ? 0.22 : 0) - ringDist * 0.03 + (r() - 0.5) * 0.3));
      if (r() < 0.07) {
        parks.push({ rect: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, poly: rectPoly(bx0, by0, bx1, by1) });
        continue;
      }
      // subdivide the block
      const cols = intensity > 0.7 ? 3 : intensity > 0.35 ? 4 : 5;
      const rows = intensity > 0.7 ? 2 : 2;
      const cw = (bx1 - bx0) / cols, rh = (by1 - by0) / rows;
      for (let a = 0; a < cols; a++) {
        for (let b = 0; b < rows; b++) {
          if (r() < 0.03) continue;
          const pad = 3 + r() * 4;
          const x0 = bx0 + a * cw + pad, y0 = by0 + b * rh + pad, x1 = bx0 + (a + 1) * cw - pad, y1 = by0 + (b + 1) * rh - pad;
          let kind: SkyKind;
          let height: number;
          const roll = r();
          if (intensity > 0.8) {
            kind = roll < 0.45 ? 'tower' : roll < 0.8 ? 'glass' : 'office';
            height = 60 + r() * 140 * intensity;
          } else if (intensity > 0.55) {
            kind = roll < 0.3 ? 'glass' : roll < 0.6 ? 'office' : roll < 0.85 ? 'apartment' : 'brick';
            height = 22 + r() * 55;
          } else if (intensity > 0.3) {
            kind = roll < 0.35 ? 'apartment' : roll < 0.6 ? 'brick' : roll < 0.8 ? 'low' : 'warehouse';
            height = 9 + r() * 22;
          } else {
            kind = roll < 0.55 ? 'house' : roll < 0.8 ? 'low' : 'warehouse';
            height = kind === 'house' ? 6 + r() * 4 : 6 + r() * 8;
          }
          // tall buildings take a narrower footprint
          let fx0 = x0, fy0 = y0, fx1 = x1, fy1 = y1;
          if (height > 50) {
            const s = 0.7 + r() * 0.15;
            const w = (x1 - x0) * s, h = (y1 - y0) * s;
            fx0 = (x0 + x1) / 2 - w / 2; fx1 = fx0 + w; fy0 = (y0 + y1) / 2 - h / 2; fy1 = fy0 + h;
          } else if (kind === 'house') {
            const w = Math.min(x1 - x0, 14), h = Math.min(y1 - y0, 12);
            fx0 = (x0 + x1) / 2 - w / 2; fx1 = fx0 + w; fy0 = (y0 + y1) / 2 - h / 2; fy1 = fy0 + h;
          }
          buildings.push({ id: `${cityId}-k${n++}`, rect: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 }, poly: rectPoly(fx0, fy0, fx1, fy1), height, kind, color: pick(PALETTE[kind]), seed: r() });
        }
      }
    }
  }
  const PX = (inner + CITY_RINGS) * (BW + ST), PY = (inner + CITY_RINGS) * (BH + ST);
  const out: Cityscape = { cityId, buildings, parks, ground: rectPoly(-PX - 20, -PY - 20, totalW + PX + 20, totalH + PY + 20) };
  cache.set(cityId, out);
  return out;
}

/** A small town: house-lined streets, a few landmarks, then farmland and the river. */
function townScape(cityId: string, f: ReturnType<typeof districtFrame>): Cityscape {
  const r = mulberry32(hashString('townscape:' + cityId));
  const { BW, BH, ST, BX, BY, toLL } = f;
  const plan = townPlan(f);
  const { px, py } = plan;
  const rectPoly = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [toLL(x0, y0), toLL(x1, y0), toLL(x1, y1), toLL(x0, y1), toLL(x0, y0)];
  const buildings: SkyBuilding[] = [];
  const parks: Cityscape['parks'] = [];
  let n = 0;
  const put = (kind: SkyKind, x0: number, y0: number, x1: number, y1: number, height: number, yard = false) => {
    const pal = PALETTE[kind];
    buildings.push({ id: `${cityId}-k${n++}`, rect: { x0, y0, x1, y1 }, poly: rectPoly(x0, y0, x1, y1), height, kind, color: pal[Math.floor(r() * pal.length)], seed: r(), yard });
  };
  for (let j = -TOWN.ringS; j < BY + TOWN.ringN; j++) for (let i = -TOWN.ringW; i < BX + TOWN.ringE; i++) {
    const bx0 = ST + i * px + 3, by0 = ST + j * py + 3, bx1 = bx0 + BW - 6, by1 = by0 + BH - 6;
    if (i >= 0 && i < BX && j >= 0 && j < BY) {
      const kind = townCellKind(i, j);
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      if (kind === 'courthouse') { parks.push({ rect: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, poly: rectPoly(bx0, by0, bx1, by1) }); put('civic', cx - 21, cy - 15, cx + 21, cy + 15, 13); }
      else if (kind === 'school') put('school', bx0 + 4, by0 + 8, bx1 - 4, by0 + 40, 8);
      else if (kind === 'church') { put('church', cx - 10, cy - 15, cx + 10, cy + 15, 9); put('house', bx0 + 2, by0 + 2, bx0 + 13, by0 + 12, 7, true); }
      else if (kind === 'park') parks.push({ rect: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, poly: rectPoly(bx0, by0, bx1, by1) });
      continue;
    }
    if (r() < 0.05) { parks.push({ rect: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, poly: rectPoly(bx0, by0, bx1, by1) }); continue; }
    // a block of houses: four to the side, backing onto an alley
    const cols = 4, rows = 2, cw = (bx1 - bx0) / cols, rh = (by1 - by0) / rows;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      if (r() < 0.1) continue;
      const w = 9 + r() * 4, d = 8 + r() * 3;
      const cx = bx0 + (a + 0.5) * cw + (r() - 0.5) * 2, cy = b === 0 ? by0 + 8 + d / 2 : by1 - 8 - d / 2;
      put('house', cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, 7, r() < 0.55);
    }
  }
  // landmarks you can see from anywhere in town
  put('watertower', plan.x0 + 18, plan.z1 - 60, plan.x0 + 34, plan.z1 - 44, 36);
  const oak = plan.oakZ;
  put('silo', plan.x0 - 70, oak - 44, plan.x0 - 44, oak - 18, 24);
  put('silo', plan.x0 - 40, oak - 44, plan.x0 - 14, oak - 18, 24);
  // farmsteads and the oil pumpjacks White County is known for, out among the fields
  const farms: [number, number][] = [[-820, -240], [-640, 620], [-300, 1120], [420, -560], [920, -420], [-960, 880], [1000, 1180]];
  for (const [x, z] of farms) {
    if (x > 0 && Math.abs(x - townRiverX(z, plan.riverBase)) < 70) continue;
    put('barn', x, z, x + 20, z + 14, 8);
    put('silo', x + 26, z + 2, x + 34, z + 10, 13);
    put('house', x - 26, z + 16, x - 14, z + 26, 7, true);
  }
  const jacks: [number, number][] = [[-560, -180], [-720, 480], [-880, 120], [-200, 1040], [430, -720], [-420, -520], [760, -700], [-620, 900]];
  for (const [x, z] of jacks) put('pumpjack', x, z, x + 9, z + 3, 5);
  const out: Cityscape = { cityId, buildings, parks, ground: rectPoly(plan.x0 - 480, plan.z0 - 340, plan.x1 + 200, plan.z1 + 60) };
  return out;
}

export function allCityscapes(): Cityscape[] {
  return CITIES.map((c) => getCityscape(c.id));
}
