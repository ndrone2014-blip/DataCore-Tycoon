// Land: purchasing lots and zones, selling, demolition, zone consolidation, region licences.

import type { GameState, ParcelState } from '../core/state';
import { newId } from '../core/state';
import { getParcel, getZone, type ParcelDef } from '../world/parcels';
import { ECONOMY } from '../config/economy';
import { cityById, countryById } from '../config/world';
import { landValue } from './derive';
import { spend, receive, log, addXp, stat, canAfford } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { constructionMult, getEffects, deptBonus, eff } from './modifiers';
import { money } from '../core/format';

export function parcelState(s: GameState, id: string): ParcelState {
  const st = s.parcels[id];
  if (st) return st;
  const p = getParcel(id);
  return { owner: null, status: p && p.buildingFloors > 0 ? 'existing' : 'cleared' };
}

function ensureState(s: GameState, id: string): ParcelState {
  if (!s.parcels[id]) s.parcels[id] = { ...parcelState(s, id) };
  return s.parcels[id];
}

export const isCityUnlocked = (s: GameState, cityId: string) => s.unlockedCities.includes(cityId);

export function demolitionCost(s: GameState, p: ParcelDef): number {
  if (p.buildingArea <= 0) return 0;
  return Math.round(p.buildingArea * ECONOMY.demolitionPerM2 * constructionMult(s, p.cityId, getEffects(s)) / 100) * 100;
}

export function demolitionSeconds(p: ParcelDef): number {
  return Math.max(ECONOMY.demolitionMinSeconds, Math.round((p.buildingArea / 1000) * ECONOMY.demolitionSecondsPer1000m2));
}

export interface Check { ok: boolean; reason?: string }

export function canBuy(s: GameState, id: string): Check {
  const p = getParcel(id);
  if (!p || p.isSite) return { ok: false, reason: 'Not purchasable' };
  if (!isCityUnlocked(s, p.cityId)) return { ok: false, reason: `Unlock ${cityById(p.cityId).name} first` };
  const st = parcelState(s, id);
  if (st.owner === 'player') return { ok: false, reason: 'You already own this property' };
  if (st.owner) return { ok: false, reason: 'Owned by a competitor' };
  const price = landValue(s, id);
  if (!canAfford(s, price)) return { ok: false, reason: `Need ${money(price)}` };
  return { ok: true };
}

function noteExpansion(s: GameState, cityId: string) {
  const owned = Object.entries(s.parcels).filter(([, v]) => v.owner === 'player');
  const inCity = owned.filter(([k]) => getParcel(k)?.cityId === cityId).length;
  if (inCity === 1) {
    addXp(s, ECONOMY.xp.newCity, 'New city');
    const country = cityById(cityId).country;
    const countryCount = new Set(owned.map(([k]) => cityById(getParcel(k)!.cityId).country));
    if (countryCount.size > (s.stats.countriesEntered ?? 0)) {
      s.stats.countriesEntered = countryCount.size;
      if (countryCount.size > 1) {
        addXp(s, ECONOMY.xp.newCountry, 'New country');
        log(s, `Expanded into ${countryById(country).name} ${countryById(country).flag}`, 'good');
      }
    }
  }
}

export function buyParcel(s: GameState, id: string): Check {
  const c = canBuy(s, id);
  if (!c.ok) return c;
  const p = getParcel(id)!;
  const price = landValue(s, id);
  spend(s, price, 'Property', `Purchased ${p.name}, ${cityById(p.cityId).name}`);
  const st = ensureState(s, id);
  st.owner = 'player';
  st.boughtFor = price;
  st.boughtAt = s.gameHours;
  stat(s, 'propertiesBought');
  addXp(s, ECONOMY.xp.buyProperty + price / ECONOMY.xp.buyPropertyPer, 'Property');
  noteExpansion(s, p.cityId);
  log(s, `Bought ${p.name} in ${cityById(p.cityId).name} for ${money(price)}`, 'money');
  sfx('buy');
  emit('world');
  return { ok: true };
}

