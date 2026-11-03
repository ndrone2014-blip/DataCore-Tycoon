// AI competitor companies. They buy real parcels from the same pool as the
// player, demolish, build, install capacity, research, and earn from the same
// city markets — so they compete for land and depress spot prices.

import type { CompSite, Competitor, GameState } from '../core/state';
import { COMPETITOR_DEFS } from '../config/content';
import { BLUEPRINTS, type BlueprintDef } from '../config/buildings';
import { ECONOMY } from '../config/economy';
import { CITIES, cityById, type CityDef } from '../config/world';
import { getCityLayout, getParcel, getZone, type ParcelDef } from '../world/parcels';
import { newId } from '../core/state';
import { autoEquip } from './equipment';
import { landValue, type Derived } from './derive';
import { demolitionSeconds, parcelState } from './property';
import { canAfford, log, spend } from './ledger';
import { rand, randRange, pick } from '../core/rng';
import { emit, sfx, toast } from '../core/bus';
import { money } from '../core/format';

const cuPerSlot = (tech: number) => 40 * Math.pow(1.35, tech);
const costPerCu = (tech: number) => 430 / (1 + tech * 0.08);

export function createCompetitors(s: GameState): Competitor[] {
  const diff = ECONOMY.difficulties[s.difficulty]?.competitorCash ?? 1;
  return COMPETITOR_DEFS.map((d) => ({
    id: d.id, name: d.name, color: d.color, logo: d.logo, personality: d.personality,
    aggression: d.aggression, profitFocus: d.profitFocus, techFocus: d.techFocus, frugality: d.frugality,
    cash: d.cash * diff, techLevel: 0, research: 0, sites: [], revenueHr: 0, expenseHr: 0, valuation: d.cash * diff,
    history: [], contractsWon: 0, nextThink: rand() * ECONOMY.competitorThinkHours, desc: d.desc, lastAction: 'Founded',
  }));
}

/** Give competitors a starting footprint so the world is alive from minute one. */
export function seedCompetitors(s: GameState) {
  for (const c of s.competitors) {
    const def = COMPETITOR_DEFS.find((d) => d.id === c.id)!;
    const cities = [def.home, pick(['chicago', 'dallas', 'nova', 'phoenix'].filter((x) => x !== def.home))];
    for (const cityId of cities) {
      const p = choosePlot(s, c, cityById(cityId), 1500, 9000);
      if (!p) continue;
      const bp = BLUEPRINTS[p.area > 2600 ? 2 : 1];
      const maxCu = bp.slots * cuPerSlot(0);
      claim(s, c, p.id, 'facility');
      c.sites.push({ parcelId: p.id, cityId, stage: 'operational', progress: 1, total: 1, cu: maxCu * randRange(0.35, 0.6), maxCu, blueprintId: bp.id, invested: bp.cost + landValue(s, p.id) });
    }
  }
}

function claim(s: GameState, c: Competitor, parcelId: string, status: 'demolishing' | 'construction' | 'facility' | 'cleared' | 'existing') {
  s.parcels[parcelId] = { ...(s.parcels[parcelId] ?? parcelState(s, parcelId)), owner: c.id, status };
}

function choosePlot(s: GameState, c: Competitor, city: CityDef, minArea: number, maxArea: number, budget = Infinity): ParcelDef | undefined {
  const lay = getCityLayout(city.id);
  const free = lay.parcels.filter((p) => {
    const st = s.parcels[p.id];
    return (!st || !st.owner) && p.area >= minArea && p.area <= maxArea && p.type !== 'premium' && landValue(s, p.id) <= budget;
  });
  if (!free.length) return undefined;
  // frugal companies prefer cheap land per m^2, others prefer bigger lots
  free.sort((a, b) => {
    const pa = landValue(s, a.id) / a.area, pb = landValue(s, b.id) / b.area;
    return c.frugality > 1.2 ? pa - pb : b.area - a.area;
  });
  return free[Math.floor(rand() * Math.min(4, free.length))];
}

function pickBlueprint(c: Competitor, area: number, budget: number): BlueprintDef | undefined {
  const maxIdx = Math.min(BLUEPRINTS.length - 1, 1 + Math.floor(c.techLevel * 0.9));
  let best: BlueprintDef | undefined;
  for (let i = 0; i <= maxIdx; i++) {
    const b = BLUEPRINTS[i];
    if (b.id === 'mega') continue;
    if (b.minLot <= area && b.cost * 1.3 <= budget) best = b;
  }
  return best;
}

