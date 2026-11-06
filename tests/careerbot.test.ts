// A scripted player works through a new career company and reports when each milestone lands.
// Times are at 1× game speed. Usage: npx tsx tests/careerbot.test.ts [hours] [city] [difficulty]
import { newGame, advance } from '../src/systems/sim';
import { deriveAll, landValue } from '../src/systems/derive';
import { buyParcel, startDemolition, parcelState, unlockCity, licenseFee } from '../src/systems/property';
import { startBuild, quoteBuild, startHQ } from '../src/systems/construction';
import { install, installQuote, upgradeHQ, hqUpgradeQuote } from '../src/systems/equipment';
import { acceptOffer, eligibleFacilities } from '../src/systems/contracts';
import { startResearch, canResearch } from '../src/systems/research';
import { hire, staffCap } from '../src/systems/employees';
import { claimMission, currentStory, missionProgress } from '../src/systems/progression';
import { buyGarageServer, garageQuote, startGig, ensureBoard, setAutoGigs, takeStartupLoan, loanOffer, orderHookup, hasFeature, GOALS, STAGES } from '../src/systems/career';
import { getCityLayout } from '../src/world/parcels';
import { BLUEPRINTS } from '../src/config/buildings';
import { RESEARCH } from '../src/config/research';
import { CITIES } from '../src/config/world';
import { money } from '../src/core/format';
import { on } from '../src/core/bus';

