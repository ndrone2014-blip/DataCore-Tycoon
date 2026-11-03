// Developer Tools: every tool must really change the game, and the password lock must hold.
const mem: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; }, removeItem: (k: string) => { delete mem[k]; } };

import { newGame, advance } from '../src/systems/sim';
import { deriveAll, landValue } from '../src/systems/derive';
import { parse, serialize } from '../src/save/save';
import * as dev from '../src/systems/devtools';
import * as auth from '../src/core/devAuth';
import { EVENT_DEFS } from '../src/config/content';
import { BLUEPRINTS, equipmentById } from '../src/config/buildings';
import { CITIES } from '../src/config/world';
import { RESEARCH } from '../src/config/research';
import { ACHIEVEMENTS, STORY } from '../src/systems/progression';
import { DECISIONS } from '../src/systems/decisions';
import { startDemolition, parcelState } from '../src/systems/property';
import { quoteBuild, startBuild } from '../src/systems/construction';
import { unitPrice, installQuote } from '../src/systems/equipment';
import { getCityLayout } from '../src/world/parcels';
import { xpForLevel } from '../src/config/economy';

let fails = 0;
const ok = (c: unknown, m: string) => { if (c) console.log('ok  ', m); else { console.error('FAIL', m); fails++; } };
const game = () => newGame({ name: 'D', logo: 'A', color: '#3b82f6', startCity: 'nova', difficulty: 'standard' });

// ---- password ----
{
  const salt = 'test';
  mem['aidce-dev-auth'] = JSON.stringify({ salt, hash: auth.hashPassword('first-pass', salt) });
  ok(!auth.isUnlocked(), 'starts locked');
  ok(!auth.unlock('wrong').ok && !auth.isUnlocked(), 'a wrong password does not unlock');
  ok(auth.unlock('first-pass').ok && auth.isUnlocked(), 'the right password unlocks');
  auth.lock();
  ok(!auth.isUnlocked(), 'the lock button locks');
  ok(!auth.changePassword('nope', 'new-pass', 'new-pass').ok, 'changing needs the current password');
  ok(!auth.changePassword('first-pass', 'new-pass', 'different').ok, 'the new password must be confirmed');
  ok(!auth.changePassword('first-pass', 'abc', 'abc').ok, 'very short passwords are refused');
  ok(auth.changePassword('first-pass', 'new-pass', 'new-pass').ok, 'the password can be changed');
  ok(!mem['aidce-dev-auth'].includes('new-pass'), 'the password is not stored as plain text');
  ok(auth.checkPassword('new-pass') && !auth.checkPassword('first-pass'), 'only the new password works, using what was stored');
  ok(!auth.usingDefaultPassword(), 'knows a custom password is set');
  auth.restoreDefaultPassword();
  ok(auth.usingDefaultPassword() && !auth.checkPassword('new-pass'), 'restoring the default removes the custom password');
  mem['aidce-dev-auth'] = JSON.stringify({ salt, hash: auth.hashPassword('p4ss', salt) });
  let now = 1_000_000;
  for (let i = 0; i < 5; i++) auth.unlock('bad', now);
  ok(auth.lockoutLeft(now) > 0 && !auth.unlock('p4ss', now).ok, 'repeated wrong guesses cause a short lockout');
  now += 31_000;
  ok(auth.unlock('p4ss', now).ok, 'the lockout ends');
  auth.setAutoLockMinutes(1);
  ok(!auth.checkAutoLock(now + 30_000) && auth.isUnlocked(), 'stays unlocked while within the timeout');
  auth.touch(now + 50_000);
  ok(!auth.checkAutoLock(now + 100_000), 'activity restarts the timer');
  ok(auth.checkAutoLock(now + 111_000) && !auth.isUnlocked(), 'inactivity locks it');
}

// ---- economy ----
{
  const g = game();
  const c = g.cash;
  ok(dev.adjustCash(g, 500).ok && g.cash === c + 500, 'adds money');
  ok(dev.adjustCash(g, -200).ok && g.cash === c + 300, 'removes money');
  ok(!dev.adjustCash(g, NaN).ok, 'rejects invalid amounts');
  dev.setCash(g, 42);
  ok(g.cash === 42, 'sets cash');
  const rev = g.finance.totalRevenue;
  dev.adjustCash(g, 1e9);
  ok(g.finance.totalRevenue === rev, 'developer money stays out of the financial reports');
  g.debt = 5; dev.clearDebt(g);
  ok(g.debt === 0, 'clears debt');
  const lot = getCityLayout('nova').parcels.find((p) => !parcelState(g, p.id).owner)!;
  const land = landValue(g, lot.id), eq = unitPrice(g, equipmentById('cpu_std'));
  const power = deriveAll(g);
  void power;
  dev.setPriceMults(g, { land: 2, equipment: 0.5 });
  ok(Math.abs(landValue(g, lot.id) - land * 2) <= 1, 'land price multiplier works');
  ok(Math.abs(unitPrice(g, equipmentById('cpu_std')) - eq / 2) <= 1, 'equipment price multiplier works');
  ok(!dev.setPriceMults(g, { land: -1 }).ok, 'rejects invalid multipliers');
  dev.resetPrices(g);
  ok(landValue(g, lot.id) === land && unitPrice(g, equipmentById('cpu_std')) === eq, 'prices go back to normal');
  const start = g.company.startParcel!;
  g.parcels[start].status = 'cleared';
  g.cash = 1e12;
  const q0 = quoteBuild(g, start, 'modular').total;
  dev.setPriceMults(g, { construction: 3 });
  ok(quoteBuild(g, start, 'modular').total > q0 * 2, 'construction price multiplier works');
}

