// Names, customers, competitors, employees and events.

export const COMPETITOR_DEFS = [
  { id: 'nexcore', name: 'NexCore Systems', color: '#f87171', logo: '⬢', personality: 'aggressive', aggression: 1.6, profitFocus: 0.6, techFocus: 0.8, frugality: 0.6, cash: 4_000_000, home: 'nova', desc: 'Expands at any cost. Buys land before you can blink.' },
  { id: 'quantumgrid', name: 'QuantumGrid', color: '#c084fc', logo: '◈', personality: 'technology', aggression: 1.0, profitFocus: 0.8, techFocus: 1.8, frugality: 0.8, cash: 3_500_000, home: 'dallas', desc: 'Research-obsessed. Fewer sites, but each one is cutting edge.' },
  { id: 'cloudnova', name: 'CloudNova', color: '#38bdf8', logo: '☁', personality: 'conservative', aggression: 0.8, profitFocus: 1.6, techFocus: 0.9, frugality: 1.0, cash: 5_000_000, home: 'chicago', desc: 'Profit first. Slow, steady and very well capitalised.' },
  { id: 'titan', name: 'Titan Infrastructure', color: '#fbbf24', logo: '▲', personality: 'aggressive', aggression: 1.3, profitFocus: 1.0, techFocus: 0.7, frugality: 0.7, cash: 6_000_000, home: 'phoenix', desc: 'Builds enormous campuses in cheap markets.' },
  { id: 'vertex', name: 'Vertex Computing', color: '#4ade80', logo: '◆', personality: 'budget', aggression: 1.1, profitFocus: 1.2, techFocus: 0.6, frugality: 1.7, cash: 2_500_000, home: 'dallas', desc: 'Lean operator chasing the lowest cost per rack.' },
] as const;

export type CustomerType = 'small' | 'startup' | 'corp' | 'research' | 'university' | 'government' | 'tech';

export const CUSTOMER_TYPES: Record<CustomerType, {
  label: string; caps: ('cpu' | 'gpu' | 'storage')[]; days: [number, number]; rate: number; sla: number; security: number; sizeMult: number; contractTypes: string[]; level: number;
}> = {
  small: { label: 'Small Business', caps: ['cpu', 'storage'], days: [5, 14], rate: 1.0, sla: 0.9, security: 0, sizeMult: 0.4, contractTypes: ['Cloud Hosting', 'Storage Services'], level: 1 },
  startup: { label: 'AI Startup', caps: ['gpu', 'gpu', 'cpu'], days: [4, 12], rate: 1.25, sla: 0.85, security: 0, sizeMult: 0.6, contractTypes: ['GPU Rental', 'AI Computing'], level: 1 },
  corp: { label: 'Large Corporation', caps: ['cpu', 'storage', 'gpu'], days: [20, 45], rate: 1.1, sla: 0.97, security: 1, sizeMult: 1.1, contractTypes: ['Enterprise Computing', 'Cloud Hosting', 'Storage Services'], level: 4 },
  research: { label: 'Research Organization', caps: ['gpu', 'cpu'], days: [10, 30], rate: 1.05, sla: 0.9, security: 0, sizeMult: 0.9, contractTypes: ['Research Computing', 'AI Computing'], level: 3 },
  university: { label: 'University', caps: ['cpu', 'gpu', 'storage'], days: [14, 40], rate: 0.9, sla: 0.85, security: 0, sizeMult: 0.7, contractTypes: ['Research Computing', 'Cloud Hosting'], level: 2 },
  government: { label: 'Government Agency', caps: ['cpu', 'storage', 'gpu'], days: [30, 75], rate: 1.35, sla: 0.98, security: 2, sizeMult: 1.2, contractTypes: ['Enterprise Computing', 'Long-term Infrastructure Agreement'], level: 7 },
  tech: { label: 'Technology Company', caps: ['gpu', 'cpu', 'storage'], days: [25, 90], rate: 1.15, sla: 0.95, security: 1, sizeMult: 1.6, contractTypes: ['AI Computing', 'Long-term Infrastructure Agreement', 'GPU Rental'], level: 6 },
};

