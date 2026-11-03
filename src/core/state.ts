// Game state model. Everything in GameState is persisted.

import type { CapType, CustomOptions } from '../config/buildings';
import type { CustomerType, Department } from '../config/content';

export const SAVE_VERSION = 4;

export type ParcelStatus = 'existing' | 'cleared' | 'demolishing' | 'construction' | 'facility' | 'hq';

export interface ParcelState {
  owner: string | null; // 'player' | competitor id | null
  status: ParcelStatus;
  facilityId?: string;
  projectId?: string;
  mergedInto?: string; // member lot consolidated into a zone mega-site
  boughtFor?: number;
  boughtAt?: number;
}

export interface Facility {
  id: string;
  parcelId: string;
  cityId: string;
  name: string;
  blueprintId: string;
  custom?: CustomOptions;
  slots: number;
  bays: number;
  basePower: number;
  baseCooling: number;
  floors: number;
  style: string;
  color: string;
  footprint: number;
  equipment: Record<string, number>;
  condition: number; // 0-100
  builtAt: number; // game hours
  buildCost: number;
  shellValue: number;
  equipmentSpent: number;
  revenueTotal: number;
  profitTotal: number;
  isHQ?: boolean;
  autoRepair?: boolean;
  /** Hardware on its way from a supplier: takes up space but doesn't run yet. */
  orders?: { eq: string; n: number; at: number }[];
  /** Weighted quality of installed hardware by supplier category. */
  vendor?: Record<string, { n: number; perf: number; rel: number }>;
  /** Acquired sites run below par until they are integrated. */
  integrateUntil?: number;
}

export interface Project {
  id: string;
  kind: 'demolish' | 'build';
  parcelId: string;
  cityId: string;
  totalSeconds: number;
  doneSeconds: number;
  cost: number;
  breakdown: Record<string, number>;
  startedAt: number; // game hours
  workers: number;
  speedSpent: number;
  draft?: {
    name: string;
    blueprintId: string;
    custom?: CustomOptions;
    slots: number;
    bays: number;
    power: number;
    cooling: number;
    floors: number;
    style: string;
    color: string;
    footprint: number;
    isHQ?: boolean;
  };
}

export interface Contract {
  id: string;
  customer: string;
  ctype: CustomerType;
  label: string; // contract type label
  cap: CapType;
  amount: number;
  ratePerHour: number;
  hours: number; // total length (game hours)
  hoursLeft: number;
  sla: number;
  security: number;
  bonus: number; // signing bonus
  facilityId?: string;
  expiresAt?: number; // offer expiry (game hours)
  fulfillment: number;
  earned: number;
  breachHours: number;
  status: 'offer' | 'active' | 'completed' | 'cancelled' | 'lost';
  cityPref?: string;
}

export interface Employee {
  id: string;
  name: string;
  dept: Department;
  skill: number; // 1-5
  exp: number; // game hours worked
  perf: number; // 0-100
  salary: number; // $/game hour
  assigned: string; // 'hq' or facility id
  hiredAt: number;
}

export interface CompSite {
  parcelId: string;
  cityId: string;
  stage: 'demolish' | 'build' | 'operational';
  progress: number;
  total: number;
  cu: number;
  maxCu: number;
  blueprintId: string;
  invested: number;
}

export interface Competitor {
  id: string;
  name: string;
  color: string;
  logo: string;
  personality: string;
  aggression: number;
  profitFocus: number;
  techFocus: number;
  frugality: number;
  cash: number;
  techLevel: number;
  research: number; // progress to next tech level
  sites: CompSite[];
  revenueHr: number;
  expenseHr: number;
  valuation: number;
  history: number[];
  contractsWon: number;
  nextThink: number;
  desc: string;
  lastAction: string;
  /** Added to the asking price after a rejected offer. */
  askMult?: number;
}

export interface Tx {
  t: number; // game hours
  amount: number;
  cat: string;
  desc: string;
}

export interface Report {
  t: number; // period start (game hours)
  revenue: Record<string, number>;
  expenses: Record<string, number>;
  capex: number;
}

export interface ActiveEvent {
  id: string;
  defId: string;
  cityId?: string;
  region?: string;
  country?: string;
  supplier?: string;
  endsAt: number;
  startedAt: number;
}

export interface Mission {
  id: string;
  title: string;
  desc: string;
  metric: string;
  target: number;
  base: number;
  reward: { cash?: number; xp?: number };
  done?: boolean;
  claimed?: boolean;
}

