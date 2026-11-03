// Customer contract marketplace.

import type { Contract, GameState } from '../core/state';
import { newId } from '../core/state';
import { CUSTOMER_TYPES, customerName, type CustomerType } from '../config/content';
import { ECONOMY } from '../config/economy';
import { CAP_LABEL, type CapType } from '../config/buildings';
import { rand, randRange, pick } from '../core/rng';
import { deriveAll, type Derived } from './derive';
import { deptBonus, eff } from './modifiers';
import { receive, spend, log, addXp, stat, pushTx } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { money, num } from '../core/format';
import { cityById } from '../config/world';
import { cityMods, specMods } from './regulation';
import { REP_REQ, repOfferMult } from './reputation';

const MIN_SIZE: Record<CapType, number> = { cpu: 128, gpu: 8, storage: 480 };
const STEP: Record<CapType, number> = { cpu: 64, gpu: 8, storage: 480 };

export function contractRateMult(s: GameState, der: Derived): number {
  return 1 + eff(der.effects, 'contractRate') + deptBonus(s, 'sales') * 0.4 + (s.company.reputation - 50) / 500;
}

export function generateOffer(s: GameState, der: Derived): Contract {
  const boom = s.events.some((e) => e.defId === 'ai_boom');
  // Customers buy capacity in a specific market. Mostly where you operate, sometimes elsewhere (expansion bait).
  const myCities = [...new Set(Object.values(s.facilities).filter((f) => !f.isHQ).map((f) => f.cityId))];
  const cityPref = myCities.length && rand() < 0.75 ? pick(myCities) : pick(s.unlockedCities);
  const mods = cityMods(s, cityPref);
  const spec = specMods(s, cityPref, der.effects);
  // big customers look at your reputation before they'll talk to you
  const allTypes = (Object.keys(CUSTOMER_TYPES) as CustomerType[]).filter((t) => s.level >= CUSTOMER_TYPES[t].level);
  const trusted = allTypes.filter((t) => s.company.reputation >= (REP_REQ[t] ?? 0));
  const types = trusted.length ? trusted : allTypes;
  const weights = types.map((t) => (boom && (t === 'startup' || t === 'tech') ? 2.5 : 1) * (t === 'government' || t === 'tech' ? 0.6 : 1) * (t === 'government' ? mods.govDemand : 1) * (spec.draws.includes(t) ? 1.7 : 1));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  let ctype = types[0];
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) { ctype = types[i]; break; }
  }
  const def = CUSTOMER_TYPES[ctype];
  const cityCap = (c: CapType) => Object.values(s.facilities).filter((f) => f.cityId === cityPref).reduce((a, f) => a + (der.fac[f.id]?.raw[c] ?? 0), 0);
  const owned = def.caps.filter((c) => cityCap(c) > 0);
  const cap: CapType = owned.length && rand() < 0.75 ? pick(owned) : pick(def.caps);
  // size: a slice of your local capacity, but never more than the market's unmet demand allows
  const price = der.cityPrice[cityPref] ?? 1;
  const headroomCU = Math.max(der.cityDemand[cityPref] * 0.08, der.cityDemand[cityPref] - der.citySupply[cityPref] * 0.85);
  const headroomUnits = headroomCU / ECONOMY.cuPerUnit[cap];
  const base = Math.min(Math.max(cityCap(cap), MIN_SIZE[cap] * 2) * randRange(0.15, 0.5) * def.sizeMult, headroomUnits * randRange(0.15, 0.4));
  const amount = Math.max(MIN_SIZE[cap], Math.round(base / STEP[cap]) * STEP[cap]);
  const label = pick(def.contractTypes);
  const longTerm = label.startsWith('Long-term');
  const days = Math.round(randRange(def.days[0], def.days[1]) * (longTerm ? 1.5 : 1));
  // contract prices follow the local market (oversupplied cities pay less)
  const marketFactor = 0.35 + 0.65 * Math.min(1.2, price);
  const capFx = eff(der.effects, cap === 'gpu' ? 'gpuRate' : cap === 'cpu' ? 'cpuRate' : 'storageRate');
  const localFx = 1 + capFx + spec.rates[cap] + spec.contractRate + (der.net.city[cityPref]?.contractBonus ?? 0);
  const rate = amount * ECONOMY.revenueRates[cap] * def.rate * contractRateMult(s, der) * localFx * (s.dev?.sale ?? 1) * marketFactor * randRange(0.92, 1.12) * (longTerm ? 0.95 : 1);
  const lifetime = randRange(ECONOMY.offerLifetimeHours[0], ECONOMY.offerLifetimeHours[1]);
  return {
    id: newId(s, 'ct'),
    customer: customerName(ctype, rand),
    ctype, label, cap, amount,
    ratePerHour: Math.round(rate * 100) / 100,
    hours: days * 24, hoursLeft: days * 24,
    sla: def.sla, security: Math.max(def.security, mods.privacyTier),
    bonus: longTerm || days > 30 ? Math.round(rate * randRange(8, 20)) : 0,
    expiresAt: s.gameHours + lifetime,
    fulfillment: 0, earned: 0, breachHours: 0, status: 'offer', cityPref,
  };
}

