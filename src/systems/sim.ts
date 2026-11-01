// Simulation core: new game creation, the per-step update, and offline catch-up.

import { SAVE_VERSION, defaultSettings, emptyReport, type GameState } from '../core/state';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { CITIES, cityById } from '../config/world';
import { getCityLayout } from '../world/parcels';
import { deriveAll, landValue, type Derived } from './derive';
import { flow, addXp, log } from './ledger';
import { finishDemolition, constructionSpeed } from './property';
import { finishBuild } from './construction';
import { tickResearch } from './research';
import { tickContracts } from './contracts';
import { tickEmployees, refreshCandidates } from './employees';
import { tickCompetitors, createCompetitors, seedCompetitors } from './competitors';
import { tickEvents } from './events';
import { checkAchievements, rollDailies } from './progression';
import { deptBonus, getEffects, eff, offlineCapHours } from './modifiers';
import { emit, toast } from '../core/bus';
import { tickDecisions } from './decisions';

export interface NewGameOptions {
  name: string;
  logo: string;
  color: string;
  startCity: string;
  difficulty: string;
}

export function newGame(o: NewGameOptions): GameState {
  const diff = ECONOMY.difficulties[o.difficulty] ?? ECONOMY.difficulties.standard;
  const now = Date.now();
  const s: GameState = {
    version: SAVE_VERSION,
    seed: Math.floor(Math.random() * 1e9),
    createdAt: now,
    lastRealTime: now,
    gameHours: 0,
    speed: 1,
    paused: false,
    difficulty: o.difficulty,
    company: { name: o.name || 'NewCo', logo: o.logo, color: o.color, startCity: o.startCity, hqTier: 0, reputation: 50, founded: now },
    cash: diff.cash,
    debt: 0,
    xp: 0,
    level: 1,
    unlockedCities: CITIES.filter((c) => c.unlockLevel <= 1 && c.license === 0).map((c) => c.id),
    parcels: {},
    facilities: {},
    projects: {},
    research: { done: [] },
    employees: [],
    candidates: [],
    candidatesAt: 0,
    contracts: { offers: [], active: [], history: [], nextOfferAt: 3 },
    competitors: [],
    finance: {
      ledger: [], hourly: [], daily: [], monthly: [],
      cur: { hour: emptyReport(0), day: emptyReport(0), month: emptyReport(0) },
      totalRevenue: 0, totalExpenses: 0, totalCapex: 0, valuationHistory: [], lastHourProfit: 0, avgHourProfit: 0,
    },
    achievements: {},
    missions: { tutorial: 0, daily: { date: '', items: [] }, claimed: [] },
    events: [],
    nextEventAt: 48,
    stats: {},
    log: [],
    settings: defaultSettings(),
    cityDemand: Object.fromEntries(CITIES.map((c) => [c.id, 1])),
    idCounter: 0,
    permanent: {},
    offline: { capHours: ECONOMY.baseOfflineCapHours },
  };
  if (!s.unlockedCities.includes(o.startCity)) s.unlockedCities.push(o.startCity);

  // Starting property: a small, cheap lot with an old building on it.
  const lay = getCityLayout(o.startCity);
  const candidates = lay.parcels
    .filter((p) => !p.zoneId && p.buildingFloors > 0 && p.area >= 450 && p.area <= 2400 && ['retail', 'restaurant', 'warehouse'].includes(p.type))
    .sort((a, b) => a.basePrice - b.basePrice);
  const start = candidates[0] ?? lay.parcels.find((p) => p.area >= 400)!;
  s.parcels[start.id] = { owner: 'player', status: start.buildingFloors > 0 ? 'existing' : 'cleared', boughtFor: 0, boughtAt: 0 };
  s.company.startParcel = start.id;

  s.competitors = createCompetitors(s);
  seedCompetitors(s);
  for (const c of s.competitors) {
    c.valuation = c.cash + c.sites.reduce((a, x) => a + x.invested, 0) * 0.72;
    c.history.push(Math.round(c.valuation));
  }
  refreshCandidates(s);
  log(s, `${s.company.name} was founded in ${cityById(o.startCity).name}. Your first property: ${start.name}.`, 'good');
  const d = deriveAll(s);
  s.finance.valuationHistory.push(Math.round(d.totals.valuation));
  rollDailies(s, d);
  return s;
}

