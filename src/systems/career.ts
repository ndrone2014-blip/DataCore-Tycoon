// Company progression: goals that unlock the game step by step, the founder's freelance work that
// pays for the first property, utility hookups, startup financing and milestone celebrations.
// Companies from before v2.3 run with mode 'legacy': nothing is locked and their numbers don't change.

import type { CareerState, Facility, GameState, Gig } from '../core/state';
import type { Derived } from './derive';
import { ECONOMY } from '../config/economy';
import { cityById } from '../config/world';
import { getCityLayout, type ParcelDef } from '../world/parcels';
import { METRICS } from './progression';
import { addXp, canAfford, log, pushNews, pushTx, receive, spend, stat } from './ledger';
import { emit, sfx, toast } from '../core/bus';
import { money } from '../core/format';
import { pick, rand, randRange } from '../core/rng';
import { quoteBuild } from './construction';
import { parcelState } from './property';
import { builderExperience, hasFeature, hookupsDone, isCareer, stageDef } from './careerCore';
import { deptBonus } from './modifiers';

const C = ECONOMY.career;
export { hasFeature, isCareer, stageDef };
export const STAGES = C.stages;

// ---------- starter property ----------
/** The one property on the market when a career company is founded. */
export function starterParcel(cityId: string): ParcelDef {
  const lay = getCityLayout(cityId);
  const marked = lay.parcels.find((p) => p.starter);
  if (marked) return marked;
  const candidates = lay.parcels
    .filter((p) => !p.zoneId && p.buildingFloors > 0 && p.area >= 450 && p.area <= 2400 && ['retail', 'restaurant', 'warehouse'].includes(p.type))
    .sort((a, b) => a.basePrice - b.basePrice);
  return candidates[0] ?? lay.parcels.find((p) => p.area >= 400)!;
}

export function newCareerState(career: boolean): CareerState {
  return { mode: career ? 'career' : 'legacy', stage: 0, done: {}, seeded: !career ? false : true, profitHours: 0, board: [], boardAt: 0, gigsDone: 0, autoGigs: false, garage: 0, loans: {}, endless: 0 };
}

// ---------- goals ----------
export interface GoalReq { label: string; metric: string; target: number }
export interface GoalDef {
  id: string;
  stage: number;
  title: string;
  icon: string;
  desc: string;
  reqs: GoalReq[];
  /** What this opens up, in plain words. Empty for goals that are purely milestones. */
  opens: string[];
  reward?: { cash?: number; xp?: number };
  /** Full-screen moment instead of a toast. */
  big?: boolean;
  /** Promotes the company to this stage. */
  stageUp?: number;
}

const r = (label: string, metric: string, target: number): GoalReq => ({ label, metric, target });

