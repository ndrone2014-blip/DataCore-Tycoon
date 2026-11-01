// Achievements, story missions and daily missions.

import type { GameState, Mission } from '../core/state';
import type { Derived } from './derive';
import { receive, addXp, log } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { RESEARCH } from '../config/research';
import { getZone } from '../world/parcels';
import { money } from '../core/format';
import { randInt, pick } from '../core/rng';

type Metric = (s: GameState, d: Derived) => number;

export const METRICS: Record<string, Metric> = {
  properties: (s) => s.stats.propertiesBought ?? 0,
  ownedNow: (_s, d) => d.totals.properties,
  demolitions: (s) => s.stats.demolitions ?? 0,
  builds: (s) => s.stats.buildsCompleted ?? 0,
  servers: (s) => s.stats.serversInstalled ?? 0,
  infra: (s) => Object.values(s.facilities).reduce((a, f) => a + ['cooling_air', 'cooling_adv', 'liquid', 'pdu', 'substation', 'generator', 'generator_x', 'security'].reduce((b, k) => b + (f.equipment[k] ?? 0), 0), 0),
  contractsSigned: (s) => s.stats.contractsSigned ?? 0,
  contractsCompleted: (s) => s.stats.contractsCompleted ?? 0,
  employees: (s) => s.employees.length,
  research: (s) => s.research.done.length,
  profitHr: (_s, d) => d.totals.profitHr,
  revenueHr: (_s, d) => d.totals.revenueHr,
  valuation: (_s, d) => d.totals.valuation,
  hq: (s) => (s.company.hqFacility ? 1 : 0),
  level: (s) => s.level,
  cities: (_s, d) => d.totals.cities,
  countries: (_s, d) => d.totals.countries,
  zones: (s) => s.stats.zonesBought ?? 0,
  gpu: (_s, d) => d.totals.delivered.gpu,
  facilities: (_s, d) => d.totals.facilities,
  hyperscale: (s) => (s.stats.built_hyperscale ?? 0) + (s.stats.built_ai_center ?? 0) + (s.stats.built_supercomputer ?? 0) + (s.stats.built_mega ?? 0),
  supercomputer: (s) => (s.stats.built_supercomputer ?? 0) + (s.stats.built_mega ?? 0),
  mega: (s) => s.stats.built_mega ?? 0,
  campus: (s) => {
    const best = (s.stats.built_mega ?? 0) > 0 ? 4 : 0;
    const byZone: Record<string, number> = {};
    for (const f of Object.values(s.facilities)) {
      if (f.isHQ) continue;
      const zone = zoneOfParcel(f.parcelId);
      if (zone) byZone[zone] = (byZone[zone] ?? 0) + 1;
    }
    return Math.max(best, ...Object.values(byZone), 0);
  },
  leader: (s, d) => (s.competitors.every((c) => c.valuation < d.totals.valuation) ? 1 : 0),
  speedUps: (s) => s.stats.speedUps ?? 0,
  totalRevenue: (s) => s.finance.totalRevenue,
  cash: (s) => s.cash,
  allResearch: (s) => (s.research.done.length >= RESEARCH.length ? 1 : 0),
  green: (s) => (s.research.done.includes('green_ppa') ? 1 : 0),
  upgrades: (s) => s.stats.upgrades ?? 0,
};