const PREFIX = ['Blue', 'Iron', 'Silver', 'Bright', 'North', 'Quantum', 'Open', 'Red', 'Hyper', 'Lumen', 'Atlas', 'Pixel', 'Nova', 'Echo', 'Cedar', 'Summit', 'Pioneer', 'Vector', 'Helix', 'Orbit', 'Prism', 'Tidal', 'Granite', 'Falcon', 'Polar'];
const SUFFIX_BY_TYPE: Record<CustomerType, string[]> = {
  small: ['Bakery Online', 'Logistics', 'Dental Group', 'Print Shop', 'Accounting', 'Realty', 'Outfitters', 'Coffee Co.'],
  startup: ['AI', 'Labs', 'Mind', 'Neural', 'Intelligence', 'Robotics', 'Vision', 'GenAI'],
  corp: ['Industries', 'Holdings', 'Bank', 'Retail Group', 'Motors', 'Insurance', 'Pharma', 'Airlines'],
  research: ['Institute', 'Research Center', 'Genomics Lab', 'Climate Lab', 'Physics Foundation'],
  university: ['State University', 'Institute of Technology', 'College', 'Polytechnic'],
  government: ['Defense Agency', 'Weather Service', 'Health Department', 'Census Bureau', 'Space Agency'],
  tech: ['Software', 'Cloud', 'Social', 'Search', 'Streaming', 'Games', 'Platforms'],
};
// Fictional small-town clients: farming, oilfield services and Main Street.
const LOCAL_CLIENTS: Partial<Record<CustomerType, string[]>> = {
  small: ['Little Wabash Grain Co-op', 'Courthouse Square Pharmacy', 'Bottomland Farm Supply', 'Main Cross Insurance', 'Southern Illinois Oilfield Services', 'Wabash Valley Seed', 'Oak Street Auto Parts', 'County Line Veterinary'],
  startup: ['Prairie Precision Ag', 'Riverbend Robotics', 'Cornbelt Vision Labs', 'Tillage AI'],
  university: ['Tri-County Community College', 'Southern Prairie College'],
  corp: ['Mid-Rivers Energy Holdings', 'Heartland Farm Credit'],
};
export function customerName(type: CustomerType, r: () => number, local = false): string {
  const near = local ? LOCAL_CLIENTS[type] : undefined;
  if (near) return near[Math.floor(r() * near.length)];
  const p = PREFIX[Math.floor(r() * PREFIX.length)];
  const list = SUFFIX_BY_TYPE[type];
  return `${p} ${list[Math.floor(r() * list.length)]}`;
}

export const DEPARTMENTS = {
  engineering: { label: 'Engineers', icon: '🛠️', salary: 52, desc: 'Faster construction.', maxBonus: 0.6, k: 10 },
  electrical: { label: 'Electrical Technicians', icon: '⚡', salary: 44, desc: '+Power capacity, −electricity cost.', maxBonus: 0.25, k: 8 },
  cooling: { label: 'Cooling Specialists', icon: '❄️', salary: 44, desc: '+Cooling capacity, −cooling cost.', maxBonus: 0.25, k: 8 },
  it: { label: 'IT Administrators', icon: '💻', salary: 48, desc: '−Server maintenance, +performance.', maxBonus: 0.35, k: 10 },
  ops: { label: 'Operations Managers', icon: '📋', salary: 60, desc: '−Facility wear and building upkeep.', maxBonus: 0.6, k: 8 },
  security: { label: 'Security Personnel', icon: '🛡️', salary: 32, desc: '−Incident chance, +security tier.', maxBonus: 0.8, k: 6 },
  finance: { label: 'Finance', icon: '📈', salary: 55, desc: '−Taxes, insurance and loan interest.', maxBonus: 0.3, k: 8 },
  research: { label: 'Research Scientists', icon: '🔬', salary: 70, desc: 'Faster research.', maxBonus: 1.0, k: 10 },
  sales: { label: 'Sales Representatives', icon: '🤝', salary: 46, desc: 'More and better contract offers.', maxBonus: 0.5, k: 9 },
} as const;
export type Department = keyof typeof DEPARTMENTS;

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Zoe', 'Ethan', 'Aria', 'Lucas', 'Maya', 'Leo', 'Isla', 'Kai', 'Nora', 'Omar', 'Priya', 'Hiro', 'Sofia', 'Mateo', 'Yuki', 'Amara', 'Jonas', 'Elena', 'Ravi', 'Chloe', 'Diego', 'Freya', 'Sam', 'Ines', 'Theo', 'Lena', 'Kofi', 'Mei'];
const LAST = ['Chen', 'Patel', 'Garcia', 'Kim', 'Müller', 'Okafor', 'Rossi', 'Novak', 'Silva', 'Tanaka', 'Johnson', 'Nguyen', 'Haddad', 'Larsen', 'Dubois', 'Kowalski', 'Ahmed', 'Brown', 'Ivanova', 'Santos', 'Wright', 'Sato', 'Murphy', 'Lopez'];
export function personName(r: () => number): string {
  return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
}