export function zoneQuote(s: GameState, zoneId: string): { ok: boolean; reason?: string; price: number; lots: string[]; full: number } {
  const z = getZone(zoneId);
  if (!z) return { ok: false, reason: 'Unknown zone', price: 0, lots: [], full: 0 };
  if (!isCityUnlocked(s, z.cityId)) return { ok: false, reason: `Unlock ${cityById(z.cityId).name} first`, price: 0, lots: [], full: 0 };
  const lots: string[] = [];
  let full = 0;
  for (const pid of z.parcelIds) {
    const st = parcelState(s, pid);
    if (st.owner && st.owner !== 'player') return { ok: false, reason: 'A competitor owns part of this zone', price: 0, lots: [], full: 0 };
    if (st.owner !== 'player') {
      lots.push(pid);
      full += landValue(s, pid);
    }
  }
  if (!lots.length) return { ok: false, reason: 'You already own the whole zone', price: 0, lots, full };
  const price = Math.round(full * (1 - ECONOMY.zoneBundleDiscount));
  if (!canAfford(s, price)) return { ok: false, reason: `Need ${money(price)}`, price, lots, full };
  return { ok: true, price, lots, full };
}

export function buyZone(s: GameState, zoneId: string): Check {
  const q = zoneQuote(s, zoneId);
  if (!q.ok) return q;
  const z = getZone(zoneId)!;
  spend(s, q.price, 'Property', `Purchased ${z.name} (${q.lots.length} lots)`);
  for (const pid of q.lots) {
    const st = ensureState(s, pid);
    st.owner = 'player';
    st.boughtFor = Math.round(landValue(s, pid) * (1 - ECONOMY.zoneBundleDiscount));
    st.boughtAt = s.gameHours;
  }
  stat(s, 'propertiesBought', q.lots.length);
  stat(s, 'zonesBought');
  addXp(s, ECONOMY.xp.buyProperty * q.lots.length + q.price / ECONOMY.xp.buyPropertyPer, 'Zone');
  noteExpansion(s, z.cityId);
  log(s, `Acquired the ${z.name} — ${q.lots.length} lots for ${money(q.price)}`, 'money');
  toast({ title: 'Development zone acquired', body: `${z.name}: ${q.lots.length} lots.`, kind: 'good', icon: '📐' });
  sfx('buy');
  emit('world');
  return { ok: true };
}

export function canSell(s: GameState, id: string): Check {
  const st = parcelState(s, id);
  if (st.owner !== 'player') return { ok: false, reason: 'Not yours' };
  if (st.status === 'facility' || st.status === 'hq' || st.status === 'construction' || st.status === 'demolishing') return { ok: false, reason: 'Remove the facility or finish the project first' };
  if (st.mergedInto) return { ok: false, reason: 'Part of a consolidated site' };
  return { ok: true };
}

export function sellParcel(s: GameState, id: string): Check {
  const c = canSell(s, id);
  if (!c.ok) return c;
  const p = getParcel(id)!;
  const value = Math.round(landValue(s, id) * ECONOMY.propertySellReturn);
  if (p.isSite && p.members) {
    for (const m of p.members) {
      const ms = ensureState(s, m);
      ms.owner = null;
      ms.mergedInto = undefined;
      ms.status = 'cleared';
    }
  }
  const st = ensureState(s, id);
  st.owner = null;
  st.boughtFor = undefined;
  receive(s, value, 'Property Sale', `Sold ${p.name}`);
  log(s, `Sold ${p.name} for ${money(value)}`, 'money');
  sfx('cash');
  emit('world');
  return { ok: true };
}

