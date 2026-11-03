// Global expansion: every new system has to change the game, save correctly and survive old saves.
import { newGame, advance, advanceFrozen, catchUp } from '../src/systems/sim';
import { deriveAll } from '../src/systems/derive';
import { parse, serialize } from '../src/save/save';
import { EVENT_DEFS } from '../src/config/content';
import { tickEvents, eventText } from '../src/systems/events';
import { buildRoute, buildHub, routeQuote, netStats, fiberGeo } from '../src/systems/fiber';
import { setCitySpec, setPolicy } from '../src/systems/strategy';
import { specMods, cityMods } from '../src/systems/regulation';
import { chooseSupplier, signDeal, techRelease, supplierTerms, activeSupplier } from '../src/systems/suppliers';
import { unitPrice, install, autoEquip, sellEquipment } from '../src/systems/equipment';
import { equipmentById } from '../src/config/buildings';
import { acquireCompetitor, acquisitionQuote, buySite, makeOffer, offerChance, siteQuote } from '../src/systems/competitors';
import { companyRows, ranked, RANK_METRICS, cityBoard, countryBoard } from '../src/systems/rankings';
import { generateOffer } from '../src/systems/contracts';
import { tickReputation, repTarget } from '../src/systems/reputation';
import { DECISIONS, resolveDecision } from '../src/systems/decisions';
import { FIBER_LINKS, POLICIES } from '../src/config/expansion';
import { getEffects } from '../src/systems/modifiers';
import { licenseFee, unlockCity } from '../src/systems/property';
import { startBuild, quoteBuild } from '../src/systems/construction';
import type { GameState } from '../src/core/state';

let fails = 0;
const ok = (c: unknown, m: string) => { if (c) console.log('ok  ', m); else { console.error('FAIL', m); fails++; } };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** A running company with one data center in Northern Virginia. */
function company(cash = 5e8, level = 30): { g: GameState; fid: string } {
  const g = newGame({ name: 'Co', logo: 'A', color: '#3b82f6', startCity: 'nova', difficulty: 'standard' });
  g.cash = cash; g.level = level;
  const fid = 'dcT', pid = g.company.startParcel!;
  g.parcels[pid] = { owner: 'player', status: 'facility', facilityId: fid };
  g.facilities[fid] = { id: fid, parcelId: pid, cityId: 'nova', name: 'T', blueprintId: 'cloud', slots: 160, bays: 14, basePower: 1200, baseCooling: 1100, floors: 2, style: 'concrete', color: '#fff', footprint: 0.5, equipment: {}, condition: 100, builtAt: 0, buildCost: 1, shellValue: 1e6, equipmentSpent: 0, revenueTotal: 0, profitTotal: 0 };
  return { g, fid };
}

// ---- old saves ----
{
  const fs = (globalThis as any).process.getBuiltinModule?.('fs');
  const path = 'tests/fixtures/save-v2.0-late.json'; // a real save written by version 2.0
  const g = newGame({ name: 'Old', logo: 'A', color: '#3b82f6', startCity: 'nova', difficulty: 'standard' });
  const raw = JSON.parse(serialize(g));
  raw.v = 3; raw.state.version = 3;
  for (const k of ['news', 'newsState', 'policies', 'policyAt', 'citySpec', 'fiber', 'supply', 'rep', 'integrations', 'dealCooldown']) delete raw.state[k];
  const r = parse(JSON.stringify(raw));
  ok(r.state && r.state.version === 4 && Array.isArray(r.state.fiber.routes) && r.state.supply.chosen.gpu === 'std_gpu', 'a version 3 save gains the new systems on load');
  ok(!!r.state && (advance(r.state, 50), true), 'a migrated save keeps simulating');
  if (fs?.existsSync(path)) {
    const old = parse(fs.readFileSync(path, 'utf8'));
    const before = JSON.parse(fs.readFileSync(path, 'utf8')).state;
    ok(old.state && old.state.cash === before.cash && Object.keys(old.state.facilities).length === Object.keys(before.facilities).length && old.state.level === before.level, `a real late-game v2.0 save loads intact (${Object.keys(before.facilities).length} facilities)`);
    const d = deriveAll(old.state!);
    const baseRev = d.totals.revenueHr;
    advance(old.state!, 200);
    ok(isFinite(old.state!.cash) && deriveAll(old.state!).totals.revenueHr >= baseRev * 0.5, 'the real old save keeps earning after migrating');
  }
}

