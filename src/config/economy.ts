// ============================================================
// Central economy configuration. Every price, rate and timer in
// the game is read from here so the game can be rebalanced in
// one place.
// ============================================================

export const ECONOMY = {
  // ---- Time ----
  /** Game hours that pass per real second at 1x speed. */
  gameHoursPerSecond: 1,
  /** Simulation sub-step (game hours) used when catching up offline. */
  offlineStepHours: 2,
  /** Base offline progression cap in real hours (upgradable). */
  baseOfflineCapHours: 4,
  startDate: Date.UTC(2027, 0, 1, 8, 0, 0),

  // ---- Start ----
  difficulties: {
    relaxed: { label: 'Relaxed', cash: 1_600_000, competitorCash: 0.7, priceMult: 0.9 },
    standard: { label: 'Standard', cash: 1_000_000, competitorCash: 1, priceMult: 1 },
    hardcore: { label: 'Hardcore', cash: 650_000, competitorCash: 1.4, priceMult: 1.1 },
  } as Record<string, { label: string; cash: number; competitorCash: number; priceMult: number }>,

  // ---- Land ----
  /** Price per m^2 by property type (before city multipliers). */
  landPricePerM2: {
    empty_lot: 140,
    retail: 230,
    restaurant: 260,
    shopping_center: 320,
    warehouse: 150,
    office: 400,
    industrial: 190,
    industrial_land: 230,
    commercial_zone: 300,
    premium: 2600,
  } as Record<string, number>,
  /** Price range clamps by type (USD, before city multiplier) — design targets from the spec. */
  landPriceClamp: {
    empty_lot: [50_000, 150_000],
    retail: [125_000, 300_000],
    restaurant: [110_000, 280_000],
    shopping_center: [1_500_000, 6_000_000],
    warehouse: [300_000, 1_000_000],
    office: [750_000, 3_000_000],
    industrial: [1_000_000, 5_000_000],
    industrial_land: [5_000_000, 25_000_000],
    commercial_zone: [5_000_000, 25_000_000],
    premium: [10_000_000, 100_000_000],
  } as Record<string, [number, number]>,
  /** Discount applied when a full development zone is bought in one transaction. */
  zoneBundleDiscount: 0.15,
  /** Demolition cost per m^2 of existing floor area. */
  demolitionPerM2: 55,
  demolitionSecondsPer1000m2: 6,
  demolitionMinSeconds: 8,
  /** Fraction of land value returned when selling a property. */
  propertySellReturn: 0.85,
  /** Annual-ish appreciation of land per game day. */
  landAppreciationPerDay: 0.0006,

  // ---- Construction ----
  sitePrepPerM2: 22,
  electricalPerKW: 180,
  coolingPerKW: 140,
  laborPerWorkerHour: 38,
  permitRate: 0.03,
  /** Speed-up options: fraction of remaining time removed and price factor. */
  speedUps: [
    { id: 'small', label: 'Overtime Crew', cut: 0.25, factor: 0.18 },
    { id: 'medium', label: 'Double Shifts', cut: 0.5, factor: 0.32 },
    { id: 'major', label: 'Around-the-Clock', cut: 0.75, factor: 0.5 },
    { id: 'instant', label: 'Instant Completion', cut: 1, factor: 0.75 },
  ],
  /** Extra cost per remaining real-second when speeding up. */
  speedUpPerSecond: 140,

  // ---- Power / cooling ----
  /** Converts kW * $/kWh into $/game-hour. Keeps power a meaningful cost. */
  powerCostScale: 3.5,
  basePUE: 1.6,
  minPUE: 1.08,
  coolingMaintPerKW: 0.02,

  // ---- Revenue (per unit of capacity per game hour) ----
  revenueRates: { cpu: 1.4, gpu: 45, storage: 0.15 } as Record<string, number>,
  /** Idle capacity rents on the spot market at this fraction of contract rates. */
  spotRateFraction: 0.55,
  /** Revenue-equivalent "compute units" per capacity unit — used for market supply math. */
  cuPerUnit: { cpu: 0.9, gpu: 30, storage: 0.1 } as Record<string, number>,

  // ---- Operating expenses ----
  buildingMaintRate: 0.0000045, // per game hour of building value
  propertyTaxScale: 6, // hourly tax = value * city tax * scale / 8760
  insuranceRate: 0.0000018, // per game hour of insured assets
  connectivityBase: 6, // $/hr per facility
  connectivityPerNetwork: 1.2,
  hqUpkeep: [0, 30, 140, 480, 1600],

  // ---- Condition ----
  conditionDecayPerDay: 0.4, // % per game day
  /** Auto-maintenance keeps condition above this level (if enabled per facility). */
  autoRepairThreshold: 85,
  autoRepairTarget: 96,
  repairCostPerPoint: 0.0012, // fraction of building value per condition point

  // ---- Valuation ----
  equipmentBookValue: 0.55,
  buildingBookValue: 0.8,
  profitMultipleHours: 2200,

  // ---- Loans ----
  loanLimitOfValuation: 0.35,
  loanInterestPerDay: 0.0011,

  // ---- Contracts ----
  maxOpenOffers: 6,
  offerIntervalHours: [16, 34] as [number, number],
  offerLifetimeHours: [40, 110] as [number, number],
  slaPenaltyReputation: 0.4,

  // ---- Employees ----
  candidatePoolSize: 6,
  candidateRefreshHours: 24,
  signingWeeks: 0.08,
  severanceWeeks: 0.12,

  // ---- Experience ----
  xp: {
    buyProperty: 40,
    buyPropertyPer: 25_000,
    demolish: 25,
    buildComplete: 180,
    buildPer: 40_000,
    contractSigned: 35,
    contractComplete: 90,
    contractPer: 15_000,
    researchComplete: 140,
    profitPer: 4_000,
    newCity: 300,
    newCountry: 650,
  },

  // ---- Events ----
  eventIntervalHours: [60, 140] as [number, number],

  // ---- Competitors ----
  competitorThinkHours: 6,
};

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(260 * Math.pow(level - 1, 1.8));
}

export const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: 'Startup' },
  { level: 5, title: 'Growing Business' },
  { level: 10, title: 'Regional Provider' },
  { level: 20, title: 'National Corporation' },
  { level: 35, title: 'Technology Giant' },
  { level: 50, title: 'Global AI Empire' },
  { level: 75, title: 'Global Infrastructure Leader' },
  { level: 100, title: 'World-Dominating AI Corporation' },
];

export function titleForLevel(level: number): string {
  let t = LEVEL_TITLES[0].title;
  for (const l of LEVEL_TITLES) if (level >= l.level) t = l.title;
  return t;
}

/** HQ tiers: employee capacity and offline-cap bonus. */
export const HQ_TIERS = [
  { tier: 0, name: 'Garage Office', staff: 4, cost: 0, offlineBonus: 0, desc: 'A rented garage. Room for a handful of people.' },
  { tier: 1, name: 'Startup Office', staff: 12, cost: 400_000, offlineBonus: 1, desc: 'Your first real headquarters.' },
  { tier: 2, name: 'Corporate Offices', staff: 35, cost: 3_500_000, offlineBonus: 2, desc: 'Multi-floor offices with a war room.' },
  { tier: 3, name: 'Headquarters Tower', staff: 90, cost: 28_000_000, offlineBonus: 4, desc: 'A glass tower with your logo on top.' },
  { tier: 4, name: 'Global Campus', staff: 250, cost: 160_000_000, offlineBonus: 8, desc: 'A sprawling campus fit for an empire.' },
];