export const GOALS: GoalDef[] = [
  // ---- Garage Startup ----
  { id: 'g_first_gig', stage: 0, title: 'First Paying Client', icon: '🧰', desc: 'Finish a freelance job. Every dollar for your first property starts here.', reqs: [r('Freelance jobs finished', 'gigs', 1)], opens: [], reward: { xp: 30 } },
  { id: 'g_garage', stage: 0, title: 'Garage Rack', icon: '🗄️', desc: 'Buy a used server and host a few websites from the garage.', reqs: [r('Garage servers', 'garage', 1)], opens: [], reward: { xp: 40 } },
  { id: 'g_steady', stage: 0, title: 'Steady Clients', icon: '📞', desc: 'Word gets around town and clients start calling you back.', reqs: [r('Freelance jobs finished', 'gigs', 8)], opens: ['Keep Working: take the next job automatically'], reward: { cash: 500, xp: 60 } },
  { id: 'g_property', stage: 0, title: 'You Own Land', icon: '🏷️', desc: 'Buy your first property. It is yours now, and the bank will talk to you.', reqs: [r('Properties bought', 'properties', 1)], opens: ['Construction', 'Construction loan from the local bank'], reward: { cash: 5_000, xp: 120 }, big: true },
  { id: 'g_cleared', stage: 0, title: 'Clean Slate', icon: '🧱', desc: 'Tear down the old building and clear the site.', reqs: [r('Demolitions', 'demolitions', 1)], opens: [], reward: { cash: 2_000, xp: 60 } },
  { id: 'g_first_build', stage: 0, title: 'Your First Data Center', icon: '🏗️', desc: 'Finish building your first data center.', reqs: [r('Data centers built', 'builds', 1)], opens: ['Data Centers', 'Servers & Equipment', 'Equipment financing'], reward: { cash: 10_000, xp: 200 }, big: true },
  { id: 'g_hooked', stage: 0, title: 'Power and Internet', icon: '🔌', desc: 'Connect the building to the electric utility and to fiber.', reqs: [r('Sites connected', 'hookups', 1)], opens: [], reward: { cash: 2_500, xp: 100 } },
  { id: 'g_operational', stage: 0, title: 'We Are Live', icon: '💡', desc: 'Bring the first server online. Your data center is operational.', reqs: [r('Sites online with servers', 'onlineDCs', 1)], opens: ['Customers & Contracts'], reward: { cash: 5_000, xp: 200 }, big: true },
  { id: 'g_first_contract', stage: 0, title: 'First Customer', icon: '🤝', desc: 'Sign a real customer. Contracts pay far more than the spot market.', reqs: [r('Contracts signed', 'contractsSigned', 1)], opens: [], reward: { cash: 3_000, xp: 100 } },
  { id: 'g_profit', stage: 0, title: 'In the Black', icon: '📈', desc: 'Stay profitable for four game days, loan interest included. This is the moment you have a real business.', reqs: [r('Hours in profit', 'profitHours', C.profitHoursGoal)], opens: ['Growing Business status', 'Employees', 'Headquarters', 'Competitor intelligence', 'The property market'], reward: { cash: 25_000, xp: 500 }, big: true, stageUp: 1 },
  // ---- Growing Business ----
  { id: 'g_first_hire', stage: 1, title: 'First Hire', icon: '👋', desc: 'Hire your first employee. Pick someone who covers your biggest weakness.', reqs: [r('Employees', 'employees', 1)], opens: [], reward: { cash: 5_000, xp: 150 } },
  { id: 'g_upgrades', stage: 1, title: 'Building Upgrades', icon: '🛠️', desc: 'Deliver on a contract and reach level 3. Better vendors will take your call.', reqs: [r('Contracts completed', 'contractsCompleted', 1), r('Company level', 'level', 3)], opens: ['Custom building designer', 'Equipment upgrades'], reward: { xp: 150 } },
  { id: 'g_second_property', stage: 1, title: 'Second Property', icon: '🏘️', desc: 'Buy a second property. You are no longer a one-site company.', reqs: [r('Properties owned', 'ownedNow', 2)], opens: [], reward: { cash: 10_000, xp: 250 }, big: true },
  { id: 'g_research', stage: 1, title: 'R&D Budget', icon: '🔬', desc: 'Reach level 4 with money to spare for engineering.', reqs: [r('Company level', 'level', 4)], opens: ['Technology Research (tiers 1 and 2)'], reward: { xp: 200 } },
  { id: 'g_suppliers', stage: 1, title: 'Vendor Relationships', icon: '📦', desc: 'Complete three contracts. Suppliers now see you as a real account.', reqs: [r('Contracts completed', 'contractsCompleted', 3)], opens: ['Suppliers'], reward: { xp: 200 } },
  { id: 'g_second_dc', stage: 1, title: 'Second Data Center', icon: '🏢', desc: 'Get a second data center built. Your crews already know what they are doing.', reqs: [r('Data centers', 'facilities', 2)], opens: [], reward: { cash: 50_000, xp: 500 }, big: true },
  { id: 'g_network', stage: 1, title: 'Network Operations', icon: '🌐', desc: 'Reach level 5 with two sites to link together.', reqs: [r('Company level', 'level', 5), r('Data centers', 'facilities', 2)], opens: ['Global Network: exchanges and regional fiber'], reward: { xp: 250 } },
  { id: 'g_first_research', stage: 1, title: 'First Breakthrough', icon: '💡', desc: 'Finish a research project.', reqs: [r('Research completed', 'research', 1)], opens: [], reward: { cash: 15_000, xp: 200 } },
  { id: 'g_stage2', stage: 1, title: 'Established Company', icon: '🏢', desc: 'Two sites online, a strong record and a real balance sheet.', reqs: [r('Sites online', 'onlineDCs', 2), r('Company level', 'level', 9), r('Contracts completed', 'contractsCompleted', 15), r('Company value', 'valuation', 4_000_000)], opens: ['Established Company status', 'New cities', 'Markets & Rules', 'Portfolio tools: auto-equip, auto-sign, auto-assign'], reward: { cash: 150_000, xp: 1_000 }, big: true, stageUp: 2 },
  // ---- Established Company ----
  { id: 'g_third_dc', stage: 1, title: 'Third Data Center', icon: '🏭', desc: 'Three sites means real redundancy for your customers.', reqs: [r('Data centers', 'facilities', 3)], opens: [], reward: { cash: 120_000, xp: 800 }, big: true },
  { id: 'g_hq', stage: 2, title: 'A Real Headquarters', icon: '🏛️', desc: 'Move out of the garage and build a headquarters.', reqs: [r('Headquarters', 'hq', 1)], opens: [], reward: { cash: 60_000, xp: 500 } },
  { id: 'g_strategy', stage: 2, title: 'Boardroom', icon: '🧭', desc: 'Grow to five employees. Time to decide what kind of company this is.', reqs: [r('Employees', 'employees', 5)], opens: ['Corporate Strategy'], reward: { xp: 500 } },
  { id: 'g_adv_research', stage: 2, title: 'Advanced Research', icon: '🧪', desc: 'Finish four research projects.', reqs: [r('Research completed', 'research', 4)], opens: ['Research tier 3'], reward: { xp: 800 } },
  { id: 'g_zones', stage: 2, title: 'Large Development Projects', icon: '📐', desc: 'Reach level 8 and $5M in value. Land agents now bring you whole zones.', reqs: [r('Company level', 'level', 8), r('Company value', 'valuation', 5_000_000)], opens: ['Buy entire development zones'], reward: { xp: 800 } },
  { id: 'g_new_city', stage: 2, title: 'New Market', icon: '🗺️', desc: 'Run data centers in a second city.', reqs: [r('Cities with facilities', 'cities', 2)], opens: [], reward: { cash: 300_000, xp: 1_500 }, big: true },
  { id: 'g_net_strategy', stage: 2, title: 'Advanced Network Strategy', icon: '🛰️', desc: 'Operate in two cities and connect a fiber route.', reqs: [r('Cities with facilities', 'cities', 2), r('Fiber routes online', 'fiberOnline', 1)], opens: ['Long-haul and undersea fiber'], reward: { xp: 1_000 } },
  { id: 'g_stage3', stage: 2, title: 'Major Corporation', icon: '🏙️', desc: 'Five sites, two cities and the engineering to back them up.', reqs: [r('Data centers', 'facilities', 5), r('Cities with facilities', 'cities', 2), r('Company level', 'level', 15), r('Research completed', 'research', 8), r('Company value', 'valuation', 50_000_000)], opens: ['Major Corporation status', 'Hyperscale-class buildings'], reward: { cash: 2_000_000, xp: 5_000 }, big: true, stageUp: 3 },
  // ---- Major Corporation ----
  { id: 'g_campus', stage: 3, title: 'Large-Scale Campuses', icon: '🏟️', desc: 'Own a whole development zone and turn it into one campus site.', reqs: [r('Zones bought', 'zones', 1)], opens: ['Consolidate zones into campus sites'], reward: { cash: 1_000_000, xp: 3_000 } },
  { id: 'g_adv_infra', stage: 3, title: 'Advanced Infrastructure', icon: '⚡', desc: 'Finish ten research projects.', reqs: [r('Research completed', 'research', 10)], opens: ['Private substations', 'Turbine backup plants', 'Liquid cooling loops'], reward: { xp: 3_000 } },
  { id: 'g_staff', stage: 3, title: 'Talent Management', icon: '🎓', desc: 'Employ fifteen people.', reqs: [r('Employees', 'employees', 15)], opens: ['Staff promotions and training'], reward: { xp: 2_500 } },
  { id: 'g_tech', stage: 3, title: 'Frontier Technology', icon: '🚀', desc: 'Finish twelve research projects.', reqs: [r('Research completed', 'research', 12)], opens: ['Research tier 4'], reward: { xp: 4_000 } },
  { id: 'g_deals', stage: 3, title: 'Major Business Opportunities', icon: '💼', desc: 'Reach $250M in company value. Rivals will now take your calls.', reqs: [r('Company value', 'valuation', 250_000_000)], opens: ['Buy rival data centers', 'Takeover offers'], reward: { xp: 5_000 } },
  { id: 'g_hyperscale', stage: 3, title: 'Hyperscale', icon: '🏗️', desc: 'Complete a hyperscale-class data center.', reqs: [r('Hyperscale builds', 'hyperscale', 1)], opens: [], reward: { cash: 8_000_000, xp: 6_000 }, big: true },
  { id: 'g_country', stage: 3, title: 'Going International', icon: '✈️', desc: 'Operate in a second country.', reqs: [r('Countries', 'countries', 2)], opens: [], reward: { cash: 5_000_000, xp: 6_000 }, big: true },
  { id: 'g_stage4', stage: 3, title: 'Global Empire', icon: '🌍', desc: 'Fifteen sites across three countries and a $2B company.', reqs: [r('Data centers', 'facilities', 15), r('Countries', 'countries', 3), r('Company level', 'level', 35), r('Company value', 'valuation', 2_000_000_000)], opens: ['Global Empire status', 'The highest market rates'], reward: { cash: 50_000_000, xp: 30_000 }, big: true, stageUp: 4 },
  // ---- Global Empire ----
  { id: 'g_five_countries', stage: 4, title: 'Five Countries', icon: '🌐', desc: 'Operate in five countries.', reqs: [r('Countries', 'countries', 5)], opens: [], reward: { cash: 30_000_000, xp: 20_000 }, big: true },
  { id: 'g_mega', stage: 4, title: 'Gigawatt Campus', icon: '🏟️', desc: 'Complete a Mega AI Data Center Campus.', reqs: [r('Mega campuses', 'mega', 1)], opens: [], reward: { cash: 100_000_000, xp: 30_000 }, big: true },
  { id: 'g_leader', stage: 4, title: 'Number One', icon: '👑', desc: 'Become the most valuable company in the world.', reqs: [r('Most valuable company', 'leader', 1)], opens: [], reward: { cash: 100_000_000, xp: 40_000 }, big: true },
  { id: 'g_level50', stage: 4, title: 'Level 50', icon: '⭐', desc: 'Reach company level 50.', reqs: [r('Company level', 'level', 50)], opens: [], reward: { cash: 250_000_000, xp: 0 }, big: true },
];
const GOAL_MAP = new Map(GOALS.map((g) => [g.id, g]));
export const goalById = (id: string) => GOAL_MAP.get(id);

