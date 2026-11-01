// Data center blueprints and equipment catalog.

export type CapType = 'cpu' | 'gpu' | 'storage';

export interface BlueprintDef {
  id: string;
  name: string;
  cost: number; // building shell cost
  slots: number; // rack slots for servers
  bays: number; // infrastructure bays (cooling / power / generators / security)
  power: number; // base electrical capacity kW
  cooling: number; // base cooling capacity kW
  minLot: number; // m^2 of land required
  floors: number;
  buildSeconds: number;
  level: number;
  /** Fraction of lot used as footprint for premade layout. */
  footprint: number;
  style: 'modular' | 'concrete' | 'glass' | 'metal';
  color: string;
  desc: string;
  /** Custom-builder parameters */
  slotsPerM2: number;
  kwPerSlot: number;
  maxFloors: number;
}

export const BLUEPRINTS: BlueprintDef[] = [
  { id: 'modular', name: 'Modular Data Center', cost: 250_000, slots: 12, bays: 4, power: 60, cooling: 60, minLot: 350, floors: 1, buildSeconds: 75, level: 1, footprint: 0.45, style: 'modular', color: '#8fa3bf', desc: 'Prefabricated container modules. Quick to deploy, tiny capacity.', slotsPerM2: 0.06, kwPerSlot: 5, maxFloors: 2 },
  { id: 'small_ent', name: 'Small Enterprise Data Center', cost: 1_000_000, slots: 36, bays: 6, power: 200, cooling: 180, minLot: 1100, floors: 2, buildSeconds: 160, level: 3, footprint: 0.5, style: 'concrete', color: '#a7b4c6', desc: 'A compact two-storey facility for regional customers.', slotsPerM2: 0.045, kwPerSlot: 5.5, maxFloors: 3 },
  { id: 'enterprise', name: 'Enterprise Data Center', cost: 5_000_000, slots: 90, bays: 10, power: 620, cooling: 560, minLot: 2600, floors: 3, buildSeconds: 280, level: 6, footprint: 0.55, style: 'concrete', color: '#b9c3d1', desc: 'Tier III enterprise facility with redundant systems.', slotsPerM2: 0.04, kwPerSlot: 6.5, maxFloors: 4 },
  { id: 'cloud', name: 'Cloud Infrastructure Center', cost: 10_000_000, slots: 160, bays: 14, power: 1200, cooling: 1100, minLot: 4500, floors: 4, buildSeconds: 380, level: 9, footprint: 0.55, style: 'glass', color: '#6aa9ff', desc: 'Multi-tenant cloud region building block.', slotsPerM2: 0.04, kwPerSlot: 7.5, maxFloors: 5 },
  { id: 'hyperscale', name: 'Hyperscale Data Center', cost: 25_000_000, slots: 320, bays: 20, power: 2600, cooling: 2400, minLot: 9000, floors: 4, buildSeconds: 560, level: 13, footprint: 0.6, style: 'metal', color: '#cfd7e3', desc: 'Warehouse-scale computing for the cloud giants.', slotsPerM2: 0.035, kwPerSlot: 8.5, maxFloors: 5 },
  { id: 'ai_center', name: 'AI Computing Center', cost: 50_000_000, slots: 420, bays: 24, power: 6400, cooling: 5600, minLot: 11000, floors: 5, buildSeconds: 720, level: 18, footprint: 0.6, style: 'glass', color: '#4fd1c5', desc: 'High-density halls engineered for GPU clusters.', slotsPerM2: 0.035, kwPerSlot: 15, maxFloors: 6 },
  { id: 'supercomputer', name: 'AI Supercomputer Campus', cost: 100_000_000, slots: 720, bays: 32, power: 13000, cooling: 11500, minLot: 18000, floors: 6, buildSeconds: 900, level: 25, footprint: 0.6, style: 'glass', color: '#9f7aea', desc: 'A national-scale AI training supercomputer.', slotsPerM2: 0.034, kwPerSlot: 18, maxFloors: 7 },
  { id: 'mega', name: 'Mega AI Data Center Campus', cost: 500_000_000, slots: 2000, bays: 48, power: 42000, cooling: 38000, minLot: 36000, floors: 8, buildSeconds: 1400, level: 38, footprint: 0.62, style: 'metal', color: '#f6ad55', desc: 'Gigawatt-class campus. Requires a consolidated development zone.', slotsPerM2: 0.03, kwPerSlot: 21, maxFloors: 9 },
];

export const blueprintById = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

