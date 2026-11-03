// Data center construction: quoting premade/custom builds, projects, stages, speed-ups.

import { cityMods } from './regulation';
import type { GameState, Project } from '../core/state';
import { newId } from '../core/state';
import { BLUEPRINTS, blueprintById, COOLING_TIERS, ELECTRICAL_TIERS, EXTERIOR_STYLES, type CustomOptions, type BlueprintDef } from '../config/buildings';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { cityById } from '../config/world';
import { getParcel, type ParcelDef } from '../world/parcels';
import { constructionMult, getEffects } from './modifiers';
import { spend, log, addXp, stat, canAfford } from './ledger';
import { parcelState, constructionSpeed } from './property';
import { toast, sfx, emit } from '../core/bus';
import { money } from '../core/format';

export const BUILD_STAGES = [
  { name: 'Site preparation', w: 0.08 },
  { name: 'Foundation', w: 0.12 },
  { name: 'Building structure', w: 0.2 },
  { name: 'Electrical infrastructure', w: 0.14 },
  { name: 'Cooling infrastructure', w: 0.14 },
  { name: 'Interior construction', w: 0.14 },
  { name: 'Rack & cabling installation', w: 0.1 },
  { name: 'Testing & commissioning', w: 0.08 },
];
export const DEMO_STAGES = [
  { name: 'Mobilizing crew', w: 0.15 },
  { name: 'Stripping interior & hazmat', w: 0.25 },
  { name: 'Structural demolition', w: 0.4 },
  { name: 'Debris removal & grading', w: 0.2 },
];

export function stageOf(p: Project): { index: number; name: string; stageProgress: number; count: number } {
  const stages = p.kind === 'build' ? BUILD_STAGES : DEMO_STAGES;
  const prog = Math.min(1, p.doneSeconds / p.totalSeconds);
  let acc = 0;
  for (let i = 0; i < stages.length; i++) {
    if (prog <= acc + stages[i].w || i === stages.length - 1) {
      return { index: i, name: stages[i].name, stageProgress: Math.min(1, (prog - acc) / stages[i].w), count: stages.length };
    }
    acc += stages[i].w;
  }
  return { index: 0, name: stages[0].name, stageProgress: 0, count: stages.length };
}

export interface BuildSpec {
  name: string;
  blueprintId: string;
  custom?: CustomOptions;
  slots: number;
  bays: number;
  power: number;
  cooling: number;
  floors: number;
  footprint: number;
  style: string;
  color: string;
  shell: number;
  seconds: number;
  isHQ?: boolean;
}

export interface BuildQuote {
  ok: boolean;
  reasons: string[];
  spec: BuildSpec;
  breakdown: Record<string, number>;
  total: number;
  seconds: number;
  workers: number;
}

export function defaultCustom(bp: BlueprintDef, p: ParcelDef): CustomOptions {
  return {
    floors: Math.min(bp.floors, p.zoning.maxFloors),
    footprint: Math.min(bp.footprint, p.zoning.maxCoverage),
    style: bp.style,
    color: bp.color,
    coolingTier: 0,
    electricalTier: 0,
    generators: 0,
    security: 0,
    serverDensity: 1,
  };
}