function rollReports(s: GameState, prevHours: number, d: Derived) {
  const f = s.finance;
  const ph = Math.floor(prevHours), nh = Math.floor(s.gameHours);
  if (nh === ph) return;
  // hour rollover
  const h = f.cur.hour;
  const rev = Object.values(h.revenue).reduce((a, b) => a + b, 0);
  const exp = Object.values(h.expenses).reduce((a, b) => a + b, 0);
  const span = Math.max(1, nh - ph);
  const profit = (rev - exp) / span;
  f.lastHourProfit = profit;
  // valuation uses smoothed *operating* profit (one-off rewards/sales excluded)
  const op = d.totals.profitHr;
  f.avgHourProfit = f.hourly.length === 0 ? op : f.avgHourProfit * 0.97 + op * 0.03;
  f.hourly.push(h);
  if (f.hourly.length > 72) f.hourly.splice(0, f.hourly.length - 72);
  f.cur.hour = emptyReport(nh);
  if (d.totals.profitHr > 0) addXp(s, ECONOMY.xp.profitXpScale * Math.pow(d.totals.profitHr, ECONOMY.xp.profitXpExp) * span);
  checkAchievements(s, d);
  // day rollover
  if (Math.floor(nh / 24) !== Math.floor(ph / 24)) {
    f.daily.push(f.cur.day);
    if (f.daily.length > 90) f.daily.splice(0, f.daily.length - 90);
    f.cur.day = emptyReport(Math.floor(nh / 24) * 24);
    f.valuationHistory.push(Math.round(d.totals.valuation));
    if (f.valuationHistory.length > 180) f.valuationHistory.splice(0, f.valuationHistory.length - 180);
    rollDailies(s, d);
    emit('newday');
  }
  // month rollover (30 game days)
  if (Math.floor(nh / 720) !== Math.floor(ph / 720)) {
    f.monthly.push(f.cur.month);
    if (f.monthly.length > 36) f.monthly.splice(0, f.monthly.length - 36);
    f.cur.month = emptyReport(Math.floor(nh / 720) * 720);
  }
}

/**
 * Advance the simulation.
 * @param realSeconds simulated real seconds (already multiplied by game speed)
 */
