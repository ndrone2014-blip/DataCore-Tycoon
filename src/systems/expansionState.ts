// Default values for everything the global expansion stores. Older saves pass through here on
// load, so they gain the new systems without losing anything.

import type { GameState } from '../core/state';
import { SUPPLY_CATS } from '../config/expansion';

const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);

export function ensureExpansion(s: GameState): GameState {
  const x = s as any;
  if (!Array.isArray(x.news)) x.news = [];
  if (!isObj(x.newsState)) x.newsState = { rank: 0, sat: {} };
  if (!isObj(x.newsState.sat)) x.newsState.sat = {};
  if (!isObj(x.policies)) x.policies = {};
  if (!isObj(x.policyAt)) x.policyAt = {};
  if (!isObj(x.citySpec)) x.citySpec = {};
  if (!isObj(x.fiber)) x.fiber = { routes: [], hubs: {} };
  if (!Array.isArray(x.fiber.routes)) x.fiber.routes = [];
  if (!isObj(x.fiber.hubs)) x.fiber.hubs = {};
  if (!isObj(x.supply)) x.supply = { chosen: {}, deals: {}, gen: {} };
  for (const k of ['chosen', 'deals', 'gen']) if (!isObj(x.supply[k])) x.supply[k] = {};
  for (const c of SUPPLY_CATS) x.supply.chosen[c.id] ??= `std_${c.id}`;
  if (!isObj(x.rep)) x.rep = { history: [], parts: {} };
  if (!Array.isArray(x.rep.history)) x.rep.history = [];
  if (!isObj(x.rep.parts)) x.rep.parts = {};
  if (!Array.isArray(x.integrations)) x.integrations = [];
  if (!isObj(x.dealCooldown)) x.dealCooldown = {};
  if (x.dev !== undefined && !isObj(x.dev)) delete x.dev;
  // Companies founded before v2.3 keep playing exactly as they did: nothing is locked for them.
  if (!isObj(x.career)) x.career = { mode: 'legacy', stage: 0, done: {} };
  const c = x.career;
  if (c.mode !== 'career' && c.mode !== 'legacy') c.mode = 'legacy';
  if (!isObj(c.done)) c.done = {};
  if (!isObj(c.loans)) c.loans = {};
  if (!Array.isArray(c.board)) c.board = [];
  for (const k of ['stage', 'profitHours', 'boardAt', 'gigsDone', 'garage', 'endless']) if (typeof c[k] !== 'number' || !isFinite(c[k])) c[k] = 0;
  c.stage = Math.max(0, Math.min(4, Math.floor(c.stage)));
  c.autoGigs = !!c.autoGigs;
  return s;
}