export function buildSpec(s: GameState, parcelId: string, blueprintId: string, custom?: CustomOptions): { spec: BuildSpec; reasons: string[] } {
  const p = getParcel(parcelId)!;
  const bp = blueprintById(blueprintId);
  const reasons: string[] = [];
  if (s.level < bp.level && !s.dev?.unlockAll) reasons.push(`Requires company level ${bp.level}`);
  if (!p.zoning.heavy && ['hyperscale', 'ai_center', 'supercomputer', 'mega'].includes(bp.id)) reasons.push(`Zoning ${p.zoning.code} does not allow hyperscale-class buildings`);
  if (!custom) {
    if (p.area < bp.minLot) reasons.push(`Lot too small: needs ${bp.minLot.toLocaleString()} m² (lot is ${p.area.toLocaleString()} m²)`);
    if (bp.floors > p.zoning.maxFloors) reasons.push(`Zoning allows max ${p.zoning.maxFloors} floors (blueprint has ${bp.floors})`);
    return {
      spec: { name: bp.name, blueprintId: bp.id, slots: bp.slots, bays: bp.bays, power: bp.power, cooling: bp.cooling, floors: bp.floors, footprint: Math.min(bp.footprint, p.zoning.maxCoverage), style: bp.style, color: bp.color, shell: bp.cost, seconds: bp.buildSeconds },
      reasons,
    };
  }
  const c = custom;
  if (c.floors > p.zoning.maxFloors) reasons.push(`Zoning allows max ${p.zoning.maxFloors} floors`);
  if (c.floors > bp.maxFloors) reasons.push(`${bp.name} supports max ${bp.maxFloors} floors`);
  if (c.footprint > p.zoning.maxCoverage + 1e-6) reasons.push(`Footprint exceeds ${Math.round(p.zoning.maxCoverage * 100)}% lot coverage limit`);
  const ct = COOLING_TIERS[c.coolingTier];
  const et = ELECTRICAL_TIERS[c.electricalTier];
  if (ct.research && !s.research.done.includes(ct.research)) reasons.push(`${ct.label} requires research`);
  if (et.research && !s.research.done.includes(et.research)) reasons.push(`${et.label} requires research`);
  const floorArea = p.area * c.footprint * c.floors;
  const slots = Math.max(4, Math.round(floorArea * bp.slotsPerM2 * c.serverDensity));
  const basePower = slots * bp.kwPerSlot * 0.85;
  const power = Math.round(basePower * et.mult);
  const cooling = Math.round(basePower * 0.9 * ct.mult);
  const bays = Math.max(3, Math.round(bp.bays * Math.sqrt(slots / bp.slots)));
  if (slots < bp.slots * 0.25) reasons.push(`Too small for a ${bp.name} — choose a smaller class or more floors`);
  const styleMult = EXTERIOR_STYLES.find((x) => x.id === c.style)?.mult ?? 1;
  const scale = Math.pow(slots / bp.slots, 0.92);
  const shell = Math.round(bp.cost * scale * styleMult * (0.9 + 0.1 * c.serverDensity) + c.generators * 120_000 + c.security * 90_000 * Math.sqrt(scale));
  const seconds = Math.round(bp.buildSeconds * Math.pow(slots / bp.slots, 0.5) * (1 + c.floors * 0.04));
  return {
    spec: { name: `Custom ${bp.name}`, blueprintId: bp.id, custom: c, slots, bays: bays + c.generators, power, cooling, floors: c.floors, footprint: c.footprint, style: c.style, color: c.color, shell, seconds },
    reasons,
  };
}

export function quoteBuild(s: GameState, parcelId: string, blueprintId: string, custom?: CustomOptions): BuildQuote {
  const p = getParcel(parcelId)!;
  const { spec, reasons } = buildSpec(s, parcelId, blueprintId, custom);
  spec.seconds = Math.round(spec.seconds * cityMods(s, p.cityId).permitTime);
  const st = parcelState(s, parcelId);
  if (st.owner !== 'player') reasons.push('You must own this property');
  else if (st.status === 'existing') reasons.push('Demolish the existing building first');
  else if (st.status !== 'cleared') reasons.push('Site is not available');
  if (st.mergedInto) reasons.push('Lot is part of a consolidated campus site');
  const e = getEffects(s);
  const m = constructionMult(s, p.cityId, e);
  const ct = custom ? COOLING_TIERS[custom.coolingTier] : COOLING_TIERS[0];
  const et = custom ? ELECTRICAL_TIERS[custom.electricalTier] : ELECTRICAL_TIERS[0];
  const seconds = Math.max(20, Math.round(spec.seconds / constructionSpeed(s)));
  const workers = Math.round(10 + Math.sqrt(spec.shell / 8000));
  const breakdown: Record<string, number> = {
    'Building shell': spec.shell * m,
    'Site preparation': p.area * ECONOMY.sitePrepPerM2 * m,
    'Electrical infrastructure': spec.power * ECONOMY.electricalPerKW * et.costMult * m,
    'Cooling infrastructure': spec.cooling * ECONOMY.coolingPerKW * ct.costMult * m,
    'Labor': workers * spec.seconds * ECONOMY.laborPerWorkerHour * m,
  };
  const sub = Object.values(breakdown).reduce((a, b) => a + b, 0);
  breakdown['Permits & fees'] = sub * ECONOMY.permitRate;
  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k] / 100) * 100;
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (reasons.length === 0 && !canAfford(s, total)) reasons.push(`Need ${money(total)}`);
  return { ok: reasons.length === 0, reasons, spec, breakdown, total, seconds, workers };
}