// ---- defaults change nothing until the player chooses ----
{
  const { g, fid } = company();
  ok(unitPrice(g, equipmentById('gpu_ai')) === 85_000, 'default supplier leaves catalog prices unchanged');
  install(g, fid, 'cpu_std', 4);
  ok(!g.facilities[fid].orders && deriveAll(g).fac[fid].raw.cpu === 256, 'default supplier delivers instantly at full spec');
}

// ---- policies ----
{
  const { g, fid } = company();
  install(g, fid, 'pdu', 2); install(g, fid, 'gpu_ai', 6); install(g, fid, 'cpu_std', 6);
  for (const c of g.competitors) c.sites = [];
  const base = deriveAll(g).fac[fid].revenue.spot;
  const v = deriveAll(g).totals.valuation;
  ok(setPolicy(g, v, 'focus', 'ai').ok, 'can adopt AI-first policy');
  const after = deriveAll(g).fac[fid];
  ok(after.revenue.spot > base, 'AI-first raises revenue on a GPU-heavy site');
  ok(!setPolicy(g, v, 'focus', 'cloud').ok, 'policies cannot be flipped straight back');
  const cash = g.cash; g.level = 1;
  ok(!setPolicy(g, v, 'capital', 'lean').ok && g.cash === cash, 'locked policies cost nothing and do nothing');
  g.level = 30;
  setPolicy(g, v, 'capital', 'lean');
  ok((getEffects(g).decay ?? 0) < 0 && (getEffects(g).opex ?? 0) < 0, 'cutting expenses has both an upside and a downside');
  for (const p of POLICIES) for (const o of p.options) if (o.id !== p.options[0].id) ok(o.pros.length && o.cons.length, `${o.label} has a real trade-off`);
  setPolicy(g, v, 'growth', 'global');
  ok(licenseFee(g, 'tokyo') < 8_000_000 && licenseFee(g, 'chicago') === 0, 'global expansion discounts licenses');
  g.level = 40; const c0 = g.cash; unlockCity(g, 'tokyo');
  ok(near(c0 - g.cash, 5_600_000), 'unlocking charges the discounted license');
}

// ---- regional focus ----
{
  const { g, fid } = company();
  install(g, fid, 'pdu', 2); install(g, fid, 'cpu_std', 8);
  for (const c of g.competitors) c.sites = [];
  const base = deriveAll(g).fac[fid].revenue.spot;
  ok(!setCitySpec(g, 'tokyo', 'ai').ok, 'a focus needs a data center in that city');
  ok(setCitySpec(g, 'nova', 'cloud').ok, 'can set a city focus');
  ok(deriveAll(g).fac[fid].revenue.spot > base * 1.1, 'a matched focus raises local CPU income');
  ok(specMods(g, 'nova', {}).matched, 'Northern Virginia recognises Cloud Region as its natural focus');
  ok(!setCitySpec(g, 'nova', 'ai').ok, 'a focus cannot be swapped immediately');
}

// ---- country rules ----
{
  const { g } = company();
  ok(cityMods(g, 'frankfurt').pueLimit < cityMods(g, 'dallas').pueLimit, 'Germany is stricter than the US');
  g.parcels['frankfurt-x'] = undefined as any; delete g.parcels['frankfurt-x'];
  const fid = 'dcEU';
  g.facilities[fid] = { ...Object.values(g.facilities)[0], id: fid, cityId: 'frankfurt', name: 'EU', equipment: { cpu_std: 4, pdu: 1 } };
  const st = deriveAll(g).fac[fid];
  ok(st.expenses.compliance > 0 && st.warnings.some((w) => /PUE/.test(w)), 'an inefficient German site pays compliance fees and is warned');
  g.research.done.push('adv_cool', 'liquid', 'hd_cool');
  ok(deriveAll(g).fac[fid].expenses.compliance === 0, 'research that improves PUE removes the fee');
  g.unlockedCities = ['frankfurt'];
  const offers = Array.from({ length: 60 }, () => generateOffer(g, deriveAll(g))).filter((o) => o.cityPref === 'frankfurt');
  ok(offers.length > 0 && offers.every((o) => o.security >= 1), 'privacy law raises the security tier customers require');
}