function zoneOfParcel(pid: string): string | undefined {
  const city = pid.split('-')[0];
  for (let i = 0; i < 3; i++) {
    const z = getZone(`${city}-z${i}`);
    if (z && z.parcelIds.includes(pid)) return z.id;
  }
  return undefined;
}

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  metric: string;
  target: number;
  reward: { cash?: number; xp?: number; perm?: Record<string, number>; permLabel?: string };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_property', title: 'First Property', desc: 'Purchase your first lot.', icon: '🏷️', metric: 'properties', target: 1, reward: { cash: 25_000, xp: 100 } },
  { id: 'wrecking_ball', title: 'Wrecking Ball', desc: 'Demolish your first building.', icon: '🧱', metric: 'demolitions', target: 1, reward: { cash: 20_000, xp: 80 } },
  { id: 'first_build', title: 'First Construction', desc: 'Complete your first data center.', icon: '🏗️', metric: 'builds', target: 1, reward: { cash: 100_000, xp: 250 } },
  { id: 'racked', title: 'Racked & Stacked', desc: 'Install 25 servers.', icon: '🗄️', metric: 'servers', target: 25, reward: { cash: 150_000, xp: 300 } },
  { id: 'first_contract', title: 'Open for Business', desc: 'Sign your first customer contract.', icon: '🤝', metric: 'contractsSigned', target: 1, reward: { cash: 40_000, xp: 120 } },
  { id: 'millionaire', title: 'Millionaire', desc: 'Reach $2M in company value.', icon: '💰', metric: 'valuation', target: 2_000_000, reward: { xp: 200 } },
  { id: 'decamillionaire', title: 'Big League', desc: 'Reach $25M in company value.', icon: '💎', metric: 'valuation', target: 25_000_000, reward: { xp: 800, perm: { contractRate: 0.02 }, permLabel: '+2% contract rates' } },
  { id: 'centimillionaire', title: 'Centimillionaire', desc: 'Reach $250M in company value.', icon: '🏦', metric: 'valuation', target: 250_000_000, reward: { xp: 3000, perm: { buildCost: 0.03 }, permLabel: '−3% construction cost' } },
  { id: 'billion', title: 'Unicorn', desc: 'Reach $1B in company value.', icon: '🦄', metric: 'valuation', target: 1_000_000_000, reward: { xp: 8000, perm: { offlineHours: 4 }, permLabel: '+4h offline cap' } },
  { id: 'decacorn', title: 'Decacorn', desc: 'Reach $10B in company value.', icon: '🌠', metric: 'valuation', target: 10_000_000_000, reward: { xp: 25000, perm: { contractRate: 0.05 }, permLabel: '+5% contract rates' } },
  { id: 'regional', title: 'Regional Expansion', desc: 'Own facilities in 5 cities.', icon: '🗺️', metric: 'cities', target: 5, reward: { cash: 2_000_000, xp: 1500 } },
  { id: 'global', title: 'Global Expansion', desc: 'Own facilities in 5 countries.', icon: '🌍', metric: 'countries', target: 5, reward: { cash: 15_000_000, xp: 6000, perm: { contractRate: 0.03 }, permLabel: '+3% contract rates' } },
  { id: 'ai_powerhouse', title: 'AI Powerhouse', desc: 'Deliver 1,000 PFLOPS of AI compute.', icon: '🧠', metric: 'gpu', target: 1000, reward: { cash: 5_000_000, xp: 3000 } },
  { id: 'exascale', title: 'Exascale Empire', desc: 'Deliver 20,000 PFLOPS of AI compute.', icon: '🌌', metric: 'gpu', target: 20000, reward: { cash: 80_000_000, xp: 15000, perm: { gpuCap: 0.05 }, permLabel: '+5% AI compute' } },
  { id: 'industry_leader', title: 'Industry Leader', desc: 'Become the highest-valued company.', icon: '👑', metric: 'leader', target: 1, reward: { cash: 10_000_000, xp: 5000 } },
  { id: 'zone', title: 'Master Planner', desc: 'Purchase an entire development zone.', icon: '📐', metric: 'zones', target: 1, reward: { cash: 500_000, xp: 600 } },
  { id: 'mega_campus', title: 'Mega Campus', desc: 'Run 4 facilities in one zone, or build a Mega AI Campus.', icon: '🏟️', metric: 'campus', target: 4, reward: { cash: 20_000_000, xp: 6000, perm: { perf: 0.03 }, permLabel: '+3% facility performance' } },
  { id: 'hyperscaler', title: 'Hyperscaler', desc: 'Complete a hyperscale-class facility.', icon: '🏭', metric: 'hyperscale', target: 1, reward: { cash: 8_000_000, xp: 3000 } },
  { id: 'supercomputer', title: 'Supercomputer', desc: 'Complete an AI Supercomputer Campus.', icon: '🖥️', metric: 'supercomputer', target: 1, reward: { cash: 40_000_000, xp: 9000 } },
  { id: 'cash_machine', title: 'Cash Machine', desc: 'Earn $10,000 profit per hour.', icon: '📈', metric: 'profitHr', target: 10_000, reward: { cash: 1_000_000, xp: 1200 } },
  { id: 'money_printer', title: 'Money Printer', desc: 'Earn $250,000 profit per hour.', icon: '🖨️', metric: 'profitHr', target: 250_000, reward: { cash: 50_000_000, xp: 10000 } },
  { id: 'reliable', title: 'Five Nines', desc: 'Complete 10 contracts.', icon: '✅', metric: 'contractsCompleted', target: 10, reward: { cash: 600_000, xp: 1000, perm: { contractRate: 0.02 }, permLabel: '+2% contract rates' } },
  { id: 'trusted', title: 'Trusted Partner', desc: 'Complete 50 contracts.', icon: '🏅', metric: 'contractsCompleted', target: 50, reward: { cash: 12_000_000, xp: 5000 } },
  { id: 'scientist', title: 'R&D Department', desc: 'Complete 5 research projects.', icon: '🔬', metric: 'research', target: 5, reward: { cash: 1_000_000, xp: 1200 } },
  { id: 'all_research', title: 'Singularity', desc: 'Complete every research project.', icon: '♾️', metric: 'allResearch', target: 1, reward: { cash: 100_000_000, xp: 20000 } },
  { id: 'team', title: 'Growing Team', desc: 'Employ 10 people.', icon: '👥', metric: 'employees', target: 10, reward: { cash: 300_000, xp: 600 } },
  { id: 'army', title: 'Workforce', desc: 'Employ 60 people.', icon: '🏢', metric: 'employees', target: 60, reward: { cash: 10_000_000, xp: 4000 } },
  { id: 'hq', title: 'Corner Office', desc: 'Build a company headquarters.', icon: '🏛️', metric: 'hq', target: 1, reward: { cash: 150_000, xp: 300 } },
  { id: 'speed', title: 'Need for Speed', desc: 'Speed up construction 5 times.', icon: '⏩', metric: 'speedUps', target: 5, reward: { xp: 400 } },
  { id: 'landlord', title: 'Landlord', desc: 'Own 25 properties at once.', icon: '🏘️', metric: 'ownedNow', target: 25, reward: { cash: 3_000_000, xp: 2000 } },
  { id: 'demolisher', title: 'Demolition Expert', desc: 'Demolish 10 buildings.', icon: '💥', metric: 'demolitions', target: 10, reward: { cash: 500_000, xp: 900 } },
  { id: 'green', title: 'Green Grid', desc: 'Research Renewable Power Agreements.', icon: '🌱', metric: 'green', target: 1, reward: { cash: 5_000_000, xp: 2000 } },
];

