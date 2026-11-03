// Aggregated modifiers from research, permanent bonuses, staff and events.

import type { GameState } from '../core/state';
import { researchById, type Effects, type EffectKey } from '../config/research';
import { DEPARTMENTS, type Department } from '../config/content';
import { cityById } from '../config/world';
import { POLICIES } from '../config/expansion';
import { cityMods } from './regulation';

const POLICY_FX = new Map(POLICIES.flatMap((p) => p.options.map((o) => [`${p.id}:${o.id}`, o.effects] as const)));

export function getEffects(s: GameState): Effects {
  const e: Effects = {};
  const add = (k: EffectKey, v: number) => (e[k] = (e[k] ?? 0) + v);
  for (const id of s.research.done) {
    const r = researchById(id);
    if (!r) continue;
    for (const [k, v] of Object.entries(r.effects)) add(k as EffectKey, v as number);
  }
  for (const [k, v] of Object.entries(s.permanent)) add(k as EffectKey, v);
  for (const b of s.buffs ?? []) if (b.key !== 'equipDiscount' && b.endsAt > s.gameHours) add(b.key as EffectKey, b.value);
  for (const pid in s.policies) {
    const fx = POLICY_FX.get(`${pid}:${s.policies[pid]}`);
    if (fx) for (const k in fx) add(k as EffectKey, fx[k as EffectKey] as number);
  }
  return e;
}

export const eff = (e: Effects, k: EffectKey) => e[k] ?? 0;

/** Staff effectiveness for a department; facility-assigned staff count double there. */
export function deptPower(s: GameState, dept: Department, facilityId?: string): number {
  let E = 0;
  for (const emp of s.employees) {
    if (emp.dept !== dept) continue;
    const base = emp.skill * (0.6 + 0.4 * (emp.perf / 100)) * (1 + Math.min(1, emp.exp / 400));
    if (emp.assigned === 'hq') E += base;
    else if (facilityId && emp.assigned === facilityId) E += base * 2;
    else E += base * 0.25; // staff at other sites help a little company-wide
  }
  return E;
}

export function deptBonus(s: GameState, dept: Department, facilityId?: string): number {
  const d = DEPARTMENTS[dept];
  const E = deptPower(s, dept, facilityId);
  return d.maxBonus * (1 - Math.exp(-E / d.k));
}

export function activeEvent(s: GameState, defId: string, cityId?: string): boolean {
  return s.events.some((ev) => ev.defId === defId && (cityId === undefined || ev.cityId === undefined || ev.cityId === cityId));
}

export function powerPrice(s: GameState, cityId: string): number {
  const c = cityById(cityId);
  return c.powerPrice * (s.events.some((e) => e.defId === 'energy_spike' && e.cityId === cityId) ? 1.3 : 1) * cityMods(s, cityId).powerMult;
}

export function equipPriceMult(s: GameState, e: Effects, kind: 'server' | 'infra', cityId?: string): number {
  let m = 1 - eff(e, 'equipCost');
  if (kind === 'server' && s.events.some((x) => x.defId === 'gpu_shortage')) m *= 1.2;
  if (kind === 'server' && s.events.some((x) => x.defId === 'chip_breakthrough')) m *= 0.9;
  if (cityId) m *= cityMods(s, cityId).equipMult;
  for (const b of s.buffs ?? []) if (b.key === 'equipDiscount' && b.endsAt > s.gameHours) m *= 1 - b.value;
  if (s.events.some((x) => x.defId === 'chip_sale')) m *= 0.8;
  return m;
}

export function constructionMult(s: GameState, cityId: string, e: Effects): number {
  let m = cityById(cityId).constructionMult * (1 - eff(e, 'buildCost'));
  if (s.events.some((x) => x.defId === 'tax_break' && x.cityId === cityId)) m *= 0.8;
  m *= cityMods(s, cityId).permitCost;
  return m;
}

export function offlineCapHours(s: GameState, e: Effects, hqBonus: number): number {
  return s.offline.capHours + eff(e, 'offlineHours') + hqBonus;
}