function allowedCities(s: GameState, c: Competitor): CityDef[] {
  const reach = 1 + s.gameHours / (260 / c.aggression) + c.techLevel * 1.5;
  return CITIES.filter((x) => x.unlockLevel <= reach);
}

function think(s: GameState, c: Competitor, der: Derived) {
  const opCu = c.sites.reduce((a, x) => a + (x.stage === 'operational' ? x.cu : 0), 0);
  // 1) fill existing sites with capacity
  for (const site of c.sites) {
    if (site.stage !== 'operational' || site.cu >= site.maxCu) continue;
    if ((der.cityPrice[site.cityId] ?? 1) < 0.55) continue; // don't flood a saturated market
    const budget = c.cash * 0.35 * c.aggression;
    const add = Math.min(site.maxCu - site.cu, budget / costPerCu(c.techLevel));
    if (add > 5) {
      const cost = add * costPerCu(c.techLevel);
      c.cash -= cost;
      site.cu += add;
      site.invested += cost;
    }
  }
  // 2) research
  if (c.cash > 500_000) {
    const spendR = c.cash * 0.04 * c.techFocus;
    c.cash -= spendR;
    c.research += spendR / (1_500_000 * Math.pow(2.1, c.techLevel));
    if (c.research >= 1 && c.techLevel < 8) {
      c.research = 0;
      c.techLevel++;
      c.lastAction = `Reached technology level ${c.techLevel}`;
      for (const site of c.sites) site.maxCu = Math.max(site.maxCu, BLUEPRINTS.find((b) => b.id === site.blueprintId)!.slots * cuPerSlot(c.techLevel));
      log(s, `${c.name} advanced to technology level ${c.techLevel}`, 'comp');
    }
  }
  // 3) expansion
  const building = c.sites.filter((x) => x.stage !== 'operational').length;
  const threshold = 900_000 / c.aggression;
  const siteCap = 3 + (s.gameHours / 1200) * c.aggression;
  if (building < 1 + Math.floor(c.aggression) && c.sites.length < siteCap && c.cash > threshold && rand() < 0.35 * c.aggression) {
    const cities = allowedCities(s, c);
    // score cities: demand/supply ratio (profit-focus), cheap land (frugality), home bias
    let bestCity: CityDef | undefined;
    let bestScore = -Infinity;
    for (const city of cities) {
      const ratio = der.cityDemand[city.id] / Math.max(500, der.citySupply[city.id]);
      if (ratio < 1.15) continue; // market saturated — no new builds here
      const score = ratio * c.profitFocus - city.landMult * 0.3 * c.frugality + rand() * 0.8 + (c.sites.some((x) => x.cityId === city.id) ? 0.2 : 0);
      if (score > bestScore) { bestScore = score; bestCity = city; }
    }
    if (bestCity) {
      // aggressive rich competitors sometimes grab an entire development zone
      const lay = getCityLayout(bestCity.id);
      if (c.aggression > 1.2 && c.cash > 25_000_000 && rand() < 0.25) {
        const z = lay.zones.find((zz) => zz.parcelIds.every((pid) => !s.parcels[pid]?.owner));
        if (z) {
          const price = z.parcelIds.reduce((a, pid) => a + landValue(s, pid), 0) * 0.85;
          if (price < c.cash * 0.4) {
            c.cash -= price;
            for (const pid of z.parcelIds) claim(s, c, pid, parcelState(s, pid).status === 'existing' ? 'existing' : 'cleared');
            for (const pid of z.parcelIds.slice(0, 2)) startSite(s, c, pid, bestCity, 0);
            c.lastAction = `Bought the ${z.name}`;
            log(s, `${c.name} bought the entire ${z.name} in ${bestCity.name} for ${money(price)}`, 'comp');
            if (s.unlockedCities.includes(bestCity.id)) toast({ title: `${c.name} moves in`, body: `They bought a whole development zone in ${bestCity.name}.`, kind: 'warn', icon: c.logo });
            emit('world');
            return;
          }
        }
      }
      const maxArea = c.cash > 30_000_000 ? 60000 : c.cash > 8_000_000 ? 20000 : 6000;
      const p = choosePlot(s, c, bestCity, 1100, maxArea, c.cash * 0.4);
      if (p) {
        const price = landValue(s, p.id);
        if (price < c.cash * 0.45) {
          c.cash -= price;
          claim(s, c, p.id, p.buildingFloors > 0 ? 'demolishing' : 'construction');
          startSite(s, c, p.id, bestCity, price);
          emit('world');
        }
      }
    }
  }
  void opCu;
}

