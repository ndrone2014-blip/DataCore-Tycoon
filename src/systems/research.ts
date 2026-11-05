// Research tree progress.

import type { GameState } from '../core/state';
import { RESEARCH, researchById, type ResearchDef } from '../config/research';
import { ECONOMY } from '../config/economy';
import { spend, log, addXp, stat, canAfford } from './ledger';
import { deptBonus, getEffects, eff } from './modifiers';
import { toast, sfx, emit } from '../core/bus';
import { money } from '../core/format';
import { hasFeature } from './careerCore';

export function researchState(s: GameState, r: ResearchDef): 'done' | 'active' | 'available' | 'locked' {
  if (s.research.done.includes(r.id)) return 'done';
  if (s.research.active?.id === r.id) return 'active';
  if (r.requires.every((x) => s.research.done.includes(x)) && s.level >= r.level && !tierLock(s, r)) return 'available';
  return 'locked';
}

/** Career companies reach the higher research tiers as they grow. */
export function tierLock(s: GameState, r: ResearchDef): string | undefined {
  if (r.tier >= 4 && !hasFeature(s, 'g_tech')) return 'Tier 4 unlocks with Frontier Technology';
  if (r.tier === 3 && !hasFeature(s, 'g_adv_research')) return 'Tier 3 unlocks with Advanced Research';
  if (!hasFeature(s, 'g_research')) return 'Research unlocks with R&D Budget';
  return undefined;
}

export function researchSpeed(s: GameState): number {
  return 1 + deptBonus(s, 'research') + eff(getEffects(s), 'researchSpeed');
}

export function canResearch(s: GameState, id: string): { ok: boolean; reason?: string } {
  const r = researchById(id);
  if (!r) return { ok: false, reason: 'Unknown' };
  const st = researchState(s, r);
  if (st === 'done') return { ok: false, reason: 'Already researched' };
  if (st === 'active') return { ok: false, reason: 'In progress' };
  if (s.research.active) return { ok: false, reason: 'Another project is in progress' };
  if (s.level < r.level) return { ok: false, reason: `Requires level ${r.level}` };
  const tier = tierLock(s, r);
  if (tier) return { ok: false, reason: tier };
  const missing = r.requires.filter((x) => !s.research.done.includes(x));
  if (missing.length) return { ok: false, reason: `Requires ${missing.map((m) => researchById(m).name).join(', ')}` };
  if (!canAfford(s, r.cost)) return { ok: false, reason: `Need ${money(r.cost)}` };
  return { ok: true };
}

export function startResearch(s: GameState, id: string): { ok: boolean; reason?: string } {
  const c = canResearch(s, id);
  if (!c.ok) return c;
  const r = researchById(id);
  spend(s, r.cost, 'Research', `Research: ${r.name}`);
  s.research.active = { id, done: 0, total: r.seconds };
  log(s, `Research started: ${r.name}`, 'info');
  sfx('research');
  emit('world');
  return { ok: true };
}

export function tickResearch(s: GameState, realSeconds: number) {
  const a = s.research.active;
  if (!a) return;
  a.done += realSeconds * researchSpeed(s);
  if (a.done >= a.total) {
    const r = researchById(a.id);
    s.research.done.push(a.id);
    s.research.active = undefined;
    stat(s, 'researchDone');
    addXp(s, ECONOMY.xp.researchComplete * r.tier, 'Research');
    log(s, `Research complete: ${r.name}`, 'good');
    toast({ title: 'Research complete', body: `${r.name}${r.unlocks ? ' — unlocked ' + r.unlocks : ''}`, kind: 'achievement', icon: '🔬' });
    emit('researchDone', r.id);
    sfx('unlock');
    emit('world');
  }
}

export { RESEARCH };
