// Derived (non-persisted) facility and company statistics.
// Recomputed every simulation step from GameState.

import type { Facility, GameState } from '../core/state';
import { equipmentById, type CapType } from '../config/buildings';
import { ECONOMY } from '../config/economy';
import { cityById, CITIES } from '../config/world';
import { type Effects } from '../config/research';
import { getEffects, eff, deptBonus, powerPrice, activeEvent } from './modifiers';
import { getParcel } from '../world/parcels';

export interface FacStats {
  id: string;
  servers: number;
  slotsUsed: number;
  baysUsed: number;
  raw: Record<CapType, number>;
  delivered: Record<CapType, number>;
  allocated: Record<CapType, number>;
  free: Record<CapType, number>;
  itLoad: number;
  powerCap: number;
  coolingCap: number;
  backup: number;
  network: number;
  powerFactor: number;
  coolingFactor: number;
  networkFactor: number;
  conditionFactor: number;
  outage: boolean;
  perf: number;
  temperature: number;
  pue: number;
  security: number;
  revenue: { contracts: number; spot: number };
  expenses: Record<string, number>;
  revenueHr: number;
  expenseHr: number;
  profitHr: number;
  equipmentValue: number;
  value: number;
  utilization: number;
  cu: number;
  warnings: string[];
  campus: number;
}

export interface Derived {
  effects: Effects;
  fac: Record<string, FacStats>;
  cityPrice: Record<string, number>;
  citySupply: Record<string, number>;
  cityDemand: Record<string, number>;
  playerCU: Record<string, number>;
  totals: {
    revenueHr: number;
    expenseHr: number;
    profitHr: number;
    salariesHr: number;
    landTaxHr: number;
    interestHr: number;
    hqHr: number;
    delivered: Record<CapType, number>;
    raw: Record<CapType, number>;
    landValue: number;
    buildingValue: number;
    equipmentValue: number;
    valuation: number;
    facilities: number;
    properties: number;
    cities: number;
    countries: number;
    cu: number;
  };
}

const zero = (): Record<CapType, number> => ({ cpu: 0, gpu: 0, storage: 0 });

export function landValue(s: GameState, parcelId: string): number {
  const p = getParcel(parcelId);
  if (!p) return 0;
  if (p.isSite && p.members) return p.members.reduce((a, m) => a + landValue(s, m), 0);
  const c = cityById(p.cityId);
  const diff = ECONOMY.difficulties[s.difficulty]?.priceMult ?? 1;
  const growth = s.cityDemand[p.cityId] ?? 1;
  return Math.round(p.basePrice * c.landMult * diff * (0.55 + 0.45 * growth));
}

function rawStats(s: GameState, f: Facility, e: Effects) {
  const raw = zero();
  let servers = 0, slotsUsed = 0, baysUsed = 0, itLoad = 0, addPower = 0, addCooling = 0, backup = 0, network = 0, security = 0, maint = 0, equipValue = 0, liquid = 0, netUnits = 0;
  for (const [id, n] of Object.entries(f.equipment)) {
    if (!n) continue;
    const d = equipmentById(id);
    if (!d) continue;
    itLoad += d.power * n;
    maint += d.maint * n;
    equipValue += (d.cost + d.install) * n;
    if (d.kind === 'server') {
      slotsUsed += d.slotsUsed * n;
      if (d.cap) {
        raw[d.cap] += d.capacity * n;
        servers += n;
      }
      if (d.addNetwork) {
        network += d.addNetwork * n;
        netUnits += n;
      }
    } else {
      baysUsed += n;
      addPower += (d.addPower ?? 0) * n;
      addCooling += (d.addCooling ?? 0) * n;
      backup += (d.backup ?? 0) * n;
      security += (d.security ?? 0) * n;
      if (id === 'liquid') liquid += n;
    }
  }
  network *= 1 + eff(e, 'networkCap');
  return { raw, servers, slotsUsed, baysUsed, itLoad, addPower, addCooling, backup, network, security, maint, equipValue, liquid, netUnits };
}