function startSite(s: GameState, c: Competitor, parcelId: string, city: CityDef, landCost: number) {
  const lay = getCityLayout(city.id);
  const p = lay.parcels.find((x) => x.id === parcelId)!;
  const bp = pickBlueprint(c, p.area, c.cash) ?? BLUEPRINTS[0];
  const buildCost = bp.cost * city.constructionMult;
  c.cash -= buildCost;
  const needsDemo = p.buildingFloors > 0;
  const site: CompSite = {
    parcelId, cityId: city.id, stage: needsDemo ? 'demolish' : 'build', progress: 0,
    total: needsDemo ? demolitionSeconds(p) * 1.5 : bp.buildSeconds * 1.2,
    cu: 0, maxCu: bp.slots * cuPerSlot(c.techLevel), blueprintId: bp.id, invested: landCost + buildCost,
  };
  c.sites.push(site);
  claim(s, c, parcelId, needsDemo ? 'demolishing' : 'construction');
  c.lastAction = `Building a ${bp.name} in ${city.name}`;
  if (rand() < 0.5 || s.unlockedCities.includes(city.id)) log(s, `${c.name} started a ${bp.name} in ${city.name}`, 'comp');
}

export function tickCompetitors(s: GameState, dt: number, realDt: number, der: Derived) {
  const dayBefore = Math.floor((s.gameHours - dt) / 24);
  const dayNow = Math.floor(s.gameHours / 24);
  for (const c of s.competitors) {
    // site progress
    for (const site of c.sites) {
      if (site.stage === 'operational') continue;
      site.progress += realDt;
      if (site.progress >= site.total) {
        if (site.stage === 'demolish') {
          const bp = BLUEPRINTS.find((b) => b.id === site.blueprintId)!;
          site.stage = 'build';
          site.progress = 0;
          site.total = bp.buildSeconds * 1.2;
          claim(s, c, site.parcelId, 'construction');
        } else {
          site.stage = 'operational';
          site.cu = site.maxCu * 0.15;
          claim(s, c, site.parcelId, 'facility');
          c.lastAction = `Opened a facility in ${cityById(site.cityId).name}`;
        }
        emit('world');
      }
    }
    // economics
    let rev = 0;
    let cu = 0;
    for (const site of c.sites) {
      if (site.stage !== 'operational') continue;
      const util = 0.62 + 0.12 * Math.min(1, c.profitFocus / 1.6);
      rev += site.cu * util * (der.cityPrice[site.cityId] ?? 1) * (1 + c.techLevel * 0.04);
      cu += site.cu;
    }
    const exp = (cu * 0.07 * (1 - (c.frugality - 1) * 0.15)) / (1 + c.techLevel * 0.12) + c.sites.length * 60;
    c.revenueHr = rev;
    c.expenseHr = exp;
    c.cash += (rev - exp) * dt;
    if (c.cash < 0) {
      // distressed: sell capacity to stay afloat
      for (const site of c.sites) site.cu *= 0.97;
      c.cash += 50_000 * dt;
    }
    const assets = c.sites.reduce((a, x) => a + x.invested, 0);
    c.valuation = Math.max(0, c.cash + assets * 0.72 + Math.max(0, rev - exp) * ECONOMY.profitMultipleHours);
    if (dayNow !== dayBefore) {
      c.history.push(Math.round(c.valuation));
      if (c.history.length > 120) c.history.shift();
    }
    // decisions
    if (s.gameHours >= c.nextThink) {
      c.nextThink = s.gameHours + ECONOMY.competitorThinkHours * randRange(0.7, 1.3) / Math.sqrt(c.aggression);
      think(s, c, der);
    }
  }
}