export const STORY: Omit<Mission, 'base'>[] = [
  { id: 's0', title: 'Clear the site', desc: 'Open your starting property on the World Map and demolish the old building.', metric: 'demolitions', target: 1, reward: { cash: 30_000, xp: 60 } },
  { id: 's1', title: 'Break ground', desc: 'Build a Modular Data Center on your cleared lot and wait for it to finish (or speed it up).', metric: 'builds', target: 1, reward: { cash: 80_000, xp: 150 } },
  { id: 's2', title: 'Rack it up', desc: 'Install 4 servers in your new data center.', metric: 'servers', target: 4, reward: { cash: 40_000, xp: 100 } },
  { id: 's3', title: 'Keep it cool', desc: 'Install a cooling unit or power distribution unit so you can grow.', metric: 'infra', target: 1, reward: { cash: 40_000, xp: 100 } },
  { id: 's4', title: 'First customer', desc: 'Sign a customer contract on the Contracts page.', metric: 'contractsSigned', target: 1, reward: { cash: 60_000, xp: 120 } },
  { id: 's5', title: 'First hire', desc: 'Hire an employee. Engineers speed up construction, Sales reps bring better deals.', metric: 'employees', target: 1, reward: { cash: 30_000, xp: 80 } },
  { id: 's6', title: 'Invest in R&D', desc: 'Complete a research project.', metric: 'research', target: 1, reward: { cash: 100_000, xp: 200 } },
  { id: 's7', title: 'Land grab', desc: 'Own 3 properties.', metric: 'properties', target: 3, reward: { cash: 120_000, xp: 200 } },
  { id: 's8', title: 'In the black', desc: 'Reach $1,000/hour net profit.', metric: 'profitHr', target: 1000, reward: { cash: 200_000, xp: 300 } },
  { id: 's9', title: 'Headquarters', desc: 'Build your HQ on one of your properties (Employees page or property panel).', metric: 'hq', target: 1, reward: { cash: 150_000, xp: 300 } },
  { id: 's10', title: 'Growing Business', desc: 'Reach company level 5.', metric: 'level', target: 5, reward: { cash: 400_000, xp: 0 } },
  { id: 's11', title: 'New market', desc: 'Operate facilities in 2 cities.', metric: 'cities', target: 2, reward: { cash: 500_000, xp: 600 } },
  { id: 's12', title: 'Think big', desc: 'Buy an entire development zone.', metric: 'zones', target: 1, reward: { cash: 750_000, xp: 800 } },
  { id: 's13', title: 'Serious money', desc: 'Reach $25M company value.', metric: 'valuation', target: 25_000_000, reward: { cash: 2_000_000, xp: 1500 } },
  { id: 's14', title: 'Going international', desc: 'Operate facilities in 2 countries.', metric: 'countries', target: 2, reward: { cash: 3_000_000, xp: 2500 } },
  { id: 's15', title: 'Hyperscale', desc: 'Complete a hyperscale-class data center.', metric: 'hyperscale', target: 1, reward: { cash: 8_000_000, xp: 4000 } },
  { id: 's16', title: 'AI Powerhouse', desc: 'Deliver 1,000 PFLOPS of AI compute.', metric: 'gpu', target: 1000, reward: { cash: 15_000_000, xp: 6000 } },
  { id: 's17', title: 'Number one', desc: 'Become the most valuable company in the world.', metric: 'leader', target: 1, reward: { cash: 50_000_000, xp: 12000 } },
  { id: 's18', title: 'Global AI Empire', desc: 'Reach company level 50.', metric: 'level', target: 50, reward: { cash: 500_000_000, xp: 0 } },
];