export interface EventDef {
  id: string;
  title: string;
  desc: string;
  hours: [number, number];
  scope: 'city' | 'global' | 'region' | 'country';
  good: boolean;
  weight: number;
}

export const EVENT_DEFS: EventDef[] = [
  { id: 'heatwave', title: 'Heat Wave', desc: 'Cooling capacity −15% in {city}.', hours: [24, 48], scope: 'city', good: false, weight: 2 },
  { id: 'outage', title: 'Grid Outage', desc: 'Utility power lost in {city}. Facilities without enough backup generators go dark.', hours: [3, 8], scope: 'city', good: false, weight: 1 },
  { id: 'gpu_shortage', title: 'GPU Shortage', desc: 'Server and accelerator prices +20%.', hours: [36, 72], scope: 'global', good: false, weight: 1 },
  { id: 'chip_sale', title: 'Hardware Clearance Sale', desc: 'All equipment −20%.', hours: [24, 48], scope: 'global', good: true, weight: 2 },
  { id: 'ai_boom', title: 'AI Boom', desc: 'AI compute spot prices +40% and more GPU contracts.', hours: [48, 120], scope: 'global', good: true, weight: 3 },
  { id: 'tax_break', title: 'Tax Incentive', desc: 'Construction costs −20% in {city}.', hours: [48, 96], scope: 'city', good: true, weight: 2 },
  { id: 'energy_spike', title: 'Energy Price Spike', desc: 'Electricity +30% in {city}.', hours: [24, 48], scope: 'city', good: false, weight: 1 },
  { id: 'demand_surge', title: 'Cloud Demand Surge', desc: 'Spot prices +30% in {city}.', hours: [36, 96], scope: 'city', good: true, weight: 3 },
  // ---- industry-wide events: rivals feel these too ----
  { id: 'recession', title: 'Economic Recession', desc: 'Compute demand −18% in {place}. Every company in the region earns less.', hours: [96, 220], scope: 'region', good: false, weight: 1.2 },
  { id: 'cloud_surge', title: 'Enterprise Cloud Migration', desc: 'CPU and storage spot prices +25% worldwide.', hours: [48, 120], scope: 'global', good: true, weight: 2 },
  { id: 'chip_breakthrough', title: 'Chip Breakthrough', desc: 'Older servers get cheaper: server prices −10% and a vendor ships new hardware.', hours: [48, 96], scope: 'global', good: true, weight: 1.5 },
  { id: 'supply_crunch', title: 'Semiconductor Supply Crunch', desc: '{supplier} can\'t keep up: its prices +30%, deliveries 36 hours slower.', hours: [60, 130], scope: 'global', good: false, weight: 1.5 },
  { id: 'trade_dispute', title: 'Trade Dispute', desc: 'New tariffs: equipment installed in {place} costs +15%.', hours: [120, 280], scope: 'region', good: false, weight: 1 },
  { id: 'energy_crisis', title: 'Regional Energy Crisis', desc: 'Electricity +28% across {place}.', hours: [72, 180], scope: 'region', good: false, weight: 1 },
  { id: 'infra_program', title: 'Infrastructure Investment Program', desc: '{place} is fast-tracking data centers: construction −25%, permits 20% faster.', hours: [120, 300], scope: 'country', good: true, weight: 1.6 },
  { id: 'gov_program', title: 'Government Cloud Program', desc: '{place} is buying capacity: three times as many government customers.', hours: [120, 300], scope: 'country', good: true, weight: 1.6 },
  { id: 'efficiency_law', title: 'New Efficiency Law', desc: '{place} tightens its PUE limit and raises compliance fees.', hours: [300, 700], scope: 'country', good: false, weight: 0.9 },
  { id: 'tax_hike', title: 'Data Center Tax Hike', desc: 'Property taxes +35% in {place}.', hours: [240, 600], scope: 'country', good: false, weight: 0.8 },
  { id: 'tax_cut', title: 'Tech Investment Tax Cut', desc: 'Property taxes −30% in {place}.', hours: [240, 600], scope: 'country', good: true, weight: 0.9 },
];

export const COMPANY_LOGOS = ['⬡', '◆', '▲', '●', '✦', '❖', '⬢', '◉', '⚡', '☁', '◈', '✺'];
export const COMPANY_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#eab308', '#14b8a6', '#f97316'];