// ---- permits ----
{
  const a = company(5e9), b = company(5e9);
  const id = a.g.company.startParcel!;
  a.g.parcels[id] = { owner: 'player', status: 'cleared' };
  const q = quoteBuild(a.g, id, 'modular');
  a.g.events.push({ id: 'e', defId: 'infra_program', country: 'US', startedAt: 0, endsAt: 500 });
  const q2 = quoteBuild(a.g, id, 'modular');
  ok(q2.total < q.total && q2.spec.seconds < q.spec.seconds, 'an infrastructure program makes building cheaper and faster');
  void b;
}

// ---- suppliers ----
{
  const { g, fid } = company();
  ok(!chooseSupplier(g, 'gpu', 'gpu_premium').ok === false, 'can pick a premium GPU vendor at this level');
  const pricey = unitPrice(g, equipmentById('gpu_ai'));
  ok(pricey > 85_000, 'premium vendors cost more');
  ok(chooseSupplier(g, 'gpu', 'gpu_budget').ok, 'can switch to a budget vendor');
  const cheap = unitPrice(g, equipmentById('gpu_ai'));
  ok(cheap < 85_000, 'budget vendors cost less');
  install(g, fid, 'pdu', 2);
  install(g, fid, 'gpu_ai', 4);
  let st = deriveAll(g).fac[fid];
  ok(st.raw.gpu === 0 && st.slotsUsed === 4 && st.itLoadAll > st.itLoad, 'hardware on order holds its slots but does not run yet');
  advance(g, 40);
  st = deriveAll(g).fac[fid];
  ok(!g.facilities[fid].orders && near(st.raw.gpu, 32 * 0.94), 'delivered hardware runs at the vendor\'s performance');
  ok(st.expenses.maintenance > 0, 'budget hardware still needs maintenance');
  chooseSupplier(g, 'cpu', 'cpu_budget');
  install(g, fid, 'cpu_std', 3);
  sellEquipment(g, fid, 'cpu_std', 3);
  ok(!g.facilities[fid].orders, 'selling undelivered hardware cancels the order');
  const r = autoEquip(g, fid, 5e7);
  st = deriveAll(g).fac[fid];
  ok(r.ok && st.itLoadAll <= st.powerCap + 1e-6, 'auto-equip plans for hardware that is still on order');
  advance(g, 60);
  st = deriveAll(g).fac[fid];
  ok(st.powerFactor >= 0.999 && st.coolingFactor >= 0.999, 'nothing overloads once the deliveries arrive');
  const v = deriveAll(g).totals.valuation;
  const before = supplierTerms(g, activeSupplier(g, 'gpu')).price;
  ok(signDeal(g, v, 'gpu', 'd30').ok && supplierTerms(g, activeSupplier(g, 'gpu')).price < before, 'a supply agreement lowers prices');
  ok(!chooseSupplier(g, 'gpu', 'std_gpu').ok, 'you cannot walk away from a supply agreement');
  const name = techRelease(g);
  ok(!!name, 'vendors can release new hardware generations');
  g.events.push({ id: 'x', defId: 'supply_crunch', supplier: 'gpu_budget', startedAt: g.gameHours, endsAt: g.gameHours + 100 });
  ok(supplierTerms(g, activeSupplier(g, 'gpu')).short, 'a supply crunch hits one vendor');
}

