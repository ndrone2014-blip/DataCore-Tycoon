// Company Progress: where the company stands, what to do next and what is still to come.
// Also the founder's freelance desk and the bank's startup loans, shared with the Dashboard.

import type { App } from '../app';
import { bar, btn, empty } from '../components';
import { money, num, esc, duration } from '../../core/format';
import { ECONOMY } from '../../config/economy';
import { endlessGoal, garageQuote, gigTier, gigsRelevant, goalProgress, GOALS, hasFeature, isCareer, loanOffer, nextGigTierAt, nextGoals, STAGES, startGig, setAutoGigs, buyGarageServer, takeStartupLoan, orderHookup, hookupQuote, ensureBoard, type GoalDef } from '../../systems/career';
import { hookupsDone } from '../../systems/careerCore';
import { cityById } from '../../config/world';
import { getParcel } from '../../world/parcels';
import { landValue } from '../../systems/derive';
import { parcelState } from '../../systems/property';
import type { Facility } from '../../core/state';

const reqValue = (metric: string, v: number) => (metric === 'valuation' ? money(v) : num(Math.floor(v)));

function goalCard(app: App, g: GoalDef): string {
  const p = goalProgress(app.s, app.d, g);
  return `<div class="goal-card">
    <div class="goal-ic">${g.icon}</div>
    <div class="grow">
      <b>${esc(g.title)}</b><p class="small muted">${esc(g.desc)}</p>
      ${g.reqs.map((q, i) => { const r = p.reqs[i]; return `<div class="goal-req"><span>${esc(q.label)}</span><small>${reqValue(q.metric, Math.min(r.value, q.target))} / ${reqValue(q.metric, q.target)}</small>${bar(r.frac, r.frac >= 1 ? 'ok' : 'sm')}</div>`; }).join('')}
      ${g.opens.length ? `<div class="goal-opens">🔓 ${g.opens.map((o) => `<span>${esc(o)}</span>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

function stageTrack(app: App): string {
  const cur = app.s.career.stage;
  return `<div class="stage-track">${STAGES.map((st, i) => `<div class="stage-step ${i < cur ? 'done' : i === cur ? 'cur' : ''}"><span class="stage-dot">${i < cur ? '✓' : st.icon}</span><b>${st.name}</b></div>`).join('')}</div>`;
}

/** A small strip for the Dashboard: the stage and the single most useful next goal. */
export function progressStrip(app: App): string {
  const s = app.s, d = app.d;
  const stage = STAGES[s.career.stage];
  const g = nextGoals(s, d, 1)[0];
  const done = Object.keys(s.career.done).length;
  return `<button class="card progress-strip" data-act="nav" data-page="progress">
    <span class="ps-stage">${stage.icon}<span><small>Company stage</small><b>${stage.name}</b></span></span>
    <span class="ps-next grow"><small>${g ? 'Next goal' : 'Next milestone'}</small><b>${g ? esc(g.title) : `${money(endlessGoal(s).target)} company value`}</b>${bar(g ? g.frac : d.totals.valuation / endlessGoal(s).target, 'sm')}</span>
    <span class="ps-count"><b>${done}</b><small>of ${GOALS.length} goals</small></span>
  </button>`;
}

/** Freelance jobs and the garage rack: how a founder with no income earns the first property. */
export function founderDesk(app: App): string {
  const s = app.s, d = app.d;
  if (!gigsRelevant(s, d)) return '';
  ensureBoard(s);
  const c = s.career;
  const q = garageQuote(s);
  const next = nextGigTierAt(c.gigsDone);
  const sp = s.company.startParcel;
  const target = sp && parcelState(s, sp).owner !== 'player' ? landValue(s, sp) : 0;
  const netHr = ECONOMY.career.garage.incomeHr - ECONOMY.career.garage.powerHr;
  const gig = c.gig;
  return `<div class="card founder-desk">
    <div class="row between wrap gap"><div><h3>🧰 Founder's desk</h3><p class="small muted">${target ? `You need <b>${money(target)}</b> for ${esc(getParcel(sp!)!.name)}. You have ${money(s.cash)}.` : 'Your data center isn\'t paying the bills on its own yet. A little outside work still helps.'}</p></div>
      ${target ? `<button class="btn ghost sm" data-act="openParcel" data-id="${sp}">📍 See the property</button>` : ''}</div>
    ${target ? bar(s.cash / target, 'big', `${Math.min(100, Math.floor((s.cash / target) * 100))}% of the way to your first property`) : ''}
    <div class="founder-grid mt">
      <div>
        <h4 class="sect">Freelance jobs ${next !== undefined ? `<small class="muted">· better clients after ${next - c.gigsDone} more</small>` : ''}</h4>
        ${gig ? `<div class="gig active"><span class="gig-ic">${gig.def.icon}</span><span class="grow"><b>${esc(gig.def.title)}</b><small>${esc(gig.def.client)} · ${money(gig.def.pay)} on completion · ${duration(Math.max(0, (gig.def.seconds - gig.done) / s.speed))} left</small>${bar(gig.done / gig.def.seconds, 'ok')}</span></div>` : ''}
        <div class="gig-list">${c.board.map((g) => `<div class="gig"><span class="gig-ic">${g.icon}</span><span class="grow"><b>${esc(g.title)}</b><small>${esc(g.client)} · ${duration(g.seconds)}</small></span><b class="price">${money(g.pay)}</b>${btn('Take job', 'startGig', { id: g.id }, gig ? 'ghost sm' : 'primary sm', gig ? 'You are on a job' : s.paused ? 'Time is stopped' : undefined)}</div>`).join('')}</div>
        ${hasFeature(s, 'g_steady') ? `<label class="check mt"><input type="checkbox" data-change="autoGigs" ${c.autoGigs ? 'checked' : ''}> Keep working: take the best-paying job automatically (only while you're playing)</label>` : `<p class="small muted mt">Finish ${8 - Math.min(8, c.gigsDone)} more to build a client list you can work through automatically.</p>`}
      </div>
      <div>
        <h4 class="sect">Garage rack <small class="muted">· ${c.garage}/${ECONOMY.career.garage.max} used servers</small></h4>
        <p class="small muted">Slow but steady: each one nets ${money(netHr, 2)}/hour hosting local websites, even while you're away. Every dollar here delays your first property, then pays you back.</p>
        ${q.reason === 'The garage is full' ? '<p class="small pos">The garage is full.</p>' : btn(`Buy a used server · ${money(q.cost)}`, 'buyGarage', {}, 'ghost', q.ok ? undefined : q.reason)}
        ${s.paused ? '<p class="small warn-t mt">Time is stopped, so jobs are on hold.</p>' : ''}
      </div>
    </div>
    <small class="muted gig-tier">Reputation in town: ${['Odd jobs', 'Local handyman', 'The IT person people call', 'Regional consultant'][gigTier(c.gigsDone)]} · ${c.gigsDone} jobs done</small>
  </div>`;
}

/** The bank's two startup loans, offered once there is something to lend against. */
export function loanCards(app: App): string {
  const s = app.s;
  if (!isCareer(s)) return '';
  const rows = [
    { kind: 'construction' as const, title: 'Construction loan', body: `Covers ${Math.round(ECONOMY.career.constructionLoanShare * 100)}% of a Modular Data Center on your property.`, show: hasFeature(s, 'g_property') },
    { kind: 'equipment' as const, title: 'Equipment financing', body: 'Buys your first racks of servers.', show: hasFeature(s, 'g_first_build') },
  ].filter((x) => x.show && !s.career.loans[x.kind]);
  if (!rows.length) return '';
  return `<div class="card loan-card"><h3>🏦 Local bank</h3><p class="small muted">Startup loans for a business with collateral. Interest is ${money(app.d.totals.interestHr)}/hour right now and counts against your profit, so borrowing makes profitability harder to reach.</p>
    ${rows.map((x) => { const q = loanOffer(s, x.kind); return `<div class="list-row static"><span class="flag">🏦</span><span class="grow"><b>${x.title}</b><small>${x.body}</small></span><b class="price">${money(q.amount)}</b>${btn('Take loan', 'startupLoan', { k: x.kind }, 'primary sm', q.ok ? undefined : q.reason)}</div>`; }).join('')}</div>`;
}

/** Electric service and fiber for a new site. */
export function hookupCard(app: App, f: Facility): string {
  const s = app.s;
  if (hookupsDone(f) || !f.hookups) return '';
  const row = (kind: 'power' | 'net', icon: string, title: string, body: string) => {
    const cur = f.hookups![kind], q = hookupQuote(s, f, kind);
    return `<div class="list-row static"><span class="flag">${cur === 0 ? '✅' : icon}</span><span class="grow"><b>${title}</b><small>${cur === 0 ? 'Connected' : cur > 0 ? `Crew on site · ${duration(cur / Math.max(1, s.speed))} left` : body}</small></span>${cur === -1 ? btn(`Order · ${money(q.cost)}`, 'hookup', { id: f.id, k: kind }, 'primary sm', q.ok ? undefined : q.reason) : ''}</div>`;
  };
  return `<div class="card hookup-card"><h3>🔌 Connect this site</h3><p class="small muted">The building is finished, but it can't earn anything until the utility and a fiber carrier have connected it. ${cityById(f.cityId).name} crews take about ${duration(hookupQuote(s, f, 'power').seconds)}.</p>
    ${row('power', '⚡', 'Electric service', `Utility connection, ${f.basePower} kW`)}
    ${row('net', '🌐', 'Internet connection', 'Fiber drop and cross-connect')}</div>`;
}

export function renderLocked(app: App, g: GoalDef, pageTitle: string): string {
  return `<div class="card locked-page">${empty('🔒', `${pageTitle} isn't open yet`, `Unlocked by <b>${esc(g.title)}</b>.`)}${goalCard(app, g)}
    <div class="row center-x mt"><button class="btn primary" data-act="nav" data-page="progress">View Company Progress</button></div></div>`;
}

export function renderProgress(app: App): string {
  const s = app.s, d = app.d;
  const stage = STAGES[s.career.stage], nextStage = STAGES[s.career.stage + 1];
  const legacy = !isCareer(s);
  const next = nextGoals(s, d, 3);
  const doneCount = Object.keys(s.career.done).length;
  const endless = endlessGoal(s);
  const list = (i: number) => GOALS.filter((g) => g.stage === i);
  const rows = STAGES.map((st, i) => {
    const goals = list(i);
    const done = goals.filter((g) => s.career.done[g.id] !== undefined).length;
    const future = i > s.career.stage;
    return `<details class="stage-group" ${i === s.career.stage ? 'open' : ''}><summary>${st.icon} <b>${st.name}</b><small class="muted">${done}/${goals.length}</small></summary>
      <div class="goal-rows">${goals.map((g) => {
        const isDone = s.career.done[g.id] !== undefined;
        const frac = isDone ? 1 : goalProgress(s, d, g).frac;
        return `<div class="goal-row ${isDone ? 'done' : future ? 'future' : ''}"><span class="gr-ic">${isDone ? '✅' : g.icon}</span><span class="grow"><b>${esc(g.title)}</b><small>${esc(g.opens.length ? `Opens: ${g.opens.join(', ')}` : g.desc)}</small></span>${isDone ? '<span class="tag ok sm">Done</span>' : `<span class="gr-pct">${Math.round(frac * 100)}%</span>`}</div>`;
      }).join('')}</div></details>`;
  }).join('');
  const unlockedChips = GOALS.filter((g) => g.opens.length && s.career.done[g.id] !== undefined).flatMap((g) => g.opens);
  const comingChips = GOALS.filter((g) => g.opens.length && s.career.done[g.id] === undefined && g.stage > s.career.stage).flatMap((g) => g.opens).slice(0, 8);
  return `
  <div class="card stage-hero">
    <div class="row between wrap gap"><div><small class="eyebrow">Company stage ${s.career.stage + 1} of ${STAGES.length}</small><h2>${stage.icon} ${stage.name}</h2><p class="muted">${esc(stage.blurb)}</p></div>
    <div class="stage-stats"><div><label>Goals reached</label><b>${doneCount} / ${GOALS.length}</b></div><div><label>Company value</label><b>${money(d.totals.valuation)}</b></div><div><label>Level</label><b>${s.level}</b></div></div></div>
    ${stageTrack(app)}
    ${legacy ? '<p class="small muted mt">This company was founded before staged progression arrived, so everything stays unlocked and its economy is unchanged. Start a new company to play the full climb from a rented garage.</p>' : nextStage ? `<div class="stage-perks"><span>Next stage, <b>${nextStage.name}</b>:</span><span>Market rates <b class="pos">+${Math.round((nextStage.revenue / stage.revenue - 1) * 100)}%</b></span><span>Cost to staff a site <b class="pos">−${Math.round((1 - nextStage.overhead / stage.overhead) * 100)}%</b></span>${nextStage.credit > stage.credit ? `<span>Bank credit <b class="pos">${Math.round(stage.credit * 100)}% → ${Math.round(nextStage.credit * 100)}%</b></span>` : ''}</div>` : ''}
  </div>
  ${founderDesk(app)}
  ${loanCards(app)}
  <div class="card mt"><h3>🎯 What to do next</h3>
    ${next.length ? `<div class="goal-grid">${next.map((g) => goalCard(app, g)).join('')}</div>` : `<div class="goal-card"><div class="goal-ic">💎</div><div class="grow"><b>Build a ${money(endless.target)} company</b><p class="small muted">Every goal on the board is done, and the empire can always get bigger.</p>${bar(d.totals.valuation / endless.target)}</div></div>`}
  </div>
  <div class="grid2 mt">
    <div class="card"><h3>🔓 Unlocked so far</h3>${unlockedChips.length ? `<div class="chip-list">${unlockedChips.map((x) => `<span class="chip ok">${esc(x)}</span>`).join('')}</div>` : '<p class="small muted">Nothing yet. Your first unlock comes with your first property.</p>'}</div>
    <div class="card"><h3>🔭 Coming up</h3>${comingChips.length ? `<div class="chip-list">${comingChips.map((x) => `<span class="chip">🔒 ${esc(x)}</span>`).join('')}</div>` : '<p class="small muted">You have reached the top stage. The goals below still have rewards, and value milestones never run out.</p>'}</div>
  </div>
  <div class="card mt"><h3>🗺️ The road to an empire</h3>${rows}</div>`;
}

export function progressActions(app: App) {
  return {
    startGig: (el: HTMLElement) => app.run(() => startGig(app.s, el.dataset.id!)),
    buyGarage: () => app.run(() => buyGarageServer(app.s)),
    startupLoan: (el: HTMLElement) => app.run(() => takeStartupLoan(app.s, el.dataset.k as 'construction' | 'equipment')),
    hookup: (el: HTMLElement) => app.run(() => orderHookup(app.s, el.dataset.id!, el.dataset.k as 'power' | 'net')),
  };
}
export function progressChanges(app: App) {
  return { autoGigs: (el: HTMLElement) => app.run(() => setAutoGigs(app.s, (el as HTMLInputElement).checked)) };
}
