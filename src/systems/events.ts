// Random world events that change the economy for a while.

import type { GameState } from '../core/state';
import { newId } from '../core/state';
import { EVENT_DEFS } from '../config/content';
import { ECONOMY } from '../config/economy';
import { cityById } from '../config/world';
import { rand, randRange, pick, weightedPick } from '../core/rng';
import { log } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { getEffects, eff, deptBonus } from './modifiers';

export function eventText(defId: string, cityId?: string): { title: string; desc: string; good: boolean } {
  const d = EVENT_DEFS.find((e) => e.id === defId)!;
  return { title: d.title, desc: d.desc.replace('{city}', cityId ? cityById(cityId).name : ''), good: d.good };
}

export function tickEvents(s: GameState) {
  const before = s.events.length;
  s.events = s.events.filter((e) => e.endsAt > s.gameHours);
  if (s.events.length !== before) emit('world');
  if (s.gameHours < s.nextEventAt) return;
  s.nextEventAt = s.gameHours + randRange(ECONOMY.eventIntervalHours[0], ECONOMY.eventIntervalHours[1]);
  if (s.gameHours < 36) return; // grace period at game start
  // incident reduction from monitoring research & security staff makes bad events rarer
  const e = getEffects(s);
  const safety = eff(e, 'incidents') + deptBonus(s, 'security') * 0.5;
  let def = weightedPick(EVENT_DEFS);
  if (!def.good && rand() < safety) def = weightedPick(EVENT_DEFS.filter((x) => x.good));
  if (s.events.some((x) => x.defId === def.id && def.scope === 'global')) return;
  // prefer cities where the player operates so events matter
  const playerCities = [...new Set(Object.values(s.facilities).map((f) => f.cityId))];
  const cityId = def.scope === 'city' ? (playerCities.length && rand() < 0.7 ? pick(playerCities) : pick(s.unlockedCities)) : undefined;
  const hours = randRange(def.hours[0], def.hours[1]);
  s.events.push({ id: newId(s, 'ev'), defId: def.id, cityId, startedAt: s.gameHours, endsAt: s.gameHours + hours });
  const t = eventText(def.id, cityId);
  log(s, `${t.title}: ${t.desc}`, def.good ? 'good' : 'bad');
  toast({ title: t.title, body: t.desc, kind: def.good ? 'good' : 'warn', icon: def.good ? '📣' : '⚠️' });
  sfx(def.good ? 'event_good' : 'event_bad');
  emit('world');
}
