// Procedural fictional parcel layout for each city's tech district.
// Real geography (MapLibre / OpenStreetMap) is the backdrop; these
// parcels are the game's own property system on top of it.

import { CITIES, cityById, type CityDef } from '../config/world';
import { ECONOMY } from '../config/economy';
import { hashString, mulberry32 } from '../core/rng';

export type PropertyType =
  | 'empty_lot' | 'retail' | 'restaurant' | 'shopping_center' | 'warehouse'
  | 'office' | 'industrial' | 'industrial_land' | 'commercial_zone' | 'premium';

export const PROPERTY_TYPE_INFO: Record<PropertyType, { label: string; icon: string; floors: [number, number]; coverage: number; color: string }> = {
  empty_lot: { label: 'Empty Land', icon: '🟫', floors: [0, 0], coverage: 0, color: '#6b5b3e' },
  retail: { label: 'Small Retail Store', icon: '🏪', floors: [1, 2], coverage: 0.55, color: '#c08457' },
  restaurant: { label: 'Restaurant', icon: '🍔', floors: [1, 1], coverage: 0.45, color: '#d97757' },
  shopping_center: { label: 'Shopping Center', icon: '🛍️', floors: [1, 2], coverage: 0.5, color: '#b7791f' },
  warehouse: { label: 'Warehouse', icon: '🏚️', floors: [1, 1], coverage: 0.62, color: '#8b8f99' },
  office: { label: 'Office Building', icon: '🏢', floors: [3, 8], coverage: 0.45, color: '#7895b8' },
  industrial: { label: 'Industrial Building', icon: '🏭', floors: [1, 2], coverage: 0.55, color: '#7a7f6b' },
  industrial_land: { label: 'Large Industrial Land', icon: '🏗️', floors: [0, 1], coverage: 0.08, color: '#5d6b4a' },
  commercial_zone: { label: 'Commercial Development Zone', icon: '📐', floors: [0, 0], coverage: 0, color: '#3d5a80' },
  premium: { label: 'Premium Metropolitan Property', icon: '🏙️', floors: [10, 28], coverage: 0.4, color: '#9fb4d9' },
};

export interface Zoning {
  code: string;
  label: string;
  maxFloors: number;
  maxCoverage: number;
  heavy: boolean; // allows hyperscale-class builds
}

const ZONINGS: Record<string, Zoning> = {
  C1: { code: 'C-1', label: 'Neighborhood Commercial', maxFloors: 3, maxCoverage: 0.6, heavy: false },
  C2: { code: 'C-2', label: 'General Commercial', maxFloors: 5, maxCoverage: 0.7, heavy: false },
  CBD: { code: 'CBD', label: 'Central Business District', maxFloors: 9, maxCoverage: 0.8, heavy: false },
  I1: { code: 'I-1', label: 'Light Industrial', maxFloors: 5, maxCoverage: 0.7, heavy: true },
  I2: { code: 'I-2', label: 'Heavy Industrial', maxFloors: 7, maxCoverage: 0.75, heavy: true },
  PD: { code: 'P-D', label: 'Planned Development', maxFloors: 9, maxCoverage: 0.8, heavy: true },
};

export interface ParcelDef {
  id: string;
  cityId: string;
  blockId: string;
  zoneId?: string;
  type: PropertyType;
  name: string;
  address: string;
  poly: [number, number][]; // lng,lat ring (closed)
  footprintPoly: [number, number][]; // inner buildable / existing footprint
  rect: { x0: number; y0: number; x1: number; y1: number }; // meters, district-local
  center: [number, number];
  area: number;
  buildingArea: number; // existing floor area (m^2)
  buildingFloors: number;
  buildingHeight: number; // meters
  basePrice: number;
  zoning: Zoning;
  potential: string;
  restrictions: string[];
  isSite?: boolean; // consolidated zone site
  members?: string[];
  /** The property on the market when a new company is founded here. */
  starter?: boolean;
  /** Old brick storefront instead of the type's usual building. */
  brick?: boolean;
}

export interface ZoneDef {
  id: string;
  cityId: string;
  name: string;
  parcelIds: string[];
  siteId: string;
  poly: [number, number][];
  center: [number, number];
  area: number;
}

