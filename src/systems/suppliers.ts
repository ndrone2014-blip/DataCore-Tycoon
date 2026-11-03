// Hardware suppliers. The vendor you've picked for each category sets the price, quality and
// delivery time of what you buy from then on; hardware you already own keeps the quality it came with.

import type { Facility, GameState } from '../core/state';
import { GEN_PERF, GEN_PRICE, MAX_SUPPLIER_GEN, SUPPLIERS, SUPPLY_DEALS, equipCat, supplierById, type SupplierDef, type SupplyCat } from '../config/expansion';
import { canAfford, log, pushNews, spend, stat } from './ledger';
import { emit, sfx, toast } from '../core/bus';
import { money } from '../core/format';
import { equipmentById } from '../config/buildings';
import { pick } from '../core/rng';

export function activeSupplier(s: GameState, cat: SupplyCat): SupplierDef {
  return supplierById(s.supply?.chosen?.[cat] ?? `std_${cat}`) ?? supplierById(`std_${cat}`)!;
}
const inShortage = (s: GameState, id: string) => s.events.some((e) => e.defId === 'supply_crunch' && e.supplier === id);
export const supplierGen = (s: GameState, id: string) => s.supply?.gen?.[id] ?? 0;

/** Current deal terms for a supplier, after technology, shortages, your reputation and any contract. */
export function supplierTerms(s: GameState, sup: SupplierDef) {
  const gen = supplierGen(s, sup.id);
  const short = inShortage(s, sup.id);
  const deal = s.supply?.deals?.[sup.cat];
  const dealDisc = deal && deal.supplier === sup.id && deal.until > s.gameHours ? deal.discount : 0;
  const repDisc = (s.company.reputation - 50) / 1000;
  return {
    price: sup.price * (1 + gen * GEN_PRICE) * (short ? 1.3 : 1) * (1 - dealDisc) * (1 - repDisc),
    perf: sup.perf + gen * GEN_PERF,
    rel: sup.rel,
    lead: sup.lead + (short ? 36 : 0),
    short, gen, dealDisc,
  };
}

export function categoryPriceMult(s: GameState, eqId: string): number {
  const cat = equipCat(eqId);
  return cat ? supplierTerms(s, activeSupplier(s, cat)).price : 1;
}

/** Records who supplied this batch and schedules its delivery. */
export function recordPurchase(s: GameState, f: Facility, eqId: string, count: number) {
  const cat = equipCat(eqId);
  if (!cat) return;
  const sup = activeSupplier(s, cat);
  const t = supplierTerms(s, sup);
  const v = ((f.vendor ??= {})[cat] ??= { n: 0, perf: 1, rel: 1 });
  const total = v.n + count;
  v.perf = (v.perf * v.n + t.perf * count) / total;
  v.rel = (v.rel * v.n + t.rel * count) / total;
  v.n = total;
  if (t.lead > 0) (f.orders ??= []).push({ eq: eqId, n: count, at: s.gameHours + t.lead });
}

export function chooseSupplier(s: GameState, cat: SupplyCat, id: string): { ok: boolean; reason?: string } {
  const sup = supplierById(id);
  if (!sup || sup.cat !== cat) return { ok: false, reason: 'Unknown supplier' };
  if (s.level < sup.level) return { ok: false, reason: `Requires level ${sup.level}` };
  const deal = s.supply.deals[cat];
  if (deal && deal.supplier !== id && deal.until > s.gameHours) return { ok: false, reason: `You're under contract with ${supplierById(deal.supplier)?.name} for ${Math.ceil((deal.until - s.gameHours) / 24)} more days` };
  s.supply.chosen[cat] = id;
  log(s, `${sup.name} is now your ${sup.cat.toUpperCase()} supplier`, 'info');
  sfx('nav');
  return { ok: true };
}

export const dealFee = (valuation: number, dealId: string) => {
  const d = SUPPLY_DEALS.find((x) => x.id === dealId)!;
  return Math.max(d.minFee, Math.round((valuation * d.feeShare) / 1000) * 1000);
};

export function signDeal(s: GameState, valuation: number, cat: SupplyCat, dealId: string): { ok: boolean; reason?: string } {
  const d = SUPPLY_DEALS.find((x) => x.id === dealId);
  if (!d) return { ok: false, reason: 'Unknown agreement' };
  const cur = s.supply.deals[cat];
  if (cur && cur.until > s.gameHours) return { ok: false, reason: 'You already have an agreement in this category' };
  const fee = dealFee(valuation, dealId);
  if (!canAfford(s, fee)) return { ok: false, reason: `Need ${money(fee)}` };
  const sup = activeSupplier(s, cat);
  spend(s, fee, 'Suppliers', `${d.label} with ${sup.name}`);
  s.supply.deals[cat] = { supplier: sup.id, until: s.gameHours + d.days * 24, discount: d.discount };
  stat(s, 'supplyDeals');
  log(s, `Signed a ${d.label.toLowerCase()} with ${sup.name}: ${Math.round(d.discount * 100)}% off`, 'money');
  sfx('contract');
  emit('world');
  return { ok: true };
}

/** A new product generation from one vendor: better hardware from now on, at a slightly higher price. */
export function techRelease(s: GameState): string | null {
  const options = SUPPLIERS.filter((x) => supplierGen(s, x.id) < MAX_SUPPLIER_GEN);
  if (!options.length) return null;
  const sup = pick(options);
  s.supply.gen[sup.id] = supplierGen(s, sup.id) + 1;
  pushNews(s, `${sup.name} ships a new generation of hardware`, `Generation ${s.supply.gen[sup.id] + 1}: +${Math.round(GEN_PERF * 100)}% performance on new orders, slightly higher prices.`, 'info', 'Suppliers');
  return sup.name;
}

export function tickOrders(s: GameState) {
  for (const f of Object.values(s.facilities)) {
    if (!f.orders?.length) continue;
    const before = f.orders.length;
    const arrived = f.orders.filter((o) => o.at <= s.gameHours);
    if (!arrived.length) continue;
    f.orders = f.orders.filter((o) => o.at > s.gameHours);
    if (!f.orders.length) f.orders = undefined;
    const units = arrived.reduce((a, o) => a + o.n, 0);
    toast({ title: 'Hardware delivered', body: `${units} × ${equipmentById(arrived[0].eq)?.name ?? 'equipment'}${before > arrived.length ? ' and more on the way' : ''} now running at ${f.name}.`, kind: 'good', icon: '📦', channel: 'contract' });
    emit('world');
  }
}

export function pendingUnits(f: Facility, eqId?: string): number {
  if (!f.orders?.length) return 0;
  let n = 0;
  for (const o of f.orders) if (!eqId || o.eq === eqId) n += o.n;
  return n;
}

/** Selling hardware that hasn't arrived cancels those orders first. */
export function cancelOrders(f: Facility, eqId: string, count: number) {
  if (!f.orders) return;
  let left = count;
  for (const o of f.orders) {
    if (o.eq !== eqId || left <= 0) continue;
    const k = Math.min(o.n, left);
    o.n -= k;
    left -= k;
  }
  f.orders = f.orders.filter((o) => o.n > 0);
  if (!f.orders.length) f.orders = undefined;
}

export function announceShortage(s: GameState, supplierId: string) {
  const sup = supplierById(supplierId);
  if (sup && s.supply.chosen[sup.cat] === sup.id) toast({ title: `${sup.name} shortage`, body: 'Your supplier has raised prices and delivery times. You can switch vendors on the Suppliers page.', kind: 'warn', icon: '📦' });
}
