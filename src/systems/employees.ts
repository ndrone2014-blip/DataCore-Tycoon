// Staff: hiring, firing, promotion, assignment and growth.

import type { Employee, GameState } from '../core/state';
import { newId } from '../core/state';
import { DEPARTMENTS, personName, type Department } from '../config/content';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { rand, randRange, pick } from '../core/rng';
import { spend, log, canAfford } from './ledger';
import { sfx, emit } from '../core/bus';
import { money } from '../core/format';
import { hasFeature, isCareer } from './careerCore';

export function staffCap(s: GameState): number {
  return HQ_TIERS[s.company.hqTier]?.staff ?? 4;
}

function makeCandidate(s: GameState, dept?: Department): Employee {
  const depts = Object.keys(DEPARTMENTS) as Department[];
  const d = dept ?? pick(depts);
  const levelBias = Math.min(2, s.level / 15);
  const skill = Math.max(1, Math.min(5, Math.round(randRange(0.6, 2.6) + levelBias * rand())));
  const salary = Math.round(DEPARTMENTS[d].salary * (0.75 + skill * 0.3) * randRange(0.9, 1.15) * (isCareer(s) ? ECONOMY.career.salaryMult : 1));
  return { id: newId(s, 'em'), name: personName(rand), dept: d, skill, exp: Math.round(randRange(0, 200) * skill), perf: Math.round(randRange(55, 95)), salary, assigned: 'hq', hiredAt: 0 };
}

export function refreshCandidates(s: GameState) {
  s.candidates = Array.from({ length: ECONOMY.candidatePoolSize }, () => makeCandidate(s));
  s.candidatesAt = s.gameHours;
}

export function hireCost(e: Employee): number {
  return Math.round(e.salary * 168 * ECONOMY.signingWeeks * 10) ;
}

export function hire(s: GameState, candId: string): { ok: boolean; reason?: string } {
  const i = s.candidates.findIndex((c) => c.id === candId);
  if (i < 0) return { ok: false, reason: 'Candidate no longer available' };
  if (!hasFeature(s, 'g_profit')) return { ok: false, reason: 'You can hire once your first data center is profitable' };
  if (s.employees.length >= staffCap(s)) return { ok: false, reason: `HQ is full (${staffCap(s)} staff). Upgrade your headquarters.` };
  const c = s.candidates[i];
  const cost = hireCost(c);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)} signing bonus` };
  spend(s, cost, 'Recruiting', `Hired ${c.name} (${DEPARTMENTS[c.dept].label})`);
  s.candidates.splice(i, 1);
  c.hiredAt = s.gameHours;
  s.employees.push(c);
  log(s, `Hired ${c.name} as ${DEPARTMENTS[c.dept].label.replace(/s$/, '')}`, 'info');
  if (s.settings.autoAssignStaff) autoAssignStaff(s);
  sfx('hire');
  emit('world');
  return { ok: true };
}

export function fire(s: GameState, empId: string): { ok: boolean; reason?: string } {
  const i = s.employees.findIndex((e) => e.id === empId);
  if (i < 0) return { ok: false, reason: 'Unknown employee' };
  const e = s.employees[i];
  const cost = Math.round(e.salary * 168 * ECONOMY.severanceWeeks * 10);
  if (!canAfford(s, cost)) return { ok: false, reason: `Severance is ${money(cost)}` };
  spend(s, cost, 'Severance', `Severance: ${e.name}`);
  s.employees.splice(i, 1);
  log(s, `${e.name} left the company`, 'info');
  emit('world');
  return { ok: true };
}

export function promoteCost(e: Employee): number {
  return Math.round(e.salary * 400 * e.skill);
}

export function promote(s: GameState, empId: string): { ok: boolean; reason?: string } {
  const e = s.employees.find((x) => x.id === empId);
  if (!e) return { ok: false, reason: 'Unknown employee' };
  if (!hasFeature(s, 'g_staff')) return { ok: false, reason: 'Promotions unlock with Talent Management' };
  if (e.skill >= 5) return { ok: false, reason: 'Already at maximum level' };
  if (e.exp < e.skill * 120) return { ok: false, reason: `Needs ${e.skill * 120}h experience (has ${Math.round(e.exp)}h)` };
  const cost = promoteCost(e);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)}` };
  spend(s, cost, 'Training', `Promotion & training: ${e.name}`);
  e.skill++;
  e.salary = Math.round(e.salary * 1.28);
  e.perf = Math.min(100, e.perf + 10);
  log(s, `${e.name} promoted to level ${e.skill}`, 'good');
  sfx('levelup');
  emit('world');
  return { ok: true };
}

