// Money movement, experience and activity log. All cash changes go through here
// so every dollar shows up in reports and transaction history.

import type { GameState, LogEntry } from '../core/state';
import { emit, toast, sfx } from '../core/bus';
import { xpForLevel, titleForLevel } from '../config/economy';

export class InsufficientFunds extends Error {}

export function canAfford(s: GameState, amount: number): boolean {
  return s.cash >= amount - 0.01;
}

function addToReports(s: GameState, side: 'revenue' | 'expenses', cat: string, amount: number) {
  for (const r of [s.finance.cur.hour, s.finance.cur.day, s.finance.cur.month]) {
    r[side][cat] = (r[side][cat] ?? 0) + amount;
  }
}

/** One-off capital spending (property, construction, equipment...). */
export function spend(s: GameState, amount: number, cat: string, desc: string): void {
  if (amount <= 0) return;
  if (!canAfford(s, amount)) throw new InsufficientFunds(`Not enough cash: need $${Math.round(amount).toLocaleString()}`);
  s.cash -= amount;
  s.finance.totalCapex += amount;
  for (const r of [s.finance.cur.hour, s.finance.cur.day, s.finance.cur.month]) r.capex += amount;
  pushTx(s, -amount, cat, desc);
  emit('cash', -amount);
}

/** One-off income (sales, bonuses, rewards). */
export function receive(s: GameState, amount: number, cat: string, desc: string): void {
  if (amount <= 0) return;
  s.cash += amount;
  addToReports(s, 'revenue', cat, amount);
  s.finance.totalRevenue += amount;
  pushTx(s, amount, cat, desc);
  emit('cash', amount);
}

/** Continuous operating flows, aggregated into reports (not individual tx). */
export function flow(s: GameState, revenue: Record<string, number>, expenses: Record<string, number>): void {
  let net = 0;
  for (const [k, v] of Object.entries(revenue)) {
    if (!v) continue;
    addToReports(s, 'revenue', k, v);
    s.finance.totalRevenue += v;
    net += v;
  }
  for (const [k, v] of Object.entries(expenses)) {
    if (!v) continue;
    addToReports(s, 'expenses', k, v);
    s.finance.totalExpenses += v;
    net -= v;
  }
  s.cash += net;
}

export function pushTx(s: GameState, amount: number, cat: string, desc: string) {
  s.finance.ledger.unshift({ t: s.gameHours, amount, cat, desc });
  if (s.finance.ledger.length > 400) s.finance.ledger.length = 400;
}

export function log(s: GameState, msg: string, kind: LogEntry['kind'] = 'info') {
  s.log.unshift({ t: s.gameHours, msg, kind });
  if (s.log.length > 200) s.log.length = 200;
  emit('log', { msg, kind });
}

export function stat(s: GameState, key: string, inc = 1) {
  s.stats[key] = (s.stats[key] ?? 0) + inc;
}

export function addXp(s: GameState, amount: number, reason?: string) {
  if (amount <= 0) return;
  s.xp += Math.round(amount);
  let leveled = false;
  while (s.level < 100 && s.xp >= xpForLevel(s.level + 1)) {
    s.level++;
    leveled = true;
    const newTitle = titleForLevel(s.level);
    log(s, `Company reached level ${s.level} — ${newTitle}`, 'good');
    toast({ title: `Level ${s.level}!`, body: `${newTitle}. New buildings, equipment or regions may be unlocked.`, kind: 'level', icon: '⭐' });
  }
  if (leveled) {
    sfx('levelup');
    emit('levelup', s.level);
  }
  if (reason) emit('xp', { amount, reason });
}
