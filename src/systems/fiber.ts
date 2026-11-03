// Fiber network: routes between cities that earn transit income and give the markets they touch
// cheaper connectivity and better prices. Rivals build routes on the same links and split the income.

import type { Competitor, FiberRoute, GameState } from '../core/state';
import { newId } from '../core/state';
import { FIBER_KIND, FIBER_LINKS, FIBER_PAYBACK_HOURS, FIBER_UPKEEP_PER_HOUR, HUB_LEVELS, MAX_FIBER_TIER, fiberLink, type FiberLink } from '../config/expansion';
import { cityById } from '../config/world';
import { canAfford, log, pushNews, spend, stat } from './ledger';
import { emit, sfx, toast } from '../core/bus';
import { money } from '../core/format';
import type { Effects } from '../config/research';
import { getEffects } from './modifiers';

export interface CityNet { links: number; hub: number; intl: number; score: number; connectCut: number; spotBonus: number; contractBonus: number }
export interface NetStats { city: Record<string, CityNet>; transitHr: number; upkeepHr: number; value: number; byRoute: Record<string, number>; rivalTransit: Record<string, number>; coverage: Record<string, number> }

const routeCost = (l: FiberLink, tier: number, e: Effects) => Math.round(l.km * FIBER_KIND[l.kind].perKm * (tier === 1 ? 1 : tier === 2 ? 0.5 : 0.75) * (1 + (e.fiberCost ?? 0)) / 1000) * 1000;
const tierWeight = (t: number) => (t <= 1 ? 1 : t === 2 ? 1.6 : 2.3);
const baseCost = (l: FiberLink) => l.km * FIBER_KIND[l.kind].perKm;

const cache = new WeakMap<GameState, { key: string; net: NetStats }>();
/** Only finished routes count. The result is cached until the network changes. */
export function netStats(s: GameState): NetStats {
  let key = '';
  for (const r of s.fiber.routes) key += r.doneAt <= s.gameHours ? `${r.id}${r.tier}${r.owner};` : '';
  for (const c in s.fiber.hubs) key += `${c}${s.fiber.hubs[c]},`;
  const had = cache.get(s);
  if (had?.key === key) return had.net;
  const net: NetStats = { city: {}, transitHr: 0, upkeepHr: 0, value: 0, byRoute: {}, rivalTransit: {}, coverage: {} };
  const byLink: Record<string, FiberRoute[]> = {};
  for (const r of s.fiber.routes) if (r.doneAt <= s.gameHours) (byLink[r.link] ??= []).push(r);
  const touch: Record<string, Set<string>> = {};
  for (const [lid, routes] of Object.entries(byLink)) {
    const l = fiberLink(lid);
    if (!l) continue;
    const total = routes.reduce((a, r) => a + tierWeight(r.tier), 0);
    const pool = (baseCost(l) / FIBER_PAYBACK_HOURS) * (1 + 0.45 * (routes.length - 1)); // competition grows the market a little and splits it a lot
    for (const r of routes) {
      const hubK = 1 + 0.15 * ((s.fiber.hubs[l.a] ?? 0) + (s.fiber.hubs[l.b] ?? 0));
      const netHub = r.owner === 'player' ? hubK : 1;
      const income = pool * tierWeight(r.tier) * (tierWeight(r.tier) / total) * netHub;
      if (r.owner === 'player') {
        net.byRoute[r.id] = income;
        net.transitHr += income;
        net.upkeepHr += r.invested * FIBER_UPKEEP_PER_HOUR;
        net.value += r.invested * 0.6;
        for (const c of [l.a, l.b]) {
          const q = (net.city[c] ??= { links: 0, hub: 0, intl: 0, score: 0, connectCut: 0, spotBonus: 0, contractBonus: 0 });
          q.links++;
          if (l.kind === 'undersea' || cityById(l.a).country !== cityById(l.b).country) q.intl++;
        }
      } else net.rivalTransit[r.owner] = (net.rivalTransit[r.owner] ?? 0) + income;
      (touch[r.owner] ??= new Set()).add(l.a).add(l.b);
    }
  }
  for (const o in touch) net.coverage[o] = touch[o].size;
  for (const [c, lvl] of Object.entries(s.fiber.hubs)) {
    net.city[c] ??= { links: 0, hub: 0, intl: 0, score: 0, connectCut: 0, spotBonus: 0, contractBonus: 0 };
    net.city[c].hub = lvl;
    net.upkeepHr += (HUB_LEVELS[lvl - 1]?.cost ?? 0) * FIBER_UPKEEP_PER_HOUR;
    net.value += (HUB_LEVELS[lvl - 1]?.cost ?? 0) * 0.6;
  }
  for (const [cid, q] of Object.entries(net.city)) {
    q.score = Math.min(1, q.links * 0.24 + q.intl * 0.16 + q.hub * 0.2);
    q.connectCut = 0.55 * q.score;
    q.spotBonus = 0.08 * q.score;
    q.contractBonus = 0.12 * q.score;
  }
  cache.set(s, { key, net });
  return net;
}