export function assign(s: GameState, empId: string, target: string) {
  const e = s.employees.find((x) => x.id === empId);
  if (!e) return;
  if (target !== 'hq' && !s.facilities[target]) return;
  e.assigned = target;
  emit('world');
}

/** Departments whose bonus is felt per facility. All others work best from headquarters. */
const SITE_DEPTS: Department[] = ['electrical', 'cooling', 'it', 'ops', 'security'];
const staffPower = (e: Employee) => e.skill * (0.6 + 0.4 * (e.perf / 100)) * (1 + Math.min(1, e.exp / 400));

/**
 * Place every employee where they help most. HQ staff give 1× at every site; on-site staff give
 * 2× there and 0.25× elsewhere. Greedily maximises the load-weighted department bonus, so with few
 * sites people go on site and with many sites they stay at HQ, except that busy sites still get cover.
 */
export function autoAssignStaff(s: GameState): number {
  if (!hasFeature(s, 'g_stage2')) return 0;
  const facs = Object.values(s.facilities).filter((f) => !f.isHQ);
  const weight = (f: typeof facs[number]) => 1 + f.slots + Object.values(f.equipment).reduce((a, b) => a + b, 0) * 4;
  const sites = facs.sort((a, b) => weight(b) - weight(a)).slice(0, 30);
  let moved = 0;
  const set = (e: Employee, to: string) => { if (e.assigned !== to) { e.assigned = to; moved++; } };
  for (const e of s.employees) if (!SITE_DEPTS.includes(e.dept)) set(e, 'hq');
  for (const dept of SITE_DEPTS) {
    const staff = s.employees.filter((e) => e.dept === dept).sort((a, b) => staffPower(b) - staffPower(a));
    if (!sites.length) { staff.forEach((e) => set(e, 'hq')); continue; }
    const k = DEPARTMENTS[dept].k;
    const E = new Map(sites.map((f) => [f.id, 0]));
    const value = () => sites.reduce((sum, f) => sum + weight(f) * (1 - Math.exp(-E.get(f.id)! / k)) + (dept === 'security' && E.get(f.id)! > 0 ? weight(f) * 0.02 : 0), 0);
    const apply = (to: string, base: number, sign: number) => { for (const f of sites) E.set(f.id, E.get(f.id)! + sign * base * (to === 'hq' ? 1 : to === f.id ? 2 : 0.25)); };
    for (const e of staff) {
      const base = staffPower(e);
      let best = 'hq', bestV = -Infinity;
      for (const to of ['hq', ...sites.map((f) => f.id)]) {
        apply(to, base, 1);
        const v = value();
        apply(to, base, -1);
        if (v > bestV + 1e-9) { bestV = v; best = to; }
      }
      apply(best, base, 1);
      set(e, best);
    }
  }
  if (moved) emit('world');
  return moved;
}

/** Move a whole department (or everyone) to one location. */
export function bulkAssign(s: GameState, dept: string, target: string): number {
  if (target !== 'hq' && !s.facilities[target]) return 0;
  let n = 0;
  for (const e of s.employees) if ((dept === 'all' || e.dept === dept) && e.assigned !== target) { e.assigned = target; n++; }
  if (n) emit('world');
  return n;
}

export function tickEmployees(s: GameState, dt: number) {
  if (s.settings.autoAssignStaff && Math.floor(s.gameHours / 24) !== Math.floor((s.gameHours - dt) / 24)) autoAssignStaff(s);
  if (!s.candidates.length || s.gameHours - s.candidatesAt > ECONOMY.candidateRefreshHours) refreshCandidates(s);
  for (const e of s.employees) {
    e.exp += dt;
    // performance drifts toward a skill-dependent baseline, with noise
    const target = 60 + e.skill * 6;
    e.perf += (target - e.perf) * 0.002 * dt + (rand() - 0.5) * 0.4 * Math.sqrt(dt);
    e.perf = Math.max(20, Math.min(100, e.perf));
    if (e.assigned !== 'hq' && !s.facilities[e.assigned]) e.assigned = 'hq';
  }
}
