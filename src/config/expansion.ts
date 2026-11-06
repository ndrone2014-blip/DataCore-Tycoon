// Balancing data for the global expansion: country rules, regional focuses, company policies,
// hardware suppliers and the fiber network. Every number here changes real gameplay.

import type { EffectKey } from './research';
import { cityById } from './world';

// ---------- Country rules ----------
export interface CountryRule {
  label: string;
  /** Multiplier on property tax. */
  taxMult: number;
  /** Multiplier on construction cost, and on build time. */
  permitCost: number;
  permitTime: number;
  /** Facilities above this PUE pay a compliance fee (share of their power bill). */
  pueLimit: number;
  carbonFee: number;
  /** Minimum security tier customers require here because of privacy law. */
  privacyTier: number;
  /** How often government agencies come looking for capacity. */
  govDemand: number;
  note: string;
}

export const COUNTRY_RULES: Record<string, CountryRule> = {
  US: { label: 'Business friendly', taxMult: 0.95, permitCost: 1, permitTime: 1, pueLimit: 9, carbonFee: 0, privacyTier: 0, govDemand: 1.4, note: 'Light regulation and big federal contracts.' },
  CA: { label: 'Clean power incentives', taxMult: 1, permitCost: 0.92, permitTime: 1.05, pueLimit: 1.6, carbonFee: 0.06, privacyTier: 0, govDemand: 1, note: 'Provinces subsidise construction but expect efficient sites.' },
  GB: { label: 'Tight planning', taxMult: 1.05, permitCost: 1.15, permitTime: 1.3, pueLimit: 1.5, carbonFee: 0.08, privacyTier: 1, govDemand: 1.1, note: 'Slow permits and UK data protection rules.' },
  DE: { label: 'Strict efficiency law', taxMult: 1.1, permitCost: 1.2, permitTime: 1.25, pueLimit: 1.4, carbonFee: 0.14, privacyTier: 1, govDemand: 0.9, note: 'Hard PUE limits and strong privacy law.' },
  FR: { label: 'Nuclear-backed incentives', taxMult: 1, permitCost: 0.95, permitTime: 1.1, pueLimit: 1.5, carbonFee: 0.07, privacyTier: 1, govDemand: 1.2, note: 'State support for digital infrastructure.' },
  NL: { label: 'Grid-constrained', taxMult: 1.05, permitCost: 1.25, permitTime: 1.4, pueLimit: 1.35, carbonFee: 0.12, privacyTier: 1, govDemand: 0.8, note: 'Permits are scarce, and only efficient sites get them cheaply.' },
  JP: { label: 'Quality first', taxMult: 1.05, permitCost: 1.1, permitTime: 1.15, pueLimit: 1.5, carbonFee: 0.05, privacyTier: 1, govDemand: 1, note: 'Demanding customers and careful regulators.' },
  KR: { label: 'Tech-sector support', taxMult: 0.9, permitCost: 0.95, permitTime: 0.95, pueLimit: 1.55, carbonFee: 0.05, privacyTier: 0, govDemand: 1, note: 'Fast approvals for technology investment.' },
  SG: { label: 'Green data center quota', taxMult: 0.85, permitCost: 1.35, permitTime: 1.2, pueLimit: 1.3, carbonFee: 0.18, privacyTier: 1, govDemand: 1.1, note: 'Low tax, but permits go to the most efficient builders.' },
  AU: { label: 'Open market', taxMult: 1, permitCost: 1, permitTime: 1, pueLimit: 1.65, carbonFee: 0.05, privacyTier: 0, govDemand: 1.2, note: 'Stable rules and steady public-sector demand.' },
};

// ---------- Regional focus ----------
export type CapRates = { cpu: number; gpu: number; storage: number };
export interface CitySpecDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Spot-market rate changes by capacity type, also applied to new contract offers. */
  rates: CapRates;
  contractRate: number;
  connectivity: number;
  opex: number;
  offerRate: number;
  /** Customer types drawn to this kind of hub. */
  draws: string[];
}