export interface CityLayout {
  city: CityDef;
  plate: [number, number][];
  streets: { name: string; line: [number, number][] }[];
  parcels: ParcelDef[];
  zones: ZoneDef[];
  sites: ParcelDef[];
  bounds: [number, number, number, number];
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Rings of decorative (non-purchasable) city blocks around the district. */
export const CITY_RINGS = 5;
const BX = 6;
const BY = 5;
const BW = 170;
const BH = 130;
const ST = 26;

const STREET_NAMES = ['Fiber Way', 'Innovation Ave', 'Quantum Blvd', 'Silicon Dr', 'Gateway Rd', 'Circuit St', 'Kilowatt Ln', 'Parallel Pkwy', 'Server Row', 'Cloud Ct', 'Photon Ave', 'Uplink Rd', 'Lattice St'];
const BIZ = {
  retail: ['Corner Market', 'Old Supermarket', 'Thrift Store', 'Hardware Store', 'Pharmacy', 'Bike Shop', 'Electronics Outlet', 'Furniture Store'],
  restaurant: ['Corner Café', 'Burger Joint', 'Noodle House', 'Diner', 'Pizza Place', 'Taco Stand', 'Steakhouse'],
  shopping_center: ['Plaza Mall', 'Town Center', 'Outlet Center', 'Galleria', 'Marketplace'],
  warehouse: ['Distribution Warehouse', 'Cold Storage', 'Freight Depot', 'Self Storage', 'Parcel Hub'],
  office: ['Office Park', 'Business Center', 'Corporate Offices', 'Tech Plaza', 'Medical Offices'],
  industrial: ['Machine Works', 'Printing Plant', 'Metal Fabrication', 'Bottling Plant', 'Assembly Plant'],
  industrial_land: ['Brownfield Site', 'Rail Yard Land', 'Former Factory Grounds', 'Logistics Land'],
  premium: ['Skyline Tower', 'Financial Center', 'Landmark Tower', 'Metro Exchange'],
  empty_lot: ['Vacant Lot', 'Gravel Lot', 'Overgrown Lot', 'Parking Lot'],
  commercial_zone: ['Development Parcel'],
};
const AREA_NAMES = ['Northgate', 'Riverside', 'Hillcrest', 'Eastfield', 'Westbrook', 'Lakeview', 'Oakridge', 'Brookline', 'Sunset', 'Highpoint', 'Fairview', 'Stonegate'];

const cache = new Map<string, CityLayout>();
const parcelIndex = new Map<string, ParcelDef>();
const zoneIndex = new Map<string, ZoneDef>();

export function getCityLayout(cityId: string): CityLayout {
  let l = cache.get(cityId);
  if (!l) {
    l = generate(cityById(cityId));
    cache.set(cityId, l);
    for (const p of l.parcels) parcelIndex.set(p.id, p);
    for (const p of l.sites) parcelIndex.set(p.id, p);
    for (const z of l.zones) zoneIndex.set(z.id, z);
  }
  return l;
}

export function getParcel(id: string): ParcelDef | undefined {
  if (!parcelIndex.has(id)) {
    const cityId = id.split('-')[0];
    if (CITIES.some((c) => c.id === cityId)) getCityLayout(cityId);
  }
  return parcelIndex.get(id);
}

export function getZone(id: string): ZoneDef | undefined {
  if (!zoneIndex.has(id)) {
    const cityId = id.split('-')[0];
    if (CITIES.some((c) => c.id === cityId)) getCityLayout(cityId);
  }
  return zoneIndex.get(id);
}

export function allParcels(): ParcelDef[] {
  for (const c of CITIES) getCityLayout(c.id);
  return [...parcelIndex.values()].filter((p) => !p.isSite);
}

function generate(city: CityDef): CityLayout {
  if (city.town) return generateTown(city);
  let r = mulberry32(hashString('district:' + city.id));
  const [clng, clat] = city.district;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((clat * Math.PI) / 180));
  const totalW = BX * BW + (BX + 1) * ST;
  const totalH = BY * BH + (BY + 1) * ST;
  const toLL = (x: number, y: number): [number, number] => [clng + (x - totalW / 2) * mLng, clat + (y - totalH / 2) * mLat];
  const rectPoly = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [toLL(x0, y0), toLL(x1, y0), toLL(x1, y1), toLL(x0, y1), toLL(x0, y0)];

  // purchasable district = original grid + 2 expansion rings; streets continue through the surrounding city
  const PX = 2 * (BW + ST), PY = 2 * (BH + ST);
  const plate = rectPoly(-PX - 40, -PY - 40, totalW + PX + 40, totalH + PY + 40);
  const CX = CITY_RINGS * (BW + ST), CY = CITY_RINGS * (BH + ST);
  const streets: CityLayout['streets'] = [];
  for (let i = -2 - CITY_RINGS; i <= BX + 2 + CITY_RINGS; i++) {
    const x = i * (BW + ST) + ST / 2;
    streets.push({ name: STREET_NAMES[mod(i, STREET_NAMES.length)], line: [toLL(x, -PY - CY), toLL(x, totalH + PY + CY)] });
  }
  for (let j = -2 - CITY_RINGS; j <= BY + 2 + CITY_RINGS; j++) {
    const y = j * (BH + ST) + ST / 2;
    streets.push({ name: STREET_NAMES[mod(j + 7, STREET_NAMES.length)], line: [toLL(-PX - CX, y), toLL(totalW + PX + CX, y)] });
  }

