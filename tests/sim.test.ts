import { newGame, step, catchUp } from '../src/systems/sim';
import { buyParcel, startDemolition, canBuy } from '../src/systems/property';
import { startBuild, quoteBuild, speedUp } from '../src/systems/construction';
import { install, installQuote } from '../src/systems/equipment';
import { acceptOffer, eligibleFacilities } from '../src/systems/contracts';
import { startResearch } from '../src/systems/research';
import { hire } from '../src/systems/employees';
import { deriveAll } from '../src/systems/derive';
import { getCityLayout } from '../src/world/parcels';
import { serialize, parse } from '../src/save/save';
import { money } from '../src/core/format';

const assert = (c: any, m: string) => { if (!c) { console.error('FAIL', m); (globalThis as any).process.exitCode = 1; } else console.log('ok  ', m); };
const s = newGame({ name: 'TestCo', logo: '⬡', color: '#3b82f6', startCity: 'chicago', difficulty: 'standard' });
const start = s.company.startParcel!;
assert(s.parcels[start].owner === 'player', 'start parcel owned');
for (const c of ['chicago','nova','tokyo','sydney']) { const l = getCityLayout(c); console.log(c, 'parcels', l.parcels.length, 'zones', l.zones.length); }
assert(startDemolition(s, start).ok, 'demolition starts');
const cash0 = s.cash;
for (let i = 0; i < 60; i++) step(s, 1);
assert(s.parcels[start].status === 'cleared', 'demolition completes');
const q = quoteBuild(s, start, 'modular');
console.log('modular quote', money(q.total), q.seconds + 's', q.reasons);
assert(q.ok, 'modular quote ok');
startBuild(s, start, 'modular', undefined);
const pid = Object.keys(s.projects)[0];
for (let i = 0; i < 20; i++) step(s, 1);
const r = speedUp(s, pid, 'medium'); assert(r.ok, 'speed up works');
for (let i = 0; i < 200 && Object.keys(s.projects).length; i++) step(s, 1);
const fid = Object.keys(s.facilities)[0];
assert(!!fid, 'facility created');
console.log('cash after build', money(s.cash));
let q2 = installQuote(s, fid, 'cpu_std', 8); console.log('install 8 cpu', q2);
install(s, fid, 'pdu', 1); install(s, fid, 'cooling_air', 1);
q2 = install(s, fid, 'cpu_std', 8); assert(q2.ok, 'install cpus');
install(s, fid, 'storage', 2); install(s, fid, 'network', 1);
let d = deriveAll(s);
console.log('fac stats', JSON.stringify({ perf: d.fac[fid].perf, rev: d.fac[fid].revenueHr, exp: d.fac[fid].expenseHr, load: d.fac[fid].itLoad, pc: d.fac[fid].powerCap, cc: d.fac[fid].coolingCap, exps: d.fac[fid].expenses }));
console.log('totals', d.totals.revenueHr.toFixed(0), d.totals.expenseHr.toFixed(0), d.totals.profitHr.toFixed(0), 'val', money(d.totals.valuation));
for (let i = 0; i < 30; i++) step(s, 1);
console.log('offers', s.contracts.offers.length);
for (const o of [...s.contracts.offers]) {
  const el = eligibleFacilities(s, o).find((x) => x.ok);
  if (el) { const a = acceptOffer(s, o.id, el.f.id); console.log('accept', o.customer, o.cap, o.amount, a); }
}
hire(s, s.candidates[0].id);
console.log('research', startResearch(s, 'air_imp'));
// simulate 30 minutes with naive reinvestment
for (let t = 0; t < 1800; t++) {
  step(s, 1);
  if (t % 60 === 0) {
    for (const o of [...s.contracts.offers]) { const el = eligibleFacilities(s, o).find((x) => x.ok); if (el) acceptOffer(s, o.id, el.f.id); }
    const f = s.facilities[fid];
    if (installQuote(s, fid, 'cooling_air', 1).ok && deriveAll(s).fac[fid].coolingCap < deriveAll(s).fac[fid].itLoad + 30) install(s, fid, 'cooling_air', 1);
    if (installQuote(s, fid, 'pdu', 1).ok && deriveAll(s).fac[fid].powerCap < deriveAll(s).fac[fid].itLoad + 30) install(s, fid, 'pdu', 1);
    const eq = s.level >= 2 ? 'gpu_ai' : 'cpu_std';
    if (installQuote(s, fid, eq, 1).ok && s.cash > 200000) install(s, fid, eq, 1);
    void f;
  }
  if (t % 300 === 0) { d = deriveAll(s); console.log(`t=${t}s lvl ${s.level} cash ${money(s.cash)} rev/h ${d.totals.revenueHr.toFixed(0)} exp/h ${d.totals.expenseHr.toFixed(0)} val ${money(d.totals.valuation)} contracts ${s.contracts.active.length} comps ${s.competitors.map(c=>c.sites.length+':'+money(c.valuation)).join(' ')}`); }
}
const txt = serialize(s);
const back = parse(txt);
assert(back.state && back.state.cash === s.cash, 'save roundtrip');
console.log('save size KB', (txt.length/1024).toFixed(1));
s.lastRealTime = Date.now() - 3600_000;
const rep = catchUp(s);
console.log('offline', rep);
assert(rep && rep.seconds > 3000, 'offline progress');
const bad = parse('{"magic":"AIDCE","state":{"company":{"name":"x"},"cash":"NaN"}}');
assert(bad.state && bad.state.cash === 0 && bad.repaired.length > 0, 'repair invalid save');
assert(!parse('garbage').state, 'reject garbage');

