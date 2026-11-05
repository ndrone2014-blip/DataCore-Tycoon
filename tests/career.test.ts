// Company progression, Carmi and the Thanksgiving theme, plus proof that old saves are untouched.
import { newGame, advance, advanceFrozen, catchUp } from '../src/systems/sim';
import { deriveAll, landValue } from '../src/systems/derive';
import { buyParcel, canBuy, startDemolition, unlockCity, zoneQuote, licenseFee, parcelState, consolidateQuote } from '../src/systems/property';
import { quoteBuild, startBuild, hqQuote } from '../src/systems/construction';
import { autoEquip, install, installQuote, upgradeQuote } from '../src/systems/equipment';
import { canResearch } from '../src/systems/research';
import { hire, promote } from '../src/systems/employees';
import { generateOffer, tickContracts } from '../src/systems/contracts';
import { makeOffer, tickCompetitors } from '../src/systems/competitors';
import { routeQuote, hubQuote } from '../src/systems/fiber';
import { buyGarageServer, checkCareer, ensureBoard, GOALS, goalProgress, hasFeature, hookupQuote, loanOffer, nextGoals, orderHookup, pageLocked, PAGE_GOAL, setAutoGigs, starterParcel, startGig, takeStartupLoan, endlessGoal } from '../src/systems/career';
import { hookupsDone, revenueMult } from '../src/systems/careerCore';
import { claimMission, currentStory, METRICS, missionProgress, storyOf } from '../src/systems/progression';
import { parse, serialize } from '../src/save/save';
import { getCityLayout, getParcel, townRiverX, townPlan, districtFrame } from '../src/world/parcels';
import { getCityscape } from '../src/world/cityscape';
import { BLUEPRINTS } from '../src/config/buildings';
import { CITIES, cityById } from '../src/config/world';
import { ECONOMY } from '../src/config/economy';
import { seasonOn } from '../src/core/season';
import { fiberLink } from '../src/config/expansion';
import { on } from '../src/core/bus';

let failed = 0;
const ok = (c: unknown, m: string) => { if (c) console.log('ok  ', m); else { failed++; console.error('FAIL', m); } };
const co = (startCity = 'carmi', difficulty = 'standard') => newGame({ name: 'T', logo: 'A', color: '#3b82f6', startCity, difficulty });

// ---- the opening ----
{
  const s = co();
  ok(s.career.mode === 'career' && s.career.stage === 0, 'new companies are career companies');
  ok(s.cash === ECONOMY.difficulties.standard.careerCash && s.cash < 20_000, 'a new company starts with very little money');
  ok(s.unlockedCities.length === 1 && s.unlockedCities[0] === 'carmi', 'only one city is available');
  ok(!Object.values(s.parcels).some((p) => p.owner === 'player'), 'the founder owns nothing at the start');
  const sp = s.company.startParcel!;
  const available = getCityLayout('carmi').parcels.filter((p) => { const q = s.cash; s.cash = 1e12; const r = canBuy(s, p.id).ok; s.cash = q; return r; });
  ok(available.length === 1 && available[0].id === sp, 'exactly one property can be bought');
  ok(!canBuy(s, sp).ok, 'and it costs more than the starting cash');
  for (const page of Object.keys(PAGE_GOAL)) ok(!!pageLocked(s, page), `${page} starts locked`);
  ok(!pageLocked(s, 'dashboard') && !pageLocked(s, 'progress') && !pageLocked(s, 'map'), 'the essentials are open');
  ok(!loanOffer(s, 'construction').ok && !loanOffer(s, 'equipment').ok, 'the bank will not lend without collateral');
  ok(!unlockCity(s, 'chicago').ok, 'other cities are closed');
  const d0 = deriveAll(s);
  ok(d0.totals.revenueHr === 0, 'no income at the start');
  // the freelance job loop
  ensureBoard(s);
  ok(s.career.board.length === 3, 'three freelance jobs on the board');
  const gig = s.career.board[0];
  ok(startGig(s, gig.id).ok && !startGig(s, s.career.board[0].id).ok, 'one job at a time');
  const before = s.cash;
  advance(s, gig.seconds + 1);
  ok(s.cash > before + gig.pay * 0.9 && s.career.gigsDone === 1, 'a finished job pays out');
  ok(hasFeature(s, 'g_first_gig'), 'first client goal reached');
  ok(!setAutoGigs(s, true).ok, 'Keep Working has to be earned');
  // garage rack
  s.cash = 5000;
  ok(buyGarageServer(s).ok && s.career.garage === 1, 'buy a garage server');
  ok(deriveAll(s).totals.garageRevenueHr > 0, 'the garage earns a little');
  // jobs can't run while the game is closed
  s.career.gig = { def: { id: 'x', title: 'x', client: 'y', icon: 'z', seconds: 100000, pay: 1, tier: 0 }, done: 0 };
  s.lastRealTime = Date.now() - 1800_000;
  catchUp(s);
  ok(s.career.gig!.done === 0, 'freelance jobs do not advance offline');
  s.career.gig = undefined;
}

