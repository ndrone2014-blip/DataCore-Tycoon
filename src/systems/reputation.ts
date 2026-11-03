// Company reputation: measured from how the business actually runs, and felt in customers,
// contracts, supplier prices and valuation.

import type { GameState } from '../core/state';
import type { Derived } from './derive';
import { cityMods } from './regulation';
import { eff } from './modifiers';

export const REP_WEIGHTS = [
  { id: 'service', label: 'Customer service', weight: 0.28, hint: 'How much of the promised capacity your customers actually receive.' },
  { id: 'track', label: 'Contract record', weight: 0.2, hint: 'Contracts completed versus contracts lost to SLA breaches.' },
  { id: 'uptime', label: 'Facility uptime', weight: 0.2, hint: 'Power, cooling and network keeping your racks at full performance.' },
  { id: 'quality', label: 'Infrastructure quality', weight: 0.12, hint: 'The condition of your buildings.' },
  { id: 'network', label: 'Network performance', weight: 0.1, hint: 'Fiber connectivity in the cities you operate in.' },
  { id: 'compliance', label: 'Regulatory compliance', weight: 0.1, hint: 'Facilities meeting local efficiency limits.' },
] as const;

export function repParts(s: GameState, d: Derived): Record<string, number> {
  const fac = Object.values(s.facilities).filter((f) => !f.isHQ);
  const active = s.contracts.active;
  const service = active.length ? (active.reduce((a, c) => a + Math.min(1, c.fulfillment / Math.max(0.01, c.sla)), 0) / active.length) * 100 : 62;
  const done = s.stats.contractsCompleted ?? 0, lost = s.stats.contractsBreached ?? 0;
  const track = 50 + (50 * (done - 2.5 * lost)) / (done + 2.5 * lost + 6);
  let capSum = 0, perfSum = 0, cond = 0, netSum = 0, comply = 0;
  for (const f of fac) {
    const st = d.fac[f.id];
    if (!st) continue;
    const w = Math.max(1, st.servers);
    capSum += w;
    perfSum += w * Math.min(1, st.perf);
    cond += f.condition;
    netSum += d.net.city[f.cityId]?.score ?? 0;
    if (st.pue <= cityMods(s, f.cityId).pueLimit) comply++;
  }
  const n = Math.max(1, fac.length);
  return {
    service, track,
    uptime: capSum ? (perfSum / capSum) * 100 : 62,
    quality: fac.length ? cond / n : 62,
    network: fac.length ? 42 + (netSum / n) * 58 : 50,
    compliance: fac.length ? (comply / n) * 100 : 80,
  };
}

export function repTarget(s: GameState, d: Derived, parts = repParts(s, d)): number {
  let t = 0;
  for (const w of REP_WEIGHTS) t += w.weight * parts[w.id];
  return Math.max(0, Math.min(100, t + eff(d.effects, 'repBase')));
}

/** Runs once per game hour. Reputation drifts toward what you've earned. */
export function tickReputation(s: GameState, d: Derived, hours: number, newDay: boolean) {
  if (!s.rep) return;
  const parts = repParts(s, d);
  s.rep.parts = parts;
  if (d.totals.facilities > 0) {
    const t = repTarget(s, d, parts);
    s.company.reputation += (t - s.company.reputation) * (1 - Math.pow(1 - 0.012, hours));
  }
  if (newDay || !s.rep.history.length) {
    s.rep.history.push(Math.round(s.company.reputation * 10) / 10);
    if (s.rep.history.length > 180) s.rep.history.splice(0, s.rep.history.length - 180);
  }
}

/** Offer flow: 0.7× at reputation 0, 1× at 50, 1.3× at 100. */
export const repOfferMult = (rep: number) => 0.7 + rep * 0.006;
/** Earnings multiple on valuation: 0.85× at 0, 1× at 50, 1.15× at 100. */
export const repValuationMult = (rep: number) => 0.85 + rep * 0.003;
export const REP_REQ: Partial<Record<string, number>> = { government: 55, tech: 35 };
