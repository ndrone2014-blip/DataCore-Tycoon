// Developer testing tools. Each one changes the live game state through the same structures the
// simulation uses, so what you test is what really happens.

import type { Competitor, GameState } from '../core/state';
import { newId } from '../core/state';
import { BLUEPRINTS, blueprintById } from '../config/buildings';
import { CITIES, cityById } from '../config/world';
import { RESEARCH } from '../config/research';
import { xpForLevel } from '../config/economy';
import { EVENT_DEFS } from '../config/content';
import { getCityLayout } from '../world/parcels';
import { parcelState, finishDemolition } from './property';
import { finishBuild } from './construction';
import { autoEquip } from './equipment';
import { advance } from './sim';
import { ACHIEVEMENTS, STORY } from './progression';
import { addCompetitorSite } from './competitors';
import { startEvent } from './events';
import { DECISIONS } from './decisions';
import { generateOffer } from './contracts';
import { deriveAll } from './derive';
import { addXp, pushTx } from './ledger';
import { emit } from '../core/bus';

type R = { ok: boolean; reason?: string };
const OK: R = { ok: true };
const fail = (reason: string): R => ({ ok: false, reason });
const finite = (v: number) => typeof v === 'number' && isFinite(v);

// ---------- Economy ----------
export function adjustCash(s: GameState, amount: number): R {
  if (!finite(amount) || amount === 0) return fail('Enter an amount');
  s.cash += amount;
  pushTx(s, amount, 'Developer', amount > 0 ? 'Developer: money added' : 'Developer: money removed');
  emit('world');
  return OK;
}
export function setCash(s: GameState, amount: number): R {
  if (!finite(amount)) return fail('Enter an amount');
  return s.cash === amount ? OK : adjustCash(s, amount - s.cash);
}
export function clearDebt(s: GameState): R {
  s.debt = 0;
  emit('world');
  return OK;
}
export const PRICE_KEYS = [
  { id: 'land', label: 'Land prices' },
  { id: 'construction', label: 'Construction costs' },
  { id: 'equipment', label: 'Equipment prices' },
  { id: 'electricity', label: 'Electricity prices' },
  { id: 'sale', label: 'Compute selling prices' },
] as const;
export type PriceKey = (typeof PRICE_KEYS)[number]['id'];
export function setPriceMults(s: GameState, m: Partial<Record<PriceKey, number>>): R {
  const dev = (s.dev ??= {});
  for (const { id } of PRICE_KEYS) {
    const v = m[id];
    if (v === undefined) continue;
    if (!finite(v) || v < 0 || v > 1000) return fail('Multipliers must be between 0 and 1000');
    dev[id] = v;
  }
  emit('world');
  return OK;
}
export function resetPrices(s: GameState): R {
  if (s.dev) for (const { id } of PRICE_KEYS) delete s.dev[id];
  emit('world');
  return OK;
}

// ---------- World ----------
export function unlockAllCities(s: GameState): R {
  s.unlockedCities = CITIES.map((c) => c.id);
  emit('world');
  return OK;
}
export function setUnlockAll(s: GameState, on: boolean): R {
  (s.dev ??= {}).unlockAll = on;
  emit('world');
  return OK;
}
/** Hands over every lot nobody owns, in one city or the whole world. */
export function grantProperties(s: GameState, cityId?: string): { ok: boolean; reason?: string; count: number } {
  let count = 0;
  for (const c of CITIES) {
    if (cityId && c.id !== cityId) continue;
    if (!s.unlockedCities.includes(c.id)) s.unlockedCities.push(c.id);
    for (const p of getCityLayout(c.id).parcels) {
      const st = parcelState(s, p.id);
      if (st.owner) continue;
      s.parcels[p.id] = { ...st, owner: 'player', boughtFor: 0, boughtAt: s.gameHours };
      count++;
    }
  }
  emit('world');
  return { ok: true, count };
}