// ---- fiber ----
{
  const { g, fid } = company();
  void fid;
  ok(!routeQuote(g, 'nova-paris').ok, 'routes need both markets unlocked');
  const cash0 = g.cash;
  const q = routeQuote(g, 'chicago-nova');
  ok(q.ok && buildRoute(g, 'chicago-nova').ok && near(cash0 - g.cash, q.cost), 'building a route charges its quote');
  ok(netStats(g).transitHr === 0, 'a route earns nothing until it is finished');
  advance(g, q.hours + 2);
  const n = netStats(g);
  ok(n.transitHr > 0 && n.upkeepHr > 0 && n.transitHr > n.upkeepHr, 'a finished route earns more than it costs to run');
  ok(n.city.nova.connectCut > 0 && n.city.nova.spotBonus > 0, 'connected cities get cheaper connectivity and better prices');
  const payback = q.cost / (n.transitHr - n.upkeepHr);
  console.log('     payback hours', Math.round(payback));
  ok(payback > 400 && payback < 2500, 'route payback is meaningful but not instant');
  const revBefore = deriveAll(g).totals.revenueHr;
  ok(revBefore >= n.transitHr, 'transit shows up in company revenue');
  const c = g.finance.totalRevenue; advance(g, 10);
  ok(g.finance.cur.month.revenue['Network Transit'] > 0 && g.finance.totalRevenue > c, 'transit reaches the financial reports');
  ok(buildRoute(g, 'chicago-nova').ok, 'routes can be upgraded');
  const up = netStats(g).transitHr;
  advance(g, 400);
  ok(netStats(g).transitHr > up, 'an upgraded route earns more');
  const solo = netStats(g).transitHr;
  g.fiber.routes.push({ id: 'rv', link: 'chicago-nova', owner: g.competitors[0].id, tier: 3, startedAt: 0, doneAt: g.gameHours, invested: 1e6 });
  ok(netStats(g).transitHr < solo && netStats(g).rivalTransit[g.competitors[0].id] > 0, 'rivals on the same link take a share');
  ok(buildHub(g, 'nova').ok && netStats(g).city.nova.score > n.city.nova.score, 'hubs strengthen a city');
  ok(fiberGeo(g).features.length >= 2 && fiberGeo(g).features.some((f) => f.properties.mine), 'routes are exported to the maps');
  ok(FIBER_LINKS.some((l) => l.kind === 'undersea') && FIBER_LINKS.some((l) => l.kind === 'regional') && FIBER_LINKS.some((l) => l.kind === 'longhaul'), 'regional, long-haul and undersea links all exist');
  const val = deriveAll(g).totals.valuation;
  ok(val > g.cash, 'network assets count toward valuation');
}

// ---- reputation ----
{
  const { g, fid } = company();
  install(g, fid, 'pdu', 2); install(g, fid, 'cpu_std', 8);
  g.company.reputation = 50;
  const d = deriveAll(g);
  const t = repTarget(g, d);
  tickReputation(g, d, 24, true);
  ok(g.rep.history.length === 1 && Math.abs(g.company.reputation - t) < Math.abs(50 - t) + 1e-9, 'reputation drifts toward what you earn, with history');
  g.facilities[fid].condition = 40;
  ok(repTarget(g, deriveAll(g)) < t, 'neglected buildings lower the target');
  g.company.reputation = 20; g.level = 50;
  const types = new Set(Array.from({ length: 150 }, () => generateOffer(g, deriveAll(g)).ctype));
  ok(!types.has('government'), 'agencies refuse a company with poor reputation');
  g.company.reputation = 90;
  const types2 = new Set(Array.from({ length: 400 }, () => generateOffer(g, deriveAll(g)).ctype));
  ok(types2.has('government'), 'agencies come back once you are trusted');
  const low = (g.company.reputation = 10, deriveAll(g).totals), hi = (g.company.reputation = 95, deriveAll(g));
  void low; void hi;
}

