// Scripted player that plays the game for N real-time hours to check balance.
import { newGame, advance, catchUp } from '../src/systems/sim';
import { buyParcel, startDemolition, parcelState, unlockCity, buyZone, zoneQuote, consolidateZone, consolidateQuote } from '../src/systems/property';
import { startBuild, quoteBuild, startHQ, speedUp } from '../src/systems/construction';
import { install, installQuote, upgradeHQ, hqUpgradeQuote, upgradeEquipment, upgradeQuote } from '../src/systems/equipment';
import { acceptOffer, eligibleFacilities } from '../src/systems/contracts';
import { startResearch, canResearch } from '../src/systems/research';
import { hire, staffCap } from '../src/systems/employees';
import { claimMission, currentStory, missionProgress } from '../src/systems/progression';
import { deriveAll, landValue } from '../src/systems/derive';
import { getCityLayout } from '../src/world/parcels';
import { BLUEPRINTS, EQUIPMENT } from '../src/config/buildings';
import { RESEARCH } from '../src/config/research';
import { CITIES } from '../src/config/world';
import { money } from '../src/core/format';

const HOURS = Number((globalThis as any).process?.argv?.[2] ?? 3);
const s = newGame({ name: 'Bot', logo: '⬡', color: '#3b82f6', startCity: 'nova', difficulty: 'standard', mode: 'legacy' });
const t0 = Date.now();
let errors = 0;
const tryDo = (f: () => any) => { try { return f(); } catch (e: any) { if (!/Not enough cash/.test(e.message)) { errors++; console.error('ERR', e.message); } } };