  // Choose zone superblocks (pairs of adjacent blocks).
  const zoneCells = new Map<string, number>(); // "i,j" -> zone index
  const zoneStarts: { i: number; j: number }[] = [];
  const zoneRows = [0, BY - 1, 2];
  const zoneCount = 2 + (r() < 0.6 ? 1 : 0);
  for (let z = 0; z < zoneCount; z++) {
    const j = zoneRows[z];
    let i = Math.floor(r() * (BX - 1));
    if (z === 2) i = r() < 0.5 ? 0 : BX - 2; // middle row zone on an edge
    if (zoneCells.has(`${i},${j}`) || zoneCells.has(`${i + 1},${j}`)) continue;
    zoneCells.set(`${i},${j}`, zoneStarts.length);
    zoneCells.set(`${i + 1},${j}`, zoneStarts.length);
    zoneStarts.push({ i, j });
  }

  const parcels: ParcelDef[] = [];
  const zones: ZoneDef[] = [];
  const sites: ParcelDef[] = [];
  let lotNo = 0;
  const areaName = () => AREA_NAMES[Math.floor(r() * AREA_NAMES.length)];

  const makeParcel = (blockId: string, type: PropertyType, x0: number, y0: number, x1: number, y1: number, streetName: string, zoneId?: string, ring = 1): ParcelDef => {
    lotNo++;
    const id = `${city.id}-${lotNo}`;
    const area = Math.round((x1 - x0) * (y1 - y0));
    const info = PROPERTY_TYPE_INFO[type];
    const floors = info.floors[1] === 0 ? 0 : Math.round(info.floors[0] + r() * (info.floors[1] - info.floors[0]));
    const cov = info.coverage * (0.85 + r() * 0.2);
    const fw = (x1 - x0) * Math.sqrt(cov);
    const fh = (y1 - y0) * Math.sqrt(cov);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const footprint = floors > 0 ? rectPoly(cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2) : rectPoly(x0 + 3, y0 + 3, x1 - 3, y1 - 3);
    const buildingArea = floors > 0 ? fw * fh * floors : 0;
    const ppm = ECONOMY.landPricePerM2[type] * (0.85 + r() * 0.35) * (1.25 - ring * 0.15);
    const [lo, hi] = ECONOMY.landPriceClamp[type];
    const base = Math.min(hi, Math.max(lo, ppm * area));
    let zoning: Zoning;
    if (zoneId) zoning = ZONINGS.PD;
    else if (type === 'premium') zoning = ZONINGS.CBD;
    else if (type === 'office' || type === 'shopping_center') zoning = r() < 0.5 ? ZONINGS.C2 : ZONINGS.CBD;
    else if (type === 'retail' || type === 'restaurant') zoning = ZONINGS.C1;
    else if (type === 'industrial_land' || type === 'industrial') zoning = r() < 0.5 ? ZONINGS.I2 : ZONINGS.I1;
    else if (type === 'warehouse') zoning = ZONINGS.I1;
    else zoning = r() < 0.5 ? ZONINGS.C2 : ZONINGS.I1;
    const restrictions: string[] = [`Max ${zoning.maxFloors} floors`, `Max ${Math.round(zoning.maxCoverage * 100)}% lot coverage`];
    if (!zoning.heavy) restrictions.push('No hyperscale-class facilities');
    if (type === 'premium') restrictions.push('Historic façade review');
    if (r() < 0.25) restrictions.push('Noise limits after 10 PM');
    if (ring === 0 && r() < 0.4) restrictions.push('Limited grid connection');
    const potential = area > 15000 ? 'Exceptional' : area > 6000 ? 'High' : area > 1800 ? 'Medium' : 'Low';
    const names = BIZ[type];
    const name = type === 'empty_lot' || type === 'industrial_land'
      ? `${areaName()} ${names[Math.floor(r() * names.length)]}`
      : `${areaName()} ${names[Math.floor(r() * names.length)]}`;
    const p: ParcelDef = {
      id, cityId: city.id, blockId, zoneId, type, name,
      address: `${100 + lotNo * 20} ${streetName}`,
      poly: rectPoly(x0, y0, x1, y1), footprintPoly: footprint,
      rect: { x0, y0, x1, y1 }, center: toLL(cx, cy),
      area, buildingArea: Math.round(buildingArea), buildingFloors: floors,
      buildingHeight: floors * (type === 'premium' || type === 'office' ? 3.8 : type === 'warehouse' || type === 'industrial' || type === 'shopping_center' ? 9 : 4.2),
      basePrice: Math.round(base / 1000) * 1000,
      zoning, potential, restrictions,
    };
    return p;
  };

  const split = (x0: number, x1: number, k: number): number[] => {
    const w = x1 - x0;
    const weights = Array.from({ length: k }, () => 0.7 + r() * 0.6);
    const sum = weights.reduce((a, b) => a + b, 0);
    const cuts = [x0];
    let acc = x0;
    for (let i = 0; i < k - 1; i++) {
      acc += (weights[i] / sum) * w;
      cuts.push(acc);
    }
    cuts.push(x1);
    return cuts;
  };

