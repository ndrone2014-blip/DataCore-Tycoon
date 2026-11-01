// Staff: hiring, firing, promotion, assignment and growth.

import type { Employee, GameState } from '../core/state';
import { newId } from '../core/state';
import { DEPARTMENTS, personName, type Department } from '../config/content';
import { ECONOMY, HQ_TIERS } from '../config/economy';
import { rand, randRange, pick } from '../core/rng';
import { spend, log, canAfford } from './ledger';
import { sfx, emit } from '../core/bus';
import { money } from '../core/format';

export function staffCap(s: GameState): number {
  return HQ_TIERS[s.company.hqTier]?.staff ?? 4;
}

function makeCandidate(s: GameState, dept?: Department): Employee {
  const depts = Object.keys(DEPARTMENTS) as Department[];
  const d = dept ?? pick(depts);
  const levelBias = Math.min(2, s.level / 15);
  const skill = Math.max(1, Math.min(5, Math.round(randRange(0.6, 2.6) + levelBias * rand())));
  const salary = Math.round(DEPARTMENTS[d].salary * (0.75 + skill * 0.3) * randRange(0.9, 1.15));
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
  if (s.employees.length >= staffCap(s)) return { ok: false, reason: `HQ is full (${staffCap(s)} staff). Upgrade your headquarters.` };
  const c = s.candidates[i];
  const cost = hireCost(c);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${money(cost)} signing bonus` };
  spend(s, cost, 'Recruiting', `Hired ${c.name} (${DEPARTMENTS[c.dept].label})`);
  s.candidates.splice(i, 1);
  c.hiredAt = s.gameHours;
  s.employees.push(c);
  log(s, `Hired ${c.name} as ${DEPARTMENTS[c.dept].label.replace(/s$/, '')}`, 'info');
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

export function tickEmployees(s: GameState, dt: number) {
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