// ---- world ----
{
  const g = game();
  dev.unlockAllCities(g);
  ok(g.unlockedCities.length === CITIES.length, 'unlocks every market');
  const big = BLUEPRINTS.find((b) => b.level > 1)!;
  ok(quoteBuild(g, g.company.startParcel!, big.id).reasons.some((r) => /level/i.test(r)), 'blueprints start locked');
  dev.setUnlockAll(g, true);
  ok(!quoteBuild(g, g.company.startParcel!, big.id).reasons.some((r) => /level/i.test(r)), 'unlock-all removes the level requirement');
  ok(installQuote(g, 'none', 'accel_x').reason === 'Unknown', 'quotes still fail safely');
  const before = Object.values(g.parcels).filter((p) => p.owner === 'player').length;
  const r = dev.grantProperties(g, 'tokyo');
  ok(r.count > 50 && Object.values(g.parcels).filter((p) => p.owner === 'player').length === before + r.count, 'gives you a whole city');
  ok(!Object.values(g.parcels).some((p) => p.owner === 'player' && p.status === 'facility' && !p.facilityId), 'granted land has no phantom buildings');
  advance(g, 5);
  ok(deriveAll(g).totals.properties >= r.count, 'the simulation sees the new land');
}

// ---- construction ----
{
  const g = game();
  g.cash = 1e12;
  startDemolition(g, g.company.startParcel!);
  ok(dev.completeAllProjects(g).count === 1 && g.parcels[g.company.startParcel!].status === 'cleared', 'finishes a demolition instantly');
  startBuild(g, g.company.startParcel!, 'modular', undefined);
  ok(dev.completeAllProjects(g).count === 1 && Object.keys(g.facilities).length === 1 && !Object.keys(g.projects).length, 'finishes a building instantly');
  dev.setUnlockAll(g, true);
  for (const b of BLUEPRINTS.filter((x) => x.id !== 'mega')) {
    const r = dev.spawnFacility(g, 'nova', b.id, true);
    if (!r.ok) { const r2 = dev.spawnFacility(g, 'tokyo', b.id, true); ok(r2.ok, `spawns ${b.name} (second city): ${r2.reason ?? ''}`); continue; }
    const st = deriveAll(g).fac[r.id!];
    ok(st && st.servers > 0 && st.itLoad <= st.powerCap + 1e-6, `spawns a working, filled ${b.name}`);
  }
  const fid = Object.keys(g.facilities)[0];
  g.contracts.active.push({ id: 'x', customer: 'c', ctype: 'small', label: 'l', cap: 'cpu', amount: 1, ratePerHour: 1, hours: 9, hoursLeft: 9, sla: 0.5, security: 0, bonus: 0, facilityId: fid, fulfillment: 1, earned: 0, breachHours: 0, status: 'active' });
  const pid = g.facilities[fid].parcelId;
  ok(dev.removeFacility(g, fid).ok && !g.facilities[fid] && g.parcels[pid].status === 'cleared' && g.parcels[pid].owner === 'player', 'removes a data center and keeps the land');
  ok(g.contracts.active[0].facilityId === undefined, 'its contracts are released');
  advance(g, 10);
  ok(isFinite(g.cash), 'the simulation runs after spawns and removals');
  ok(!dev.spawnFacility(g, 'nova', 'nope', true).ok, 'unknown buildings are refused');
}

// ---- progression ----
{
  const g = game();
  dev.setLevel(g, 40);
  ok(g.level === 40 && g.xp === xpForLevel(40), 'sets the level and matching XP');
  dev.setLevel(g, 999);
  ok(g.level === 100, 'the level is capped');
  dev.setLevel(g, 5);
  const xp = g.xp; dev.grantXp(g, 1000);
  ok(g.xp === xp + 1000, 'adds XP');
  dev.setReputation(g, 150);
  ok(g.company.reputation === 100, 'reputation is capped');
  dev.unlockAllResearch(g);
  ok(g.research.done.length === RESEARCH.length, 'unlocks all research');
  ok(Object.keys(deriveAll(g).effects).length > 3, 'research effects apply');
  dev.resetResearch(g);
  ok(g.research.done.length === 0, 'resets research');
  const perm0 = JSON.stringify(g.permanent);
  ok(dev.unlockAllAchievements(g).count > 0 && Object.keys(g.achievements).length === ACHIEVEMENTS.length, 'unlocks all achievements');
  ok(JSON.stringify(g.permanent) !== perm0, 'their permanent bonuses apply');
  dev.resetAchievements(g);
  ok(!Object.keys(g.achievements).length && Object.values(g.permanent).every((v) => Math.abs(v) < 1e-9), 'resetting takes the bonuses back');
  dev.completeStory(g);
  ok(g.missions.tutorial === STORY.length, 'finishes the story');
  advance(g, 5);
}