export function eligibleFacilities(s: GameState, ct: Contract, der = deriveAll(s)) {
  return Object.values(s.facilities)
    .filter((f) => !f.isHQ)
    .map((f) => {
      const st = der.fac[f.id];
      let reason = '';
      if (st.security < ct.security) reason = `Needs security tier ${ct.security} (has ${st.security})`;
      else if (ct.cityPref && f.cityId !== ct.cityPref) reason = `Customer requires ${cityById(ct.cityPref).name}`;
      else if (st.free[ct.cap] + 1e-6 < ct.amount) reason = `Only ${num(st.free[ct.cap])} ${CAP_LABEL[ct.cap].unit} free`;
      return { f, st, ok: !reason, reason };
    });
}

export function acceptOffer(s: GameState, offerId: string, facilityId: string): { ok: boolean; reason?: string } {
  const idx = s.contracts.offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return { ok: false, reason: 'Offer no longer available' };
  const ct = s.contracts.offers[idx];
  const el = eligibleFacilities(s, ct).find((x) => x.f.id === facilityId);
  if (!el) return { ok: false, reason: 'Unknown facility' };
  if (!el.ok) return { ok: false, reason: el.reason };
  s.contracts.offers.splice(idx, 1);
  ct.status = 'active';
  ct.facilityId = facilityId;
  ct.expiresAt = undefined;
  s.contracts.active.push(ct);
  if (ct.bonus) receive(s, ct.bonus, 'Contract Bonus', `Signing bonus: ${ct.customer}`);
  stat(s, 'contractsSigned');
  addXp(s, ECONOMY.xp.contractSigned, 'Contract');
  log(s, `Signed ${ct.label} contract with ${ct.customer} (${money(ct.ratePerHour)}/h)`, 'money');
  sfx('contract');
  emit('world');
  return { ok: true };
}

export function declineOffer(s: GameState, offerId: string) {
  s.contracts.offers = s.contracts.offers.filter((o) => o.id !== offerId);
  emit('world');
}

export function reassignContract(s: GameState, contractId: string, facilityId: string): { ok: boolean; reason?: string } {
  const ct = s.contracts.active.find((c) => c.id === contractId);
  if (!ct) return { ok: false, reason: 'Unknown contract' };
  const prev = ct.facilityId;
  ct.facilityId = undefined;
  const el = eligibleFacilities(s, ct).find((x) => x.f.id === facilityId);
  if (!el || !el.ok) {
    ct.facilityId = prev;
    return { ok: false, reason: el?.reason ?? 'Unknown facility' };
  }
  ct.facilityId = facilityId;
  emit('world');
  return { ok: true };
}

export function cancelContract(s: GameState, contractId: string): { ok: boolean; reason?: string } {
  const i = s.contracts.active.findIndex((c) => c.id === contractId);
  if (i < 0) return { ok: false, reason: 'Unknown contract' };
  const ct = s.contracts.active[i];
  const fee = Math.round(ct.ratePerHour * 24);
  if (s.cash < fee) return { ok: false, reason: `Early termination fee is ${money(fee)}` };
  spend(s, fee, 'Contract Penalties', `Early termination: ${ct.customer}`);
  s.contracts.active.splice(i, 1);
  ct.status = 'cancelled';
  s.contracts.history.unshift(ct);
  s.company.reputation = Math.max(0, s.company.reputation - 5);
  emit('world');
  return { ok: true };
}