export interface CustomOptions {
  floors: number;
  footprint: number; // 0.3 .. 0.8
  style: 'modular' | 'concrete' | 'glass' | 'metal';
  color: string;
  coolingTier: 0 | 1 | 2; // air / advanced / liquid
  electricalTier: 0 | 1 | 2; // standard / redundant / high-density
  generators: number;
  security: number; // 0..3
  serverDensity: number; // 0.7 .. 1.3 multiplier on slots
}

export const EXTERIOR_STYLES = [
  { id: 'modular', label: 'Container Modules', mult: 0.85 },
  { id: 'concrete', label: 'Precast Concrete', mult: 1 },
  { id: 'metal', label: 'Insulated Metal Panels', mult: 1.05 },
  { id: 'glass', label: 'Glass Curtain Wall', mult: 1.25 },
] as const;

export const COOLING_TIERS = [
  { label: 'Air Cooling (CRAC)', mult: 1, costMult: 1, research: '' },
  { label: 'Advanced Air (Hot-Aisle)', mult: 1.35, costMult: 1.3, research: 'adv_cool' },
  { label: 'Direct Liquid Cooling', mult: 2, costMult: 1.9, research: 'liquid' },
];
export const ELECTRICAL_TIERS = [
  { label: 'Standard Utility Feed', mult: 1, costMult: 1, research: '' },
  { label: 'Redundant 2N Feed', mult: 1.3, costMult: 1.35, research: 'power_opt' },
  { label: 'High-Density Substation', mult: 1.9, costMult: 1.9, research: 'elec_sys' },
];

