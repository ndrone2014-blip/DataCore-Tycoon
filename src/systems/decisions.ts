// Opportunity cards: occasional choices with real consequences (cash, buffs, gambles).
// They wait patiently — if ignored they simply expire with no penalty.

import type { GameState, PendingDecision } from '../core/state';
import { newId } from '../core/state';
import type { Derived } from './derive';
import { ECONOMY } from '../config/economy';
import { rand, randRange, pick } from '../core/rng';
import { receive, spend, addXp, log, canAfford } from './ledger';
import { toast, sfx, emit } from '../core/bus';
import { money } from '../core/format';
import { researchById } from '../config/research';

export interface DecisionChoice {
  label: string;
  hint: string;
  cost?: number;
  apply: (s: GameState, data: Record<string, number>) => string;
}

export interface DecisionDef {
  id: string;
  icon: string;
  title: string;
  text: (s: GameState, data: Record<string, number>) => string;
  /** Returns data for the card, or null if it doesn't apply right now. */
  setup: (s: GameState, d: Derived) => Record<string, number> | null;
  choices: (s: GameState, data: Record<string, number>) => DecisionChoice[];
}

const buff = (s: GameState, key: string, value: number, hours: number, label: string) => {
  (s.buffs ??= []).push({ key, value, endsAt: s.gameHours + hours, label });
};
const scale = (d: Derived) => Math.max(60_000, Math.min(50_000_000, Math.max(0, d.totals.revenueHr) * 60 + d.totals.valuation * 0.01));