export function linkStatus(s: GameState, l: FiberLink) {
  const mine = s.fiber.routes.find((r) => r.link === l.id && r.owner === 'player');
  const rivals = s.fiber.routes.filter((r) => r.link === l.id && r.owner !== 'player');
  return { mine, rivals, building: !!mine && mine.doneAt > s.gameHours };
}

export function routeQuote(s: GameState, linkId: string): { ok: boolean; reason?: string; cost: number; hours: number; tier: number } {
  const l = fiberLink(linkId);
  if (!l) return { ok: false, reason: 'Unknown route', cost: 0, hours: 0, tier: 1 };
  const e = getEffects(s);
  const { mine } = linkStatus(s, l);
  const tier = mine ? mine.tier + 1 : 1;
  const cost = routeCost(l, tier, e);
  const hours = Math.round(l.km * FIBER_KIND[l.kind].hoursPerKm * (tier === 1 ? 1 : 0.5)) + 20;
  if (mine && mine.doneAt > s.gameHours) return { ok: false, reason: 'Construction in progress', cost, hours, tier };
  if (tier > MAX_FIBER_TIER) return { ok: false, reason: 'Maximum capacity reached', cost, hours, tier };
  const need = FIBER_KIND[l.kind].level;
  if (s.level < need) return { ok: false, reason: `Requires level ${need}`, cost, hours, tier };
  for (const c of [l.a, l.b]) if (!s.unlockedCities.includes(c)) return { ok: false, reason: `Unlock ${cityById(c).name} first`, cost, hours, tier };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost, hours, tier };
  return { ok: true, cost, hours, tier };
}

export function buildRoute(s: GameState, linkId: string): { ok: boolean; reason?: string } {
  const q = routeQuote(s, linkId);
  if (!q.ok) return q;
  const l = fiberLink(linkId)!;
  const name = `${cityById(l.a).name} ⇄ ${cityById(l.b).name}`;
  spend(s, q.cost, 'Network', `${q.tier > 1 ? `Capacity upgrade (tier ${q.tier})` : FIBER_KIND[l.kind].label}: ${name}`);
  const { mine } = linkStatus(s, l);
  if (mine) {
    mine.tier = q.tier;
    mine.invested += q.cost;
    mine.doneAt = s.gameHours + q.hours;
  } else {
    s.fiber.routes.push({ id: newId(s, 'fb'), link: l.id, owner: 'player', tier: 1, startedAt: s.gameHours, doneAt: s.gameHours + q.hours, invested: q.cost });
  }
  stat(s, 'fiberBuilt');
  log(s, `Started ${FIBER_KIND[l.kind].label.toLowerCase()} ${name}`, 'build');
  sfx('build');
  emit('world');
  return { ok: true };
}

export function hubQuote(s: GameState, cityId: string): { ok: boolean; reason?: string; cost: number; next?: (typeof HUB_LEVELS)[number] } {
  const next = HUB_LEVELS[s.fiber.hubs[cityId] ?? 0];
  if (!next) return { ok: false, reason: 'Fully developed', cost: 0 };
  const cost = Math.round(next.cost * cityById(cityId).constructionMult);
  if (s.level < next.level_req) return { ok: false, reason: `Requires level ${next.level_req}`, cost, next };
  if (!s.unlockedCities.includes(cityId)) return { ok: false, reason: 'Unlock this market first', cost, next };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost, next };
  return { ok: true, cost, next };
}