// ---- competitors ----
{
  const g = game();
  const n = g.competitors.length;
  const r = dev.spawnCompetitor(g, 'Test Rival', 'aggressive', 2e7, 2);
  ok(r.ok && g.competitors.length === n + 1, 'spawns a company');
  const c = g.competitors.find((x) => x.id === r.id)!;
  ok(c.sites.length === 2 && c.sites.every((x) => g.parcels[x.parcelId].owner === c.id), 'the new company owns its data centers');
  ok(!dev.spawnCompetitor(g, 'test rival', 'budget', 1, 0).ok, 'duplicate names are refused');
  ok(!dev.spawnCompetitor(g, '  ', 'budget', 1, 0).ok, 'a name is required');
  const fresh = deriveAll(g).citySupply[c.sites[0].cityId];
  ok(fresh > 0, 'its capacity counts in the market');
  for (let i = 0; i < 300; i++) advance(g, 1);
  ok(c.revenueHr > 0 && c.lastAction !== undefined, 'the spawned company runs under the AI');
  const cash = c.cash;
  dev.updateCompetitor(g, c.id, { addCash: 1000, tech: 20, aggression: 3 });
  ok(Math.abs(c.cash - cash - 1000) < 1 && c.techLevel === 8 && c.aggression === 3, 'modifies a company');
  const lots = Object.entries(g.parcels).filter(([, p]) => p.owner === c.id).map(([id]) => id);
  g.fiber.routes.push({ id: 'z', link: 'chicago-nova', owner: c.id, tier: 1, startedAt: 0, doneAt: 0, invested: 1 });
  ok(dev.removeCompetitor(g, c.id).ok && !g.competitors.some((x) => x.id === c.id), 'removes a company');
  ok(lots.every((id) => !g.parcels[id].owner) && !g.fiber.routes.some((x) => x.owner === c.id), 'its land returns to the market and its fiber goes');
  while (g.competitors.length) dev.removeCompetitor(g, g.competitors[0].id);
  for (let i = 0; i < 50; i++) advance(g, 1);
  ok(isFinite(g.cash), 'the game runs with every rival removed');
  ok(dev.spawnCompetitor(g, 'Back Again', 'budget', 1e6, 1).ok, 'rivals can be spawned into an empty market');
}

// ---- time ----
{
  const g = game();
  dev.setSpeed(g, 50);
  ok(g.speed === 50 && !g.paused, 'sets a developer speed');
  ok(!dev.setSpeed(g, 7).ok, 'rejects unknown speeds');
  const h = g.gameHours;
  dev.skipTime(g, 168);
  ok(Math.abs(g.gameHours - h - 168) < 1e-6, 'skips time');
  ok(g.finance.hourly.length > 50, 'the skip is really simulated');
  ok(!dev.skipTime(g, 99999).ok && !dev.skipTime(g, -1).ok, 'rejects bad skips');
  ok(parse(serialize(g)).state!.speed === 1, 'developer speeds do not stick in a save');
}

// ---- events ----
{
  const g = game();
  for (const e of EVENT_DEFS) {
    g.events = [];
    ok(dev.triggerEvent(g, e.id).ok && g.events.length === 1 && g.events[0].defId === e.id, `triggers ${e.title}`);
  }
  g.events = [];
  dev.triggerEvent(g, 'recession', 'Europe');
  ok(g.events[0].region === 'Europe', 'events can target a chosen place');
  ok(!dev.triggerEvent(g, 'recession', 'Mars').ok, 'bad places are refused');
  dev.endAllEvents(g);
  ok(!g.events.length, 'ends all events');
  const offers = g.contracts.offers.length;
  dev.addContractOffer(g);
  ok(g.contracts.offers.length === offers + 1, 'adds a contract offer');
  const any = DECISIONS.find((d) => d.id === 'salvage')!;
  ok(dev.triggerDecision(g, any.id).ok && g.decision?.defId === any.id, 'shows a chosen opportunity card');
  ok(!dev.triggerDecision(g, 'pay_review').ok, 'cards that do not apply explain why');
}

// ---- saves ----
{
  const g = game();
  dev.setPriceMults(g, { land: 2 });
  dev.setUnlockAll(g, true);
  const b = parse(serialize(g)).state!;
  ok(b.dev?.land === 2 && b.dev?.unlockAll === true, 'developer settings survive a save');
  const old = JSON.parse(serialize(game()));
  delete old.state.dev;
  ok(parse(JSON.stringify(old)).state!.dev === undefined, 'normal saves are unaffected');
  old.state.dev = 'junk';
  ok(parse(JSON.stringify(old)).state!.dev === undefined, 'a corrupt developer block is removed');
}

if (fails) { console.error(`${fails} FAILED`); (globalThis as any).process.exitCode = 1; } else console.log('ALL DEV TOOL TESTS PASSED');