/** What it costs to buy a rival outright: their valuation (paying for their cash means you also receive it). */
export function acquisitionQuote(s: GameState, compId: string): { ok: boolean; reason?: string; price: number; cashAcquired: number; facilities: number; lots: number } {
  const c = s.competitors.find((x) => x.id === compId);
  if (!c) return { ok: false, reason: 'Company no longer exists', price: 0, cashAcquired: 0, facilities: 0, lots: 0 };
  const price = Math.round(c.valuation);
  const lots = Object.values(s.parcels).filter((p) => p.owner === c.id).length;
  const facilities = c.sites.filter((x) => x.stage === 'operational').length;
  const cashAcquired = Math.max(0, Math.round(c.cash));
  if (!canAfford(s, price)) return { ok: false, reason: `Need ${money(price)} in cash`, price, cashAcquired, facilities, lots };
  return { ok: true, price, cashAcquired, facilities, lots };
}

/** Buy a rival: their land and running data centers become yours, their projects stop, and they leave the market. */
export function acquireCompetitor(s: GameState, compId: string): { ok: boolean; reason?: string } {
  const q = acquisitionQuote(s, compId);
  if (!q.ok) return { ok: false, reason: q.reason };
  const c = s.competitors.find((x) => x.id === compId)!;
  spend(s, q.price, 'Acquisitions', `Acquired ${c.name}`);
  // their cash comes with the company (not counted as operating revenue)
  s.cash += q.cashAcquired;
  s.finance.ledger.unshift({ t: s.gameHours, amount: q.cashAcquired, cat: 'Acquisitions', desc: `Cash on ${c.name}'s balance sheet` });
  const siteByParcel = new Map(c.sites.map((x) => [x.parcelId, x]));
  const newFacilities: { id: string; fill: number; slots: number }[] = [];
  for (const [pid, ps] of Object.entries(s.parcels)) {
    if (ps.owner !== c.id) continue;
    const site = siteByParcel.get(pid);
    const p = getParcel(pid);
    const value = landValue(s, pid);
    ps.owner = 'player';
    ps.boughtFor = value;
    ps.boughtAt = s.gameHours;
    if (p && !s.unlockedCities.includes(p.cityId)) s.unlockedCities.push(p.cityId);
    if (site?.stage === 'operational') {
      const bp = BLUEPRINTS.find((b) => b.id === site.blueprintId)!;
      const fid = newId(s, 'dc');
      s.facilities[fid] = {
        id: fid, parcelId: pid, cityId: site.cityId, name: `${bp.name} (ex-${c.name})`, blueprintId: bp.id,
        slots: bp.slots, bays: bp.bays, basePower: bp.power, baseCooling: bp.cooling, floors: bp.floors, style: 'concrete', color: s.company.color,
        footprint: bp.footprint, equipment: {}, condition: 90, builtAt: s.gameHours, buildCost: bp.cost, shellValue: bp.cost * 0.72,
        equipmentSpent: 0, revenueTotal: 0, profitTotal: 0,
      };
      ps.status = 'facility';
      ps.facilityId = fid;
      newFacilities.push({ id: fid, fill: site.maxCu ? site.cu / site.maxCu : 0, slots: bp.slots });
    } else if (ps.status === 'demolishing' || ps.status === 'construction') {
      ps.status = 'cleared'; // their half-finished work is written off, the land is ready to build on
    }
  }
  s.competitors = s.competitors.filter((x) => x.id !== c.id);
  // their hardware comes along, roughly as full as it was, using gear you've unlocked
  for (const nf of newFacilities) autoEquip(s, nf.id, Infinity, { free: true, maxSlots: Math.round(nf.slots * Math.min(1, nf.fill)) });
  s.stats.acquisitions = (s.stats.acquisitions ?? 0) + 1;
  log(s, `Acquired ${c.name} for ${money(q.price)}: ${q.lots} properties and ${q.facilities} data centers joined the company`, 'good');
  toast({ title: `${c.name} acquired!`, body: `${q.lots} properties and ${q.facilities} data centers are now yours.${s.competitors.length ? '' : ' You have no rivals left.'}`, kind: 'achievement', icon: '🤝' });
  sfx('levelup');
  emit('world');
  return { ok: true };
}

export function competitorCities(c: Competitor): string[] {
  return [...new Set(c.sites.map((x) => x.cityId))];
}

export { getZone };