export const CITY_SPECS: CitySpecDef[] = [
  { id: 'ai', name: 'AI Computing Hub', icon: '🧠', desc: 'AI labs come to you. GPU work pays more, everything else a little less.', rates: { cpu: -0.05, gpu: 0.1, storage: -0.05 }, contractRate: 0, connectivity: 0, opex: 0, offerRate: 0.05, draws: ['startup', 'research', 'tech'] },
  { id: 'cloud', name: 'Cloud Region', icon: '☁️', desc: 'General compute and storage at volume. GPU rates slip.', rates: { cpu: 0.1, gpu: -0.05, storage: 0.12 }, contractRate: 0, connectivity: 0, opex: 0, offerRate: 0.05, draws: ['small', 'corp', 'tech'] },
  { id: 'enterprise', name: 'Enterprise & Finance', icon: '🏦', desc: 'Premium customers pay better rates, but expect higher security and bring less volume.', rates: { cpu: 0, gpu: 0, storage: 0 }, contractRate: 0.1, connectivity: 0, opex: 0.02, offerRate: -0.1, draws: ['corp', 'government'] },
  { id: 'scale', name: 'Hyperscale Campus', icon: '🏗️', desc: 'Run big and cheap. Lower upkeep, thinner contract margins.', rates: { cpu: 0, gpu: 0, storage: 0 }, contractRate: -0.04, connectivity: 0, opex: -0.12, offerRate: 0, draws: ['tech'] },
  { id: 'hub', name: 'Network Hub', icon: '🌐', desc: 'A meeting point for carriers. Far cheaper connectivity and better transit income.', rates: { cpu: -0.02, gpu: -0.02, storage: -0.02 }, contractRate: 0.02, connectivity: -0.5, opex: 0, offerRate: 0.03, draws: ['small', 'tech'] },
];
export const citySpecById = (id: string) => CITY_SPECS.find((c) => c.id === id);

/** What each market is naturally good at. Matching it makes the focus 50% stronger; you can still pick anything. */
export const CITY_NATURAL: Record<string, string> = {
  nova: 'cloud', chicago: 'enterprise', dallas: 'scale', phoenix: 'ai', newyork: 'enterprise', losangeles: 'hub', toronto: 'cloud',
  amsterdam: 'hub', frankfurt: 'cloud', london: 'hub', paris: 'enterprise', singapore: 'hub', tokyo: 'ai', seoul: 'ai', sydney: 'cloud', melbourne: 'scale',
};
export const SPEC_COOLDOWN_HOURS = 480;
export const specFee = (cityId: string) => Math.max(150_000, Math.round(cityById(cityId).license * 0.2));

// ---------- Company policies ----------
export type PolicyEffects = Partial<Record<EffectKey, number>>;
export interface PolicyOption { id: string; label: string; icon: string; desc: string; pros: string[]; cons: string[]; effects: PolicyEffects }
export interface PolicyDef { id: string; title: string; question: string; level: number; options: PolicyOption[] }