// ---------- Construction ----------
export function completeProject(s: GameState, id: string): R {
  const pr = s.projects[id];
  if (!pr) return fail('That project is no longer running');
  if (pr.kind === 'demolish') finishDemolition(s, id);
  else finishBuild(s, id);
  return OK;
}
export function completeAllProjects(s: GameState): { ok: boolean; count: number } {
  const ids = Object.keys(s.projects);
  for (const id of ids) completeProject(s, id);
  return { ok: true, count: ids.length };
}
export function spawnFacility(s: GameState, cityId: string, blueprintId: string, fill: boolean): { ok: boolean; reason?: string; id?: string } {
  const bp = blueprintById(blueprintId);
  const city = cityById(cityId);
  if (!bp || !city) return fail('Choose a city and a building');
  const lot = getCityLayout(cityId).parcels
    .filter((p) => p.area >= bp.minLot && !parcelState(s, p.id).owner)
    .sort((a, b) => a.area - b.area)[0];
  if (!lot) return fail(`${city.name} has no free lot of ${bp.minLot.toLocaleString()} m² or more. The Mega Campus needs a consolidated development zone.`);
  if (!s.unlockedCities.includes(cityId)) s.unlockedCities.push(cityId);
  const pid = newId(s, 'pr');
  s.parcels[lot.id] = { ...parcelState(s, lot.id), owner: 'player', status: 'construction', projectId: pid, boughtFor: 0, boughtAt: s.gameHours };
  s.projects[pid] = {
    id: pid, kind: 'build', parcelId: lot.id, cityId, totalSeconds: 1, doneSeconds: 1, cost: bp.cost, breakdown: {}, startedAt: s.gameHours, workers: 0, speedSpent: 0,
    draft: { name: `${bp.name} (dev)`, blueprintId: bp.id, slots: bp.slots, bays: bp.bays, power: bp.power, cooling: bp.cooling, floors: bp.floors, style: bp.style, color: s.company.color, footprint: bp.footprint },
  };
  const id = finishBuild(s, pid) ?? Object.values(s.facilities).find((f) => f.parcelId === lot.id)?.id;
  if (id && fill) autoEquip(s, id, Infinity, { free: true });
  return { ok: !!id, id };
}
export function removeFacility(s: GameState, id: string): R {
  const f = s.facilities[id];
  if (!f) return fail('That data center no longer exists');
  for (const c of s.contracts.active) if (c.facilityId === id) c.facilityId = undefined;
  for (const e of s.employees) if (e.assigned === id) e.assigned = 'hq';
  if (s.company.hqFacility === id) s.company.hqFacility = undefined;
  const st = s.parcels[f.parcelId];
  if (st) { st.status = 'cleared'; st.facilityId = undefined; }
  delete s.facilities[id];
  emit('world');
  return OK;
}
export function repairAll(s: GameState): R {
  for (const f of Object.values(s.facilities)) f.condition = 100;
  emit('world');
  return OK;
}

// ---------- Progression ----------
export function setLevel(s: GameState, level: number): R {
  if (!finite(level)) return fail('Enter a level');
  s.level = Math.max(1, Math.min(100, Math.round(level)));
  s.xp = xpForLevel(s.level);
  emit('world');
  return OK;
}
export function grantXp(s: GameState, xp: number): R {
  if (!finite(xp) || xp <= 0) return fail('Enter an amount of XP');
  addXp(s, xp);
  emit('world');
  return OK;
}
export function setReputation(s: GameState, rep: number): R {
  if (!finite(rep)) return fail('Enter a reputation');
  s.company.reputation = Math.max(0, Math.min(100, rep));
  emit('world');
  return OK;
}
export function unlockAllResearch(s: GameState): R {
  s.research.done = RESEARCH.map((r) => r.id);
  s.research.active = undefined;
  emit('world');
  return OK;
}
export function resetResearch(s: GameState): R {
  s.research = { done: [] };
  emit('world');
  return OK;
}
export function unlockAllAchievements(s: GameState): { ok: boolean; count: number } {
  let count = 0;
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] !== undefined) continue;
    s.achievements[a.id] = s.gameHours;
    for (const [k, v] of Object.entries(a.reward.perm ?? {})) s.permanent[k] = (s.permanent[k] ?? 0) + v;
    count++;
  }
  emit('world');
  return { ok: true, count };
}
export function resetAchievements(s: GameState): R {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] === undefined) continue;
    for (const [k, v] of Object.entries(a.reward.perm ?? {})) s.permanent[k] = (s.permanent[k] ?? 0) - v;
  }
  s.achievements = {};
  emit('world');
  return OK;
}
export function completeStory(s: GameState): R {
  s.missions.tutorial = STORY.length;
  return OK;
}