export function buildHub(s: GameState, cityId: string): { ok: boolean; reason?: string } {
  const q = hubQuote(s, cityId);
  if (!q.ok || !q.next) return q;
  spend(s, q.cost, 'Network', `${q.next.name} in ${cityById(cityId).name}`);
  s.fiber.hubs[cityId] = q.next.level;
  log(s, `Opened a ${q.next.name.toLowerCase()} in ${cityById(cityId).name}`, 'good');
  sfx('unlock');
  emit('world');
  return { ok: true };
}

/** Announces finished routes. Income starts automatically once a route's doneAt has passed. */
export function tickFiber(s: GameState, prevHours: number) {
  for (const r of s.fiber.routes) {
    if (r.doneAt > s.gameHours || r.doneAt <= prevHours) continue;
    const l = fiberLink(r.link);
    if (!l) continue;
    const name = `${cityById(l.a).name} ⇄ ${cityById(l.b).name}`;
    if (r.owner === 'player') {
      log(s, `${name} is lit and carrying traffic`, 'good');
      toast({ title: 'Fiber route online', body: name, kind: 'good', icon: '🌐' });
      sfx('complete');
      pushNews(s, `${s.company.name} lights new ${FIBER_KIND[l.kind].label.toLowerCase()}`, name, 'good', 'Network');
      stat(s, 'fiberOnline');
    }
    emit('world');
  }
}

/** A rival may lay fiber between markets it already serves. */
export function rivalFiber(s: GameState, c: Competitor) {
  const cities = new Set(c.sites.map((x) => x.cityId));
  const options = FIBER_LINKS.filter((l) => (cities.has(l.a) || cities.has(l.b)) && !s.fiber.routes.some((r) => r.link === l.id && r.owner === c.id) && (l.kind !== 'undersea' || s.gameHours > 900));
  if (!options.length) return;
  const l = options[Math.floor(Math.random() * options.length)];
  const cost = baseCost(l);
  if (c.cash < cost * 3) return;
  c.cash -= cost;
  const hours = Math.round(l.km * FIBER_KIND[l.kind].hoursPerKm) + 20;
  s.fiber.routes.push({ id: newId(s, 'fb'), link: l.id, owner: c.id, tier: 1, startedAt: s.gameHours, doneAt: s.gameHours + hours, invested: cost });
  c.lastAction = `Laying fiber ${cityById(l.a).name} ⇄ ${cityById(l.b).name}`;
  log(s, `${c.name} is laying fiber between ${cityById(l.a).name} and ${cityById(l.b).name}`, 'comp');
  emit('world');
}

/** Great-circle lines for the maps. */
export function fiberGeo(s: GameState) {
  const features: any[] = [];
  const colors: Record<string, string> = { player: s.company.color };
  for (const c of s.competitors) colors[c.id] = c.color;
  for (const r of s.fiber.routes) {
    const l = fiberLink(r.link);
    if (!l) continue;
    features.push({
      type: 'Feature',
      properties: { id: r.id, color: colors[r.owner] ?? '#64748b', mine: r.owner === 'player', live: r.doneAt <= s.gameHours, width: r.owner === 'player' ? 1.2 + r.tier * 0.7 : 1 },
      geometry: { type: 'LineString', coordinates: arc(cityById(l.a).center, cityById(l.b).center) },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

export function arc(a: [number, number], b: [number, number], n = 28): [number, number][] {
  const r = Math.PI / 180;
  const la1 = a[1] * r, lo1 = a[0] * r, la2 = b[1] * r, lo2 = b[0] * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 1e-6) return [a, b];
  const pts: [number, number][] = [];
  let prev: number | null = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lng = Math.atan2(y, x) / r;
    // keep lines continuous across the date line
    if (prev !== null) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
    prev = lng;
    pts.push([lng, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]);
  }
  return pts;
}