export function startDemolition(s: GameState, id: string): Check {
  const st = parcelState(s, id);
  const p = getParcel(id);
  if (!p) return { ok: false, reason: 'Unknown parcel' };
  if (st.owner !== 'player') return { ok: false, reason: 'Buy the property first' };
  if (st.status !== 'existing') return { ok: false, reason: 'Nothing to demolish' };
  const cost = demolitionCost(s, p);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}` };
  spend(s, cost, 'Demolition', `Demolition of ${p.name}`);
  const pid = newId(s, 'pr');
  const total = demolitionSeconds(p);
  s.projects[pid] = {
    id: pid, kind: 'demolish', parcelId: id, cityId: p.cityId,
    totalSeconds: total, doneSeconds: 0, cost, breakdown: { demolition: cost },
    startedAt: s.gameHours, workers: Math.round(6 + p.buildingArea / 400), speedSpent: 0,
  };
  const w = ensureState(s, id);
  w.status = 'demolishing';
  w.projectId = pid;
  log(s, `Demolition started at ${p.name}`, 'build');
  sfx('demolish');
  emit('world');
  return { ok: true };
}

export function finishDemolition(s: GameState, projectId: string) {
  const pr = s.projects[projectId];
  if (!pr) return;
  const st = ensureState(s, pr.parcelId);
  st.status = 'cleared';
  st.projectId = undefined;
  delete s.projects[projectId];
  stat(s, 'demolitions');
  addXp(s, ECONOMY.xp.demolish, 'Demolition');
  const p = getParcel(pr.parcelId)!;
  log(s, `${p.name} has been demolished — site cleared`, 'build');
  toast({ title: 'Demolition complete', body: `${p.name} is ready for construction.`, kind: 'good', icon: '🧱' });
  sfx('complete');
  emit('world');
}

export function consolidateQuote(s: GameState, zoneId: string): { ok: boolean; reason?: string; cost: number } {
  const z = getZone(zoneId);
  if (!z) return { ok: false, reason: 'Unknown zone', cost: 0 };
  const site = parcelState(s, z.siteId);
  if (site.owner === 'player') return { ok: false, reason: 'Already consolidated', cost: 0 };
  for (const pid of z.parcelIds) {
    const st = parcelState(s, pid);
    if (st.owner !== 'player') return { ok: false, reason: 'You must own every lot in the zone', cost: 0 };
    if (st.status !== 'cleared') return { ok: false, reason: 'All lots must be cleared (demolish buildings, no facilities)', cost: 0 };
  }
  const cost = Math.round(250_000 * cityById(z.cityId).constructionMult);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost };
  return { ok: true, cost };
}

export function consolidateZone(s: GameState, zoneId: string): Check {
  const q = consolidateQuote(s, zoneId);
  if (!q.ok) return q;
  const z = getZone(zoneId)!;
  spend(s, q.cost, 'Permits', `Re-zoning & lot consolidation: ${z.name}`);
  for (const pid of z.parcelIds) ensureState(s, pid).mergedInto = z.siteId;
  const site = ensureState(s, z.siteId);
  site.owner = 'player';
  site.status = 'cleared';
  site.boughtAt = s.gameHours;
  log(s, `Consolidated ${z.name} into a single ${Math.round(z.area / 1000)}k m² campus site`, 'build');
  toast({ title: 'Campus site created', body: 'You can now build mega-scale facilities here.', kind: 'good', icon: '🏗️' });
  sfx('complete');
  emit('world');
  return { ok: true };
}

/** Market license price after company strategy. */
export function licenseFee(s: GameState, cityId: string): number {
  const base = cityById(cityId).license;
  return base ? Math.round((base * (1 + eff(getEffects(s), 'licenseCost'))) / 1000) * 1000 : 0;
}

export function unlockCity(s: GameState, cityId: string): Check {
  const c = cityById(cityId);
  const fee = licenseFee(s, cityId);
  if (isCityUnlocked(s, cityId)) return { ok: false, reason: 'Already unlocked' };
  if (s.level < c.unlockLevel) return { ok: false, reason: `Requires company level ${c.unlockLevel}` };
  if (!canAfford(s, fee)) return { ok: false, reason: `Need ${money(fee)}` };
  if (fee > 0) spend(s, fee, 'Licenses', `Market entry license: ${c.name}`);
  s.unlockedCities.push(cityId);
  log(s, `Entered the ${c.name} market`, 'good');
  toast({ title: `${c.name} unlocked`, body: c.blurb, kind: 'good', icon: countryById(c.country).flag });
  sfx('unlock');
  emit('world');
  return { ok: true };
}

/** Engineering bonus + research applied to construction progress speed. */
export function constructionSpeed(s: GameState): number {
  return 1 + eff(getEffects(s), 'constructionSpeed') + deptBonus(s, 'engineering');
}
