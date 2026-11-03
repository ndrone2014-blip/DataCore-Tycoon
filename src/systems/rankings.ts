// Worldwide leaderboards, built on demand from the live simulation.

import type { GameState } from '../core/state';
import type { Derived } from './derive';
import { ECONOMY } from '../config/economy';
import { CITIES } from '../config/world';

export interface CompanyRow {
  id: string; name: string; color: string; logo: string; me: boolean;
  valuation: number; revenue: number; profit: number; facilities: number; compute: number; gpu: number; share: number; coverage: number; customers: number; reputation: number; employees: number;
}

export const RANK_METRICS = [
  { id: 'valuation', label: 'Company valuation', fmt: 'money' },
  { id: 'revenue', label: 'Annual revenue', fmt: 'money' },
  { id: 'profit', label: 'Annual profit', fmt: 'money' },
  { id: 'facilities', label: 'Data centers', fmt: 'num' },
  { id: 'compute', label: 'Computing capacity (CU)', fmt: 'num' },
  { id: 'gpu', label: 'AI capacity (PFLOPS)', fmt: 'num' },
  { id: 'share', label: 'Global market share', fmt: 'pct' },
  { id: 'coverage', label: 'Network coverage (cities)', fmt: 'num' },
  { id: 'customers', label: 'Customers served', fmt: 'num' },
  { id: 'reputation', label: 'Reputation', fmt: 'num' },
] as const;
export type RankMetric = (typeof RANK_METRICS)[number]['id'];

const HOURS_PER_YEAR = 8760;
const rivalReputation = (techFocus: number, profitFocus: number, frugality: number, won: number) => Math.max(20, Math.min(92, 42 + techFocus * 9 + profitFocus * 6 - frugality * 4 + Math.min(18, won / 3)));

export function companyRows(s: GameState, d: Derived): CompanyRow[] {
  const rivalCU = s.competitors.map((c) => c.sites.reduce((a, x) => a + (x.stage === 'operational' ? x.cu : 0), 0));
  const totalCU = Math.max(1, d.totals.cu + rivalCU.reduce((a, b) => a + b, 0));
  const me: CompanyRow = {
    id: 'player', name: s.company.name, color: s.company.color, logo: s.company.logo, me: true,
    valuation: d.totals.valuation, revenue: d.totals.revenueHr * HOURS_PER_YEAR, profit: d.totals.profitHr * HOURS_PER_YEAR, facilities: d.totals.facilities, compute: d.totals.cu, gpu: d.totals.delivered.gpu,
    share: d.totals.cu / totalCU, coverage: d.net.coverage.player ?? 0, customers: s.contracts.active.length + (s.stats.contractsCompleted ?? 0), reputation: s.company.reputation, employees: s.employees.length,
  };
  const rows = s.competitors.map((c, i) => {
    const gpuShare = Math.min(0.75, 0.3 + c.techFocus * 0.2);
    const fac = c.sites.filter((x) => x.stage === 'operational').length;
    return {
      id: c.id, name: c.name, color: c.color, logo: c.logo, me: false,
      valuation: c.valuation, revenue: c.revenueHr * HOURS_PER_YEAR, profit: (c.revenueHr - c.expenseHr) * HOURS_PER_YEAR, facilities: fac, compute: rivalCU[i], gpu: (rivalCU[i] * gpuShare) / ECONOMY.cuPerUnit.gpu,
      share: rivalCU[i] / totalCU, coverage: d.net.coverage[c.id] ?? 0, customers: c.contractsWon + fac * 2, reputation: rivalReputation(c.techFocus, c.profitFocus, c.frugality, c.contractsWon), employees: Math.round(fac * 14 + rivalCU[i] / 400),
    };
  });
  return [me, ...rows];
}

export function ranked(rows: CompanyRow[], metric: RankMetric): CompanyRow[] {
  return [...rows].sort((a, b) => (b[metric] as number) - (a[metric] as number));
}

/** Compute held by each company in one market, biggest first. */
export function cityBoard(s: GameState, d: Derived, cityId: string) {
  const out: { id: string; name: string; color: string; cu: number; me: boolean }[] = [];
  if ((d.playerCU[cityId] ?? 0) > 0) out.push({ id: 'player', name: s.company.name, color: s.company.color, cu: d.playerCU[cityId], me: true });
  for (const c of s.competitors) {
    const cu = c.sites.reduce((a, x) => a + (x.cityId === cityId && x.stage === 'operational' ? x.cu : 0), 0);
    if (cu > 0) out.push({ id: c.id, name: c.name, color: c.color, cu, me: false });
  }
  return out.sort((a, b) => b.cu - a.cu);
}

export function countryBoard(s: GameState, d: Derived, countryId: string) {
  const total: Record<string, { id: string; name: string; color: string; cu: number; me: boolean }> = {};
  for (const c of CITIES) {
    if (c.country !== countryId) continue;
    for (const r of cityBoard(s, d, c.id)) (total[r.id] ??= { ...r, cu: 0 }).cu += r.cu;
  }
  return Object.values(total).sort((a, b) => b.cu - a.cu);
}