export interface Settings {
  graphics: 'low' | 'medium' | 'high';
  cameraSensitivity: number;
  invertZoom: boolean;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  uiScale: number;
  reduceMotion: boolean;
  forceFallbackMap: boolean;
  showFps: boolean;
  autosaveSeconds: number;
  mapLabels: boolean;
  timeOfDay: 'auto' | 'day' | 'sunset' | 'night';
  bloom: boolean;
  autoContracts: boolean;
  autoLoan: boolean;
  celebrations: boolean;
  contractAlerts: 'all' | 'problems' | 'off';
  autoAssignStaff: boolean;
}

export interface LogEntry {
  t: number;
  msg: string;
  kind: 'info' | 'good' | 'bad' | 'build' | 'money' | 'comp';
}

export interface GameState {
  version: number;
  seed: number;
  createdAt: number;
  lastRealTime: number;
  gameHours: number;
  speed: number;
  paused: boolean;
  difficulty: string;
  company: {
    name: string;
    logo: string;
    color: string;
    startCity: string;
    startParcel?: string;
    hqTier: number;
    hqFacility?: string;
    reputation: number;
    founded: number;
  };
  cash: number;
  debt: number;
  xp: number;
  level: number;
  unlockedCities: string[];
  parcels: Record<string, ParcelState>;
  facilities: Record<string, Facility>;
  projects: Record<string, Project>;
  research: { done: string[]; active?: { id: string; done: number; total: number } };
  employees: Employee[];
  candidates: Employee[];
  candidatesAt: number;
  contracts: { offers: Contract[]; active: Contract[]; history: Contract[]; nextOfferAt: number };
  competitors: Competitor[];
  finance: {
    ledger: Tx[];
    hourly: Report[];
    daily: Report[];
    monthly: Report[];
    cur: { hour: Report; day: Report; month: Report };
    totalRevenue: number;
    totalExpenses: number;
    totalCapex: number;
    valuationHistory: number[];
    lastHourProfit: number;
    avgHourProfit: number;
  };
  achievements: Record<string, number>;
  missions: { tutorial: number; daily: { date: string; items: Mission[] }; claimed: string[] };
  events: ActiveEvent[];
  nextEventAt: number;
  stats: Record<string, number>;
  log: LogEntry[];
  settings: Settings;
  cityDemand: Record<string, number>;
  idCounter: number;
  permanent: Record<string, number>; // permanent bonuses from achievements
  offline: { capHours: number };
  /** Temporary bonuses/maluses from opportunity cards. */
  buffs?: Buff[];
  /** Pending opportunity card. */
  decision?: PendingDecision;
  nextDecisionAt?: number;
  // ---- global expansion (always present once a save has been loaded or created) ----
  news: NewsItem[];
  newsState: { rank: number; sat: Record<string, number> };
  policies: Record<string, string>;
  policyAt: Record<string, number>;
  citySpec: Record<string, { spec: string; since: number }>;
  fiber: { routes: FiberRoute[]; hubs: Record<string, number> };
  supply: { chosen: Record<string, string>; deals: Record<string, SupplyDeal>; gen: Record<string, number> };
  rep: { history: number[]; parts: Record<string, number> };
  integrations: Integration[];
  dealCooldown: Record<string, number>;
  /** Developer testing overrides. Absent in normal play. */
  dev?: DevOverrides;
}

export interface DevOverrides { land?: number; construction?: number; equipment?: number; electricity?: number; sale?: number; unlockAll?: boolean }

export interface NewsItem { t: number; title: string; body?: string; kind: 'good' | 'bad' | 'info' | 'comp'; tag: string }
export interface FiberRoute { id: string; link: string; owner: string; tier: number; startedAt: number; doneAt: number; invested: number }
export interface SupplyDeal { supplier: string; until: number; discount: number }
export interface Integration { name: string; until: number; costHr: number }

export interface Buff {
  key: string;
  value: number;
  endsAt: number;
  label: string;
}

export interface PendingDecision {
  id: string;
  defId: string;
  expiresAt: number;
  data: Record<string, number>;
}

export function defaultSettings(): Settings {
  return {
    graphics: 'high',
    cameraSensitivity: 1,
    invertZoom: false,
    sfxVolume: 0.6,
    musicVolume: 0.25,
    muted: false,
    uiScale: 1,
    reduceMotion: false,
    forceFallbackMap: false,
    showFps: false,
    autosaveSeconds: 15,
    mapLabels: true,
    timeOfDay: 'auto',
    bloom: true,
    autoContracts: false,
    autoLoan: true,
    celebrations: true,
    contractAlerts: 'all',
    autoAssignStaff: false,
  };
}

export function emptyReport(t: number): Report {
  return { t, revenue: {}, expenses: {}, capex: 0 };
}

export function newId(s: GameState, prefix: string): string {
  s.idCounter++;
  return `${prefix}${s.idCounter.toString(36)}`;
}