  const GAP = 3;
  const genBlock = (i: number, j: number, outer = false) => {
    const bx0 = ST + i * (BW + ST) + 4;
    const by0 = ST + j * (BH + ST) + 4;
    const bx1 = bx0 + BW - 8;
    const by1 = by0 + BH - 8;
    const blockId = `${city.id}-b${i}_${j}`;
    const street = STREET_NAMES[mod(i + j * 3, STREET_NAMES.length)];
    const zi = zoneCells.get(`${i},${j}`);
    if (zi !== undefined) {
      const zs = zoneStarts[zi];
      if (zs.i !== i) return; // second half handled with first
      // superblock spanning two blocks plus the street between
      const zx0 = bx0;
      const zx1 = ST + (i + 1) * (BW + ST) + BW - 4;
      const zoneId = `${city.id}-z${zi}`;
      const cols = 3 + Math.floor(r() * 2);
      const rows = 2;
      const ids: string[] = [];
      const xc = split(zx0, zx1, cols);
      const yc = split(by0, by1, rows);
      for (let a = 0; a < cols; a++) {
        for (let b = 0; b < rows; b++) {
          const roll = r();
          const type: PropertyType = roll < 0.4 ? 'empty_lot' : roll < 0.7 ? 'warehouse' : roll < 0.9 ? 'industrial' : 'retail';
          const p = makeParcel(blockId, type, xc[a] + GAP, yc[b] + GAP, xc[a + 1] - GAP, yc[b + 1] - GAP, street, zoneId, 2);
          // zone lots: honour zone pricing ranges (empty lots in a zone are larger than normal)
          if (type === 'empty_lot') p.basePrice = Math.round(Math.min(900_000, Math.max(120_000, p.area * 95)) / 1000) * 1000;
          parcels.push(p);
          ids.push(p.id);
        }
      }
      const zname = `${AREA_NAMES[mod(i * 7 + j * 3 + zi * 5, AREA_NAMES.length)]} ${j === 2 ? 'Commerce' : 'Industrial'} Development Zone`;
      const siteId = `${city.id}-s${zi}`;
      const zpoly = rectPoly(zx0 - 2, by0 - 2, zx1 + 2, by1 + 2);
      const zarea = Math.round((zx1 - zx0) * (by1 - by0));
      zones.push({ id: zoneId, cityId: city.id, name: zname, parcelIds: ids, siteId, poly: zpoly, center: toLL((zx0 + zx1) / 2, (by0 + by1) / 2), area: zarea });
      sites.push({
        id: siteId, cityId: city.id, blockId, zoneId, type: 'commercial_zone',
        name: zname.replace('Development Zone', 'Consolidated Campus Site'),
        address: `${zname} (consolidated)`,
        poly: rectPoly(zx0, by0, zx1, by1), footprintPoly: rectPoly(zx0 + 6, by0 + 6, zx1 - 6, by1 - 6),
        rect: { x0: zx0, y0: by0, x1: zx1, y1: by1 }, center: toLL((zx0 + zx1) / 2, (by0 + by1) / 2),
        area: zarea, buildingArea: 0, buildingFloors: 0, buildingHeight: 0, basePrice: 0,
        zoning: ZONINGS.PD, potential: 'Exceptional', restrictions: ['Max 9 floors', 'Max 80% lot coverage'],
        isSite: true, members: ids,
      });
      return;
    }
    // regular block
    const dx = (i + 0.5) / BX - 0.5;
    const dy = (j + 0.5) / BY - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ring = d < 0.22 ? 0 : d < 0.42 ? 1 : 2;
    const roll = r();
    type Plan = { kind: 'single'; type: PropertyType } | { kind: 'grid'; cols: number; rows: number; types: PropertyType[] };
    let plan: Plan;
    if (ring === 0) {
      plan = roll < 0.3 ? { kind: 'grid', cols: 2, rows: 1, types: ['premium', 'premium', 'office'] }
        : roll < 0.8 ? { kind: 'grid', cols: 3, rows: 2, types: ['office', 'office', 'retail', 'restaurant', 'retail'] }
        : { kind: 'single', type: 'shopping_center' };
    } else if (ring === 1) {
      plan = roll < 0.35 ? { kind: 'grid', cols: 3, rows: 1, types: ['warehouse', 'warehouse', 'office', 'industrial'] }
        : roll < 0.75 ? { kind: 'grid', cols: 4, rows: 2, types: ['retail', 'restaurant', 'empty_lot', 'retail', 'office'] }
        : roll < 0.9 ? { kind: 'single', type: 'shopping_center' }
        : { kind: 'grid', cols: 2, rows: 1, types: ['office', 'warehouse'] };
    } else {
      plan = roll < 0.35 ? { kind: 'grid', cols: 3, rows: 1, types: ['industrial', 'warehouse', 'industrial'] }
        : roll < 0.55 ? { kind: 'single', type: 'industrial_land' }
        : { kind: 'grid', cols: 4, rows: 2, types: ['empty_lot', 'empty_lot', 'retail', 'restaurant', 'warehouse'] };
    }
    if (plan.kind === 'single') {
      parcels.push(makeParcel(blockId, plan.type, bx0 + GAP, by0 + GAP, bx1 - GAP, by1 - GAP, street, undefined, ring));
    } else {
      const xc = split(bx0, bx1, plan.cols);
      const yc = split(by0, by1, plan.rows);
      for (let a = 0; a < plan.cols; a++) {
        for (let b = 0; b < plan.rows; b++) {
          const type = plan.types[Math.floor(r() * plan.types.length)];
          parcels.push(makeParcel(blockId, type, xc[a] + GAP, yc[b] + GAP, xc[a + 1] - GAP, yc[b + 1] - GAP, street, undefined, ring));
        }
      }
    }
  };
  for (let j = 0; j < BY; j++) for (let i = 0; i < BX; i++) genBlock(i, j);