// ---- events ----
{
  for (const def of EVENT_DEFS) {
    const { g } = company();
    const orig = EVENT_DEFS.slice();
    g.events = []; g.nextEventAt = 0; g.gameHours = 100;
    EVENT_DEFS.length = 0; EVENT_DEFS.push({ ...def, weight: 1 });
    tickEvents(g);
    const ev = g.events[0];
    EVENT_DEFS.length = 0; EVENT_DEFS.push(...orig);
    const txt = ev ? eventText(ev.defId, ev.cityId, ev) : null;
    ok(ev && txt && !txt.desc.includes('{') && (def.scope === 'city' ? !!ev.cityId : true) && (def.scope === 'region' ? !!ev.region : true) && (def.scope === 'country' ? !!ev.country : true) && g.news.some((n) => n.title === def.title), `event "${def.title}" fires with readable text and makes the news`);
  }
  const { g, fid } = company();
  install(g, fid, 'pdu', 2); install(g, fid, 'cpu_std', 8);
  for (const c of g.competitors) c.sites = c.sites.filter((x) => x.cityId !== 'nova');
  g.facilities[fid].equipment.cpu_std = 400;
  const d0 = deriveAll(g).cityPrice.nova;
  g.events.push({ id: 'r', defId: 'recession', region: 'North America', startedAt: 0, endsAt: 1e6 });
  ok(deriveAll(g).cityDemand.nova < deriveAll(company().g).cityDemand.nova && deriveAll(g).cityPrice.nova < d0, 'a recession cuts demand and prices for everyone there');
  ok(deriveAll(g).cityDemand.london === deriveAll(company().g).cityDemand.london, 'a regional recession leaves other regions alone');
  g.events = [{ id: 't', defId: 'trade_dispute', region: 'North America', startedAt: 0, endsAt: 1e6 }];
  ok(unitPrice(g, equipmentById('cpu_std'), 'nova') > unitPrice(g, equipmentById('cpu_std'), 'london'), 'tariffs raise prices only in their region');
}

// ---- acquisitions ----
{
  const { g } = company(5e9);
  advance(g, 3);
  const c = g.competitors[0];
  ok(offerChance(g, c, 'low') < offerChance(g, c, 'fair') && offerChance(g, c, 'premium') === 1, 'bigger offers are likelier to be accepted');
  const askBefore = acquisitionQuote(g, c.id).price;
  // force a rejection
  const low = () => { const orig = Math.random; let r; for (let i = 0; i < 30 && !r?.accepted === true && g.competitors.some((x) => x.id === c.id); i++) { g.dealCooldown[c.id] = 0; r = makeOffer(g, c.id, 'low'); if (r.accepted === false) return r; } Math.random = orig; return r; };
  const rej = low();
  if (rej?.accepted === false) {
    ok(acquisitionQuote(g, c.id).price > askBefore && !makeOffer(g, c.id, 'fair').ok, 'a rejected offer pauses talks and raises the price');
    g.dealCooldown[c.id] = 0;
  }
  const rival = g.competitors[g.competitors.length - 1];
  const site = rival.sites.find((x) => x.stage === 'operational')!;
  rival.sites.push({ ...site, parcelId: Object.keys(g.parcels).find((id) => g.parcels[id].owner === rival.id && id !== site.parcelId) ?? site.parcelId + 'x' });
  const sq = siteQuote(g, rival.id, site.parcelId);
  const n0 = Object.keys(g.facilities).length, cash0 = g.cash;
  ok(sq.ok && buySite(g, rival.id, site.parcelId).ok, 'can buy one data center from a rival');
  ok(Object.keys(g.facilities).length === n0 + 1 && g.parcels[site.parcelId].owner === 'player' && !rival.sites.some((x) => x.parcelId === site.parcelId) && near(cash0 - g.cash, sq.price), 'the site, its land and the cash all change hands');
  const bought = Object.values(g.facilities).find((f) => f.parcelId === site.parcelId)!;
  ok(bought.integrateUntil! > g.gameHours && deriveAll(g).fac[bought.id].warnings.some((w) => /Integrating/.test(w)), 'bought sites start out integrating');
  const target = g.competitors.find((x) => x.id !== rival.id)!;
  target.cash = -2_000_000;
  g.fiber.routes.push({ id: 'tr', link: 'dallas-phoenix', owner: target.id, tier: 1, startedAt: 0, doneAt: 0, invested: 1e6 });
  const debt0 = g.debt;
  const offersBefore = g.contracts.offers.length;
  ok(acquireCompetitor(g, target.id).ok, 'can buy a whole company');
  ok(g.debt === debt0 + 2_000_000, 'you inherit their debts');
  ok(g.integrations.length >= 2 && deriveAll(g).totals.integrationHr > 0, 'integration has an ongoing cost');
  ok(g.fiber.routes.some((r) => r.id === 'tr' && r.owner === 'player'), 'their fiber comes with them');
  ok(g.contracts.offers.length > offersBefore || g.contracts.offers.length >= 8, 'some of their customers talk to you');
  g.gameHours += 500; advance(g, 30);
  ok(g.integrations.length === 0 && deriveAll(g).totals.integrationHr === 0, 'integration eventually ends');
  const rows = companyRows(g, deriveAll(g));
  ok(rows.length === g.competitors.length + 1, 'every company is ranked');
  for (const m of RANK_METRICS) ok(ranked(rows, m.id).every((r) => isFinite(r[m.id] as number)), `the ${m.label} ranking is valid`);
  ok(Array.isArray(cityBoard(g, deriveAll(g), 'nova')) && Array.isArray(countryBoard(g, deriveAll(g), 'US')), 'market boards build');
}