/** Advance contract timers. Revenue itself is accounted in the facility flow. */
export function tickContracts(s: GameState, dt: number, der: Derived) {
  const c = s.contracts;
  // offers
  c.nextOfferAt ??= s.gameHours + 4;
  const facilities = Object.values(s.facilities).filter((f) => !f.isHQ).length;
  if (s.gameHours >= c.nextOfferAt) {
    if (c.offers.length < ECONOMY.maxOpenOffers && (facilities > 0 || s.stats.buildsCompleted || s.gameHours > 24)) {
      c.offers.push(generateOffer(s, der));
      emit('offer');
    }
    const speed = Math.max(0.3, (1 + eff(der.effects, 'offerRate') + deptBonus(s, 'sales')) * repOfferMult(s.company.reputation));
    c.nextOfferAt = s.gameHours + randRange(ECONOMY.offerIntervalHours[0], ECONOMY.offerIntervalHours[1]) / speed;
  }
  // auto-sign: hand offers straight to the facility with the most room
  if (s.settings.autoContracts && c.offers.length) {
    for (const o of [...c.offers]) {
      const best = eligibleFacilities(s, o, der).filter((x) => x.ok).sort((a, b) => b.st.free[o.cap] - a.st.free[o.cap])[0];
      if (best) acceptOffer(s, o.id, best.f.id);
    }
  }
  for (let i = c.offers.length - 1; i >= 0; i--) {
    const o = c.offers[i];
    if (o.expiresAt !== undefined && s.gameHours >= o.expiresAt) {
      c.offers.splice(i, 1);
      const comp = s.competitors.length ? pick(s.competitors) : undefined;
      if (comp) {
        comp.contractsWon++;
        comp.cash += o.ratePerHour * Math.min(o.hours, 72) * 0.5;
        comp.lastAction = `Won a ${o.label} deal with ${o.customer}`;
        log(s, `${comp.name} signed ${o.customer} (offer you passed on)`, 'comp');
      }
    }
  }
  // active
  for (let i = c.active.length - 1; i >= 0; i--) {
    const ct = c.active[i];
    if (!ct.facilityId || !s.facilities[ct.facilityId]) {
      ct.facilityId = undefined;
      ct.fulfillment = 0;
    }
    const pay = ct.fulfillment >= ct.sla ? ct.ratePerHour * ct.fulfillment : ct.ratePerHour * ct.fulfillment * ct.fulfillment;
    ct.earned += pay * dt;
    ct.hoursLeft -= dt;
    if (ct.fulfillment + 1e-6 < ct.sla) ct.breachHours += dt;
    else ct.breachHours = Math.max(0, ct.breachHours - dt * 0.5);
    if (ct.breachHours > ECONOMY.slaGraceHours * 0.5 && !(ct as any).warned) {
      (ct as any).warned = true;
      toast({ title: 'Customer unhappy', body: `${ct.customer} is getting poor service (${Math.round(ct.fulfillment * 100)}% of promised capacity). Fix power, cooling or capacity soon.`, kind: 'warn', icon: '⚠️', channel: 'contract-problem' });
    }
    if (ct.breachHours > ECONOMY.slaGraceHours) {
      c.active.splice(i, 1);
      ct.status = 'cancelled';
      c.history.unshift(ct);
      const fee = Math.round(ct.ratePerHour * 6);
      s.cash -= fee;
      s.finance.cur.hour.expenses['Contract Penalties'] = (s.finance.cur.hour.expenses['Contract Penalties'] ?? 0) + fee;
      s.finance.cur.day.expenses['Contract Penalties'] = (s.finance.cur.day.expenses['Contract Penalties'] ?? 0) + fee;
      s.finance.cur.month.expenses['Contract Penalties'] = (s.finance.cur.month.expenses['Contract Penalties'] ?? 0) + fee;
      s.finance.totalExpenses += fee;
      pushTx(s, -fee, 'Contract Penalties', `SLA breach penalty: ${ct.customer}`);
      s.company.reputation = Math.max(0, s.company.reputation - 4);
      stat(s, 'contractsBreached');
      log(s, `${ct.customer} cancelled their contract after repeated SLA breaches (−${money(fee)})`, 'bad');
      toast({ title: 'Contract cancelled', body: `${ct.customer} left due to poor service. Check power, cooling and capacity.`, kind: 'bad', icon: '⚠️', channel: 'contract-problem' });
      if (s.settings.contractAlerts !== 'off') sfx('error');
      continue;
    }
    if (ct.hoursLeft <= 0) {
      c.active.splice(i, 1);
      ct.status = 'completed';
      ct.hoursLeft = 0;
      c.history.unshift(ct);
      s.company.reputation = Math.min(100, s.company.reputation + 2);
      stat(s, 'contractsCompleted');
      addXp(s, ECONOMY.xp.contractComplete + ct.earned / ECONOMY.xp.contractPer, 'Contract');
      log(s, `Contract with ${ct.customer} completed — earned ${money(ct.earned)}`, 'good');
      toast({ title: 'Contract completed', body: `${ct.customer}: ${money(ct.earned)} earned. Reputation +2.`, kind: 'good', icon: '✅', channel: 'contract' });
      if ((s.settings.contractAlerts ?? 'all') === 'all') sfx('cash');
    }
  }
  if (c.history.length > 80) c.history.length = 80;
}