export const POLICIES: PolicyDef[] = [
  {
    id: 'focus', title: 'Compute focus', question: 'What kind of workload does the company chase?', level: 3,
    options: [
      { id: 'balanced', label: 'Balanced fleet', icon: '⚖️', desc: 'Sell whatever customers ask for.', pros: ['No exposure to one market'], cons: ['No specialist premium'], effects: {} },
      { id: 'ai', label: 'AI first', icon: '🧠', desc: 'Commit the brand to AI compute.', pros: ['+12% GPU rates'], cons: ['−10% CPU and storage rates'], effects: { gpuRate: 0.12, cpuRate: -0.1, storageRate: -0.1 } },
      { id: 'cloud', label: 'Cloud first', icon: '☁️', desc: 'Win general-purpose workloads.', pros: ['+12% CPU and storage rates'], cons: ['−10% GPU rates'], effects: { gpuRate: -0.1, cpuRate: 0.12, storageRate: 0.12 } },
    ],
  },
  {
    id: 'pricing', title: 'Pricing position', question: 'How do you compete for customers?', level: 4,
    options: [
      { id: 'market', label: 'Market rates', icon: '🏷️', desc: 'Stay in the middle of the pack.', pros: ['Steady deal flow'], cons: ['No pricing edge'], effects: {} },
      { id: 'premium', label: 'Premium service', icon: '💎', desc: 'Charge more and earn it.', pros: ['+12% contract rates', '+5 reputation target'], cons: ['30% fewer offers'], effects: { contractRate: 0.12, offerRate: -0.3, repBase: 5 } },
      { id: 'value', label: 'Price leader', icon: '📉', desc: 'Undercut rivals for volume.', pros: ['45% more offers'], cons: ['−10% contract rates', '−4 reputation target'], effects: { contractRate: -0.1, offerRate: 0.45, repBase: -4 } },
    ],
  },
  {
    id: 'growth', title: 'Growth strategy', question: 'Where does expansion money go?', level: 5,
    options: [
      { id: 'steady', label: 'Steady growth', icon: '📈', desc: 'Expand as opportunities appear.', pros: ['No extra overhead'], cons: ['No expansion discounts'], effects: {} },
      { id: 'global', label: 'Global expansion', icon: '🌍', desc: 'Plant flags in new countries fast.', pros: ['−30% market licenses', '−20% fiber costs'], cons: ['+12% salaries for international staff'], effects: { licenseCost: -0.3, fiberCost: -0.2, salaryCost: 0.12 } },
      { id: 'dominate', label: 'Dominate home markets', icon: '🏰', desc: 'Go deep where you already are.', pros: ['Regional focus bonuses +40%', '−6% construction cost'], cons: ['+40% market licenses'], effects: { specBoost: 0.4, buildCost: 0.06, licenseCost: 0.4 } },
    ],
  },
  {
    id: 'capital', title: 'Capital priority', question: 'What does the board fund first?', level: 6,
    options: [
      { id: 'standard', label: 'Balanced budget', icon: '🧾', desc: 'Keep departments funded evenly.', pros: ['No trade-offs'], cons: ['No special advantage'], effects: {} },
      { id: 'rnd', label: 'Invest in research', icon: '🔬', desc: 'Pour revenue into the labs.', pros: ['+40% research speed'], cons: ['3% of revenue goes to R&D'], effects: { researchSpeed: 0.4, rndBudget: 0.03 } },
      { id: 'lean', label: 'Cut expenses', icon: '✂️', desc: 'Run a tight ship.', pros: ['−10% maintenance and upkeep'], cons: ['35% faster facility wear', '−25% research speed', '−3 reputation target'], effects: { opex: -0.1, decay: -0.35, researchSpeed: -0.25, repBase: -3 } },
    ],
  },
];
export const POLICY_COOLDOWN_HOURS = 360;

