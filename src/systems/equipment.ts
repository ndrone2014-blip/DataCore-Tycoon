// Installing, upgrading and selling equipment; facility maintenance and HQ upgrades.

import type { GameState } from '../core/state';
import { equipmentById, EQUIPMENT, type EquipmentDef } from '../config/buildings';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { getEffects, equipPriceMult } from './modifiers';
import { spend, receive, log, stat, canAfford } from './ledger';
import { deriveAll } from './derive';
import { sfx, emit, toast } from '../core/bus';
import { money } from '../core/format';

export function equipmentUnlocked(s: GameState, d: EquipmentDef): { ok: boolean; reason?: string } {
  if (d.level && s.level < d.level) return { ok: false, reason: `Requires level ${d.level}` };
  if (d.research && !s.research.done.includes(d.research)) return { ok: false, reason: 'Requires research' };
  return { ok: true };
}

export function unitPrice(s: GameState, d: EquipmentDef): number {
  const m = equipPriceMult(s, getEffects(s), d.kind);
  return Math.round((d.cost + d.install) * m);
}

export interface InstallQuote {
  ok: boolean;
  reason?: string;
  warn?: string;
  count: number;
  cost: number;
}

export function installQuote(s: GameState, facilityId: string, eqId: string, count = 1, derived?: ReturnType<typeof deriveAll>): InstallQuote {
  const f = s.facilities[facilityId];
  const d = equipmentById(eqId);
  if (!f || !d) return { ok: false, reason: 'Unknown', count, cost: 0 };
  if (f.isHQ) return { ok: false, reason: 'Headquarters cannot host equipment', count, cost: 0 };
  const u = equipmentUnlocked(s, d);
  if (!u.ok) return { ok: false, reason: u.reason, count, cost: 0 };
  const der = derived ?? deriveAll(s);
  const st = der.fac[facilityId];
  if (!st) return { ok: false, reason: 'Unknown', count, cost: 0 };
  const cost = unitPrice(s, d) * count;
  if (d.kind === 'server') {
    if (st.slotsUsed + d.slotsUsed * count > f.slots) return { ok: false, reason: `Not enough rack space (${f.slots - st.slotsUsed} slots free)`, count, cost };
  } else if (st.baysUsed + count > f.bays) {
    return { ok: false, reason: `Not enough infrastructure bays (${f.bays - st.baysUsed} free)`, count, cost };
  }
  const newLoad = st.itLoad + d.power * count;
  let warn: string | undefined;
  if (d.power > 0) {
    if (newLoad > st.powerCap * 1.25) return { ok: false, reason: `Insufficient power: load would be ${Math.round(newLoad)} kW vs ${Math.round(st.powerCap)} kW capacity. Add power distribution first.`, count, cost };
    if (newLoad > st.coolingCap * 1.25) return { ok: false, reason: `Insufficient cooling: heat would be ${Math.round(newLoad)} kW vs ${Math.round(st.coolingCap)} kW capacity. Add cooling first.`, count, cost };
    if (newLoad > st.powerCap) warn = 'Power will be overloaded — performance drops';
    else if (newLoad > st.coolingCap) warn = 'Cooling will be overloaded — performance drops';
  }
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, count, cost, warn };
  return { ok: true, count, cost, warn };
}

export function install(s: GameState, facilityId: string, eqId: string, count = 1): InstallQuote {
  const q = installQuote(s, facilityId, eqId, count);
  if (!q.ok) return q;
  const f = s.facilities[facilityId];
  const d = equipmentById(eqId);
  spend(s, q.cost, 'Equipment', `${count}× ${d.name} → ${f.name}`);
  f.equipment[eqId] = (f.equipment[eqId] ?? 0) + count;
  f.equipmentSpent += q.cost;
  stat(s, 'equipmentInstalled', count);
  if (d.kind === 'server' && d.cap) stat(s, 'serversInstalled', count);
  log(s, `Installed ${count}× ${d.name} at ${f.name}`, 'build');
  sfx('install');
  emit('world');
  return q;
}

export function sellEquipment(s: GameState, facilityId: string, eqId: string, count = 1): { ok: boolean; reason?: string } {
  const f = s.facilities[facilityId];
  if (!f || !f.equipment[eqId]) return { ok: false, reason: 'None installed' };
  count = Math.min(count, f.equipment[eqId]);
  const d = equipmentById(eqId);
  const value = Math.round(d.cost * 0.4 * count);
  f.equipment[eqId] -= count;
  if (f.equipment[eqId] <= 0) delete f.equipment[eqId];
  receive(s, value, 'Equipment Sale', `Sold ${count}× ${d.name} from ${f.name}`);
  sfx('cash');
  emit('world');
  return { ok: true };
}