/** Pages that open up with a goal. Anything not listed is always available. */
export const PAGE_GOAL: Record<string, string> = {
  construction: 'g_property', datacenters: 'g_first_build', equipment: 'g_first_build', contracts: 'g_operational',
  employees: 'g_profit', competitors: 'g_profit', research: 'g_research', suppliers: 'g_suppliers',
  network: 'g_network', markets: 'g_stage2', strategy: 'g_strategy',
};
export const pageLocked = (s: GameState, page: string): GoalDef | undefined => {
  const g = PAGE_GOAL[page];
  return g && !hasFeature(s, g) ? goalById(g) : undefined;
};

export interface ReqProgress { label: string; value: number; target: number; frac: number }
export function goalProgress(s: GameState, d: Derived, g: GoalDef): { reqs: ReqProgress[]; frac: number; met: boolean } {
  const reqs = g.reqs.map((q) => {
    const value = METRICS[q.metric](s, d);
    return { label: q.label, value, target: q.target, frac: Math.max(0, Math.min(1, value / q.target)) };
  });
  return { reqs, frac: reqs.reduce((a, x) => a + x.frac, 0) / reqs.length, met: reqs.every((x) => x.value >= x.target) };
}

/** Unfinished goals for the current stage first, closest to done at the top. Never empty. */
export function nextGoals(s: GameState, d: Derived, n = 3): (GoalDef & { frac: number })[] {
  const open = GOALS.filter((g) => s.career.done[g.id] === undefined);
  const rows = open.map((g) => ({ ...g, frac: goalProgress(s, d, g).frac }));
  const stage = s.career.stage;
  return rows
    .sort((a, b) => Math.abs(a.stage - stage) - Math.abs(b.stage - stage) || GOALS.findIndex((x) => x.id === a.id) - GOALS.findIndex((x) => x.id === b.id))
    .slice(0, n);
}