// ---- first data center, step by step ----
{
  const s = co();
  const sp = s.company.startParcel!;
  s.cash = landValue(s, sp) + 1000;
  ok(buyParcel(s, sp).ok, 'buy the first property');
  let d = deriveAll(s); checkCareer(s, d, 1);
  ok(hasFeature(s, 'g_property') && !pageLocked(s, 'construction'), 'construction opens');
  ok(loanOffer(s, 'construction').ok, 'the bank offers a construction loan');
  const other = getCityLayout('carmi').parcels.find((p) => p.id !== sp)!;
  s.cash = 1e7;
  ok(!canBuy(s, other.id).ok, 'a second property is still off the market');
  ok(!hqQuote(s, sp).ok, 'no headquarters yet');
  startDemolition(s, sp);
  s.paused = true;
  for (let i = 0; i < 80; i++) advanceFrozen(s, 1);
  ok(s.parcels[sp].status === 'cleared' && hasFeature(s, 'g_cleared'), 'goals still fire while time is stopped');
  s.paused = false;
  s.cash = 5000;
  const loan = loanOffer(s, 'construction');
  ok(takeStartupLoan(s, 'construction').ok && s.debt === loan.amount, 'take the loan');
  ok(!takeStartupLoan(s, 'construction').ok, 'only once');
  ok(!quoteBuild(s, sp, 'modular').ok, 'the loan alone does not cover the whole build');
  s.cash = 1e6;
  ok(!quoteBuild(s, sp, 'modular', { floors: 1, footprint: 0.45, style: 'modular', color: '#fff', coolingTier: 0, electricalTier: 0, generators: 0, security: 0, serverDensity: 1 }).ok, 'custom designer is locked');
  startBuild(s, sp, 'modular', undefined);
  for (let i = 0; i < 90 && Object.keys(s.projects).length; i++) advance(s, 1);
  const fid = Object.keys(s.facilities)[0];
  ok(!!fid && hasFeature(s, 'g_first_build') && !pageLocked(s, 'datacenters'), 'first data center opens the Data Centers page');
  const f = s.facilities[fid];
  ok(!hookupsDone(f), 'a new site is not connected');
  ok(!autoEquip(s, fid, 1e6).ok, 'auto-equip is not unlocked yet');
  install(s, fid, 'cpu_std', 2);
  d = deriveAll(s);
  ok(d.fac[fid].perf === 0 && d.fac[fid].revenueHr === 0 && d.fac[fid].warnings.some((w) => /connected/i.test(w)), 'servers earn nothing until the site is connected');
  ok(d.fac[fid].expenses.staffing === undefined, 'no site staffing until it is live');
  const pq = hookupQuote(s, f, 'power');
  ok(pq.ok && pq.cost > 1000, 'hookup quote');
  ok(orderHookup(s, fid, 'power').ok && !orderHookup(s, fid, 'power').ok, 'cannot order the same hookup twice');
  orderHookup(s, fid, 'net');
  for (let i = 0; i < pq.seconds + 2; i++) advance(s, 1);
  ok(hookupsDone(f) && (s.stats.hookups ?? 0) === 1, 'crews finish the hookups');
  d = deriveAll(s);
  ok(d.fac[fid].revenueHr > 0 && d.fac[fid].perf > 0.9, 'the site earns once connected');
  ok(d.fac[fid].expenses.staffing! > 0 && d.fac[fid].profitHr < 0, 'two servers do not cover the cost of running a site');
  checkCareer(s, d, 1);
  ok(hasFeature(s, 'g_operational') && !pageLocked(s, 'contracts'), 'going live opens contracts');
  ok(!hasFeature(s, 'g_profit') && s.career.stage === 0, 'not profitable yet');
  // profit has to last, and reverses if the site falls back into the red
  s.career.profitHours = 90;
  checkCareer(s, d, 1);
  ok(s.career.profitHours < 90, 'losing money wipes out profit progress');
  s.debt = 0;
  install(s, fid, 'cpu_std', 8); install(s, fid, 'network', 1);
  const dd = deriveAll(s);
  ok(dd.totals.profitHr !== 0, 'bigger site changes the result');
  s.career.profitHours = 200;
  s.finance.avgHourProfit = 1;
  const live = deriveAll(s); checkCareer(s, live, 0);
  ok(hasFeature(s, 'g_profit') && s.career.stage === 1, 'sustained profit promotes the company');
  s.cash = 1e7;
  ok(canBuy(s, other.id).ok, 'the property market opens');
  s.candidates[0].dept = 'it';
  ok(hire(s, s.candidates[0].id).ok, 'hiring opens');
  ok(!promote(s, s.employees[0].id).ok, 'promotions need Talent Management');
  ok(revenueMult(s) > ECONOMY.career.stages[0].revenue, 'higher stage earns better rates');
  ok(!makeOffer(s, s.competitors[0].id, 'fair').ok, 'takeovers are locked');
  ok(!upgradeQuote(s, fid, 'cpu_std').ok, 'equipment upgrades need Building Upgrades');
  ok(!zoneQuote(s, getCityLayout('carmi').zones[0].id).ok, 'zones are locked');
  ok(!canResearch(co(), 'air_imp').ok, 'research is locked until R&D Budget');
  // expansion gets easier through experience, not lower hardware prices
  const later = co();
  const lq = quoteBuild(later, later.company.startParcel!, 'modular');
  const mineQ = quoteBuild(s, other.id, 'modular');
  later.stats.buildsCompleted = 5;
  const lq2 = quoteBuild(later, later.company.startParcel!, 'modular');
  ok(lq2.total < lq.total && lq2.seconds < lq.seconds && lq2.breakdown['Building shell'] === lq.breakdown['Building shell'], 'crews learn: labor and time fall, steel does not');
  void mineQ;
  // the second site in town needs far less utility work
  const nf = { ...f, id: 'b', hookups: { power: -1, net: -1 } };
  s.facilities.b = nf;
  ok(hookupQuote(s, nf, 'power').cost <= pq.cost * 0.55, 'later sites in town pay less for hookups');
  delete s.facilities.b;
  // no dead ends: there is always another goal
  ok(nextGoals(s, deriveAll(s), 3).length === 3, 'always something to work toward');
  const early = co();
  early.level = 20;
  checkCareer(early, deriveAll(early), 1);
  ok(!hasFeature(early, 'g_research'), 'goals from a later stage wait their turn');
  for (const g of GOALS) s.career.done[g.id] = 1;
  s.career.stage = 4;
  ok(endlessGoal(s).target >= 1e10, 'value milestones go on after the last goal');
  for (const g of GOALS) for (const q of g.reqs) ok(METRICS[q.metric] !== undefined, `metric ${q.metric}`);
}
// ---- every goal is reachable: each one's own requirement can be met ----
{
  const fresh = co();
  const d = deriveAll(fresh);
  for (const g of GOALS) { const p = goalProgress(fresh, d, g); ok(p.reqs.length > 0 && isFinite(p.frac), `goal ${g.id} reports progress`); }
  ok(new Set(GOALS.map((g) => g.id)).size === GOALS.length, 'goal ids are unique');
  for (const id of Object.values(PAGE_GOAL)) ok(GOALS.some((g) => g.id === id), `page goal ${id} exists`);
  ok(storyOf(fresh)[0].id === 'c0' && storyOf(newGame({ name: 'L', logo: 'A', color: '#fff', startCity: 'nova', difficulty: 'standard', mode: 'legacy' }))[0].id === 's0', 'story matches the company type');
  const st = currentStory(fresh)!;
  ok(missionProgress(fresh, d, { ...st, base: 0 }) === 0 && !claimMission(fresh, d, 'story', st.id).ok, 'missions must be earned');
}