export function step(s: GameState, realSeconds: number): Derived {
  const dt = realSeconds * ECONOMY.gameHoursPerSecond; // game hours
  const prev = s.gameHours;
  const facBefore = Object.keys(s.facilities).length;
  s.gameHours += dt;

  // facility wear
  const e = getEffects(s);
  for (const f of Object.values(s.facilities)) {
    if (f.isHQ) continue;
    const ops = deptBonus(s, 'ops', f.id);
    f.condition = Math.max(0, f.condition - (ECONOMY.conditionDecayPerDay / 24) * dt * (1 - eff(e, 'decay')) * (1 - ops));
    if (f.autoRepair !== false && f.condition < ECONOMY.autoRepairThreshold) {
      const pts = ECONOMY.autoRepairTarget - f.condition;
      const cost = (pts * ECONOMY.repairCostPerPoint * f.shellValue) / 100;
      if (s.cash > cost) {
        f.condition = ECONOMY.autoRepairTarget;
        flow(s, {}, { Maintenance: cost });
      }
    }
  }

  const d = deriveAll(s);

  // money flows
  const revenue: Record<string, number> = { Contracts: 0, 'Spot Market': 0 };
  const expenses: Record<string, number> = { Electricity: 0, Cooling: 0, Maintenance: 0, 'Building Upkeep': 0, 'Property Tax': 0, Insurance: 0, Connectivity: 0 };
  for (const f of Object.values(s.facilities)) {
    const st = d.fac[f.id];
    if (!st) continue;
    revenue.Contracts += st.revenue.contracts * dt;
    revenue['Spot Market'] += st.revenue.spot * dt;
    expenses.Electricity += st.expenses.electricity * dt;
    expenses.Cooling += st.expenses.cooling * dt;
    expenses.Maintenance += st.expenses.maintenance * dt;
    expenses['Building Upkeep'] += st.expenses.building * dt;
    expenses['Property Tax'] += st.expenses.tax * dt;
    expenses.Insurance += st.expenses.insurance * dt;
    expenses.Connectivity += st.expenses.connectivity * dt;
    f.revenueTotal += st.revenueHr * dt;
    f.profitTotal += st.profitHr * dt;
  }
  expenses['Property Tax'] += d.totals.landTaxHr * dt;
  expenses.Salaries = d.totals.salariesHr * dt;
  expenses.Interest = d.totals.interestHr * dt;
  expenses.Headquarters = d.totals.hqHr * dt;
  flow(s, revenue, expenses);

  // construction & demolition
  const speed = constructionSpeed(s);
  for (const pr of Object.values(s.projects)) {
    pr.doneSeconds += realSeconds * speed;
    if (pr.doneSeconds >= pr.totalSeconds) {
      if (pr.kind === 'demolish') finishDemolition(s, pr.id);
      else finishBuild(s, pr.id);
    }
  }

  tickResearch(s, realSeconds);
  tickContracts(s, dt, d);
  tickEmployees(s, dt);
  tickCompetitors(s, dt, realSeconds, d);
  tickEvents(s);
  tickDecisions(s, d);
  if (s.buffs?.length) s.buffs = s.buffs.filter((b) => b.endsAt > s.gameHours);

  // overdraft safety net: automatically draw on the credit line instead of going negative
  if (s.cash < 0 && s.settings.autoLoan !== false) {
    const limit = loanLimit(s, d);
    const need = Math.ceil((-s.cash + 25_000) / 10_000) * 10_000;
    const amt = Math.min(limit, need);
    if (amt > 0) {
      s.debt += amt;
      s.cash += amt;
      s.finance.ledger.unshift({ t: s.gameHours, amount: amt, cat: 'Loan', desc: 'Automatic overdraft protection' });
      if (!(s.stats.lastOverdraftToast > s.gameHours - 48)) {
        s.stats.lastOverdraftToast = s.gameHours;
        toast({ title: 'Overdraft protection', body: `The bank covered a shortfall with a ${Math.round(amt / 1000)}K loan. Repay it on the Finances page when you can.`, kind: 'warn', icon: '🏦' });
      }
    }
  }

  // market demand grows over time (the AI boom never stops)
  const boom = s.events.some((x) => x.defId === 'ai_boom');
  for (const c of CITIES) s.cityDemand[c.id] = (s.cityDemand[c.id] ?? 1) + (ECONOMY.demandGrowthPerDay / 24) * dt * (boom ? 2 : 1);

  rollReports(s, prev, d);
  // structural changes (new facility, etc.) need fresh derived stats for the UI
  return Object.keys(s.facilities).length !== facBefore ? deriveAll(s) : d;
}

/**
 * Time is stopped: the economy clock is frozen (no income, expenses, rivals or events),
 * but construction and research keep advancing so you can plan and build stress-free.
 */
export function advanceFrozen(s: GameState, realSeconds: number): Derived {
  const speed = constructionSpeed(s);
  for (const pr of Object.values(s.projects)) {
    pr.doneSeconds += realSeconds * speed;
    if (pr.doneSeconds >= pr.totalSeconds) {
      if (pr.kind === 'demolish') finishDemolition(s, pr.id);
      else finishBuild(s, pr.id);
    }
  }
  tickResearch(s, realSeconds);
  return deriveAll(s);
}

/** Advance in sub-steps that never straddle an hour boundary, so hourly reports are exact. */
export function advance(s: GameState, realSeconds: number): Derived {
  let left = realSeconds;
  let d: Derived | null = null;
  let guard = 0;
  while (left > 1e-9 && guard++ < 10000) {
    const toBoundary = (Math.floor(s.gameHours + 1e-9) + 1 - s.gameHours) / ECONOMY.gameHoursPerSecond;
    const chunk = Math.min(left, Math.max(1e-6, toBoundary));
    d = step(s, chunk);
    left -= chunk;
  }
  return d ?? deriveAll(s);
}