// ---------- Competitors ----------
export const RIVAL_TYPES: Record<string, { label: string; aggression: number; profitFocus: number; techFocus: number; frugality: number; desc: string }> = {
  aggressive: { label: 'Aggressive', aggression: 1.6, profitFocus: 0.7, techFocus: 0.7, frugality: 0.7, desc: 'Expands at any cost.' },
  technology: { label: 'Technology', aggression: 1, profitFocus: 0.8, techFocus: 1.8, frugality: 0.8, desc: 'Research first.' },
  conservative: { label: 'Conservative', aggression: 0.8, profitFocus: 1.6, techFocus: 0.9, frugality: 1, desc: 'Profit first.' },
  budget: { label: 'Budget', aggression: 1.1, profitFocus: 1.2, techFocus: 0.6, frugality: 1.7, desc: 'Lowest cost per rack.' },
};
const RIVAL_COLORS = ['#fb7185', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#818cf8', '#2dd4bf', '#facc15'];
const RIVAL_LOGOS = ['⬟', '◐', '✧', '❂', '▣', '⬣', '✶', '◍'];

export function spawnCompetitor(s: GameState, name: string, type: string, cash: number, sites: number): { ok: boolean; reason?: string; id?: string } {
  const t = RIVAL_TYPES[type];
  const clean = name.trim().slice(0, 28);
  if (!clean) return fail('Give the company a name');
  if (!t) return fail('Choose a strategy');
  if (!finite(cash) || cash < 0) return fail('Starting cash must be 0 or more');
  if (s.competitors.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return fail('A company already has that name');
  const id = newId(s, 'co');
  const n = s.idCounter;
  const c: Competitor = {
    id, name: clean, color: RIVAL_COLORS[n % RIVAL_COLORS.length], logo: RIVAL_LOGOS[n % RIVAL_LOGOS.length], personality: type,
    aggression: t.aggression, profitFocus: t.profitFocus, techFocus: t.techFocus, frugality: t.frugality,
    cash, techLevel: 0, research: 0, sites: [], revenueHr: 0, expenseHr: 0, valuation: cash, history: [], contractsWon: 0,
    nextThink: s.gameHours + 1, desc: t.desc, lastAction: 'Founded by a developer',
  };
  s.competitors.push(c);
  const options = s.unlockedCities.slice();
  for (let i = 0; i < Math.max(0, Math.min(10, Math.round(sites))); i++) addCompetitorSite(s, c, options[i % options.length]);
  emit('world');
  return { ok: true, id };
}
export function updateCompetitor(s: GameState, id: string, ch: { addCash?: number; tech?: number; aggression?: number }): R {
  const c = s.competitors.find((x) => x.id === id);
  if (!c) return fail('That company no longer exists');
  if (ch.addCash !== undefined && finite(ch.addCash)) c.cash += ch.addCash;
  if (ch.tech !== undefined && finite(ch.tech)) c.techLevel = Math.max(0, Math.min(8, Math.round(ch.tech)));
  if (ch.aggression !== undefined && finite(ch.aggression)) c.aggression = Math.max(0.1, Math.min(5, ch.aggression));
  emit('world');
  return OK;
}
export function removeCompetitor(s: GameState, id: string): R {
  const c = s.competitors.find((x) => x.id === id);
  if (!c) return fail('That company no longer exists');
  for (const ps of Object.values(s.parcels)) {
    if (ps.owner !== id) continue;
    ps.owner = null;
    ps.status = 'cleared';
    ps.facilityId = undefined;
    ps.projectId = undefined;
  }
  s.fiber.routes = s.fiber.routes.filter((r) => r.owner !== id);
  delete s.dealCooldown[id];
  s.competitors = s.competitors.filter((x) => x.id !== id);
  emit('world');
  return OK;
}

// ---------- Time ----------
export const DEV_SPEEDS = [1, 2, 4, 10, 25, 50];
export function setSpeed(s: GameState, speed: number): R {
  if (!DEV_SPEEDS.includes(speed)) return fail('Unknown speed');
  s.speed = speed;
  s.paused = false;
  return OK;
}
export function skipTime(s: GameState, hours: number): R {
  if (!finite(hours) || hours <= 0) return fail('Enter a number of hours');
  if (hours > 8760) return fail('Skip at most one game year (8,760 hours) at a time');
  advance(s, hours);
  emit('world');
  return OK;
}

// ---------- Events ----------
export function triggerEvent(s: GameState, defId: string, place?: string): R {
  const def = EVENT_DEFS.find((e) => e.id === defId);
  if (!def) return fail('Unknown event');
  return startEvent(s, def, place);
}
export function endAllEvents(s: GameState): R {
  s.events = [];
  emit('world');
  return OK;
}
export function triggerDecision(s: GameState, defId: string): R {
  const def = DECISIONS.find((x) => x.id === defId);
  if (!def) return fail('Unknown card');
  const data = def.setup(s, deriveAll(s));
  if (!data) return fail(`"${def.title}" does not apply to your company right now`);
  s.decision = { id: newId(s, 'op'), defId, expiresAt: s.gameHours + 72, data };
  emit('decision');
  return OK;
}
export function addContractOffer(s: GameState): R {
  s.contracts.offers.push(generateOffer(s, deriveAll(s)));
  emit('offer');
  return OK;
}

export const blueprintList = () => BLUEPRINTS;