export const DECISIONS: DecisionDef[] = [
  {
    id: 'investor', icon: '💼', title: 'Angel investor',
    text: (_s, x) => `An investor loves your growth and offers ${money(x.cash)} today in exchange for a slice of contract income for the next ${Math.round(x.days)} days.`,
    setup: (_s, d) => ({ cash: Math.round(scale(d) * 1.5 / 1000) * 1000, days: 20 }),
    choices: (_s, x) => [
      { label: `Take ${money(x.cash)}`, hint: '−8% contract rates for 20 days', apply: (s) => { receive(s, x.cash, 'Investment', 'Angel investment'); buff(s, 'contractRate', -0.08, x.days * 24, 'Investor revenue share'); return `Received ${money(x.cash)} from an angel investor.`; } },
      { label: 'Stay independent', hint: 'No change', apply: () => 'You politely declined the investor.' },
    ],
  },
  {
    id: 'miner', icon: '⛏️', title: 'GPU rental request',
    text: (_s, x) => `A research lab wants to rent your idle AI compute for a weekend sprint. They'll pay ${money(x.cash)} up front, but your facilities run 15% slower for 2 days.`,
    setup: (_s, d) => (d.totals.delivered.gpu >= 8 ? { cash: Math.round(d.totals.delivered.gpu * 30 * 24 * 0.9 / 1000) * 1000 } : null),
    choices: (_s, x) => [
      { label: `Rent it out (+${money(x.cash)})`, hint: '−15% performance for 48h', apply: (s) => { receive(s, x.cash, 'Contract Bonus', 'Weekend GPU rental'); buff(s, 'perf', -0.15, 48, 'GPU rental sprint'); return `Earned ${money(x.cash)} renting GPUs.`; } },
      { label: 'Decline', hint: 'No change', apply: () => 'You kept your GPUs for your customers.' },
    ],
  },
  {
    id: 'demand_response', icon: '🔌', title: 'Grid demand response',
    text: (_s, x) => `The utility is short on power and will pay ${money(x.cash)} if you throttle your data centers for 12 hours.`,
    setup: (_s, d) => (d.totals.facilities > 0 ? { cash: Math.round(Math.max(20_000, d.totals.revenueHr * 18) / 1000) * 1000 } : null),
    choices: (_s, x) => [
      { label: `Help the grid (+${money(x.cash)})`, hint: '−30% performance for 12h · +2 reputation', apply: (s) => { receive(s, x.cash, 'Contract Bonus', 'Demand-response payment'); buff(s, 'perf', -0.3, 12, 'Demand response'); s.company.reputation = Math.min(100, s.company.reputation + 2); return `The grid paid you ${money(x.cash)}.`; } },
      { label: 'Keep running', hint: 'No change', apply: () => 'You kept your facilities at full power.' },
    ],
  },
  {
    id: 'press', icon: '📰', title: 'Tech press feature',
    text: (_s, x) => `A major tech magazine wants a feature on your company. Hosting the shoot costs ${money(x.cost)}, but it will bring in more customers.`,
    setup: (_s, d) => ({ cost: Math.round(scale(d) * 0.3 / 1000) * 1000 }),
    choices: (_s, x) => [
      { label: `Host the shoot (${money(x.cost)})`, hint: '+40% contract offers & +5% rates for 4 days, +5 reputation', cost: x.cost, apply: (s) => { spend(s, x.cost, 'Marketing', 'Press feature'); buff(s, 'offerRate', 0.4, 96, 'Press buzz'); buff(s, 'contractRate', 0.05, 96, 'Press buzz'); s.company.reputation = Math.min(100, s.company.reputation + 5); return 'Your feature went viral!'; } },
      { label: 'Not now', hint: 'No change', apply: () => 'You skipped the press feature.' },
    ],
  },
  {
    id: 'hackathon', icon: '🧪', title: 'Engineering hackathon',
    text: (_s, x) => `Your engineers want to run a 48-hour hackathon. Pizza, prizes and cloud credits cost ${money(x.cost)}.`,
    setup: (s, d) => (s.research.active ? { cost: Math.round(scale(d) * 0.15 / 1000) * 1000 } : null),
    choices: (s, x) => [
      { label: `Fund it (${money(x.cost)})`, hint: `+60% research speed for 2 days${s.research.active ? ` (${researchById(s.research.active.id).name})` : ''}`, cost: x.cost, apply: (st) => { spend(st, x.cost, 'Research', 'Hackathon'); buff(st, 'researchSpeed', 0.6, 48, 'Hackathon'); return 'The hackathon is underway — research is flying.'; } },
      { label: 'Skip', hint: 'No change', apply: () => 'Maybe next quarter.' },
    ],
  },
  {
    id: 'bulk', icon: '📦', title: 'Hardware bulk deal',
    text: (_s, x) => `A server vendor offers a bulk-buy agreement: pay ${money(x.cost)} now and get 25% off all equipment for the next 3 days.`,
    setup: (_s, d) => ({ cost: Math.round(scale(d) * 0.25 / 1000) * 1000 }),
    choices: (_s, x) => [
      { label: `Sign the deal (${money(x.cost)})`, hint: '−25% equipment prices for 72h', cost: x.cost, apply: (s) => { spend(s, x.cost, 'Equipment', 'Bulk-buy agreement'); buff(s, 'equipDiscount', 0.25, 72, 'Bulk hardware deal'); return 'Bulk pricing is active — time to go shopping!'; } },
      { label: 'Pass', hint: 'No change', apply: () => 'You passed on the bulk deal.' },
    ],
  },
  {
    id: 'poach', icon: '🕵️', title: 'Talent poaching',
    text: (s, x) => `A rival is trying to poach ${s.employees[x.idx]?.name ?? 'one of your employees'}. A retention bonus of ${money(x.cost)} will keep them happy.`,
    setup: (s, d) => (s.employees.length >= 2 ? { idx: Math.floor(rand() * s.employees.length), cost: Math.round(Math.max(15_000, scale(d) * 0.08) / 1000) * 1000 } : null),
    choices: (s, x) => [
      { label: `Pay retention (${money(x.cost)})`, hint: 'They stay with +15 performance', cost: x.cost, apply: (st) => { spend(st, x.cost, 'Salaries', 'Retention bonus'); const e = st.employees[x.idx]; if (e) e.perf = Math.min(100, e.perf + 15); return `${e?.name ?? 'Your employee'} is staying — and motivated.`; } },
      { label: 'Let them go', hint: 'Lose this employee', apply: (st) => { const e = st.employees[x.idx]; if (e) st.employees.splice(x.idx, 1); return `${e?.name ?? 'An employee'} left for a rival.`; } },
    ],
  },
  {
    id: 'university', icon: '🎓', title: 'University partnership',
    text: () => 'A local university proposes a joint research program with free graduate students.',
    setup: () => ({}),
    choices: (s) => [
      s.research.active
        ? { label: 'Join forces', hint: 'Instantly +35% progress on current research', apply: (st) => { const a = st.research.active; if (a) a.done = Math.min(a.total, a.done + a.total * 0.35); return 'The students made a breakthrough!'; } }
        : { label: 'Join forces', hint: '+XP for your company', apply: (st) => { addXp(st, 200 + st.level * 60, 'Partnership'); return 'The partnership boosted your reputation in tech circles.'; } },
      { label: 'Decline', hint: 'No change', apply: () => 'You declined the partnership.' },
    ],
  },
  {
    id: 'salvage', icon: '🎁', title: 'Lucky find',
    text: (_s, x) => `Your crew found a stash of reusable copper and old servers during a site inspection. It's worth ${money(x.cash)} to a recycler.`,
    setup: (_s, d) => ({ cash: Math.round(scale(d) * 0.25 / 1000) * 1000 }),
    choices: (_s, x) => [{ label: `Collect ${money(x.cash)}!`, hint: 'Free money', apply: (s) => { receive(s, x.cash, 'Rewards', 'Salvaged materials'); return `Collected ${money(x.cash)}.`; } }],
  },
  {
    id: 'gamble', icon: '🎲', title: 'Speculative chip order',
    text: (_s, x) => `A broker offers early access to next-gen chips for ${money(x.cost)}. If demand spikes (60% chance) you can resell for ${money(x.cost * 2.2)}. If not, you get back ${money(x.cost * 0.5)}.`,
    setup: (_s, d) => ({ cost: Math.round(scale(d) * 0.4 / 1000) * 1000 }),
    choices: (_s, x) => [
      { label: `Take the bet (${money(x.cost)})`, hint: '60%: ×2.2 · 40%: ×0.5', cost: x.cost, apply: (s) => { spend(s, x.cost, 'Equipment', 'Speculative chip order'); const win = rand() < 0.6; const back = Math.round(x.cost * (win ? 2.2 : 0.5)); receive(s, back, 'Equipment Sale', 'Chip resale'); return win ? `Jackpot! Resold for ${money(back)}.` : `Demand fizzled — recovered ${money(back)}.`; } },
      { label: 'Play it safe', hint: 'No change', apply: () => 'You skipped the speculation.' },
    ],
  },
  {
    id: 'speedcrew', icon: '👷', title: 'Elite construction crew',
    text: (_s, x) => `A famous build crew has a gap in their schedule. For ${money(x.cost)} they'll boost all your construction speed by 50% for 2 days.`,
    setup: (s, d) => (Object.keys(s.projects).length ? { cost: Math.round(scale(d) * 0.12 / 1000) * 1000 } : null),
    choices: (_s, x) => [
      { label: `Hire them (${money(x.cost)})`, hint: '+50% construction speed for 48h', cost: x.cost, apply: (s) => { spend(s, x.cost, 'Construction', 'Elite construction crew'); buff(s, 'constructionSpeed', 0.5, 48, 'Elite crew'); return 'The elite crew is on site!'; } },
      { label: 'No thanks', hint: 'No change', apply: () => 'You stuck with your regular crews.' },
    ],
  },
];