export interface EquipmentDef {
  id: string;
  name: string;
  kind: 'server' | 'infra';
  cap?: CapType;
  capacity: number; // capacity units provided (servers)
  cost: number;
  install: number;
  power: number; // kW drawn
  maint: number; // $/game hour
  rating: number; // performance rating 1-10
  addPower?: number; // infra: kW of power capacity added
  addCooling?: number; // infra: kW of cooling capacity added
  addNetwork?: number; // servers supported by one network unit
  backup?: number; // kW of backup power
  security?: number; // security tier points
  slotsUsed: number; // rack slots (servers + network) — infra uses bays
  research?: string;
  level?: number;
  upgradeTo?: string;
  desc: string;
  icon: string;
}

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'cpu_std', name: 'Standard CPU Server', kind: 'server', cap: 'cpu', capacity: 64, cost: 14_000, install: 1_200, power: 6, maint: 1.0, rating: 3, slotsUsed: 1, upgradeTo: 'cpu_hd', desc: 'Dual-socket general purpose compute. 64 cores.', icon: '🖥️' },
  { id: 'cpu_hd', name: 'High-Density CPU Server', kind: 'server', cap: 'cpu', capacity: 160, cost: 38_000, install: 2_000, power: 11, maint: 2.6, rating: 5, slotsUsed: 1, research: 'auto_ops', desc: 'Many-core blades. 160 cores in one slot.', icon: '🗄️' },
  { id: 'storage', name: 'Storage Server', kind: 'server', cap: 'storage', capacity: 480, cost: 16_000, install: 1_000, power: 4, maint: 1, rating: 3, slotsUsed: 1, upgradeTo: 'storage_hd', desc: '480 TB of spinning disk for cloud storage.', icon: '💾' },
  { id: 'storage_hd', name: 'All-Flash Storage Array', kind: 'server', cap: 'storage', capacity: 1500, cost: 52_000, install: 2_000, power: 6, maint: 2, rating: 6, slotsUsed: 1, research: 'hs_net', desc: '1.5 PB of NVMe flash. Fast and dense.', icon: '⚡' },
  { id: 'gpu_ai', name: 'AI GPU Server', kind: 'server', cap: 'gpu', capacity: 8, cost: 80_000, install: 5_000, power: 14, maint: 4, rating: 5, slotsUsed: 1, level: 2, upgradeTo: 'gpu_ent', desc: '8 PFLOPS of AI compute. The workhorse of AI startups.', icon: '🧠' },
  { id: 'gpu_ent', name: 'Enterprise GPU Server', kind: 'server', cap: 'gpu', capacity: 24, cost: 235_000, install: 12_000, power: 22, maint: 10, rating: 7, slotsUsed: 1, research: 'gpu_adv', upgradeTo: 'accel', desc: 'NVLink-connected 8-GPU node, 24 PFLOPS.', icon: '🚀' },
  { id: 'accel', name: 'Advanced AI Accelerator', kind: 'server', cap: 'gpu', capacity: 80, cost: 690_000, install: 30_000, power: 34, maint: 24, rating: 9, slotsUsed: 1, research: 'accel_ent', upgradeTo: 'accel_x', desc: 'Custom wafer-scale accelerator. 80 PFLOPS.', icon: '🌌' },
  { id: 'accel_x', name: 'Exascale AI Pod', kind: 'server', cap: 'gpu', capacity: 260, cost: 2_100_000, install: 80_000, power: 70, maint: 70, rating: 10, slotsUsed: 1, research: 'hpai', desc: 'Liquid-cooled exascale pod. 260 PFLOPS.', icon: '🪐' },
  { id: 'network', name: 'Networking Switch', kind: 'server', capacity: 0, cost: 22_000, install: 1_500, power: 1.5, maint: 0.8, rating: 4, addNetwork: 12, slotsUsed: 1, upgradeTo: 'network_hs', desc: 'Top-of-rack switching for 12 servers.', icon: '🔀' },
  { id: 'network_hs', name: '800G Spine Switch', kind: 'server', capacity: 0, cost: 70_000, install: 3_000, power: 3, maint: 2, rating: 8, addNetwork: 40, slotsUsed: 1, research: 'hs_net', desc: 'High-speed spine switching for 40 servers.', icon: '🌐' },
  { id: 'cooling_air', name: 'CRAC Cooling Unit', kind: 'infra', capacity: 0, cost: 45_000, install: 3_000, power: 6, maint: 2, rating: 3, addCooling: 120, slotsUsed: 0, upgradeTo: 'cooling_adv', desc: '+120 kW computer-room air cooling.', icon: '❄️' },
  { id: 'cooling_adv', name: 'Hot-Aisle Containment Chiller', kind: 'infra', capacity: 0, cost: 120_000, install: 8_000, power: 12, maint: 4, rating: 6, addCooling: 380, slotsUsed: 0, research: 'adv_cool', upgradeTo: 'liquid', desc: '+380 kW high-efficiency chilled air.', icon: '🌬️' },
  { id: 'liquid', name: 'Liquid Cooling Loop', kind: 'infra', capacity: 0, cost: 360_000, install: 25_000, power: 18, maint: 9, rating: 9, addCooling: 1200, slotsUsed: 0, research: 'liquid', desc: '+1,200 kW direct-to-chip liquid cooling.', icon: '💧' },
  { id: 'pdu', name: 'Power Distribution Unit', kind: 'infra', capacity: 0, cost: 38_000, install: 2_500, power: 0, maint: 1, rating: 3, addPower: 150, slotsUsed: 0, upgradeTo: 'substation', desc: '+150 kW of electrical capacity.', icon: '🔌' },
  { id: 'substation', name: 'Private Substation', kind: 'infra', capacity: 0, cost: 420_000, install: 30_000, power: 0, maint: 8, rating: 8, addPower: 1600, slotsUsed: 0, research: 'elec_sys', desc: '+1,600 kW from a dedicated grid tap.', icon: '🏭' },
  { id: 'generator', name: 'Backup Generator', kind: 'infra', capacity: 0, cost: 85_000, install: 5_000, power: 0, maint: 2.5, rating: 4, backup: 600, slotsUsed: 0, upgradeTo: 'generator_x', desc: '600 kW diesel backup. Keeps you online during outages.', icon: '🛢️' },
  { id: 'generator_x', name: 'Turbine Backup Plant', kind: 'infra', capacity: 0, cost: 380_000, install: 20_000, power: 0, maint: 8, rating: 8, backup: 4000, slotsUsed: 0, research: 'adv_gen', desc: '4 MW gas-turbine backup power.', icon: '⚙️' },
  { id: 'security', name: 'Security System', kind: 'infra', capacity: 0, cost: 40_000, install: 3_000, power: 1, maint: 1.5, rating: 5, security: 1, slotsUsed: 0, desc: 'Biometrics, cameras and mantraps. +1 security tier.', icon: '🛡️' },
];

export const equipmentById = (id: string) => EQUIPMENT.find((e) => e.id === id)!;

export const CAP_LABEL: Record<CapType, { name: string; unit: string; color: string }> = {
  cpu: { name: 'CPU Compute', unit: 'cores', color: '#60a5fa' },
  gpu: { name: 'AI Compute', unit: 'PFLOPS', color: '#a78bfa' },
  storage: { name: 'Storage', unit: 'TB', color: '#34d399' },
};