export interface OfflineReport {
  seconds: number;
  cappedFrom?: number;
  cash: number;
  revenue: number;
  expenses: number;
  builds: number;
  research: number;
  contracts: number;
  levels: number;
  compMoves: number;
}

export function offlineCap(s: GameState): number {
  return offlineCapHours(s, getEffects(s), HQ_TIERS[s.company.hqTier]?.offlineBonus ?? 0);
}

/** Catch up elapsed wall-clock time since the last save. */
export function catchUp(s: GameState, nowMs = Date.now(), maxSeconds?: number): OfflineReport | null {
  let elapsed = (nowMs - s.lastRealTime) / 1000;
  s.lastRealTime = nowMs;
  if (!isFinite(elapsed) || elapsed <= 0) return null; // clock moved backwards — ignore safely
  const cap = (maxSeconds ?? offlineCap(s) * 3600);
  let cappedFrom: number | undefined;
  if (elapsed > cap) {
    cappedFrom = elapsed;
    elapsed = cap;
  }
  if (elapsed < 2) return null;
  const before = {
    cash: s.cash, rev: s.finance.totalRevenue, exp: s.finance.totalExpenses,
    builds: s.stats.buildsCompleted ?? 0, research: s.research.done.length, contracts: s.stats.contractsCompleted ?? 0,
    level: s.level, gh: s.gameHours,
  };
  const stepSec = ECONOMY.offlineStepHours / ECONOMY.gameHoursPerSecond;
  let left = elapsed;
  while (left > 0) {
    const chunk = Math.min(stepSec, left);
    if (s.paused) advanceFrozen(s, chunk);
    else advance(s, chunk);
    left -= chunk;
  }
  // offline safety net: being away can never cost more than a quarter of your cash
  const floor = before.cash > 0 ? before.cash * 0.75 : before.cash;
  if (s.cash < floor) {
    const refund = floor - s.cash;
    s.cash = floor;
    s.finance.ledger.unshift({ t: s.gameHours, amount: refund, cat: 'Safety Net', desc: 'Offline loss protection' });
  }
  return {
    seconds: elapsed, cappedFrom,
    cash: s.cash - before.cash,
    revenue: s.finance.totalRevenue - before.rev,
    expenses: s.finance.totalExpenses - before.exp,
    builds: (s.stats.buildsCompleted ?? 0) - before.builds,
    research: s.research.done.length - before.research,
    contracts: (s.stats.contractsCompleted ?? 0) - before.contracts,
    levels: s.level - before.level,
    compMoves: s.log.filter((l) => l.kind === 'comp' && l.t > before.gh).length,
  };
}

export function loanLimit(s: GameState, d: Derived): number {
  return Math.max(0, Math.round((d.totals.valuation * ECONOMY.loanLimitOfValuation - s.debt) / 10_000) * 10_000);
}

export function takeLoan(s: GameState, d: Derived, amount: number): { ok: boolean; reason?: string } {
  amount = Math.round(amount);
  if (amount <= 0) return { ok: false, reason: 'Invalid amount' };
  if (amount > loanLimit(s, d)) return { ok: false, reason: 'Exceeds your credit limit' };
  s.debt += amount;
  s.cash += amount;
  s.finance.ledger.unshift({ t: s.gameHours, amount, cat: 'Loan', desc: 'Bank loan drawn' });
  log(s, `Borrowed $${amount.toLocaleString()} from the bank`, 'money');
  emit('world');
  return { ok: true };
}

export function repayLoan(s: GameState, amount: number): { ok: boolean; reason?: string } {
  amount = Math.min(Math.round(amount), s.debt);
  if (amount <= 0) return { ok: false, reason: 'No debt to repay' };
  if (s.cash < amount) return { ok: false, reason: 'Not enough cash' };
  s.debt -= amount;
  s.cash -= amount;
  s.finance.ledger.unshift({ t: s.gameHours, amount: -amount, cat: 'Loan', desc: 'Loan repayment' });
  emit('world');
  return { ok: true };
}

export { landValue };