function think() {
  const d = deriveAll(s);
  // story missions
  const st = currentStory(s);
  if (st && missionProgress(s, d, { ...st, base: 0 }) >= 1) claimMission(s, d, 'story', st.id);
  for (const m of s.missions.daily.items) if (!m.claimed && missionProgress(s, d, m) >= 1) claimMission(s, d, 'daily', m.id);
  // unlock cities
  for (const c of CITIES) if (!s.unlockedCities.includes(c.id) && s.level >= c.unlockLevel && s.cash > c.license * 3) tryDo(() => unlockCity(s, c.id));
  // contracts
  for (const o of [...s.contracts.offers]) { const el = eligibleFacilities(s, o, d).find((x) => x.ok); if (el) tryDo(() => acceptOffer(s, o.id, el.f.id)); }
  // research
  if (!s.research.active) { const r = RESEARCH.filter((x) => canResearch(s, x.id).ok && s.cash > x.cost * 2.5).sort((a, b) => a.cost - b.cost)[0]; if (r) tryDo(() => startResearch(s, r.id)); }
  // staff
  if (s.employees.length < staffCap(s) && s.cash > 300_000) { const c = s.candidates.find((x) => ['engineering', 'sales', 'research', 'ops', 'it', 'cooling', 'electrical'].includes(x.dept)); if (c) tryDo(() => hire(s, c.id)); }
  // HQ
  const hq = hqUpgradeQuote(s); if (hq.ok && s.cash > hq.cost * 4) tryDo(() => upgradeHQ(s));
  // fill facilities
  for (const f of Object.values(s.facilities)) {
    if (f.isHQ) continue;
    for (let k = 0; k < 30; k++) {
      const dd = deriveAll(s); const fs = dd.fac[f.id];
      let done = false;
      if (fs.network + 4 < fs.servers + 2) { if (installQuote(s, f.id, s.research.done.includes('hs_net') ? 'network_hs' : 'network', 1, dd).ok && s.cash > 200_000) { install(s, f.id, s.research.done.includes('hs_net') ? 'network_hs' : 'network', 1); done = true; } }
      if (!done && fs.coolingCap < fs.itLoad + 80) { const eq = ['liquid', 'cooling_adv', 'cooling_air'].find((e) => installQuote(s, f.id, e, 1, dd).ok); if (eq && s.cash > 300_000) { install(s, f.id, eq, 1); done = true; } }
      if (!done && fs.powerCap < fs.itLoad + 80) { const eq = ['substation', 'pdu'].find((e) => installQuote(s, f.id, e, 1, dd).ok); if (eq && s.cash > 300_000) { install(s, f.id, eq, 1); done = true; } }
      if (!done) { const eq = ['accel_x', 'accel', 'gpu_ent', 'gpu_ai', 'cpu_hd', 'cpu_std'].find((e) => { const q = installQuote(s, f.id, e, 1, dd); return q.ok && !q.warn && s.cash > q.cost * 2; }); if (eq) { install(s, f.id, eq, 1); done = true; } }
      if (!done) break;
    }
    // upgrades
    for (const eq of ['cpu_std', 'gpu_ai', 'gpu_ent', 'accel']) if (f.equipment[eq] && upgradeQuote(s, f.id, eq).ok && s.cash > 5_000_000) tryDo(() => upgradeEquipment(s, f.id, eq));
  }
  // expand: buy best lot we can develop
  const active = Object.values(s.projects).length;
  if (active < 2 + Math.floor(s.level / 10)) {
    // existing owned sites first
    for (const [pid, ps] of Object.entries(s.parcels)) {
      if (ps.owner !== 'player' || ps.mergedInto) continue;
      if (ps.status === 'existing') tryDo(() => startDemolition(s, pid));
      else if (ps.status === 'cleared') {
        if (!s.company.hqFacility && s.level >= 4) { tryDo(() => startHQ(s, pid)); continue; }
        const bp = [...BLUEPRINTS].reverse().find((b) => quoteBuild(s, pid, b.id).ok);
        if (bp) tryDo(() => startBuild(s, pid, bp.id, undefined));
      }
    }
    // zone strategy at mid game
    if (s.level >= 12) for (const cid of s.unlockedCities) for (const z of getCityLayout(cid).zones) { const q = zoneQuote(s, z.id); if (q.ok && s.cash > q.price * 3) tryDo(() => buyZone(s, z.id)); const c = consolidateQuote(s, z.id); if (c.ok) tryDo(() => consolidateZone(s, z.id)); }
    const budget = s.cash * 0.35;
    let best: { id: string; score: number } | null = null;
    for (const cid of s.unlockedCities) for (const p of getCityLayout(cid).parcels) {
      if (parcelState(s, p.id).owner) continue;
      const price = landValue(s, p.id); if (price > budget) continue;
      const bp = [...BLUEPRINTS].reverse().find((b) => b.level <= s.level && b.minLot <= p.area && (p.zoning.heavy || !['hyperscale', 'ai_center', 'supercomputer', 'mega'].includes(b.id)) && b.floors <= p.zoning.maxFloors);
      if (!bp) continue;
      const score = bp.slots / (price + bp.cost * 1.3);
      if (!best || score > best.score) best = { id: p.id, score };
    }
    if (best && s.cash > 600_000) tryDo(() => buyParcel(s, best!.id));
  }
  // speed up when rich
  for (const pr of Object.values(s.projects)) if (s.cash > pr.cost * 6) tryDo(() => speedUp(s, pr.id, 'major'));
}

for (let t = 0; t < HOURS * 3600; t++) {
  advance(s, 1);
  if (t % 20 === 0) think();
  if (t % 1800 === 0) {
    const d = deriveAll(s);
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${(t / 3600).toFixed(2)}h lvl ${s.level} cash ${money(s.cash)} profit/h ${money(d.totals.profitHr)} val ${money(d.totals.valuation)} fac ${d.totals.facilities} cities ${d.totals.cities}/${s.unlockedCities.length} gpu ${Math.round(d.totals.delivered.gpu)} res ${s.research.done.length} emp ${s.employees.length} ach ${Object.keys(s.achievements).length} story ${s.missions.tutorial} | comps ${s.competitors.map((c) => `${c.sites.length}:${money(c.valuation)}`).join(' ')}`);
  }
}
const d = deriveAll(s);
console.log('FINAL', { level: s.level, valuation: money(d.totals.valuation), facilities: d.totals.facilities, built: Object.keys(s.stats).filter((k) => k.startsWith('built_')).map((k) => `${k}=${s.stats[k]}`).join(','), errors, secs: (Date.now() - t0) / 1000 });
s.lastRealTime = Date.now() - 8 * 3600_000;
const tt = Date.now(); const rep = catchUp(s); console.log('offline catchup', rep?.seconds, 'took', Date.now() - tt, 'ms', 'cash change', money(rep?.cash ?? 0));