// ---------- Hardware suppliers ----------
export type SupplyCat = 'cpu' | 'gpu' | 'storage' | 'network' | 'cooling' | 'power';
export const SUPPLY_CATS: { id: SupplyCat; label: string; icon: string }[] = [
  { id: 'cpu', label: 'CPUs', icon: '🖥️' },
  { id: 'gpu', label: 'GPUs & accelerators', icon: '🧠' },
  { id: 'storage', label: 'Storage systems', icon: '💾' },
  { id: 'network', label: 'Networking', icon: '🔀' },
  { id: 'cooling', label: 'Cooling systems', icon: '❄️' },
  { id: 'power', label: 'Power equipment', icon: '🔌' },
];
export interface SupplierDef { id: string; name: string; cat: SupplyCat; tag: string; price: number; perf: number; rel: number; lead: number; level: number; desc: string }
const std = (cat: SupplyCat, name: string): SupplierDef => ({ id: `std_${cat}`, name, cat, tag: 'Standard', price: 1, perf: 1, rel: 1, lead: 0, level: 1, desc: 'The default catalog. Fair prices, immediate delivery from local stock.' });
export const SUPPLIERS: SupplierDef[] = [
  std('cpu', 'Northline Systems'),
  { id: 'cpu_budget', name: 'Corvid Compute', cat: 'cpu', tag: 'Budget', price: 0.84, perf: 0.95, rel: 1.25, lead: 18, level: 2, desc: 'Grey-box servers. Cheap to buy, needier to run, shipped by sea.' },
  { id: 'cpu_premium', name: 'Atlas Foundry', cat: 'cpu', tag: 'Premium', price: 1.16, perf: 1.08, rel: 0.85, lead: 8, level: 6, desc: 'Binned silicon with first-class support contracts.' },
  std('gpu', 'Meridian Graphics'),
  { id: 'gpu_budget', name: 'Kestrel Silicon', cat: 'gpu', tag: 'Budget', price: 0.86, perf: 0.94, rel: 1.3, lead: 30, level: 3, desc: 'A hungry challenger selling on price. Long queues, more failures.' },
  { id: 'gpu_premium', name: 'Helion Compute', cat: 'gpu', tag: 'Premium', price: 1.18, perf: 1.09, rel: 0.82, lead: 12, level: 8, desc: 'The accelerator everyone wants. Top performance, top dollar.' },
  std('storage', 'Stackwell Storage'),
  { id: 'storage_budget', name: 'Basalt Drives', cat: 'storage', tag: 'Budget', price: 0.82, perf: 0.96, rel: 1.25, lead: 14, level: 2, desc: 'Bulk spinning rust at a keen price.' },
  { id: 'storage_premium', name: 'Quartzline Flash', cat: 'storage', tag: 'Premium', price: 1.14, perf: 1.08, rel: 0.85, lead: 6, level: 7, desc: 'Enterprise-grade arrays with long warranties.' },
  std('network', 'Crosspoint Networks'),
  { id: 'network_budget', name: 'Pylon Switching', cat: 'network', tag: 'Budget', price: 0.85, perf: 0.92, rel: 1.2, lead: 12, level: 3, desc: 'White-box switches. They do the job, mostly.' },
  { id: 'network_premium', name: 'Aurora Optics', cat: 'network', tag: 'Premium', price: 1.15, perf: 1.15, rel: 0.85, lead: 6, level: 7, desc: 'Each switch carries more servers than the competition.' },
  std('cooling', 'Polaris Thermal'),
  { id: 'cooling_budget', name: 'Breezeway HVAC', cat: 'cooling', tag: 'Budget', price: 0.84, perf: 0.94, rel: 1.2, lead: 16, level: 2, desc: 'Commercial HVAC adapted for server rooms.' },
  { id: 'cooling_premium', name: 'Glacier Dynamics', cat: 'cooling', tag: 'Premium', price: 1.17, perf: 1.1, rel: 0.85, lead: 10, level: 7, desc: 'More cooling out of every bay.' },
  std('power', 'Keystone Electric'),
  { id: 'power_budget', name: 'Ampere Works', cat: 'power', tag: 'Budget', price: 0.85, perf: 0.94, rel: 1.2, lead: 20, level: 2, desc: 'Basic switchgear with long factory lead times.' },
  { id: 'power_premium', name: 'Voltaic Grid Systems', cat: 'power', tag: 'Premium', price: 1.16, perf: 1.1, rel: 0.85, lead: 10, level: 7, desc: 'More capacity from each bay and rock-solid uptime.' },
];
const SUPPLIER_MAP = new Map(SUPPLIERS.map((x) => [x.id, x]));
export const supplierById = (id: string) => SUPPLIER_MAP.get(id);
export const SUPPLY_DEALS = [
  { id: 'd30', label: '30-day bulk agreement', days: 30, discount: 0.08, feeShare: 0.004, minFee: 60_000 },
  { id: 'd90', label: '90-day supply contract', days: 90, discount: 0.14, feeShare: 0.01, minFee: 150_000 },
];
export const MAX_SUPPLIER_GEN = 5;
export const GEN_PERF = 0.02;
export const GEN_PRICE = 0.01;

