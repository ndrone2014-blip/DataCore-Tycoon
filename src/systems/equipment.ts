// Installing, upgrading and selling equipment; facility maintenance and HQ upgrades.

import type { GameState } from '../core/state';
import { equipmentById, EQUIPMENT, type EquipmentDef } from '../config/buildings';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { getEffects, equipPriceMult } from './modifiers';
import { spend, receive, log, stat, canAfford } from './ledger';
import { deriveAll } from './derive';
import { sfx, emit, toast } from '../core/bus';
import { money } from '../core/format';
import { cancelOrders, categoryPriceMult, recordPurchase } from './suppliers';
import { hasFeature } from './careerCore';

export function equipmentUnlocked(s: GameState, d: EquipmentDef): { ok: boolean; reason?: string } {
  if (s.dev?.unlockAll) return { ok: true };
  if (d.level && s.level < d.level) return { ok: false, reason: `Requires level ${d.level}` };
  if (['substation', 'generator_x', 'liquid'].includes(d.id) && !hasFeature(s, 'g_adv_infra')) return { ok: false, reason: 'Unlocks with Advanced Infrastructure' };
  if (d.research && !s.research.done.includes(d.research)) return { ok: false, reason: 'Requires research' };
  return { ok: true };
}

export function unitPrice(s: GameState, d: EquipmentDef, cityId?: string): number {
  const m = equipPriceMult(s, getEffects(s), d.kind, cityId) * categoryPriceMult(s, d.id);
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
  const cost = unitPrice(s, d, f.cityId) * count;
  if (d.kind === 'server') {
    if (st.slotsUsed + d.slotsUsed * count > f.slots) return { ok: false, reason: `Not enough rack space (${f.slots - st.slotsUsed} slots free)`, count, cost };
  } else if (st.baysUsed + count > f.bays) {
    return { ok: false, reason: `Not enough infrastructure bays (${f.bays - st.baysUsed} free)`, count, cost };
  }
  const newLoad = st.itLoadAll + d.power * count;
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
  recordPurchase(s, f, eqId, count);
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
  cancelOrders(f, eqId, count);
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
  if (!hasFeature(s, 'g_upgrades')) return { ok: false, reason: 'Unlocks with Building Upgrades', cost: 0 };
  const to = equipmentById(d.upgradeTo);
  const u = equipmentUnlocked(s, to);
  if (!u.ok) return { ok: false, reason: `${to.name}: ${u.reason}`, cost: 0, to };
  const cost = Math.max(0, unitPrice(s, to, f.cityId) - Math.round(d.cost * 0.5));
  // power check for upgrade
  const der = derived ?? deriveAll(s);
  const st = der.fac[facilityId];
  const extra = to.power - d.power;
  if (extra > 0 && st.itLoadAll + extra > st.powerCap * 1.25) return { ok: false, reason: 'Insufficient power for upgrade', cost, to };
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

/**
 * One-click auto-equip. Fills a facility with a balanced mix of servers within a budget and adds
 * whatever networking, power and cooling that mix needs, always choosing infrastructure it can
 * actually afford so the budget isn't swallowed by one substation. A failed run says exactly why.
 */
export function autoEquip(s: GameState, facilityId: string, budget: number, opts: { free?: boolean; maxSlots?: number } = {}): { ok: boolean; reason?: string; count: number; spent: number } {
  const f = s.facilities[facilityId];
  if (!f || f.isHQ) return { ok: false, reason: 'Unknown facility', count: 0, spent: 0 };
  if (!opts.free && !hasFeature(s, 'g_stage2')) return { ok: false, reason: 'Auto-equip unlocks with Established Company status', count: 0, spent: 0 };
  const realCash = s.cash;
  if (opts.free) { s.cash = 1e15; budget = Infinity; }
  // a small percentage of a small balance must still be able to buy the first server
  else budget = Math.min(Math.max(0, s.cash), Math.max(budget, 70_000));
  let spent = 0;
  let count = 0;
  let stop = '';
  const unlocked = (ids: string[]) => ids.filter((id) => equipmentUnlocked(s, equipmentById(id)).ok);
  const gpus = unlocked(['accel_x', 'accel', 'gpu_ent', 'gpu_ai']);
  const cpus = unlocked(['cpu_hd', 'cpu_std']);
  const stores = unlocked(['storage_hd', 'storage']);
  const nets = unlocked(['network_hs', 'network']);
  const powers = unlocked(['substation', 'pdu']);
  const cools = unlocked(['liquid', 'cooling_adv', 'cooling_air']);
  const target: Record<string, number> = gpus.length ? { gpu: 0.55, cpu: 0.3, storage: 0.15 } : { gpu: 0, cpu: 0.75, storage: 0.25 };
  const place = (id: string, n: number, der: ReturnType<typeof deriveAll>): boolean => {
    const q = installQuote(s, facilityId, id, n, der);
    if (!q.ok || spent + q.cost > budget) return false;
    if (opts.free) f.equipment[id] = (f.equipment[id] ?? 0) + n;
    else { install(s, facilityId, id, n); spent += q.cost; }
    count += n;
    return true;
  };
  /** Add the most useful infrastructure the budget allows: enough to cover the shortfall if possible, else the best we can afford. */
  const addInfra = (ids: string[], shortfall: number, der: ReturnType<typeof deriveAll>): boolean => {
    const key = ids === powers ? 'addPower' : 'addCooling';
    const options = ids
      .map((id) => ({ id, add: (equipmentById(id) as any)[key] as number, q: installQuote(s, facilityId, id, 1, der) }))
      .filter((o) => o.q.ok && spent + o.q.cost <= budget)
      .sort((a, b) => a.q.cost - b.q.cost);
    const pick = options.find((o) => o.add >= shortfall) ?? options[options.length - 1];
    if (pick) return place(pick.id, 1, der);
    // bays full? swap existing gear for its bigger version instead of giving up
    if (!opts.free) for (const id of Object.keys(f.equipment)) {
      if ((equipmentById(id) as any)[key] > 0 && equipmentById(id).upgradeTo) {
        const uq = upgradeQuote(s, facilityId, id, der);
        if (uq.ok && spent + uq.cost <= budget && upgradeEquipment(s, facilityId, id).ok) { spent += uq.cost; count++; return true; }
      }
    }
    return false;
  };
  for (let guard = 0; guard < 400; guard++) {
    const der = deriveAll(s);
    const st = der.fac[facilityId];
    if (!st) break;
    const free = f.slots - st.slotsUsed;
    if (free <= 0) { stop = 'all rack slots are full'; break; }
    if (opts.maxSlots !== undefined && st.slotsUsed >= opts.maxSlots) break;
    // install in small batches on huge campuses so it stays instant
    const batch = Math.max(1, Math.floor(free / 40));
    if (st.servers + batch > st.network + 4 && free > batch && nets.some((id) => place(id, 1, der))) continue;
    const share: Record<string, number> = { gpu: 0, cpu: 0, storage: 0 };
    let total = 0;
    for (const [id, n] of Object.entries(f.equipment)) {
      const e = equipmentById(id);
      if (e.kind === 'server' && e.cap) { share[e.cap] += n; total += n; }
    }
    const order = (['gpu', 'cpu', 'storage'] as const)
      .filter((c) => target[c] > 0)
      .sort((a, b) => (share[a] / Math.max(1, total) - target[a]) - (share[b] / Math.max(1, total) - target[b]));
    let placed = false;
    let blocked = '';
    for (const cap of order) {
      const ids = cap === 'gpu' ? gpus : cap === 'cpu' ? cpus : stores;
      for (let k = 0; k < ids.length && !placed; k++) {
        const e = equipmentById(ids[k]);
        const price = installQuote(s, facilityId, e.id, 1, der).cost;
        // don't blow most of the budget on a single top-end server if cheaper ones exist
        if (k < ids.length - 1 && price > (budget - spent) * 0.5) continue;
        const n = Math.max(1, Math.min(batch, Math.floor((budget - spent) / Math.max(1, price))));
        const load = st.itLoadAll + e.power * n;
        if (load > st.powerCap * 0.98) {
          if (addInfra(powers, load - st.powerCap * 0.98, der)) placed = true;
          else blocked = 'not enough power capacity (no free infrastructure bay, or too little budget for it)';
          continue;
        }
        if (load > st.coolingCap * 0.98) {
          // cooling gear itself draws power — make room for it first
          if (st.itLoadAll + 18 > st.powerCap && addInfra(powers, 18, der)) placed = true;
          else if (addInfra(cools, load - st.coolingCap * 0.98, der)) placed = true;
          else blocked = 'not enough cooling capacity (no free infrastructure bay, or too little budget for it)';
          continue;
        }
        if (place(e.id, n, der)) placed = true;
        else blocked = 'the budget ran out';
      }
      if (placed) break;
    }
    if (!placed) { stop = blocked || 'the budget ran out'; break; }
  }
  if (opts.free) { s.cash = realCash; emit('world'); return { ok: true, count, spent: 0 }; }
  if (!count) return { ok: false, reason: `Couldn't install anything: ${stop || 'nothing more fits'}.`, count, spent: 0 };
  toast({ title: 'Auto-equip complete', body: `Installed ${count} items for ${money(spent)} at ${f.name}.${stop && stop !== 'all rack slots are full' ? ` Stopped because ${stop}.` : ''}`, kind: 'good', icon: '⚡' });
  return { ok: true, count, spent };
}
