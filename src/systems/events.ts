// Random world events that change the economy for a while.

import type { GameState } from '../core/state';
import { newId } from '../core/state';
import { EVENT_DEFS } from '../config/content';
import { ECONOMY } from '../config/economy';
import { cityById, countryById, COUNTRIES, CITIES } from '../config/world';
import { SUPPLIERS, supplierById } from '../config/expansion';
import type { Derived } from './derive';
import type { ActiveEvent } from '../core/state';
import { pushNews } from './ledger';
import { announceShortage, techRelease } from './suppliers';
import { rand, randRange, pick, weightedPick } from '../core/rng';
import { log } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { getEffects, eff, deptBonus } from './modifiers';

const placeOf = (ev?: Partial<ActiveEvent>) => (ev?.country ? countryById(ev.country)?.name : ev?.region) ?? '';

export function eventText(defId: string, cityId?: string, ev?: Partial<ActiveEvent>): { title: string; desc: string; good: boolean } {
  const d = EVENT_DEFS.find((e) => e.id === defId)!;
  return { title: d.title, desc: d.desc.replace('{city}', cityId ? cityById(cityId).name : '').replace('{place}', placeOf(ev)).replace('{supplier}', ev?.supplier ? supplierById(ev.supplier)?.name ?? 'A major vendor' : 'A major vendor'), good: d.good };
}

export function tickEvents(s: GameState) {
  const before = s.events.length;
  if (before) {
    for (const e of s.events) if (e.endsAt <= s.gameHours && !e.cityId) pushNews(s, `${eventText(e.defId, undefined, e).title} is over${placeOf(e) ? ` in ${placeOf(e)}` : ''}`, undefined, 'info', 'Markets');
    s.events = s.events.filter((e) => e.endsAt > s.gameHours);
    if (s.events.length !== before) emit('world');
  }
  if (s.gameHours < s.nextEventAt) return;
  s.nextEventAt = s.gameHours + randRange(ECONOMY.eventIntervalHours[0], ECONOMY.eventIntervalHours[1]);
  if (s.gameHours < 36) return; // grace period at game start
  // incident reduction from monitoring research & security staff makes bad events rarer
  const e = getEffects(s);
  const safety = eff(e, 'incidents') + deptBonus(s, 'security') * 0.5;
  let def = weightedPick(EVENT_DEFS);
  if (!def.good && rand() < safety) def = weightedPick(EVENT_DEFS.filter((x) => x.good));
  if (s.events.some((x) => x.defId === def.id && def.scope === 'global')) return;
  // regional and national news mostly lands where you do business
  const myCities = Object.values(s.facilities).filter((f) => !f.isHQ).map((f) => cityById(f.cityId));
  const region = def.scope === 'region' ? (myCities.length && rand() < 0.65 ? pick(myCities).region : pick(CITIES).region) : undefined;
  const country = def.scope === 'country' ? (myCities.length && rand() < 0.65 ? pick(myCities).country : pick(COUNTRIES).id) : undefined;
  if ((region || country) && s.events.some((x) => x.defId === def.id && x.region === region && x.country === country)) return;
  const supplier = def.id === 'supply_crunch' ? pick(SUPPLIERS.filter((x) => x.cat === 'gpu' || x.cat === 'cpu' || x.cat === 'storage')).id : undefined;
  // prefer cities where the player operates so events matter
  const playerCities = [...new Set(Object.values(s.facilities).map((f) => f.cityId))];
  const cityId = def.scope === 'city' ? (playerCities.length && rand() < 0.7 ? pick(playerCities) : pick(s.unlockedCities)) : undefined;
  const hours = randRange(def.hours[0], def.hours[1]);
  const ev: ActiveEvent = { id: newId(s, 'ev'), defId: def.id, cityId, region, country, supplier, startedAt: s.gameHours, endsAt: s.gameHours + hours };
  s.events.push(ev);
  const t = eventText(def.id, cityId, ev);
  log(s, `${t.title}: ${t.desc}`, def.good ? 'good' : 'bad');
  pushNews(s, t.title, t.desc, def.good ? 'good' : 'bad', def.scope === 'city' ? 'Local' : def.scope === 'global' ? 'Global' : 'Markets');
  if (def.id === 'chip_breakthrough') techRelease(s);
  if (supplier) announceShortage(s, supplier);
  toast({ title: t.title, body: t.desc, kind: def.good ? 'good' : 'warn', icon: def.good ? '📣' : '⚠️' });
  sfx(def.good ? 'event_good' : 'event_bad');
  emit('world');
}

/** Daily headlines drawn from what's really happening in the market. */
export function tickHeadlines(s: GameState, d: Derived) {
  if (!s.newsState) return;
  const rank = 1 + s.competitors.filter((c) => c.valuation > d.totals.valuation).length;
  const prev = s.newsState.rank;
  if (prev && rank !== prev && d.totals.facilities > 0) {
    if (rank < prev) pushNews(s, `${s.company.name} climbs to #${rank} in the global rankings`, `Valuation ${Math.round(d.totals.valuation / 1e6)}M.`, 'good', 'Rankings');
    else pushNews(s, `${s.company.name} slips to #${rank} in the global rankings`, undefined, 'bad', 'Rankings');
  }
  s.newsState.rank = rank;
  for (const c of CITIES) {
    if (!s.unlockedCities.includes(c.id)) continue;
    const ratio = (d.citySupply[c.id] ?? 0) / Math.max(1, d.cityDemand[c.id] ?? 1);
    const last = s.newsState.sat[c.id] ?? -1e9;
    if (ratio > 1.05 && s.gameHours - last > 480) {
      s.newsState.sat[c.id] = s.gameHours;
      pushNews(s, `${c.name} is oversupplied: prices are sliding`, `Capacity is at ${Math.round(ratio * 100)}% of demand. Other markets pay better right now.`, 'info', 'Markets');
    }
  }
}