  // ---- Expansion ring (v2): two extra rings of purchasable blocks around the original grid.
  // Uses its own RNG and continues lot numbering, so original parcel ids stay identical.
  r = mulberry32(hashString('ring:' + city.id));
  const RING = 2;
  const extraZones: { i: number; j: number }[] = [];
  for (const j of [-1, BY]) {
    const i = -1 + Math.floor(r() * (BX + 1));
    extraZones.push({ i, j });
  }
  for (const z of extraZones) {
    zoneCells.set(`${z.i},${z.j}`, zoneStarts.length);
    zoneCells.set(`${z.i + 1},${z.j}`, zoneStarts.length);
    zoneStarts.push(z);
  }
  for (let j = -RING; j < BY + RING; j++) {
    for (let i = -RING; i < BX + RING; i++) {
      if (i >= 0 && i < BX && j >= 0 && j < BY) continue;
      genBlock(i, j, true);
    }
  }

  // ---- Infill (v3): most vacant lots hold a real business, so the district reads as a city, not a
  // map of plots. Uses its own RNG; ids and all other parcels stay identical for existing saves.
  const rv = mulberry32(hashString('infill:' + city.id));
  for (const p of parcels) {
    if (p.type !== 'empty_lot' || rv() > 0.86) continue;
    const opts: PropertyType[] = p.zoneId ? ['warehouse', 'industrial', 'warehouse'] : p.area < 900 ? ['retail', 'restaurant', 'retail'] : ['retail', 'office', 'restaurant', 'warehouse', 'office'];
    const type = opts[Math.floor(rv() * opts.length)];
    const info = PROPERTY_TYPE_INFO[type];
    const floors = Math.max(1, Math.round(info.floors[0] + rv() * (info.floors[1] - info.floors[0])));
    const w = p.rect.x1 - p.rect.x0, h = p.rect.y1 - p.rect.y0;
    const k = Math.sqrt(info.coverage);
    const cx = (p.rect.x0 + p.rect.x1) / 2, cy = (p.rect.y0 + p.rect.y1) / 2;
    p.type = type;
    p.buildingFloors = floors;
    p.buildingArea = Math.round(w * h * info.coverage * floors);
    p.buildingHeight = floors * (type === 'office' ? 3.8 : type === 'warehouse' || type === 'industrial' ? 9 : 4.2);
    p.footprintPoly = rectPoly(cx - (w * k) / 2, cy - (h * k) / 2, cx + (w * k) / 2, cy + (h * k) / 2);
    const names = BIZ[type];
    p.name = `${AREA_NAMES[Math.floor(rv() * AREA_NAMES.length)]} ${names[Math.floor(rv() * names.length)]}`;
  }

  // Outside development zones, most sheds give way to offices and shops so it feels like a city.
  for (const p of parcels) {
    if (p.zoneId || (p.type !== 'warehouse' && p.type !== 'industrial') || rv() > 0.6) continue;
    const type: PropertyType = p.area > 2600 ? 'office' : rv() < 0.5 ? 'office' : 'retail';
    const info = PROPERTY_TYPE_INFO[type];
    const floors = Math.max(1, Math.round(info.floors[0] + rv() * (info.floors[1] - info.floors[0])));
    p.type = type;
    p.buildingFloors = floors;
    p.buildingArea = Math.round(p.area * info.coverage * floors);
    p.buildingHeight = floors * (type === 'office' ? 3.8 : 4.2);
    const names = BIZ[type];
    p.name = `${AREA_NAMES[Math.floor(rv() * AREA_NAMES.length)]} ${names[Math.floor(rv() * names.length)]}`;
  }

  const sw = toLL(-PX - 60, -PY - 60);
  const ne = toLL(totalW + PX + 60, totalH + PY + 60);
  return { city, plate, streets, parcels, zones, sites, bounds: [sw[0], sw[1], ne[0], ne[1]] };
}