// ---- Stop Time, auto-equip, opportunity cards, safety nets ----
import { advanceFrozen } from '../src/systems/sim';
import { autoEquip } from '../src/systems/equipment';
import { DECISIONS, resolveDecision } from '../src/systems/decisions';
{
  const g = newGame({ name: 'Calm', logo: '⬡', color: '#22c55e', startCity: 'dallas', difficulty: 'relaxed' });
  const sp = g.company.startParcel!;
  startDemolition(g, sp);
  const cash0 = g.cash, gh0 = g.gameHours;
  g.paused = true;
  for (let i = 0; i < 120; i++) advanceFrozen(g, 1);
  assert(g.parcels[sp].status === 'cleared', 'demolition advances while time is stopped');
  assert(g.cash === cash0 && g.gameHours === gh0, 'no money or game time passes while stopped');
  startBuild(g, sp, 'modular', undefined);
  for (let i = 0; i < 200 && Object.keys(g.projects).length; i++) advanceFrozen(g, 1);
  const fid2 = Object.keys(g.facilities)[0];
  assert(!!fid2, 'construction completes while stopped');
  const r = autoEquip(g, fid2, g.cash * 0.8);
  const st2 = deriveAll(g).fac[fid2];
  console.log('autoEquip', r.count, money(r.spent), JSON.stringify(g.facilities[fid2].equipment), 'perf', st2.perf.toFixed(2));
  assert(r.ok && r.count > 3, 'auto-equip installs equipment');
  assert(st2.powerFactor >= 0.999 && st2.coolingFactor >= 0.999, 'auto-equip never overloads power or cooling');
  g.paused = false;
  for (let i = 0; i < 60; i++) step(g, 1);
  // every opportunity card applies cleanly
  let applied = 0;
  for (const def of DECISIONS) {
    const data = def.setup(g, deriveAll(g));
    if (!data) continue;
    g.cash = 1e8;
    g.decision = { id: 'x', defId: def.id, expiresAt: g.gameHours + 50, data };
    const res = resolveDecision(g, 0);
    if (res.ok) applied++; else console.log('decision fail', def.id, res.reason);
  }
  console.log('decisions applied', applied, 'buffs', g.buffs?.length);
  assert(applied >= 6, 'opportunity cards resolve');
  // overdraft protection
  g.cash = -50_000;
  step(g, 1);
  assert(g.cash >= 0 && g.debt > 0, 'overdraft protection kicks in');
  // offline loss cap
  g.debt = 0; g.cash = 1_000_000; g.employees = Array.from({ length: 40 }, (_, i) => ({ ...g.candidates[0], id: 'e' + i, salary: 5000 }));
  g.lastRealTime = Date.now() - 3 * 3600_000;
  g.settings.autoLoan = false;
  catchUp(g);
  assert(g.cash >= 749_999, 'offline losses capped at 25%');
}
