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

  const sw = toLL(-PX - 60, -PY - 60);
  const ne = toLL(totalW + PX + 60, totalH + PY + 60);
  return { city, plate, streets, parcels, zones, sites, bounds: [sw[0], sw[1], ne[0], ne[1]] };
}

/** Coordinate frame of a city's district (meters ↔ lng/lat), shared with the cityscape generator. */
export function districtFrame(cityId: string) {
  const city = cityById(cityId);
  const [clng, clat] = city.district;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((clat * Math.PI) / 180));
  const totalW = BX * BW + (BX + 1) * ST;
  const totalH = BY * BH + (BY + 1) * ST;
  const toLL = (x: number, y: number): [number, number] => [clng + (x - totalW / 2) * mLng, clat + (y - totalH / 2) * mLat];
  const fromLL = (lng: number, lat: number): [number, number] => [(lng - clng) / mLng + totalW / 2, (lat - clat) / mLat + totalH / 2];
  return { city, toLL, fromLL, totalW, totalH, BX, BY, BW, BH, ST, mLng, mLat };
}