export function startBuild(s: GameState, parcelId: string, blueprintId: string, custom: CustomOptions | undefined, name?: string): BuildQuote {
  const q = quoteBuild(s, parcelId, blueprintId, custom);
  if (!q.ok) return q;
  const p = getParcel(parcelId)!;
  spend(s, q.total, 'Construction', `Construction: ${q.spec.name} at ${p.name}`);
  const id = newId(s, 'pr');
  const count = Object.values(s.facilities).filter((f) => f.cityId === p.cityId).length + Object.values(s.projects).filter((x) => x.cityId === p.cityId && x.kind === 'build').length;
  s.projects[id] = {
    id, kind: 'build', parcelId, cityId: p.cityId,
    totalSeconds: q.spec.seconds, doneSeconds: 0, cost: q.total, breakdown: q.breakdown,
    startedAt: s.gameHours, workers: q.workers, speedSpent: 0,
    draft: { ...q.spec, name: name?.trim() || `${cityById(p.cityId).name} ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'][count % 12]}${count >= 12 ? ' ' + (Math.floor(count / 12) + 1) : ''}` },
  };
  const st = s.parcels[parcelId] ?? (s.parcels[parcelId] = { ...parcelState(s, parcelId) });
  st.status = 'construction';
  st.projectId = id;
  log(s, `Construction started: ${q.spec.name} at ${p.name}`, 'build');
  toast({ title: 'Construction started', body: `${q.spec.name} — ${Math.round(q.seconds / 60)} min estimated.`, kind: 'info', icon: '🏗️' });
  sfx('build');
  emit('world');
  return q;
}

export function hqQuote(s: GameState, parcelId: string): { ok: boolean; reasons: string[]; cost: number; seconds: number } {
  const p = getParcel(parcelId)!;
  const reasons: string[] = [];
  const st = parcelState(s, parcelId);
  if (s.company.hqFacility) reasons.push('You already have a headquarters building');
  if (st.owner !== 'player') reasons.push('You must own this property');
  else if (st.status === 'existing') reasons.push('Demolish the existing building first');
  else if (st.status !== 'cleared') reasons.push('Site is not available');
  if (p.area < 400) reasons.push('Lot too small (min 400 m²)');
  const tier = Math.max(1, s.company.hqTier);
  const cost = Math.round(HQ_TIERS[tier].cost * 0.6 * cityById(p.cityId).constructionMult + 150_000);
  if (!reasons.length && !canAfford(s, cost)) reasons.push(`Need ${money(cost)}`);
  return { ok: reasons.length === 0, reasons, cost, seconds: 60 };
}

export function startHQ(s: GameState, parcelId: string) {
  const q = hqQuote(s, parcelId);
  if (!q.ok) return q;
  const p = getParcel(parcelId)!;
  spend(s, q.cost, 'Construction', `Headquarters construction at ${p.name}`);
  const id = newId(s, 'pr');
  s.projects[id] = {
    id, kind: 'build', parcelId, cityId: p.cityId, totalSeconds: q.seconds, doneSeconds: 0, cost: q.cost,
    breakdown: { 'Headquarters': q.cost }, startedAt: s.gameHours, workers: 30, speedSpent: 0,
    draft: { name: `${s.company.name} HQ`, blueprintId: 'hq', slots: 0, bays: 0, power: 0, cooling: 0, floors: 3, style: 'glass', color: s.company.color, footprint: 0.4, isHQ: true },
  };
  const st = s.parcels[parcelId] ?? (s.parcels[parcelId] = { ...parcelState(s, parcelId) });
  st.status = 'construction';
  st.projectId = id;
  log(s, `Headquarters construction started at ${p.name}`, 'build');
  sfx('build');
  emit('world');
  return q;
}