/** After the last goal, value milestones keep going forever. */
export function endlessGoal(s: GameState): { target: number; xp: number } {
  const next = Math.max(s.career.endless + 1, 10);
  return { target: Math.pow(10, next), xp: 20_000 * (next - 8) };
}

export interface Milestone { id: string; title: string; body: string; icon: string; opens: string[]; reward: string; big: boolean; stage?: string }

function completeGoal(s: GameState, g: GoalDef) {
  s.career.done[g.id] = s.gameHours;
  if (g.stageUp !== undefined) s.career.stage = Math.max(s.career.stage, g.stageUp);
  // older companies get the recognition, but their economy stays exactly as it was
  const cash = isCareer(s) ? g.reward?.cash : 0;
  if (cash) receive(s, cash, 'Rewards', `Milestone: ${g.title}`);
  if (g.reward?.xp) addXp(s, g.reward.xp, 'Milestone');
  log(s, `Milestone reached: ${g.title}`, 'good');
  const reward = [cash ? `+${money(cash)}` : '', g.reward?.xp ? `+${g.reward.xp.toLocaleString()} XP` : ''].filter(Boolean).join(' · ');
  if (g.stageUp !== undefined) pushNews(s, `${s.company.name} is now a ${stageDef(s).name}`, stageDef(s).blurb, 'good', 'Company');
  sfx(g.big ? 'levelup' : 'achievement');
  const m: Milestone = { id: g.id, title: g.title, body: g.desc, icon: g.icon, opens: g.opens, reward, big: !!g.big, stage: g.stageUp !== undefined ? stageDef(s).name : undefined };
  if (!g.big) toast({ title: g.opens.length ? `Unlocked: ${g.title}` : `Milestone: ${g.title}`, body: g.opens.length ? g.opens.join(' · ') : `${g.desc}${reward ? ` ${reward}` : ''}`, kind: 'achievement', icon: g.icon });
  emit('milestone', m);
  emit('world');
}