const DAILY_POOL = [
  { id: 'd_rev', title: 'Revenue push', metric: 'totalRevenue', mult: 'revenue' },
  { id: 'd_srv', title: 'Capacity expansion', metric: 'servers', mult: 'servers' },
  { id: 'd_ctr', title: 'Deal maker', metric: 'contractsSigned', mult: 'contracts' },
  { id: 'd_prop', title: 'Real estate scout', metric: 'properties', mult: 'one' },
  { id: 'd_build', title: 'Builder', metric: 'builds', mult: 'one' },
  { id: 'd_demo', title: 'Clean slate', metric: 'demolitions', mult: 'one' },
  { id: 'd_upg', title: 'Modernize', metric: 'upgrades', mult: 'upg' },
  { id: 'd_done', title: 'Deliver', metric: 'contractsCompleted', mult: 'one' },
] as const;

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function rollDailies(s: GameState, d: Derived) {
  const key = todayKey();
  if (s.missions.daily.date === key && s.missions.daily.items.length) return;
  const pool = [...DAILY_POOL];
  const items: Mission[] = [];
  const profit = Math.max(500, d.totals.profitHr);
  for (let i = 0; i < 3 && pool.length; i++) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    let target = 1;
    let desc = '';
    if (t.mult === 'revenue') {
      target = Math.round(Math.max(150_000, d.totals.revenueHr * 900) / 10_000) * 10_000;
      desc = `Earn ${money(target)} in revenue.`;
    } else if (t.mult === 'servers') {
      target = randInt(6, 12) + Math.floor(s.level / 3);
      desc = `Install ${target} servers.`;
    } else if (t.mult === 'contracts') {
      target = randInt(2, 3);
      desc = `Sign ${target} contracts.`;
    } else if (t.mult === 'upg') {
      target = randInt(2, 5);
      desc = `Upgrade ${target} pieces of equipment.`;
    } else {
      target = 1;
      desc = { d_prop: 'Buy a property.', d_build: 'Complete a construction project.', d_demo: 'Demolish a building.', d_done: 'Complete a customer contract.' }[t.id as string] ?? '';
    }
    items.push({ id: `${key}-${t.id}`, title: t.title, desc, metric: t.metric, target, base: METRICS[t.metric](s, d), reward: { cash: Math.round((profit * randInt(250, 450)) / 1000) * 1000, xp: 150 + s.level * 25 } });
  }
  s.missions.daily = { date: key, items };
}