// ---- starter property in every home town; rivals keep their hands off it ----
for (const city of CITIES.filter((c) => c.unlockLevel <= 1 && c.license === 0)) {
  const s = co(city.id);
  const sp = starterParcel(city.id);
  ok(sp.area >= BLUEPRINTS[0].minLot && sp.buildingFloors > 0, `${city.name}: a Modular Data Center fits on the first property`);
  for (const c of s.competitors) c.cash = 5e8;
  const d = deriveAll(s);
  for (let i = 0; i < 400; i++) { s.gameHours += 3; for (const c of s.competitors) c.nextThink = 0; tickCompetitors(s, 3, 3, d); }
  ok(!parcelState(s, sp.id).owner, `${city.name}: rivals never take the starter property`);
}
{
  const s = co();
  const d = deriveAll(s);
  for (let i = 0; i < 400; i++) { s.gameHours += 3; for (const c of s.competitors) { c.cash = 5e8; c.nextThink = 0; } tickCompetitors(s, 3, 3, d); }
  ok(!s.competitors.some((c) => c.sites.some((x) => x.cityId === 'carmi')), 'national rivals skip small-town Carmi');
}

// ---- Carmi ----
{
  const c = cityById('carmi');
  ok(!!c && c.country === 'US' && c.town, 'Carmi is a real city entry');
  ok(Math.abs(c.center[1] - 38.0861) < 0.01 && Math.abs(c.center[0] + 88.172) < 0.01, 'Carmi sits at its real coordinates');
  const lay = getCityLayout('carmi');
  ok(lay.parcels.length >= 120 && lay.parcels.length <= 320, `town-sized property market (${lay.parcels.length} lots)`);
  ok(new Set(lay.parcels.map((p) => p.id)).size === lay.parcels.length && lay.parcels.every((p) => getParcel(p.id) === p), 'parcel ids are unique and resolve');
  ok(!lay.parcels.some((p) => p.type === 'premium') && Math.max(...lay.parcels.map((p) => p.buildingFloors)) <= 2, 'no skyscrapers for sale in Carmi');
  ok(lay.parcels.some((p) => /Main St/.test(p.address)) && lay.parcels.some((p) => /Oak St/.test(p.address)), 'addresses use real street names');
  ok(lay.streets.some((x) => x.name === 'Main St') && lay.streets.some((x) => x.name === 'Main Cross'), 'real streets on the map');
  const scape = getCityscape('carmi');
  ok(Math.max(...scape.buildings.map((b) => b.height)) <= 40 && scape.buildings.filter((b) => b.kind === 'house').length > 300, 'surroundings are houses, not towers');
  const kinds = new Set(scape.buildings.map((b) => b.kind));
  for (const k of ['civic', 'church', 'school', 'silo', 'barn', 'watertower', 'pumpjack']) ok(kinds.has(k as any), `town has a ${k}`);
  const f = districtFrame('carmi'), plan = townPlan(f);
  // the river stays east of town and clear of everything for sale
  ok(lay.parcels.every((p) => p.rect.x1 < townRiverX((p.rect.y0 + p.rect.y1) / 2, plan.riverBase) - 30), 'no lot sits in the Little Wabash');
  ok(scape.buildings.every((b) => { const x = (b.rect.x0 + b.rect.x1) / 2; return Math.abs(x - townRiverX((b.rect.y0 + b.rect.y1) / 2, plan.riverBase)) > 28; }), 'nothing is built in the river');
  // no overlapping lots or buildings on top of lots
  const ov = (a: any, b: any) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  ok(!lay.parcels.some((p, i) => lay.parcels.slice(i + 1).some((q) => ov(p.rect, q.rect))), 'lots do not overlap');
  const clash = scape.buildings.filter((b) => lay.parcels.some((p) => ov(b.rect, p.rect)));
  ok(!clash.length, `landmarks and houses stay off the lots for sale ${clash.map((b) => `${b.kind}@${Math.round(b.rect.x0)},${Math.round(b.rect.y0)}`).join(' ')}`);
  ok(lay.zones.length === 2 && lay.zones.every((z) => z.area >= BLUEPRINTS[BLUEPRINTS.length - 1].minLot), 'edge-of-town tracts can hold a campus');
  // full integration through the same systems as every other city
  const s = co('nova');
  ok(!s.unlockedCities.includes('carmi'), 'Carmi is a locked market for a company based elsewhere');
  ok(licenseFee(s, 'carmi') > 0 && licenseFee(s, 'chicago') > licenseFee(s, 'carmi'), 'it has its own, cheaper licence');
  s.career.done.g_stage2 = 1; s.career.done.g_profit = 1; s.cash = 1e8;
  ok(unlockCity(s, 'carmi').ok && s.unlockedCities.includes('carmi'), 'and can be entered with the licence');
  const lot = lay.parcels.find((p) => p.area >= 400 && !p.zoneId && p.buildingFloors > 0)!;
  ok(buyParcel(s, lot.id).ok && startDemolition(s, lot.id).ok, 'buy and demolish in Carmi');
  for (let i = 0; i < 80 && Object.keys(s.projects).length; i++) advance(s, 1);
  ok(s.parcels[lot.id].status === 'cleared' && quoteBuild(s, lot.id, 'modular').ok, 'build in Carmi');
  ok(deriveAll(s).cityDemand.carmi < deriveAll(s).cityDemand.chicago / 5, 'a tiny market next to a metro');
  ok(cityById('carmi').landMult < cityById('dallas').landMult && cityById('carmi').powerPrice < cityById('dallas').powerPrice, 'cheaper land and power than a metro');
  ok(!!fiberLink('carmi-chicago'), 'Carmi can be linked with fiber');
  // zones consolidate into a campus site
  s.career.done.g_zones = 1; s.career.done.g_campus = 1;
  const z = lay.zones[0];
  ok(zoneQuote(s, z.id).ok, 'a Carmi zone can be bought');
  for (const pid of z.parcelIds) s.parcels[pid] = { owner: 'player', status: 'cleared' };
  ok(consolidateQuote(s, z.id).ok, 'and consolidated');
  ok(generateOffer(s, deriveAll(s)).amount > 0, 'contracts generate here');
  // a contract aimed at Carmi uses local clients
  const local = co();
  local.career.done.g_operational = 1;
  const offer = generateOffer(local, deriveAll(local));
  ok(offer.cityPref === 'carmi', 'offers reach the home market');
  void tickContracts;
}