export function tickDecisions(s: GameState, d: Derived) {
  if (s.decision && s.gameHours >= s.decision.expiresAt) {
    s.decision = undefined;
    emit('decision');
  }
  if (s.nextDecisionAt === undefined) s.nextDecisionAt = s.gameHours + 30;
  if (s.decision || s.gameHours < s.nextDecisionAt) return;
  s.nextDecisionAt = s.gameHours + randRange(ECONOMY.decisionIntervalHours[0], ECONOMY.decisionIntervalHours[1]);
  if (s.gameHours < 20) return;
  const options = DECISIONS.map((def) => ({ def, data: def.setup(s, d) })).filter((o) => o.data);
  if (!options.length) return;
  const o = pick(options);
  const pd: PendingDecision = { id: newId(s, 'op'), defId: o.def.id, expiresAt: s.gameHours + 72, data: o.data! };
  s.decision = pd;
  toast({ title: `Opportunity: ${o.def.title}`, body: 'A new decision is waiting in the corner of your screen.', kind: 'good', icon: o.def.icon });
  sfx('event_good');
  emit('decision');
}

export function resolveDecision(s: GameState, choiceIdx: number): { ok: boolean; reason?: string } {
  const pd = s.decision;
  if (!pd) return { ok: false, reason: 'No pending decision' };
  const def = DECISIONS.find((x) => x.id === pd.defId);
  if (!def) {
    s.decision = undefined;
    return { ok: false, reason: 'Unknown decision' };
  }
  const ch = def.choices(s, pd.data)[choiceIdx];
  if (!ch) return { ok: false, reason: 'Unknown choice' };
  if (ch.cost && !canAfford(s, ch.cost)) return { ok: false, reason: `Need ${money(ch.cost)}` };
  const msg = ch.apply(s, pd.data);
  s.decision = undefined;
  log(s, `${def.title}: ${msg}`, 'good');
  toast({ title: def.title, body: msg, kind: 'good', icon: def.icon });
  sfx('reward');
  emit('world');
  return { ok: true };
}