// ---------- small town street plan ----------
// Carmi, Illinois. The named streets and their directions come from real local addresses (Main,
// Oak and Robinson run east-west; Main Cross, Church and Walnut run north-south; Oak carries Highway
// 14) and the Little Wabash River runs along the east side. It is a game-scale plan of the town, not
// a survey: spacing and exact positions are approximate, and every business name is fictional.
export const TOWN = {
  /** Blocks in the buildable core. */
  BX: 8, BY: 7, BW: 92, BH: 84, ST: 14,
  /** Decorative residential blocks around the core. */
  ringW: 4, ringE: 2, ringS: 3, ringN: 3,
  /** Street rows and columns (block-grid indexes). */
  mainRow: 3, oakRow: 1, mainCrossCol: 4, routeOneCol: -1,
  EW: ['Sycamore St', 'Oak St', 'Plum St', 'Main St', 'Robinson St', 'Cherry St', 'Elm St', 'Webb St'],
  NS: ['West St', 'First St', 'Third St', 'Fourth St', 'Main Cross', 'Church St', 'Walnut St', 'Stewart St', 'Water St'],
};
/** The Little Wabash, east of town. The ground shader draws the same curve. */
export function townRiverX(z: number, base: number): number { return base + 70 * Math.sin(z * 0.0032) + 35 * Math.sin(z * 0.0091 + 1.7); }
export function townPlan(f: { totalW: number; totalH: number; BW: number; BH: number; ST: number }) {
  const px = f.BW + f.ST, py = f.BH + f.ST;
  return {
    px, py,
    x0: -TOWN.ringW * px, z0: -TOWN.ringS * py, x1: f.totalW + TOWN.ringE * px, z1: f.totalH + TOWN.ringN * py,
    routeX: TOWN.routeOneCol * px + f.ST / 2, mainZ: TOWN.mainRow * py + f.ST / 2, oakZ: TOWN.oakRow * py + f.ST / 2,
    riverBase: f.totalW + TOWN.ringE * px + 150,
  };
}
type TownCell = { kind: 'downtown' | 'commercial' | 'mixed' | 'industrial' | 'courthouse' | 'park' | 'school' | 'church' };
function townCell(i: number, j: number): TownCell['kind'] {
  if (i === TOWN.mainCrossCol && j === TOWN.mainRow) return 'courthouse';
  if (i === 2 && j === 5) return 'school';
  if (i === 6 && j === 5) return 'park';
  if (i === 5 && j === 4) return 'church';
  if (j === TOWN.mainRow || j === TOWN.mainRow - 1) { if (i >= 3 && i <= 5) return 'downtown'; }
  if (j === TOWN.oakRow && i <= 3) return 'commercial';
  if (j === 0 && i <= 2) return 'industrial';
  if (i >= 6 && j <= 1) return 'industrial';
  return 'mixed';
}
export const townCellKind = townCell;