export function upgradeQuote(s: GameState, facilityId: string, eqId: string, derived?: ReturnType<typeof deriveAll>): { ok: boolean; reason?: string; cost: number; to?: EquipmentDef } {
  const f = s.facilities[facilityId];
  const d = equipmentById(eqId);
  if (!f || !d || !f.equipment[eqId]) return { ok: false, reason: 'None installed', cost: 0 };
  if (!d.upgradeTo) return { ok: false, reason: 'No upgrade available', cost: 0 };
  const to = equipmentById(d.upgradeTo);
  const u = equipmentUnlocked(s, to);
  if (!u.ok) return { ok: false, reason: `${to.name}: ${u.reason}`, cost: 0, to };
  const cost = Math.max(0, unitPrice(s, to) - Math.round(d.cost * 0.5));
  // power check for upgrade
  const der = derived ?? deriveAll(s);
  const st = der.fac[facilityId];
  const extra = to.power - d.power;
  if (extra > 0 && st.itLoad + extra > st.powerCap * 1.25) return { ok: false, reason: 'Insufficient power for upgrade', cost, to };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}`, cost, to };
  return { ok: true, cost, to };
}

export function upgradeEquipment(s: GameState, facilityId: string, eqId: string): { ok: boolean; reason?: string } {
  const q = upgradeQuote(s, facilityId, eqId);
  if (!q.ok || !q.to) return q;
  const f = s.facilities[facilityId];
  const from = equipmentById(eqId);
  spend(s, q.cost, 'Equipment', `Upgraded ${from.name} → ${q.to.name} at ${f.name}`);
  f.equipment[eqId]--;
  if (f.equipment[eqId] <= 0) delete f.equipment[eqId];
  f.equipment[q.to.id] = (f.equipment[q.to.id] ?? 0) + 1;
  f.equipmentSpent += q.cost;
  stat(s, 'upgrades');
  sfx('install');
  emit('world');
  return { ok: true };
}

export function repairQuote(s: GameState, facilityId: string): number {
  const f = s.facilities[facilityId];
  if (!f) return 0;
  return Math.round(((100 - f.condition) * ECONOMY.repairCostPerPoint * f.shellValue) / 100) * 100;
}

export function repair(s: GameState, facilityId: string): { ok: boolean; reason?: string } {
  const f = s.facilities[facilityId];
  if (!f) return { ok: false, reason: 'Unknown' };
  if (f.condition >= 99.5) return { ok: false, reason: 'Facility is in perfect condition' };
  const cost = repairQuote(s, facilityId);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}` };
  spend(s, cost, 'Maintenance', `Maintenance overhaul at ${f.name}`);
  f.condition = 100;
  sfx('install');
  emit('world');
  return { ok: true };
}

export function renameFacility(s: GameState, facilityId: string, name: string) {
  const f = s.facilities[facilityId];
  if (!f || !name.trim()) return;
  f.name = name.trim().slice(0, 40);
  emit('world');
}

export function decommission(s: GameState, facilityId: string): { ok: boolean; reason?: string } {
  const f = s.facilities[facilityId];
  if (!f) return { ok: false, reason: 'Unknown' };
  if (f.isHQ) return { ok: false, reason: 'Cannot demolish your headquarters' };
  if (s.contracts.active.some((c) => c.facilityId === facilityId)) return { ok: false, reason: 'Move or finish active contracts first' };
  let refund = 0;
  for (const [id, n] of Object.entries(f.equipment)) refund += equipmentById(id).cost * 0.4 * n;
  refund += f.shellValue * 0.1;
  receive(s, Math.round(refund), 'Asset Sale', `Decommissioned ${f.name}`);
  s.employees.forEach((e) => { if (e.assigned === facilityId) e.assigned = 'hq'; });
  const st = s.parcels[f.parcelId];
  st.status = 'cleared';
  st.facilityId = undefined;
  delete s.facilities[facilityId];
  log(s, `${f.name} was decommissioned and torn down`, 'bad');
  sfx('demolish');
  emit('world');
  return { ok: true };
}

export function hqUpgradeQuote(s: GameState): { ok: boolean; reason?: string; cost: number; next?: (typeof HQ_TIERS)[number] } {
  const next = HQ_TIERS[s.company.hqTier + 1];
  if (!next) return { ok: false, reason: 'Maximum tier reached', cost: 0 };
  if (!s.company.hqFacility) return { ok: false, reason: 'Build a headquarters on one of your properties first', cost: next.cost, next };
  if (!canAfford(s, next.cost)) return { ok: false, reason: `Need ${money(next.cost)}`, cost: next.cost, next };
  return { ok: true, cost: next.cost, next };
}

export function upgradeHQ(s: GameState): { ok: boolean; reason?: string } {
  const q = hqUpgradeQuote(s);
  if (!q.ok || !q.next) return q;
  spend(s, q.cost, 'Headquarters', `HQ upgrade: ${q.next.name}`);
  s.company.hqTier = q.next.tier;
  const f = s.company.hqFacility ? s.facilities[s.company.hqFacility] : undefined;
  if (f) {
    f.floors = 3 + q.next.tier * 4;
    f.shellValue += q.cost;
  }
  log(s, `Headquarters upgraded to ${q.next.name}`, 'good');
  toast({ title: 'HQ upgraded', body: `${q.next.name}: room for ${q.next.staff} staff.`, kind: 'good', icon: '🏢' });
  sfx('unlock');
  emit('world');
  return { ok: true };
}

export const SERVER_EQUIPMENT = EQUIPMENT.filter((e) => e.kind === 'server');
export const INFRA_EQUIPMENT = EQUIPMENT.filter((e) => e.kind === 'infra');