export function speedUpQuote(s: GameState, projectId: string, optionId: string): number {
  const pr = s.projects[projectId];
  const opt = ECONOMY.speedUps.find((o) => o.id === optionId);
  if (!pr || !opt) return 0;
  const remainingSec = Math.max(0, pr.totalSeconds - pr.doneSeconds);
  const remFrac = remainingSec / pr.totalSeconds;
  const cost = remFrac * pr.cost * opt.factor * opt.cut + remainingSec * opt.cut * ECONOMY.speedUpPerSecond * (pr.kind === 'demolish' ? 0.5 : 1);
  return Math.max(500, Math.round(cost / 100) * 100);
}

export function speedUp(s: GameState, projectId: string, optionId: string): { ok: boolean; reason?: string } {
  const pr = s.projects[projectId];
  const opt = ECONOMY.speedUps.find((o) => o.id === optionId);
  if (!pr || !opt) return { ok: false, reason: 'Unknown project' };
  const cost = speedUpQuote(s, projectId, optionId);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}` };
  spend(s, cost, 'Construction', `${opt.label} on ${pr.draft?.name ?? 'demolition'}`);
  const remaining = pr.totalSeconds - pr.doneSeconds;
  pr.doneSeconds += remaining * opt.cut;
  pr.speedSpent += cost;
  stat(s, 'speedUps');
  sfx('speed');
  emit('world');
  return { ok: true };
}

/** Called when a build project reaches 100%. Returns the new facility id. */
export function finishBuild(s: GameState, projectId: string): string | undefined {
  const pr = s.projects[projectId];
  if (!pr || !pr.draft) return;
  const d = pr.draft;
  const fid = newId(s, 'dc');
  s.facilities[fid] = {
    id: fid, parcelId: pr.parcelId, cityId: pr.cityId, name: d.name, blueprintId: d.blueprintId, custom: d.custom,
    slots: d.slots, bays: d.bays, basePower: d.power, baseCooling: d.cooling, floors: d.floors, style: d.style, color: d.color,
    footprint: d.footprint, equipment: {}, condition: 100, builtAt: s.gameHours, buildCost: pr.cost + pr.speedSpent,
    shellValue: pr.cost, equipmentSpent: 0, revenueTotal: 0, profitTotal: 0, isHQ: d.isHQ,
  };
  // Custom builds include backup generators and security as built-in systems.
  if (d.custom?.generators) s.facilities[fid].equipment['generator'] = d.custom.generators;
  const st = s.parcels[pr.parcelId];
  st.status = d.isHQ ? 'hq' : 'facility';
  st.facilityId = fid;
  st.projectId = undefined;
  delete s.projects[projectId];
  if (d.isHQ) {
    s.company.hqFacility = fid;
    if (s.company.hqTier < 1) s.company.hqTier = 1;
    log(s, `${d.name} is open for business`, 'good');
    toast({ title: 'Headquarters complete', body: 'Your HQ now appears on the world map. Upgrade it to hire more staff.', kind: 'good', icon: '🏢' });
  } else {
    stat(s, 'buildsCompleted');
    stat(s, `built_${d.blueprintId}`);
    addXp(s, ECONOMY.xp.buildComplete + pr.cost / ECONOMY.xp.buildPer, 'Construction');
    log(s, `${d.name} is complete and ready for servers`, 'good');
    toast({ title: 'Construction complete!', body: `${d.name} is operational. Tap here to install servers and start earning.`, kind: 'good', icon: '🏁', dcId: fid });
  }
  sfx('complete');
  emit('world');
  emit('facilityBuilt', fid);
  return fid;
}

export function unlockedBlueprints(s: GameState) {
  return BLUEPRINTS.filter((b) => s.dev?.unlockAll || s.level >= b.level);
}