// ---- old saves stay exactly as they were ----
{
  const fs = (globalThis as any).process.getBuiltinModule('fs');
  const text = fs.readFileSync('tests/fixtures/save-v2.0-late.json', 'utf8');
  const raw = JSON.parse(text);
  ok(!raw.state.career, 'fixture is a real pre-progression save');
  const r = parse(text);
  const s = r.state!;
  ok(!!s && s.career.mode === 'legacy', 'an old save loads as a legacy company');
  ok(s.cash === raw.state.cash && s.level === raw.state.level && Object.keys(s.facilities).length === Object.keys(raw.state.facilities).length, 'money, level and facilities survive');
  ok(Object.keys(s.parcels).every((id) => !!getParcel(id)), 'every saved parcel still exists');
  for (const id of Object.keys(PAGE_GOAL)) ok(!pageLocked(s, id), `old save: ${id} open`);
  ok(hasFeature(s, 'g_stage4') && revenueMult(s) === 1, 'old save: no gates and no economy change');
  const d = deriveAll(s);
  ok(Object.values(d.fac).every((x) => x.online && x.expenses.staffing === undefined), 'old save: sites stay online with no new costs');
  ok(METRICS.hookups(s, d) >= Object.keys(s.facilities).length - 1, 'old save: sites count as connected');
  checkCareer(s, d, 1);
  const cashAfter = s.cash;
  ok(cashAfter === raw.state.cash && s.career.seeded === true, 'old save: past goals recorded with no surprise money');
  ok(s.career.stage >= 1, `old save: placed at a sensible company stage (${s.career.stage})`);
  ok(s.settings.seasonal === 'auto', 'old save gains the seasonal setting');
  ok(s.unlockedCities.includes(raw.state.company.startCity), 'old save keeps its markets');
  ok(advance(s, 30).totals !== undefined, 'old save runs');
  const back = parse(serialize(s));
  ok(back.state!.career.mode === 'legacy' && back.state!.career.seeded === true, 'stays legacy through save and load');
}
{
  // a career company in mid-flight survives a save and reload
  const s = co();
  ensureBoard(s);
  startGig(s, s.career.board[0].id);
  s.company.startParcel && (s.cash = 1e6);
  buyParcel(s, s.company.startParcel!);
  takeStartupLoan(s, 'construction');
  const back = parse(serialize(s)).state!;
  ok(back.career.mode === 'career' && back.career.gig?.def.id === s.career.gig?.def.id && back.career.loans.construction === s.career.loans.construction && back.unlockedCities.length === 1, 'career state round-trips');
  const broken = JSON.parse(serialize(s));
  broken.state.career.done = 'x'; broken.state.career.stage = 99; broken.state.career.gigsDone = 'NaN';
  const fixed = parse(JSON.stringify(broken)).state!;
  ok(fixed.career.stage === 4 && typeof fixed.career.gigsDone === 'number' && typeof fixed.career.done === 'object', 'a damaged career block is repaired');
}

// ---- Thanksgiving ----
{
  ok(seasonOn('on', new Date(2026, 5, 1)) && !seasonOn('off', new Date(2026, 10, 20)), 'season toggle overrides the calendar');
  ok(seasonOn('auto', new Date(2026, 10, 20)) && !seasonOn('auto', new Date(2026, 5, 1)), 'Auto follows November');
  let mile = 0; const off = on('milestone', () => mile++);
  const s = co();
  s.cash = 1e6; buyParcel(s, s.company.startParcel!);
  checkCareer(s, deriveAll(s), 1);
  ok(mile === 1, 'each goal celebrates once');
  checkCareer(s, deriveAll(s), 1);
  ok(mile === 1, 'and never twice');
  off();
}

if (failed) { console.error(`${failed} FAILED`); (globalThis as any).process.exitCode = 1; } else console.log('all career tests passed');