/** Run on every game-hour rollover and while time is stopped. */
export function checkCareer(s: GameState, d: Derived, hours: number) {
  const c = s.career;
  if (isCareer(s) && hours > 0) {
    const live = Object.values(s.facilities).some((f) => !f.isHQ && (d.fac[f.id]?.cu ?? 0) > 0);
    c.profitHours = live && d.totals.profitHr > 0 ? c.profitHours + hours : Math.max(0, c.profitHours - hours * 2);
  }
  // an older company arrives with most of this already behind it: record that without any fanfare
  if (!c.seeded) {
    c.seeded = true;
    for (const g of GOALS) {
      // the garage years don't apply to a company that skipped them
      const skipped = !isCareer(s) && g.stage === 0;
      if (skipped || goalProgress(s, d, g).met) { c.done[g.id] = s.gameHours; if (g.stageUp !== undefined) c.stage = Math.max(c.stage, g.stageUp); }
    }
    return;
  }
  for (const g of GOALS) {
    if (c.done[g.id] !== undefined) continue;
    // goals open up with their stage, so nothing later fires early (research before a first site, say)
    if (g.stage > c.stage) continue;
    if (goalProgress(s, d, g).met) completeGoal(s, g);
  }
  if (c.stage >= 4) {
    const e = endlessGoal(s);
    if (d.totals.valuation >= e.target) {
      c.endless = Math.round(Math.log10(e.target));
      addXp(s, e.xp, 'Milestone');
      sfx('levelup');
      emit('milestone', { id: `val${c.endless}`, title: `${money(e.target)} Company`, body: 'Another order of magnitude. The next one is already on the board.', icon: '💎', opens: [], reward: `+${e.xp.toLocaleString()} XP`, big: true } as Milestone);
    }
  }
}