// ---------- Fiber network ----------
export type FiberKind = 'regional' | 'longhaul' | 'undersea';
export interface FiberLink { id: string; a: string; b: string; kind: FiberKind; km: number }
export const FIBER_KIND: Record<FiberKind, { label: string; perKm: number; level: number; hoursPerKm: number; icon: string }> = {
  regional: { label: 'Regional fiber', perKm: 900, level: 4, hoursPerKm: 0.07, icon: '〰️' },
  longhaul: { label: 'Long-haul backbone', perKm: 1400, level: 8, hoursPerKm: 0.055, icon: '🛰️' },
  undersea: { label: 'Undersea cable', perKm: 3200, level: 12, hoursPerKm: 0.05, icon: '🌊' },
};
const PAIRS: [string, string][] = [
  ['chicago', 'nova'], ['chicago', 'dallas'], ['dallas', 'phoenix'], ['phoenix', 'losangeles'], ['nova', 'newyork'], ['chicago', 'toronto'], ['newyork', 'toronto'], ['dallas', 'nova'], ['losangeles', 'dallas'], ['chicago', 'losangeles'],
  ['carmi', 'chicago'], ['carmi', 'nova'],
  ['london', 'amsterdam'], ['amsterdam', 'frankfurt'], ['london', 'paris'], ['paris', 'frankfurt'],
  ['tokyo', 'seoul'], ['seoul', 'singapore'], ['tokyo', 'singapore'], ['sydney', 'melbourne'],
  ['newyork', 'london'], ['nova', 'paris'], ['newyork', 'amsterdam'], ['losangeles', 'tokyo'], ['losangeles', 'sydney'], ['singapore', 'sydney'], ['frankfurt', 'singapore'], ['tokyo', 'sydney'],
];
function km(a: string, b: string): number {
  const [lo1, la1] = cityById(a).center, [lo2, la2] = cityById(b).center;
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
}
export const FIBER_LINKS: FiberLink[] = PAIRS.map(([a, b]) => {
  const d = km(a, b);
  const sameRegion = cityById(a).region === cityById(b).region;
  return { id: `${a}-${b}`, a, b, km: d, kind: !sameRegion ? 'undersea' : d <= 1500 ? 'regional' : 'longhaul' };
});
const LINK_MAP = new Map(FIBER_LINKS.map((l) => [l.id, l]));
export const fiberLink = (id: string) => LINK_MAP.get(id);
export const MAX_FIBER_TIER = 3;
/** Transit income pays a route back in about this many game hours when you are the only carrier. */
export const FIBER_PAYBACK_HOURS = 1000;
export const FIBER_UPKEEP_PER_HOUR = 0.00018;
export const HUB_LEVELS = [
  { level: 1, name: 'Network exchange', cost: 1_800_000, level_req: 6 },
  { level: 2, name: 'Regional internet hub', cost: 7_500_000, level_req: 14 },
];

const EQUIP_CAT: Record<string, SupplyCat> = {
  cpu_std: 'cpu', cpu_hd: 'cpu', gpu_ai: 'gpu', gpu_ent: 'gpu', accel: 'gpu', accel_x: 'gpu', storage: 'storage', storage_hd: 'storage',
  network: 'network', network_hs: 'network', cooling_air: 'cooling', cooling_adv: 'cooling', liquid: 'cooling',
  pdu: 'power', substation: 'power', generator: 'power', generator_x: 'power',
};
export const equipCat = (id: string): SupplyCat | undefined => EQUIP_CAT[id];
