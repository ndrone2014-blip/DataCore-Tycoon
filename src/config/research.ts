// Technology research tree.

export type EffectKey =
  | 'cpuCap' | 'gpuCap' | 'storageCap'
  | 'coolingCap' | 'powerCap' | 'pue'
  | 'electricityCost' | 'maint' | 'decay' | 'perf' | 'incidents'
  | 'offlineHours' | 'constructionSpeed' | 'contractRate' | 'offerRate'
  | 'connectivity' | 'researchSpeed' | 'networkCap' | 'buildCost' | 'equipCost';

export type Effects = Partial<Record<EffectKey, number>>;

export interface ResearchDef {
  id: string;
  name: string;
  category: 'AI Computing' | 'Cooling' | 'Electricity' | 'Networking' | 'Automation';
  tier: number; // column in the tree
  cost: number;
  seconds: number;
  requires: string[];
  level: number;
  effects: Effects;
  unlocks?: string;
  desc: string;
}

export const RESEARCH: ResearchDef[] = [
  // ---- AI Computing ----
  { id: 'gpu_adv', name: 'Advanced GPUs', category: 'AI Computing', tier: 1, cost: 400_000, seconds: 120, requires: [], level: 4, effects: { gpuCap: 0.05 }, unlocks: 'Enterprise GPU Server', desc: 'Partner with chip vendors for next-gen GPU nodes.' },
  { id: 'accel_ent', name: 'Enterprise Accelerators', category: 'AI Computing', tier: 2, cost: 3_000_000, seconds: 300, requires: ['gpu_adv'], level: 10, effects: { gpuCap: 0.05 }, unlocks: 'Advanced AI Accelerator', desc: 'Custom silicon designed for transformer training.' },
  { id: 'hpai', name: 'High-Performance AI Systems', category: 'AI Computing', tier: 3, cost: 20_000_000, seconds: 600, requires: ['accel_ent', 'liquid'], level: 20, effects: { gpuCap: 0.15 }, unlocks: 'Exascale AI Pod', desc: 'Exascale pods with liquid-cooled interconnects. +15% AI compute.' },
  { id: 'ai_sched', name: 'AI Workload Scheduler', category: 'AI Computing', tier: 4, cost: 90_000_000, seconds: 900, requires: ['hpai', 'monitor'], level: 32, effects: { gpuCap: 0.2, cpuCap: 0.1, storageCap: 0.1 }, desc: 'An AI that packs workloads onto your fleet. +20% AI, +10% CPU/storage.' },
  // ---- Cooling ----
  { id: 'air_imp', name: 'Improved Air Cooling', category: 'Cooling', tier: 1, cost: 150_000, seconds: 80, requires: [], level: 2, effects: { coolingCap: 0.15 }, desc: 'Blanking panels and better airflow. +15% cooling capacity.' },
  { id: 'adv_cool', name: 'Advanced Cooling', category: 'Cooling', tier: 2, cost: 900_000, seconds: 180, requires: ['air_imp'], level: 5, effects: { pue: 0.1 }, unlocks: 'Hot-Aisle Chiller, Advanced Air builds', desc: 'Hot-aisle containment. PUE −0.10.' },
  { id: 'liquid', name: 'Liquid Cooling', category: 'Cooling', tier: 3, cost: 6_000_000, seconds: 360, requires: ['adv_cool'], level: 12, effects: { pue: 0.1 }, unlocks: 'Liquid Cooling Loop, Liquid builds', desc: 'Direct-to-chip liquid cooling. PUE −0.10.' },
  { id: 'hd_cool', name: 'High-Density Cooling', category: 'Cooling', tier: 4, cost: 35_000_000, seconds: 700, requires: ['liquid'], level: 24, effects: { coolingCap: 0.3, pue: 0.06 }, desc: 'Immersion tanks. +30% cooling, PUE −0.06.' },
  // ---- Electricity ----
  { id: 'power_opt', name: 'Power Optimization', category: 'Electricity', tier: 1, cost: 250_000, seconds: 100, requires: [], level: 3, effects: { electricityCost: 0.1 }, unlocks: 'Redundant 2N electrical builds', desc: 'Smart metering and load balancing. −10% electricity cost.' },
  { id: 'adv_gen', name: 'Advanced Generators', category: 'Electricity', tier: 2, cost: 1_500_000, seconds: 220, requires: ['power_opt'], level: 7, effects: { powerCap: 0.05 }, unlocks: 'Turbine Backup Plant', desc: 'Gas turbines for massive backup capacity.' },
  { id: 'elec_sys', name: 'Improved Electrical Systems', category: 'Electricity', tier: 3, cost: 7_000_000, seconds: 400, requires: ['adv_gen'], level: 11, effects: { powerCap: 0.15, electricityCost: 0.05 }, unlocks: 'Private Substation, High-Density builds', desc: 'Medium-voltage distribution. +15% power capacity.' },
  { id: 'green_ppa', name: 'Renewable Power Agreements', category: 'Electricity', tier: 4, cost: 40_000_000, seconds: 750, requires: ['elec_sys'], level: 26, effects: { electricityCost: 0.2, contractRate: 0.05 }, desc: 'Solar and wind PPAs. −20% electricity, +5% contract rates.' },
  // ---- Networking ----
  { id: 'hs_net', name: 'High-Speed Networking', category: 'Networking', tier: 1, cost: 350_000, seconds: 110, requires: [], level: 3, effects: { networkCap: 0.25 }, unlocks: '800G Spine Switch, All-Flash Storage', desc: '800G optics. +25% switch capacity.' },
  { id: 'ent_conn', name: 'Enterprise Connectivity', category: 'Networking', tier: 2, cost: 2_000_000, seconds: 240, requires: ['hs_net'], level: 8, effects: { connectivity: 0.3, contractRate: 0.05, offerRate: 0.15 }, desc: 'Direct cloud on-ramps. +5% rates, more offers.' },
  { id: 'global_net', name: 'Advanced Global Networking', category: 'Networking', tier: 3, cost: 12_000_000, seconds: 480, requires: ['ent_conn'], level: 15, effects: { contractRate: 0.1, offerRate: 0.2 }, desc: 'Private subsea capacity. +10% contract rates.' },
  { id: 'edge_mesh', name: 'Planetary Edge Mesh', category: 'Networking', tier: 4, cost: 70_000_000, seconds: 850, requires: ['global_net'], level: 30, effects: { contractRate: 0.12, networkCap: 0.5 }, desc: 'A global low-latency fabric. +12% rates.' },
  // ---- Automation ----
  { id: 'auto_ops', name: 'Automated Operations', category: 'Automation', tier: 1, cost: 300_000, seconds: 100, requires: [], level: 2, effects: { maint: 0.15 }, unlocks: 'High-Density CPU Server', desc: 'Runbook automation. −15% maintenance.' },
  { id: 'prefab', name: 'Prefabricated Construction', category: 'Automation', tier: 2, cost: 1_200_000, seconds: 200, requires: ['auto_ops'], level: 5, effects: { constructionSpeed: 0.25, buildCost: 0.05 }, desc: 'Factory-built modules. +25% construction speed.' },
  { id: 'smart_fac', name: 'Smart Facility Management', category: 'Automation', tier: 2, cost: 2_500_000, seconds: 260, requires: ['auto_ops'], level: 7, effects: { decay: 0.5, offlineHours: 4 }, desc: 'Digital twins of every hall. −50% wear, +4h offline cap.' },
  { id: 'monitor', name: 'Advanced Server Monitoring', category: 'Automation', tier: 3, cost: 9_000_000, seconds: 420, requires: ['smart_fac'], level: 14, effects: { perf: 0.05, incidents: 0.5, offlineHours: 4 }, desc: 'Predictive failure detection. +5% performance, +4h offline cap.' },
  { id: 'robotics', name: 'Datacenter Robotics', category: 'Automation', tier: 4, cost: 50_000_000, seconds: 800, requires: ['monitor', 'prefab'], level: 28, effects: { maint: 0.25, constructionSpeed: 0.35, offlineHours: 8 }, desc: 'Robots swap drives and racks. −25% maintenance, +8h offline.' },
];

export const researchById = (id: string) => RESEARCH.find((r) => r.id === id)!;