// ---------- founder's freelance work ----------
const GIG_TIERS: { need: number; rate: number; secs: [number, number]; jobs: [string, string, string][] }[] = [
  { need: 0, rate: 18, secs: [20, 34], jobs: [
    ['Fix the Wi-Fi at the diner', 'Corner diner', '📶'], ['Clean malware off a shop PC', 'Hardware store', '🧹'], ['Set up a new office printer', 'Insurance office', '🖨️'],
    ['Recover a crashed laptop', 'Farmer down the road', '💻'], ['Wire a church office network', 'Community church', '🔌'], ['Back up the bakery books', 'Family bakery', '💾'],
  ] },
  { need: 6, rate: 28, secs: [38, 60], jobs: [
    ['Install security cameras', 'Grain co-op', '📹'], ['Build a clinic file server', 'Family clinic', '🗄️'], ['Network a farm office', 'Family farm', '🌾'],
    ['Migrate email to the cloud', 'Law office', '✉️'], ['Replace a failed router rack', 'Motel', '🛜'],
  ] },
  { need: 16, rate: 42, secs: [65, 100], jobs: [
    ['Monthly IT retainer', 'Oilfield services firm', '🛢️'], ['School computer lab refresh', 'School district', '🏫'], ['Bank branch network audit', 'Community bank', '🏦'],
    ['Disaster-recovery plan', 'County office', '🏛️'],
  ] },
  { need: 30, rate: 62, secs: [90, 140], jobs: [
    ['Managed backups contract', 'Regional hospital', '🏥'], ['Private cloud consulting', 'Manufacturing plant', '🏭'], ['Fiber rollout project', 'Regional ISP', '🌐'],
  ] },
];

export const gigTier = (done: number): number => { let t = 0; GIG_TIERS.forEach((x, i) => { if (done >= x.need) t = i; }); return t; };
export const nextGigTierAt = (done: number): number | undefined => GIG_TIERS.find((x) => x.need > done)?.need;
/** Once the data centers out-earn the founder by a wide margin, freelance work leaves the screen. */
export const gigsRelevant = (s: GameState, d: Derived): boolean => isCareer(s) && (s.career.stage < 2 || d.totals.profitHr < 400);

function makeBoard(s: GameState): Gig[] {
  const c = s.career;
  const top = gigTier(c.gigsDone);
  const out: Gig[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 3; i++) {
    // two jobs at your current level, one easier job you can always finish quickly
    const tier = i === 2 ? Math.max(0, top - 1) : top;
    const def = GIG_TIERS[tier];
    let job = pick(def.jobs);
    for (let k = 0; k < 6 && used.has(job[0]); k++) job = pick(def.jobs);
    used.add(job[0]);
    const seconds = Math.round(randRange(def.secs[0], def.secs[1]));
    const pay = Math.round((seconds * def.rate * randRange(0.9, 1.12)) / 10) * 10;
    c.boardAt = s.gameHours;
    s.idCounter++;
    out.push({ id: `gig${s.idCounter.toString(36)}`, title: job[0], client: job[1], icon: job[2], seconds, pay, tier });
  }
  return out;
}

export function ensureBoard(s: GameState) {
  if (!isCareer(s)) return;
  if (!s.career.board.length || s.gameHours - s.career.boardAt > 240) s.career.board = makeBoard(s);
}

