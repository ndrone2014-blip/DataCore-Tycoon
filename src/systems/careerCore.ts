// The parts of company progression the core simulation needs. Kept free of other game systems so
// derive, fiber, construction and rivals can all read it without import cycles.

import type { Facility, GameState } from '../core/state';
import { ECONOMY } from '../config/economy';

const C = ECONOMY.career;

export const isCareer = (s: GameState): boolean => s.career?.mode === 'career';
export const stageDef = (s: GameState) => C.stages[Math.max(0, Math.min(C.stages.length - 1, s.career?.stage ?? 0))];

/** Features that open up as the company grows. Older saves and the developer unlock skip all of this. */
export function hasFeature(s: GameState, goalId: string): boolean {
  if (!isCareer(s) || s.dev?.unlockAll) return true;
  return s.career.done[goalId] !== undefined;
}

/** What the company can charge. Reputation and scale earn better customers as the stages go by. */
export const revenueMult = (s: GameState): number => (isCareer(s) ? stageDef(s).revenue : 1);
/** Fixed cost of keeping one connected site staffed and secure. */
export const siteOverhead = (s: GameState): number => (isCareer(s) ? stageDef(s).overhead : 0);
export const creditLimitShare = (s: GameState): number => (isCareer(s) ? stageDef(s).credit : ECONOMY.loanLimitOfValuation);
export const rivalRevenueMult = (s: GameState): number => (isCareer(s) ? C.rivalRevenue : 1);
export const rewardCash = (s: GameState, cash: number): number => (isCareer(s) ? Math.round((cash * C.rewardMult) / 100) * 100 : cash);

/** Learning curve: crews get faster and cheaper with every data center they finish. */
export function builderExperience(s: GameState): number {
  if (!isCareer(s)) return 0;
  return Math.min(C.learningMax, (s.stats.buildsCompleted ?? 0) * C.learningPerBuild);
}

export const hookupsDone = (f: Facility): boolean => !f.hookups || (f.hookups.power === 0 && f.hookups.net === 0);

export interface GarageIncome { revenue: number; cost: number }
export function garageIncome(s: GameState): GarageIncome {
  const n = isCareer(s) ? s.career.garage : 0;
  return { revenue: n * C.garage.incomeHr, cost: n * C.garage.powerHr };
}