export function deriveAll(s: GameState): Derived {
  const e = getEffects(s);
  const fac: Record<string, FacStats> = {};
  const playerCU: Record<string, number> = {};
  const pre: { f: Facility; st: FacStats; r: ReturnType<typeof rawStats> }[] = [];

  const itBonusG = deptBonus(s, 'it');
  const financeBonus = deptBonus(s, 'finance');

  // campus synergy: facilities sharing a city block / development zone share fiber & power
  const blockCount: Record<string, number> = {};
  const blockOf = (pid: string) => getParcel(pid)?.blockId ?? pid;
  for (const f of Object.values(s.facilities)) if (!f.isHQ) blockCount[blockOf(f.parcelId)] = (blockCount[blockOf(f.parcelId)] ?? 0) + 1;

  for (const f of Object.values(s.facilities)) {
    const r = rawStats(s, f, e);
    const campus = f.isHQ ? 0 : Math.min(0.12, 0.03 * ((blockCount[blockOf(f.parcelId)] ?? 1) - 1));
    const city = cityById(f.cityId);
    const elecB = deptBonus(s, 'electrical', f.id);
    const coolB = deptBonus(s, 'cooling', f.id);
    const itB = deptBonus(s, 'it', f.id);
    const opsB = deptBonus(s, 'ops', f.id);
    const secStaff = s.employees.some((x) => x.dept === 'security' && x.assigned === f.id) ? 1 : 0;

    const powerCap = (f.basePower + r.addPower) * (1 + eff(e, 'powerCap') + elecB);
    let coolingCap = (f.baseCooling + r.addCooling) * (1 + eff(e, 'coolingCap') + coolB);
    if (activeEvent(s, 'heatwave', f.cityId) && s.events.some((x) => x.defId === 'heatwave' && x.cityId === f.cityId)) coolingCap *= 0.75;
    const outage = s.events.some((x) => x.defId === 'outage' && x.cityId === f.cityId);
    const load = r.itLoad;
    let powerFactor = load <= 0 ? 1 : Math.min(1, powerCap / load);
    if (outage) powerFactor = load <= 0 ? 1 : Math.min(powerFactor, r.backup / load);
    const coolingFactor = load <= 0 ? 1 : Math.min(1, coolingCap / load);
    const allow = 4;
    const networkFactor = r.servers <= allow ? 1 : 0.4 + 0.6 * Math.min(1, (r.network + allow) / r.servers);
    const conditionFactor = f.condition >= 70 ? 1 : 0.5 + f.condition / 140;
    const perfBoost = 1 + eff(e, 'perf') + itB * 0.15 + (r.liquid > 0 ? 0.03 : 0) + campus;
    const perf = Math.max(0, powerFactor * coolingFactor * networkFactor * conditionFactor * perfBoost);
    const ratio = coolingCap > 0 ? load / coolingCap : load > 0 ? 2 : 0;
    const temperature = ratio <= 1 ? 19 + 16 * ratio : 35 + 22 * (ratio - 1);
    const coolTier = f.custom?.coolingTier ?? 0;
    const liquidShare = r.liquid > 0 ? Math.min(1, (r.liquid * 1200) / Math.max(1, coolingCap)) : 0;
    const pue = Math.max(ECONOMY.minPUE, ECONOMY.basePUE - eff(e, 'pue') - coolTier * 0.05 - liquidShare * 0.08 - coolB * 0.2);

    const delivered = zero();
    (['cpu', 'gpu', 'storage'] as CapType[]).forEach((c) => {
      const capE = c === 'cpu' ? eff(e, 'cpuCap') : c === 'gpu' ? eff(e, 'gpuCap') : eff(e, 'storageCap');
      delivered[c] = r.raw[c] * perf * (1 + capE);
    });

    const pp = powerPrice(s, f.cityId) * ECONOMY.powerCostScale;
    const lv = landValue(s, f.parcelId);
    const expenses: Record<string, number> = {
      electricity: load * pp * (1 - eff(e, 'electricityCost') - elecB * 0.4) * (outage ? 0.2 : 1),
      cooling: load * (pue - 1) * pp * (1 - coolB * 0.6) + coolingCap * ECONOMY.coolingMaintPerKW,
      maintenance: r.maint * (1 - eff(e, 'maint') - itB),
      building: f.shellValue * ECONOMY.buildingMaintRate * (1 - opsB * 0.33),
      tax: (lv * city.tax * ECONOMY.propertyTaxScale) / 8760 * (1 - financeBonus),
      insurance: (f.shellValue + r.equipValue) * ECONOMY.insuranceRate * (1 - financeBonus * 0.5),
      connectivity: (ECONOMY.connectivityBase + ECONOMY.connectivityPerNetwork * r.netUnits) * (1 - eff(e, 'connectivity')),
    };
    for (const k of Object.keys(expenses)) expenses[k] = Math.max(0, expenses[k]);

    const warnings: string[] = [];
    if (powerFactor < 0.999) warnings.push(outage ? 'Grid outage — running on backup power' : 'Power capacity exceeded');
    if (coolingFactor < 0.999) warnings.push('Overheating — cooling capacity exceeded');
    if (networkFactor < 0.999) warnings.push('Network bottleneck — add switches');
    if (f.condition < 70) warnings.push('Facility needs maintenance');

    const st: FacStats = {
      id: f.id, servers: r.servers, slotsUsed: r.slotsUsed, baysUsed: r.baysUsed,
      raw: r.raw, delivered, allocated: zero(), free: zero(),
      itLoad: load, powerCap, coolingCap, backup: r.backup, network: r.network,
      powerFactor, coolingFactor, networkFactor, conditionFactor, outage, perf, temperature, pue,
      security: r.security + (f.custom?.security ?? 0) + secStaff,
      revenue: { contracts: 0, spot: 0 }, expenses,
      revenueHr: 0, expenseHr: 0, profitHr: 0,
      equipmentValue: r.equipValue * ECONOMY.equipmentBookValue,
      value: 0, utilization: 0, cu: 0, warnings, campus,
    };
    st.cu = delivered.cpu * ECONOMY.cuPerUnit.cpu + delivered.gpu * ECONOMY.cuPerUnit.gpu + delivered.storage * ECONOMY.cuPerUnit.storage;
    playerCU[f.cityId] = (playerCU[f.cityId] ?? 0) + st.cu;
    fac[f.id] = st;
    pre.push({ f, st, r });
  }

  // ---- market prices per city ----
  const cityPrice: Record<string, number> = {};
  const citySupply: Record<string, number> = {};
  const cityDemand: Record<string, number> = {};
  for (const c of CITIES) {
    let supply = playerCU[c.id] ?? 0;
    for (const comp of s.competitors) for (const site of comp.sites) if (site.cityId === c.id && site.stage === 'operational') supply += site.cu;
    const demand = c.demand * ECONOMY.demandScale * (s.cityDemand[c.id] ?? 1);
    citySupply[c.id] = supply;
    cityDemand[c.id] = demand;
    let price = Math.max(ECONOMY.priceFloor, Math.min(ECONOMY.priceTop, ECONOMY.priceTop - ECONOMY.priceSlope * (supply / demand)));
    if (s.events.some((x) => x.defId === 'demand_surge' && x.cityId === c.id)) price *= 1.3;
    cityPrice[c.id] = price;
  }

  // ---- contracts & spot revenue ----
  const boom = s.events.some((x) => x.defId === 'ai_boom');
  const contractsByFac: Record<string, typeof s.contracts.active> = {};
  for (const ct of s.contracts.active) if (ct.facilityId) (contractsByFac[ct.facilityId] ??= []).push(ct);
  for (const { f, st } of pre) {
    const remaining = { ...st.delivered };
    let cRev = 0;
    for (const ct of contractsByFac[f.id] ?? []) {
      const give = Math.min(ct.amount, Math.max(0, remaining[ct.cap]));
      remaining[ct.cap] -= give;
      st.allocated[ct.cap] += give;
      const ful = ct.amount > 0 ? give / ct.amount : 1;
      ct.fulfillment = ful;
      const pay = ful >= ct.sla ? ct.ratePerHour * ful : ct.ratePerHour * ful * ful;
      cRev += pay;
    }
    let spot = 0;
    (['cpu', 'gpu', 'storage'] as CapType[]).forEach((c) => {
      st.free[c] = Math.max(0, remaining[c]);
      let rate = ECONOMY.revenueRates[c] * ECONOMY.spotRateFraction * cityPrice[f.cityId];
      if (boom && c === 'gpu') rate *= 1.4;
      spot += st.free[c] * rate;
    });
    st.revenue = { contracts: cRev, spot };
    st.revenueHr = cRev + spot;
    st.expenseHr = Object.values(st.expenses).reduce((a, b) => a + b, 0);
    st.profitHr = st.revenueHr - st.expenseHr;
    st.value = f.shellValue * ECONOMY.buildingBookValue * (0.5 + f.condition / 200) + st.equipmentValue;
    const totDel = st.delivered.cpu * 1.2 + st.delivered.gpu * 30 + st.delivered.storage * 0.12;
    const totAlloc = st.allocated.cpu * 1.2 + st.allocated.gpu * 30 + st.allocated.storage * 0.12;
    st.utilization = totDel > 0 ? totAlloc / totDel : 0;
  }

  // ---- company totals ----
  const t: Derived['totals'] = {
    revenueHr: 0, expenseHr: 0, profitHr: 0, salariesHr: 0, landTaxHr: 0, interestHr: 0, hqHr: 0,
    delivered: zero(), raw: zero(), landValue: 0, buildingValue: 0, equipmentValue: 0, valuation: 0,
    facilities: 0, properties: 0, cities: 0, countries: 0, cu: 0,
  };
  for (const st of Object.values(fac)) {
    t.revenueHr += st.revenueHr;
    t.expenseHr += st.expenseHr;
    (['cpu', 'gpu', 'storage'] as CapType[]).forEach((c) => {
      t.delivered[c] += st.delivered[c];
      t.raw[c] += st.raw[c];
    });
    t.buildingValue += st.value - st.equipmentValue;
    t.equipmentValue += st.equipmentValue;
    t.cu += st.cu;
  }
  t.facilities = Object.values(s.facilities).filter((f) => !f.isHQ).length;
  const cities = new Set<string>();
  const countries = new Set<string>();
  for (const [pid, ps] of Object.entries(s.parcels)) {
    if (ps.owner !== 'player' || ps.mergedInto) continue;
    t.properties++;
    const lv = landValue(s, pid);
    t.landValue += lv;
    const p = getParcel(pid);
    if (!p) continue;
    if (ps.status !== 'facility' && ps.status !== 'hq') {
      t.landTaxHr += (lv * cityById(p.cityId).tax * ECONOMY.propertyTaxScale) / 8760 * (1 - financeBonus);
    }
  }
  for (const f of Object.values(s.facilities)) {
    if (f.isHQ) continue;
    cities.add(f.cityId);
    countries.add(cityById(f.cityId).country);
  }
  t.cities = cities.size;
  t.countries = countries.size;
  t.salariesHr = s.employees.reduce((a, x) => a + x.salary, 0);
  t.interestHr = (s.debt * ECONOMY.loanInterestPerDay * (1 - financeBonus * 0.5)) / 24;
  t.hqHr = ECONOMY.hqUpkeep[s.company.hqTier] ?? 0;
  t.expenseHr += t.salariesHr + t.landTaxHr + t.interestHr + t.hqHr;
  t.profitHr = t.revenueHr - t.expenseHr;
  const earnings = Math.max(0, s.finance.avgHourProfit) * ECONOMY.profitMultipleHours;
  t.valuation = Math.max(0, s.cash - s.debt + t.landValue + t.buildingValue + t.equipmentValue + earnings);
  void itBonusG;
  return { effects: e, fac, cityPrice, citySupply, cityDemand, playerCU, totals: t };
}