export function startGig(s: GameState, id: string): { ok: boolean; reason?: string } {
  const c = s.career;
  if (!isCareer(s)) return { ok: false, reason: 'Not available' };
  if (c.gig) return { ok: false, reason: 'Finish the job you are on first' };
  const def = c.board.find((g) => g.id === id);
  if (!def) return { ok: false, reason: 'That job is gone' };
  c.gig = { def, done: 0 };
  c.board = c.board.filter((g) => g.id !== id);
  sfx('nav');
  return { ok: true };
}

export function setAutoGigs(s: GameState, on: boolean): { ok: boolean; reason?: string } {
  if (!hasFeature(s, 'g_steady')) return { ok: false, reason: 'Finish 8 jobs first' };
  s.career.autoGigs = on;
  if (on && !s.career.gig) pickBestGig(s);
  return { ok: true };
}

function pickBestGig(s: GameState) {
  ensureBoard(s);
  const best = [...s.career.board].sort((a, b) => b.pay / b.seconds - a.pay / a.seconds)[0];
  if (best) s.career.gig = { def: best, done: 0 }, s.career.board = s.career.board.filter((g) => g.id !== best.id);
}

// The founder can't be out on a job while the game is closed.
let founderAway = false;
export const setFounderAway = (v: boolean) => { founderAway = v; };

function tickHookups(s: GameState, sec: number) {
  for (const f of Object.values(s.facilities)) {
    const h = f.hookups;
    if (!h || (h.power === 0 && h.net === 0)) continue;
    const was = hookupsDone(f);
    if (h.power > 0) h.power = Math.max(0, h.power - sec);
    if (h.net > 0) h.net = Math.max(0, h.net - sec);
    if (!was && hookupsDone(f)) {
      stat(s, 'hookups');
      log(s, `${f.name} is connected to power and internet`, 'build');
      toast({ title: 'Site connected', body: `${f.name} has power and internet. Rack some servers.`, kind: 'good', icon: '🔌', dcId: f.id });
      sfx('complete');
      emit('world');
    }
  }
}

export function tickCareerFrozen(s: GameState, realSeconds: number) {
  if (isCareer(s)) tickHookups(s, realSeconds);
}

export function tickCareer(s: GameState, realSeconds: number) {
  if (!isCareer(s)) return;
  tickHookups(s, realSeconds);
  const c = s.career;
  if (founderAway) return;
  if (c.gig) {
    c.gig.done += realSeconds;
    if (c.gig.done >= c.gig.def.seconds) {
      const g = c.gig.def;
      c.gig = undefined;
      c.gigsDone++;
      receive(s, g.pay, 'Freelance Work', `${g.title} (${g.client})`);
      addXp(s, 6 + g.tier * 6, 'Freelance');
      s.company.reputation = Math.min(100, s.company.reputation + 0.05);
      const tierUp = GIG_TIERS.some((x) => x.need === c.gigsDone);
      if (tierUp) toast({ title: 'Bigger clients are calling', body: 'Word of mouth brought better paying jobs to your board.', kind: 'good', icon: '📞' });
      sfx('cash');
      c.board = makeBoard(s);
      if (c.autoGigs) pickBestGig(s);
    }
  } else if (s.stats.gigTick === undefined || s.gameHours - s.stats.gigTick > 30) {
    s.stats.gigTick = s.gameHours;
    ensureBoard(s);
  }
}

// ---------- garage rack ----------
export function garageQuote(s: GameState): { ok: boolean; reason?: string; cost: number; netHr: number } {
  const g = C.garage;
  const cost = Math.round((g.price * Math.pow(g.growth, s.career.garage)) / 100) * 100;
  const netHr = g.incomeHr - g.powerHr;
  if (!isCareer(s)) return { ok: false, reason: 'Not available', cost, netHr };
  if (s.career.garage >= g.max) return { ok: false, reason: 'The garage is full', cost, netHr };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost, netHr };
  return { ok: true, cost, netHr };
}
export function buyGarageServer(s: GameState): { ok: boolean; reason?: string } {
  const q = garageQuote(s);
  if (!q.ok) return q;
  spend(s, q.cost, 'Equipment', 'Used server for the garage rack');
  s.career.garage++;
  log(s, `Added a used server to the garage rack (${s.career.garage}/${C.garage.max})`, 'build');
  sfx('install');
  emit('world');
  return { ok: true };
}