export function missionProgress(s: GameState, d: Derived, m: Mission): number {
  const v = METRICS[m.metric](s, d) - (m.base ?? 0);
  return Math.max(0, Math.min(1, v / m.target));
}

export function currentStory(s: GameState): Omit<Mission, 'base'> | undefined {
  return STORY[s.missions.tutorial];
}

export function claimMission(s: GameState, d: Derived, kind: 'story' | 'daily', id: string): { ok: boolean; reason?: string } {
  let m: Mission | undefined;
  if (kind === 'story') {
    const st = currentStory(s);
    if (!st || st.id !== id) return { ok: false, reason: 'Not the active mission' };
    m = { ...st, base: 0 };
  } else {
    m = s.missions.daily.items.find((x) => x.id === id);
  }
  if (!m) return { ok: false, reason: 'Unknown mission' };
  if (m.claimed) return { ok: false, reason: 'Already claimed' };
  if (missionProgress(s, d, m) < 1) return { ok: false, reason: 'Not complete yet' };
  if (m.reward.cash) receive(s, m.reward.cash, 'Rewards', `Mission reward: ${m.title}`);
  if (m.reward.xp) addXp(s, m.reward.xp, 'Mission');
  if (kind === 'story') s.missions.tutorial++;
  else m.claimed = true;
  s.missions.claimed.push(id);
  sfx('reward');
  emit('world');
  return { ok: true };
}

export function checkAchievements(s: GameState, d: Derived) {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] !== undefined) continue;
    if (METRICS[a.metric](s, d) >= a.target) {
      s.achievements[a.id] = s.gameHours;
      if (a.reward.cash) receive(s, a.reward.cash, 'Rewards', `Achievement: ${a.title}`);
      if (a.reward.xp) addXp(s, a.reward.xp, 'Achievement');
      if (a.reward.perm) for (const [k, v] of Object.entries(a.reward.perm)) s.permanent[k] = (s.permanent[k] ?? 0) + v;
      log(s, `Achievement unlocked: ${a.title}`, 'good');
      toast({ title: `Achievement: ${a.title}`, body: `${a.desc}${a.reward.cash ? ' +' + money(a.reward.cash) : ''}${a.reward.permLabel ? ' · ' + a.reward.permLabel : ''}`, kind: 'achievement', icon: a.icon });
      sfx('achievement');
      emit('achievement', a.id);
    }
  }
}

export { pick };