const argv = (globalThis as any).process.argv;
const HOURS = Number(argv[2] ?? 6), CITY = argv[3] ?? 'carmi', DIFF = argv[4] ?? 'standard';
const s = newGame({ name: 'Bot', logo: '⬡', color: '#3b82f6', startCity: CITY, difficulty: DIFF });
const fmt = (t: number) => `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
let T = 0;
const when: Record<string, number> = {};
on('milestone', (m: any) => { when[m.id] = T; const d = deriveAll(s); console.log(`${fmt(T).padStart(7)}  ${m.title.padEnd(30)} cash ${money(s.cash).padStart(9)} debt ${money(s.debt).padStart(9)} profit/h ${money(d.totals.profitHr).padStart(8)} lvl ${s.level} dc ${d.totals.facilities}`); });

on('cash', (a: number) => { if (argv[5] === 'big' && a > 60_000) console.log(`      ${fmt(T)} +${money(a)} ${s.finance.ledger[0]?.cat}: ${s.finance.ledger[0]?.desc}`); });
function think() {
  const d = deriveAll(s);
  const st = currentStory(s);
  if (st && missionProgress(s, d, { ...st, base: 0 }) >= 1) claimMission(s, d, 'story', st.id);
  for (const m of s.missions.daily.items) if (!m.claimed && missionProgress(s, d, m) >= 1) claimMission(s, d, 'daily', m.id);
  // founder keeps working while it still matters
  ensureBoard(s);
  if (hasFeature(s, 'g_steady') && !s.career.autoGigs) setAutoGigs(s, true);
  if (!s.career.gig && s.career.board.length) startGig(s, [...s.career.board].sort((a, b) => b.pay / b.seconds - a.pay / a.seconds)[0].id);
  if (s.career.garage < 2 && garageQuote(s).ok && s.cash > garageQuote(s).cost * 2) buyGarageServer(s);
  const sp = s.company.startParcel!;
  if (parcelState(s, sp).owner !== 'player') { if (s.cash >= landValue(s, sp)) buyParcel(s, sp); return; }
  // financing
  if (loanOffer(s, 'construction').ok && parcelState(s, sp).status === 'cleared' && !Object.keys(s.facilities).length) { const q = quoteBuild(s, sp, 'modular'); if (s.cash + loanOffer(s, 'construction').amount >= q.total) takeStartupLoan(s, 'construction'); }
  if (loanOffer(s, 'equipment').ok && Object.values(s.facilities).some((f) => !f.isHQ)) takeStartupLoan(s, 'equipment');
  for (const f of Object.values(s.facilities)) if (f.hookups) { orderHookup(s, f.id, 'power'); orderHookup(s, f.id, 'net'); }
  // contracts, with a cheap capacity check
  for (const o of [...s.contracts.offers]) { const el = eligibleFacilities(s, o, d).find((x) => x.ok); if (el) acceptOffer(s, o.id, el.f.id); }
  // keep some cash back once the site is live; humans don't run to zero
  const reserve = d.totals.expenseHr * 40;
  if (hasFeature(s, 'g_research') && !s.research.active) { const r = RESEARCH.filter((x) => canResearch(s, x.id).ok && s.cash > x.cost * 1.6 + reserve).sort((a, b) => a.cost - b.cost)[0]; if (r) startResearch(s, r.id); }
  if (hasFeature(s, 'g_profit') && s.employees.length < staffCap(s) && d.totals.profitHr > 80 + s.employees.length * 90) { const c = s.candidates.find((x) => ['engineering', 'sales', 'ops', 'it', 'electrical', 'cooling', 'research'].includes(x.dept)); if (c && s.cash > reserve + 5000) hire(s, c.id); }
  const hq = hqUpgradeQuote(s); if (hq.ok && s.company.hqFacility && s.cash > hq.cost * 3) upgradeHQ(s);
  for (const f of Object.values(s.facilities)) {
    if (f.isHQ) continue;
    for (let k = 0; k < 12; k++) {
      const dd = deriveAll(s), fs = dd.fac[f.id];
      let done = false;
      const buy = (eq: string) => { const q = installQuote(s, f.id, eq, 1, dd); if (q.ok && !q.warn && s.cash > q.cost + reserve) { install(s, f.id, eq, 1); return true; } return false; };
      if (fs.network + 4 < fs.servers + 1) done = buy(s.research.done.includes('hs_net') ? 'network_hs' : 'network');
      if (!done && fs.coolingCap < fs.itLoadAll + 15) done = buy(s.research.done.includes('adv_cool') ? 'cooling_adv' : 'cooling_air');
      if (!done && fs.powerCap < fs.itLoadAll + 15) done = buy('pdu');
      if (!done) for (const eq of ['accel_x', 'accel', 'gpu_ent', 'gpu_ai', 'cpu_hd', 'cpu_std']) if (buy(eq)) { done = true; break; }
      if (!done) break;
    }
  }
  // expansion
  if (Object.values(s.projects).length < 1 + Math.floor(s.level / 12)) {
    for (const [pid, ps] of Object.entries(s.parcels)) {
      if (ps.owner !== 'player' || ps.mergedInto) continue;
      if (ps.status === 'existing') startDemolition(s, pid);
      else if (ps.status === 'cleared') {
        if (!s.company.hqFacility && hasFeature(s, 'g_stage2') && s.cash > 900_000) { startHQ(s, pid); continue; }
        const bp = [...BLUEPRINTS].reverse().find((b) => quoteBuild(s, pid, b.id).ok && s.cash > quoteBuild(s, pid, b.id).total * 1.05);
        if (bp) startBuild(s, pid, bp.id, undefined);
      }
    }
    if (hasFeature(s, 'g_profit')) {
      const noVacant = !Object.values(s.parcels).some((p) => p.owner === 'player' && !p.mergedInto && (p.status === 'cleared' || p.status === 'existing'));
      // a sensible player stops building into a saturated market and saves for the next city
      const open = s.unlockedCities.some((c) => (d.citySupply[c] ?? 0) / (d.cityDemand[c] ?? 1) < 0.6);
      if (hasFeature(s, 'g_stage2') && !open) { const c = CITIES.filter((x) => !s.unlockedCities.includes(x.id) && s.level >= x.unlockLevel).sort((a, b) => licenseFee(s, a.id) - licenseFee(s, b.id))[0]; if (c && s.cash > licenseFee(s, c.id) * 1.3) unlockCity(s, c.id); }
      if (noVacant && (open || !hasFeature(s, 'g_stage2'))) {
        const bp = [...BLUEPRINTS].reverse().find((b) => b.level <= s.level && b.cost * 1.3 < s.cash);
        let best: { id: string; v: number } | null = null;
        if (bp) for (const cid of s.unlockedCities) {
          const sat = (d.citySupply[cid] ?? 0) / (d.cityDemand[cid] ?? 1);
          for (const p of getCityLayout(cid).parcels) {
            if (sat > 0.75) continue;
            if (parcelState(s, p.id).owner || p.area < bp.minLot || bp.floors > p.zoning.maxFloors) continue;
            if (!p.zoning.heavy && ['hyperscale', 'ai_center', 'supercomputer', 'mega'].includes(bp.id)) continue;
            const price = landValue(s, p.id); if (price > s.cash * 0.3) continue;
            const v = (1 - Math.min(0.95, sat)) / (price + 1000);
            if (!best || v > best.v) best = { id: p.id, v };
          }
        }
        if (best) buyParcel(s, best.id);
      }
    }
  }
}
const t0 = Date.now();
for (T = 0; T < HOURS * 3600; T++) {
  advance(s, 1);
  if (T % 5 === 0) think();
  if (T % 3600 === 0 && T) { const d = deriveAll(s); console.log(`  -- ${fmt(T)} ${STAGES[s.career.stage].name} lvl ${s.level} cash ${money(s.cash)} debt ${money(s.debt)} profit/h ${money(d.totals.profitHr)} val ${money(d.totals.valuation)} dc ${d.totals.facilities} cities ${d.totals.cities} res ${s.research.done.length} staff ${s.employees.length} gigs ${s.career.gigsDone} | rivals ${s.competitors.map((c) => money(c.valuation)).join(' ')}`); }
}
if (argv[5] === 'big') for (const x of s.finance.ledger.filter((l) => l.amount > 50_000).slice(0, 40)) console.log(fmt(x.t), money(x.amount), x.cat, x.desc);
console.log('goals done', Object.keys(s.career.done).length, '/', GOALS.length, 'next:', GOALS.filter((g) => s.career.done[g.id] === undefined).slice(0, 5).map((g) => g.id).join(','), `sim ${(Date.now() - t0) / 1000}s`);
