// Company policies: long-term choices with real downsides, which you can't flip back and forth.

import type { GameState } from '../core/state';
import { POLICIES, POLICY_COOLDOWN_HOURS, citySpecById, type PolicyOption } from '../config/expansion';
import { canAfford, log, pushNews, spend } from './ledger';
import { emit, sfx } from '../core/bus';
import { money } from '../core/format';
import { specQuote } from './regulation';
import { cityById } from '../config/world';

export const currentPolicy = (s: GameState, policyId: string): PolicyOption => {
  const def = POLICIES.find((p) => p.id === policyId)!;
  return def.options.find((o) => o.id === s.policies[policyId]) ?? def.options[0];
};

export const policyFee = (valuation: number) => Math.max(75_000, Math.round((valuation * 0.006) / 1000) * 1000);

export function policyQuote(s: GameState, valuation: number, policyId: string, optionId: string): { ok: boolean; reason?: string; cost: number } {
  const def = POLICIES.find((p) => p.id === policyId);
  const cost = policyFee(valuation);
  if (!def || !def.options.some((o) => o.id === optionId)) return { ok: false, reason: 'Unknown policy', cost };
  if (s.level < def.level) return { ok: false, reason: `Requires level ${def.level}`, cost };
  if (currentPolicy(s, policyId).id === optionId) return { ok: false, reason: 'Current policy', cost };
  const at = s.policyAt[policyId];
  if (at !== undefined && s.gameHours - at < POLICY_COOLDOWN_HOURS) return { ok: false, reason: `The board will revisit this in ${Math.ceil((POLICY_COOLDOWN_HOURS - (s.gameHours - at)) / 24)} days`, cost };
  if (!canAfford(s, cost)) return { ok: false, reason: `Restructuring costs ${money(cost)}`, cost };
  return { ok: true, cost };
}

export function setPolicy(s: GameState, valuation: number, policyId: string, optionId: string): { ok: boolean; reason?: string } {
  const q = policyQuote(s, valuation, policyId, optionId);
  if (!q.ok) return q;
  const def = POLICIES.find((p) => p.id === policyId)!;
  const opt = def.options.find((o) => o.id === optionId)!;
  spend(s, q.cost, 'Restructuring', `${def.title}: ${opt.label}`);
  s.policies[policyId] = optionId;
  s.policyAt[policyId] = s.gameHours;
  log(s, `Board decision: ${def.title} set to ${opt.label}`, 'info');
  pushNews(s, `${s.company.name} announces new strategy: ${opt.label}`, opt.desc, 'info', 'Company');
  sfx('unlock');
  emit('world');
  return { ok: true };
}

export function setCitySpec(s: GameState, cityId: string, specId: string): { ok: boolean; reason?: string } {
  const def = citySpecById(specId);
  if (!def) return { ok: false, reason: 'Unknown focus' };
  const q = specQuote(s, cityId, specId);
  if (!q.ok) return q;
  spend(s, q.cost, 'Restructuring', `${cityById(cityId).name} focus: ${def.name}`);
  s.citySpec[cityId] = { spec: specId, since: s.gameHours };
  log(s, `${cityById(cityId).name} now operates as a ${def.name}`, 'good');
  pushNews(s, `${s.company.name} turns ${cityById(cityId).name} into a ${def.name}`, undefined, 'info', 'Company');
  sfx('unlock');
  emit('world');
  return { ok: true };
}
