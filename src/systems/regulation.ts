// Country rules, regional focus and the world events that bend them. These helpers are read from
// the derive step many times a second, so they stay cheap and allocate as little as possible.

import type { GameState } from '../core/state';
import { COUNTRY_RULES, CITY_NATURAL, citySpecById, specFee, SPEC_COOLDOWN_HOURS, type CapRates } from '../config/expansion';
import { cityById } from '../config/world';
import type { Effects } from '../config/research';

export interface CityMods {
  taxMult: number;
  permitCost: number;
  permitTime: number;
  pueLimit: number;
  carbonFee: number;
  privacyTier: number;
  govDemand: number;
  demandMult: number;
  powerMult: number;
  equipMult: number;
}

const inScope = (e: GameState['events'][number], cityId: string) => {
  if (e.cityId) return e.cityId === cityId;
  const c = cityById(cityId);
  if (e.country) return e.country === c.country;
  if (e.region) return e.region === c.region;
  return true;
};

/** Local conditions in a city: its country's rules plus any events in force there. */
export function cityMods(s: GameState, cityId: string): CityMods {
  const r = COUNTRY_RULES[cityById(cityId).country];
  const m: CityMods = {
    taxMult: r?.taxMult ?? 1, permitCost: r?.permitCost ?? 1, permitTime: r?.permitTime ?? 1, pueLimit: r?.pueLimit ?? 9, carbonFee: r?.carbonFee ?? 0,
    privacyTier: r?.privacyTier ?? 0, govDemand: r?.govDemand ?? 1, demandMult: 1, powerMult: 1, equipMult: 1,
  };
  for (const e of s.events) {
    if (!inScope(e, cityId)) continue;
    switch (e.defId) {
      case 'recession': m.demandMult *= 0.82; break;
      case 'trade_dispute': m.equipMult *= 1.15; break;
      case 'energy_crisis': m.powerMult *= 1.28; break;
      case 'infra_program': m.permitCost *= 0.75; m.permitTime *= 0.8; break;
      case 'gov_program': m.govDemand *= 3; break;
      case 'efficiency_law': m.pueLimit = Math.max(1.2, Math.min(m.pueLimit, 1.6) - 0.08); m.carbonFee = Math.max(0.08, m.carbonFee + 0.06); break;
      case 'tax_hike': m.taxMult *= 1.35; break;
      case 'tax_cut': m.taxMult *= 0.7; break;
    }
  }
  return m;
}

export interface SpecMods { rates: CapRates; contractRate: number; connectivity: number; opex: number; offerRate: number; draws: string[]; matched: boolean }
const NO_SPEC: SpecMods = { rates: { cpu: 0, gpu: 0, storage: 0 }, contractRate: 0, connectivity: 0, opex: 0, offerRate: 0, draws: [], matched: false };

/** The player's chosen focus for a city, strengthened by a natural match and company strategy. */
export function specMods(s: GameState, cityId: string, e: Effects): SpecMods {
  const pick = s.citySpec[cityId];
  const def = pick ? citySpecById(pick.spec) : undefined;
  if (!def) return NO_SPEC;
  const matched = CITY_NATURAL[cityId] === def.id;
  const k = (matched ? 1.5 : 1) * (1 + (e.specBoost ?? 0));
  // only the upside grows; the downside of a focus stays as it is
  const up = (v: number) => (v > 0 ? v * k : v);
  const cost = (v: number) => (v < 0 ? v * k : v);
  return {
    rates: { cpu: up(def.rates.cpu), gpu: up(def.rates.gpu), storage: up(def.rates.storage) },
    contractRate: up(def.contractRate), connectivity: cost(def.connectivity), opex: cost(def.opex), offerRate: up(def.offerRate), draws: def.draws, matched,
  };
}

export function specQuote(s: GameState, cityId: string, specId: string): { ok: boolean; reason?: string; cost: number } {
  const cost = specFee(cityId);
  const here = Object.values(s.facilities).some((f) => f.cityId === cityId && !f.isHQ);
  if (!here) return { ok: false, reason: `Build a data center in ${cityById(cityId).name} first`, cost };
  const cur = s.citySpec[cityId];
  if (cur?.spec === specId) return { ok: false, reason: 'Already this city\'s focus', cost };
  if (cur && s.gameHours - cur.since < SPEC_COOLDOWN_HOURS) return { ok: false, reason: `Can change again in ${Math.ceil((SPEC_COOLDOWN_HOURS - (s.gameHours - cur.since)) / 24)} days`, cost };
  if (s.cash < cost) return { ok: false, reason: `Need $${cost.toLocaleString()}`, cost };
  return { ok: true, cost };
}