// ---------- startup financing ----------
export function loanOffer(s: GameState, kind: 'construction' | 'equipment'): { ok: boolean; reason?: string; amount: number } {
  if (!isCareer(s)) return { ok: false, reason: 'Not available', amount: 0 };
  if (s.career.loans[kind]) return { ok: false, reason: 'Already taken', amount: s.career.loans[kind]! };
  if (kind === 'equipment') {
    if (!hasFeature(s, 'g_first_build')) return { ok: false, reason: 'Finish your first data center first', amount: C.equipmentLoan };
    return { ok: true, amount: C.equipmentLoan };
  }
  const pid = s.company.startParcel;
  if (!hasFeature(s, 'g_property') || !pid || parcelState(s, pid).owner !== 'player') return { ok: false, reason: 'Own your first property first', amount: 0 };
  const quote = quoteBuild(s, pid, 'modular');
  return { ok: true, amount: Math.round((quote.total * C.constructionLoanShare) / 1000) * 1000 };
}
export function takeStartupLoan(s: GameState, kind: 'construction' | 'equipment'): { ok: boolean; reason?: string } {
  const q = loanOffer(s, kind);
  if (!q.ok) return q;
  s.debt += q.amount;
  s.cash += q.amount;
  s.career.loans[kind] = q.amount;
  pushTx(s, q.amount, 'Loan', kind === 'construction' ? 'Construction loan' : 'Equipment financing');
  log(s, `The bank approved a ${money(q.amount)} ${kind === 'construction' ? 'construction loan' : 'equipment loan'}`, 'money');
  toast({ title: 'Loan approved', body: `${money(q.amount)} is in your account. Interest is charged every hour until you repay it on the Finances page.`, kind: 'good', icon: '🏦' });
  sfx('cash');
  emit('world');
  return { ok: true };
}

// ---------- utility hookups ----------
export function hookupQuote(s: GameState, f: Facility, kind: 'power' | 'net'): { ok: boolean; reason?: string; cost: number; seconds: number } {
  const h = C.hookup;
  const base = kind === 'power' ? h.powerBase + f.basePower * h.powerPerKw : h.netBase + f.slots * h.netPerSlot;
  // the utility already knows the town: later sites only need a new service drop
  const neighbor = Object.values(s.facilities).some((x) => x.id !== f.id && x.cityId === f.cityId && !x.isHQ && hookupsDone(x));
  const staff = kind === 'power' ? deptBonus(s, 'electrical') : deptBonus(s, 'it');
  const cost = Math.round((base * cityById(f.cityId).constructionMult * (neighbor ? 1 - h.sameCityCut : 1) * (1 - staff * 0.5)) / 100) * 100;
  const seconds = Math.round(h.seconds * (1 - builderExperience(s)) * (neighbor ? 0.6 : 1));
  const cur = f.hookups?.[kind];
  if (cur === undefined || cur === 0) return { ok: false, reason: 'Already connected', cost, seconds };
  if (cur > 0) return { ok: false, reason: 'Work in progress', cost, seconds };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost, seconds };
  return { ok: true, cost, seconds };
}
export function orderHookup(s: GameState, facilityId: string, kind: 'power' | 'net'): { ok: boolean; reason?: string } {
  const f = s.facilities[facilityId];
  if (!f?.hookups) return { ok: false, reason: 'Already connected' };
  const q = hookupQuote(s, f, kind);
  if (!q.ok) return q;
  spend(s, q.cost, 'Construction', `${kind === 'power' ? 'Electric service' : 'Fiber connection'}: ${f.name}`);
  f.hookups[kind] = q.seconds;
  log(s, `${kind === 'power' ? 'Utility crew' : 'Fiber crew'} is on the way to ${f.name}`, 'build');
  sfx('build');
  emit('world');
  return { ok: true };
}