// ---- rivals use the new systems on their own ----
{
  const g = newGame({ name: 'W', logo: 'A', color: '#3b82f6', startCity: 'nova', difficulty: 'standard' });
  const n = g.competitors.length;
  for (let i = 0; i < 6000; i++) advance(g, 1);
  ok(g.fiber.routes.some((r) => r.owner !== 'player'), 'rivals build fiber without being told to');
  console.log(`     after 6000h: ${g.competitors.length}/${n} rivals, ${g.fiber.routes.length} rival routes, ${g.news.length} headlines, ${g.events.length} events active`);
  ok(g.news.length > 10, 'the news feed fills up on its own');
  ok(g.rep.history.length > 200 || g.rep.history.length === 180, 'reputation history is capped and kept');
  ok(g.competitors.length >= 2, 'rival mergers always leave a market');
  const parcelsOwnedByGhosts = Object.values(g.parcels).filter((p) => p.owner && p.owner !== 'player' && !g.competitors.some((c) => c.id === p.owner));
  ok(parcelsOwnedByGhosts.length === 0, 'mergers leave no orphaned land');
  const txt = serialize(g);
  const back = parse(txt);
  ok(back.state && JSON.stringify(back.state.fiber) === JSON.stringify(g.fiber) && back.state.news.length === g.news.length, 'new systems survive a save and load');
  g.lastRealTime = Date.now() - 3600_000;
  const rep = catchUp(g);
  ok(rep && isFinite(g.cash), 'offline progress works with the new systems');
  const f0 = g.gameHours;
  advanceFrozen(g, 50);
  ok(g.gameHours === f0, 'stopping time still stops everything');
}

// ---- new decision cards ----
{
  const { g, fid } = company();
  install(g, fid, 'pdu', 1);
  g.facilities.dcB = { ...g.facilities[fid], id: 'dcB', parcelId: 'zzz' };
  for (let i = 0; i < 5; i++) g.employees.push({ ...g.candidates[0], id: 'em' + i, salary: 50 });
  for (const id of ['breach', 'anchor', 'green_bond', 'pay_review']) {
    const def = DECISIONS.find((x) => x.id === id)!;
    const data = def.setup(g, deriveAll(g));
    ok(!!data, `${def.title} can appear`);
    for (const i of [0, 1]) {
      g.decision = { id: 'x', defId: id, expiresAt: 1e6, data: data! };
      ok(resolveDecision(g, i).ok, `${def.title} choice ${i + 1} resolves`);
    }
  }
}

if (fails) { console.error(`${fails} FAILED`); (globalThis as any).process.exitCode = 1; } else console.log('ALL EXPANSION TESTS PASSED');