function generateTown(city: CityDef): CityLayout {
  const r = mulberry32(hashString('town:' + city.id));
  const f = districtFrame(city.id);
  const { BX, BY, BW, BH, ST, totalW, totalH, toLL } = f;
  const rectPoly = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [toLL(x0, y0), toLL(x1, y0), toLL(x1, y1), toLL(x0, y1), toLL(x0, y0)];
  const parcels: ParcelDef[] = [];
  const zones: ZoneDef[] = [];
  const sites: ParcelDef[] = [];
  let lot = 0;
  const FLR = { warehouse: 7, industrial: 8, shopping_center: 7, office: 3.8 } as Record<string, number>;
  const add = (blockId: string, type: PropertyType, x0: number, y0: number, x1: number, y1: number, name: string, addr: string, extra: Partial<ParcelDef> = {}) => {
    lot++;
    const info = PROPERTY_TYPE_INFO[type];
    const area = Math.round((x1 - x0) * (y1 - y0));
    const floors = type === 'office' ? 2 : info.floors[1] === 0 ? 0 : Math.max(info.floors[0], Math.min(2, info.floors[1]));
    const k = Math.sqrt(info.coverage);
    const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ppm = ECONOMY.landPricePerM2[type] * (0.85 + r() * 0.3);
    const [lo, hi] = ECONOMY.landPriceClamp[type];
    // small-town lots sit at the bottom of each type's price range
    const base = Math.min(hi, Math.max(lo * 0.7, ppm * area * 0.8));
    const zoning = extra.zoneId ? ZONINGS.PD : type === 'warehouse' || type === 'industrial' || type === 'industrial_land' ? ZONINGS.I1 : type === 'office' || type === 'shopping_center' ? ZONINGS.C2 : ZONINGS.C1;
    const restrictions = [`Max ${zoning.maxFloors} floors`, `Max ${Math.round(zoning.maxCoverage * 100)}% lot coverage`];
    if (!zoning.heavy) restrictions.push('No hyperscale-class facilities');
    if (r() < 0.35) restrictions.push('Rural feeder: limited grid connection');
    const p: ParcelDef = {
      id: `${city.id}-${lot}`, cityId: city.id, blockId, type, name, address: addr,
      poly: rectPoly(x0, y0, x1, y1), footprintPoly: floors > 0 ? rectPoly(cx - (w * k) / 2, cy - (h * k) / 2, cx + (w * k) / 2, cy + (h * k) / 2) : rectPoly(x0 + 3, y0 + 3, x1 - 3, y1 - 3),
      rect: { x0, y0, x1, y1 }, center: toLL(cx, cy), area,
      buildingArea: floors > 0 ? Math.round(w * h * info.coverage * floors) : 0, buildingFloors: floors,
      buildingHeight: floors * (FLR[type] ?? 4), basePrice: Math.round(base / 1000) * 1000,
      zoning, potential: area > 15000 ? 'Exceptional' : area > 6000 ? 'High' : area > 1800 ? 'Medium' : 'Low',
      restrictions, ...extra,
    };
    parcels.push(p);
    return p;
  };
  const NAMES: Partial<Record<PropertyType, string[]>> = {
    retail: ['Hardware & Supply', 'Five and Dime', 'Pharmacy', 'Antique Mall', 'Barber Shop', 'Flower Shop', 'Shoe Repair', 'Print Shop', 'Dress Shop', 'Video Store'],
    restaurant: ['Diner', 'Pizza Parlor', 'Coffee Shop', 'Drive-In', 'Family Restaurant', 'Bakery'],
    office: ['Insurance Office', 'Law Office', 'Dental Office', 'Savings & Loan', 'Title Company'],
    warehouse: ['Feed Warehouse', 'Farm Supply Barn', 'Storage Units', 'Tractor Shed', 'Seed Warehouse'],
    industrial: ['Machine Shop', 'Oilfield Supply Yard', 'Welding Shop', 'Pipe Yard', 'Grain Dryer Shed'],
    shopping_center: ['Highway 14 Plaza', 'Oak Street Plaza'],
    empty_lot: ['Vacant Lot', 'Gravel Lot', 'Corner Lot'],
    industrial_land: ['Rail Spur Land', 'Bottomland Tract'],
  };
  const nameOf = (type: PropertyType, street: string) => {
    const list = NAMES[type] ?? ['Lot'];
    return `${street.replace(/ (St|Ave|Rd)$/, '')} ${list[Math.floor(r() * list.length)]}`;
  };
  const GAP = 2;
  for (let j = 0; j < BY; j++) for (let i = 0; i < BX; i++) {
    const kind = townCell(i, j);
    if (kind === 'courthouse' || kind === 'park' || kind === 'school' || kind === 'church') continue; // landmarks aren't for sale
    const bx0 = ST + i * (BW + ST) + 3, by0 = ST + j * (BH + ST) + 3, bx1 = bx0 + BW - 6, by1 = by0 + BH - 6;
    const blockId = `${city.id}-b${i}_${j}`;
    // lots face the busier street: blocks just south of Main and Oak take those addresses
    const ew = TOWN.EW[j === TOWN.mainRow - 1 ? TOWN.mainRow : j === TOWN.oakRow - 1 ? TOWN.oakRow : j];
    const side = i < TOWN.mainCrossCol ? 'W' : 'E';
    const addrEW = (lotNo: number) => `${(Math.abs(i - TOWN.mainCrossCol) + 1) * 100 + lotNo * 12} ${side} ${ew}`;
    let cols: number, rows: number, types: PropertyType[];
    if (kind === 'downtown') { cols = 4; rows = 2; types = ['retail', 'retail', 'restaurant', 'office', 'retail']; }
    else if (kind === 'commercial') { const big = i === 1; cols = big ? 1 : 3; rows = big ? 1 : 2; types = big ? ['shopping_center'] : ['retail', 'restaurant', 'warehouse', 'office']; }
    else if (kind === 'industrial') { cols = 2; rows = 1; types = ['warehouse', 'industrial', 'warehouse']; }
    else { cols = 2; rows = 2; types = ['retail', 'empty_lot', 'office', 'warehouse', 'empty_lot', 'retail']; }
    const w = (bx1 - bx0) / cols, h = (by1 - by0) / rows;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      const type = types[Math.floor(r() * types.length)];
      const lotP = add(blockId, type, bx0 + a * w + GAP / 2, by0 + b * h + GAP / 2, bx0 + (a + 1) * w - GAP / 2, by0 + (b + 1) * h - GAP / 2, nameOf(type, ew), addrEW(a * 2 + b));
      if (type === 'office' || (kind === 'downtown' && type !== 'warehouse')) lotP.brick = true;
    }
  }
  // the first property: a tired feed store, the cheapest roof in town with room for modular units
  const start = parcels.filter((p) => p.type === 'warehouse' && p.area >= 1100 && p.area <= 2400).sort((a, b) => a.basePrice - b.basePrice)[0] ?? parcels[0];
  start.starter = true;
  start.name = 'Old Feed Store';
  start.basePrice = 95_000;
  start.buildingArea = 650;
  // two big tracts of farmland on the edge of town: where a campus could really go
  const tract = (zi: number, name: string, x0: number, y0: number, x1: number, y1: number, road: string) => {
    const zoneId = `${city.id}-z${zi}`;
    const ids: string[] = [];
    const cols = 3, rows = 2, w = (x1 - x0) / cols, h = (y1 - y0) / rows;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      const p = add(`${city.id}-t${zi}`, a === 0 && b === 0 ? 'warehouse' : 'empty_lot', x0 + a * w + 3, y0 + b * h + 3, x0 + (a + 1) * w - 3, y0 + (b + 1) * h - 3, a === 0 && b === 0 ? `${name} Machine Shed` : `${name} Tract`, `${1200 + lot * 8} ${road}`, { zoneId });
      p.basePrice = Math.round((p.type === 'warehouse' ? 180_000 : Math.max(90_000, p.area * 22)) / 1000) * 1000;
      ids.push(p.id);
    }
    const siteId = `${city.id}-s${zi}`;
    const area = Math.round((x1 - x0) * (y1 - y0));
    zones.push({ id: zoneId, cityId: city.id, name: `${name} Development Zone`, parcelIds: ids, siteId, poly: rectPoly(x0 - 2, y0 - 2, x1 + 2, y1 + 2), center: toLL((x0 + x1) / 2, (y0 + y1) / 2), area });
    sites.push({
      id: siteId, cityId: city.id, blockId: `${city.id}-t${zi}`, zoneId, type: 'commercial_zone', name: `${name} Campus Site`, address: `${name} (consolidated)`,
      poly: rectPoly(x0, y0, x1, y1), footprintPoly: rectPoly(x0 + 6, y0 + 6, x1 - 6, y1 - 6), rect: { x0, y0, x1, y1 }, center: toLL((x0 + x1) / 2, (y0 + y1) / 2),
      area, buildingArea: 0, buildingFloors: 0, buildingHeight: 0, basePrice: 0, zoning: ZONINGS.PD, potential: 'Exceptional', restrictions: ['Max 9 floors', 'Max 80% lot coverage'], isSite: true, members: ids,
    });
  };
  const px = BW + ST, py = BH + ST;
  const west = -(TOWN.ringW + 1) * px, oakZ = TOWN.oakRow * py + ST / 2, route = TOWN.routeOneCol * px + ST / 2;
  tract(0, 'Highway 14 West', west - 420, oakZ + 30, west - 30, oakZ + 290, 'W Oak St');
  tract(1, 'Route 1 South', route + 16, -(TOWN.ringS + 1) * py - 300, route + 416, -(TOWN.ringS + 1) * py - 40, 'Illinois Route 1');

  const streets: CityLayout['streets'] = [];
  const x0 = -TOWN.ringW * px, x1 = totalW + TOWN.ringE * px, y0 = -TOWN.ringS * py, y1 = totalH + TOWN.ringN * py;
  for (let i = 0; i <= BX; i++) { const x = i * px + ST / 2; streets.push({ name: TOWN.NS[i], line: [toLL(x, y0), toLL(x, y1)] }); }
  for (let j = 0; j <= BY; j++) { const y = j * py + ST / 2; streets.push({ name: TOWN.EW[j], line: [toLL(x0, y), toLL(x1, y)] }); }
  const plate = rectPoly(x0 - 40, y0 - 40, x1 + 40, y1 + 40);
  const sw = toLL(x0 - 480, y0 - 340), ne = toLL(x1 + 60, y1 + 60);
  return { city, plate, streets, parcels, zones, sites, bounds: [sw[0], sw[1], ne[0], ne[1]] };
}

/** Coordinate frame of a city's district (meters ↔ lng/lat), shared with the cityscape generator. */
export function districtFrame(cityId: string) {
  const city = cityById(cityId);
  const [clng, clat] = city.district;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((clat * Math.PI) / 180));
  const town = !!city.town;
  const [bx, by, bw, bh, st] = town ? [TOWN.BX, TOWN.BY, TOWN.BW, TOWN.BH, TOWN.ST] : [BX, BY, BW, BH, ST];
  const totalW = bx * bw + (bx + 1) * st;
  const totalH = by * bh + (by + 1) * st;
  const toLL = (x: number, y: number): [number, number] => [clng + (x - totalW / 2) * mLng, clat + (y - totalH / 2) * mLat];
  const fromLL = (lng: number, lat: number): [number, number] => [(lng - clng) / mLng + totalW / 2, (lat - clat) / mLat + totalH / 2];
  return { city, toLL, fromLL, totalW, totalH, BX: bx, BY: by, BW: bw, BH: bh, ST: st, mLng, mLat, town };
}
