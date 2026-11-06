// Research, Employees and Contracts pages.

import type { App } from '../app';
import { money, num, pct, esc, duration, gameDuration } from '../../core/format';
import { stat, empty, btn, bar, confirmDialog, openModal, closeModal , showToast } from '../components';
import { RESEARCH, researchById } from '../../config/research';
import { researchState, canResearch, startResearch, researchSpeed } from '../../systems/research';
import { hasFeature } from '../../systems/career';
import { DEPARTMENTS, CUSTOMER_TYPES, type Department } from '../../config/content';
import { hire, fire, promote, assign, autoAssignStaff, bulkAssign, hireCost, promoteCost, staffCap, refreshCandidates } from '../../systems/employees';
import { deptBonus } from '../../systems/modifiers';
import { HQ_TIERS } from '../../config/economy';
import { hqUpgradeQuote, upgradeHQ } from '../../systems/equipment';
import { CAP_LABEL } from '../../config/buildings';
import { cityById } from '../../config/world';
import { acceptOffer, declineOffer, eligibleFacilities, cancelContract, reassignContract } from '../../systems/contracts';

const CATS = ['AI Computing', 'Cooling', 'Electricity', 'Networking', 'Automation'] as const;
const CAT_ICON: Record<string, string> = { 'AI Computing': '🧠', Cooling: '❄️', Electricity: '⚡', Networking: '🌐', Automation: '🤖' };

export function renderResearch(app: App): string {
  const s = app.s;
  const a = s.research.active;
  const ar = a ? researchById(a.id) : null;
  const spd = researchSpeed(s);
  return `
  <div class="grid3">
    ${stat('Completed', `${s.research.done.length} / ${RESEARCH.length}`)}
    ${stat('Research speed', `×${spd.toFixed(2)}`, 'Hire Research Scientists to go faster')}
    ${stat('Active project', ar ? ar.name : 'None', ar && a ? `${pct(a.done / a.total)} · ${duration((a.total - a.done) / spd / s.speed)} left` : 'Pick a technology below')}
  </div>
  ${ar && a ? `<div class="card mt">${bar(a.done / a.total, 'big', `${ar.name} — ${pct(a.done / a.total, 1)}`)}</div>` : ''}
  <div class="tech-tree mt">
    ${CATS.map((cat) => `<div class="tech-col">
      <h3>${CAT_ICON[cat]} ${cat}</h3>
      ${RESEARCH.filter((r) => r.category === cat).sort((x, y) => x.tier - y.tier).map((r) => {
        const st = researchState(s, r);
        const c = canResearch(s, r.id);
        const prog = st === 'active' && a ? a.done / a.total : st === 'done' ? 1 : 0;
        return `<div class="tech ${st}">
          <div class="row between"><b>${esc(r.name)}</b><small>T${r.tier}</small></div>
          <p class="small">${esc(r.desc)}</p>
          ${r.unlocks ? `<p class="small pos">Unlocks: ${esc(r.unlocks)}</p>` : ''}
          <div class="small muted">${money(r.cost)} · ${duration(r.seconds)} · Lv ${r.level}${r.requires.length ? ` · needs ${r.requires.map((x) => researchById(x).name).join(', ')}` : ''}</div>
          ${st === 'done' ? '<div class="tech-done">✓ Researched</div>' : st === 'active' ? bar(prog, '', pct(prog)) : btn('Research', 'research', { id: r.id }, st === 'available' ? 'primary sm' : 'ghost sm', c.ok ? undefined : c.reason)}
        </div>`;
      }).join('<div class="tech-link"></div>')}
    </div>`).join('')}
  </div>`;
}

export function renderEmployees(app: App): string {
  const s = app.s;
  const cap = staffCap(s);
  const facs = Object.values(s.facilities).filter((f) => !f.isHQ);
  const tier = HQ_TIERS[s.company.hqTier];
  const hq = hqUpgradeQuote(s);
  const depts = Object.keys(DEPARTMENTS) as Department[];
  return `
  <div class="grid2">
    <div class="card hq-card">
      <div class="row between"><h3>🏢 Headquarters</h3><span class="tag">${tier.name}</span></div>
      <p class="small muted">${esc(tier.desc)}</p>
      ${bar(s.employees.length / cap, s.employees.length >= cap ? 'warn' : '', `${s.employees.length} / ${cap} staff`)}
      <div class="kv mt"><span>Salaries</span><b>${money(s.employees.reduce((a, e) => a + e.salary, 0))}/h</b><span>HQ upkeep</span><b>${money([0, 30, 140, 480, 1600][s.company.hqTier] ?? 0)}/h</b><span>Offline bonus</span><b>+${tier.offlineBonus}h</b></div>
      ${!s.company.hqFacility ? `<div class="callout mt small">Build your headquarters on a cleared property you own (open the lot on the World Map → <b>Build headquarters</b>). It unlocks HQ upgrades and appears on the world map.</div>` : ''}
      <div class="row gap mt">${hq.next ? btn(`Upgrade to ${hq.next.name} (${hq.next.staff} staff) · ${money(hq.cost)}`, 'upgradeHQ', {}, 'primary', hq.ok ? undefined : hq.reason) : '<span class="pos">Maximum HQ tier</span>'}</div>
    </div>
    <div class="card">
      <h3>Department bonuses</h3>
      <div class="dept-grid">${depts.map((d) => {
        const b = deptBonus(s, d);
        const n = s.employees.filter((e) => e.dept === d).length;
        return `<div class="dept"><span>${DEPARTMENTS[d].icon}</span><div><b>${DEPARTMENTS[d].label}</b><small>${n} staff · ${esc(DEPARTMENTS[d].desc)}</small>${bar(b / DEPARTMENTS[d].maxBonus, '', `+${pct(b)}`)}</div></div>`;
      }).join('')}</div>
    </div>
  </div>
  <div class="card mt">
    <div class="row between wrap gap"><h3>Staff (${s.employees.length})</h3>
      <div class="row gap wrap staff-tools">
        ${hasFeature(s, 'g_stage2') ? `<button class="btn primary sm" data-act="autoAssign" ${s.employees.length ? '' : 'disabled'}>⚡ Auto-assign everyone</button>
        <label class="check"><input type="checkbox" data-change="setting" data-k="autoAssignStaff" ${s.settings.autoAssignStaff ? 'checked' : ''}> Keep staff assigned automatically</label>` : '<small class="muted">🔒 Auto-assign unlocks with Established Company status</small>'}
      </div></div>
    <div class="row gap wrap mt small bulk-assign"><span class="muted">Move</span>
      <select data-change="bulkDept"><option value="all">everyone</option>${depts.map((x) => `<option value="${x}" ${app.ui.bulkDept === x ? 'selected' : ''}>${DEPARTMENTS[x].label}</option>`).join('')}</select>
      <span class="muted">to</span>
      <select data-change="bulkTo"><option value="hq">Headquarters</option>${facs.map((f) => `<option value="${f.id}" ${app.ui.bulkTo === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <button class="btn ghost sm" data-act="bulkMove">Move</button></div>
    <p class="small muted">On-site staff work twice as well at that site but barely help elsewhere; HQ staff help everywhere. Auto-assign works out the best split for you.</p>
    ${s.employees.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Department</th><th>Skill</th><th>Experience</th><th>Performance</th><th>Salary</th><th>Assignment</th><th></th></tr></thead><tbody>
    ${s.employees.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${DEPARTMENTS[e.dept].icon} ${DEPARTMENTS[e.dept].label}</td><td>${'★'.repeat(e.skill)}<span class="muted">${'☆'.repeat(5 - e.skill)}</span></td><td>${Math.round(e.exp)}h</td><td>${bar(e.perf / 100, e.perf < 50 ? 'bad' : '', Math.round(e.perf) + '%')}</td><td>${money(e.salary)}/h</td>
      <td><select data-change="assign" data-id="${e.id}"><option value="hq" ${e.assigned === 'hq' ? 'selected' : ''}>Headquarters</option>${facs.map((f) => `<option value="${f.id}" ${e.assigned === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></td>
      <td class="row gap">${btn(`Promote ${money(promoteCost(e))}`, 'promote', { id: e.id }, 'ghost sm', !hasFeature(s, 'g_staff') ? 'Promotions unlock with Talent Management' : e.skill >= 5 ? 'Max level' : e.exp < e.skill * 120 ? `Needs ${e.skill * 120}h experience` : s.cash < promoteCost(e) ? 'Not enough cash' : undefined)}<button class="btn danger sm" data-act="fire" data-id="${e.id}">Fire</button></td></tr>`).join('')}
    </tbody></table>` : empty('👥', 'No employees yet', 'Hire from the candidate pool below. Every department gives a real gameplay bonus.')}
  </div>
  <div class="card mt">
    <div class="row between"><h3>Candidates</h3><small class="muted">New candidates every game day · ${btn('Refresh pool $25K', 'refreshCands', {}, 'ghost sm', s.cash < 25000 ? 'Need $25K' : undefined)}</small></div>
    <div class="cand-grid">${s.candidates.map((c) => `<div class="cand">
      <div class="row between"><b>${esc(c.name)}</b><span>${'★'.repeat(c.skill)}</span></div>
      <small>${DEPARTMENTS[c.dept].icon} ${DEPARTMENTS[c.dept].label}</small>
      <div class="kv small"><span>Salary</span><b>${money(c.salary)}/h</b><span>Experience</span><b>${Math.round(c.exp)}h</b><span>Performance</span><b>${Math.round(c.perf)}%</b></div>
      ${btn(`Hire · ${money(hireCost(c))}`, 'hire', { id: c.id }, 'primary sm', s.employees.length >= cap ? 'HQ full — upgrade HQ' : s.cash < hireCost(c) ? 'Not enough cash' : undefined)}
    </div>`).join('')}</div>
  </div>`;
}

export function renderContracts(app: App): string {
  const s = app.s, d = app.d;
  const tab = app.ui.contractsTab;
  const active = s.contracts.active;
  const rev = active.reduce((a, c) => a + c.ratePerHour * c.fulfillment, 0);
  const tabs = `<div class="tabs"><button class="${tab === 'offers' ? 'on' : ''}" data-act="ctTab" data-v="offers">Offers (${s.contracts.offers.length})</button><button class="${tab === 'active' ? 'on' : ''}" data-act="ctTab" data-v="active">Active (${active.length})</button><button class="${tab === 'history' ? 'on' : ''}" data-act="ctTab" data-v="history">History</button></div>`;
  let body = '';
  if (tab === 'offers') {
    body = s.contracts.offers.length ? `<div class="offer-grid">${s.contracts.offers.map((o) => {
      const el = eligibleFacilities(s, o, d);
      const ok = el.filter((x) => x.ok);
      return `<div class="card offer">
        <div class="row between"><h3>${esc(o.customer)}</h3><span class="tag">${CUSTOMER_TYPES[o.ctype].label}</span></div>
        <p class="small muted">${esc(o.label)}${o.cityPref ? ` · must be hosted in <b>${cityById(o.cityPref).name}</b>` : ''}</p>
        <div class="kv">
          <span>Required capacity</span><b style="color:${CAP_LABEL[o.cap].color}">${num(o.amount)} ${CAP_LABEL[o.cap].unit} ${CAP_LABEL[o.cap].name}</b>
          <span>Revenue</span><b class="pos">${money(o.ratePerHour)}/h</b>
          <span>Contract length</span><b>${Math.round(o.hours / 24)} days (${money(o.ratePerHour * o.hours)} total)</b>
          <span>Service level</span><b>${pct(o.sla)} uptime${o.security ? ` · security tier ${o.security}` : ''}</b>
          ${o.bonus ? `<span>Signing bonus</span><b class="pos">${money(o.bonus)}</b>` : ''}
          <span>Offer expires</span><b>${gameDuration((o.expiresAt ?? 0) - s.gameHours)}</b>
        </div>
        ${ok.length ? `<div class="row gap mt wrap"><select data-change="noop" id="fac-${o.id}">${ok.map((x) => `<option value="${x.f.id}">${esc(x.f.name)} — ${num(x.st.free[o.cap])} free</option>`).join('')}</select>
          <button class="btn primary" data-act="acceptOffer" data-id="${o.id}">Sign contract</button></div>`
        : `<div class="callout small mt">No facility can host this yet: ${esc(el[0]?.reason ?? 'build a data center first')}.</div>`}
        <button class="link sm" data-act="declineOffer" data-id="${o.id}">Decline</button>
      </div>`;
    }).join('')}</div>` : empty('📭', 'No open offers', 'New customers reach out regularly. Sales reps and networking research bring more offers.');
  } else if (tab === 'active') {
    const facs = Object.values(s.facilities).filter((f) => !f.isHQ);
    body = active.length ? `<table class="tbl"><thead><tr><th>Customer</th><th>Type</th><th>Capacity</th><th>Revenue/h</th><th>Facility</th><th>Fulfillment</th><th>Progress</th><th></th></tr></thead><tbody>
      ${active.map((c) => `<tr><td><b>${esc(c.customer)}</b><br><small class="muted">${CUSTOMER_TYPES[c.ctype].label}</small></td><td>${esc(c.label)}</td><td>${num(c.amount)} ${CAP_LABEL[c.cap].unit}</td><td>${money(c.ratePerHour)}</td>
        <td><select data-change="reassign" data-id="${c.id}">${facs.map((f) => `<option value="${f.id}" ${c.facilityId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></td>
        <td class="${c.fulfillment + 1e-6 < c.sla ? 'neg' : 'pos'}">${pct(c.fulfillment)}${c.breachHours > 0 ? `<br><small class="neg">SLA breach ${Math.round(c.breachHours)}h/36h</small>` : ''}</td>
        <td>${bar(1 - c.hoursLeft / c.hours, '', `${Math.ceil(c.hoursLeft / 24)}d left`)}<small class="muted">earned ${money(c.earned)}</small></td>
        <td><button class="btn danger sm" data-act="cancelContract" data-id="${c.id}">Terminate</button></td></tr>`).join('')}</tbody></table>` : empty('📄', 'No active contracts', 'Sign offers to earn premium rates on your capacity.');
  } else {
    body = s.contracts.history.length ? `<table class="tbl"><thead><tr><th>Customer</th><th>Type</th><th>Status</th><th>Earned</th></tr></thead><tbody>${s.contracts.history.slice(0, 50).map((c) => `<tr><td>${esc(c.customer)}</td><td>${esc(c.label)}</td><td><span class="tag ${c.status === 'completed' ? 'ok' : 'bad'}">${c.status}</span></td><td>${money(c.earned)}</td></tr>`).join('')}</tbody></table>` : empty('🗂️', 'No history yet', 'Completed and cancelled contracts appear here.');
  }
  return `
  <div class="grid4">
    ${stat('Active contracts', `${active.length}`)}
    ${stat('Contract revenue/h', money(rev))}
    ${stat('Spot market revenue/h', money(Object.values(d.fac).reduce((a, f) => a + f.revenue.spot, 0)))}
    ${stat('Reputation', `${Math.round(s.company.reputation)}/100`, 'Affects contract rates')}
  </div>
  <div class="card mt"><div class="row between wrap gap">${tabs}<label class="set-inline small">Alerts <select data-change="setting" data-k="contractAlerts"><option value="all" ${(s.settings.contractAlerts ?? 'all') === 'all' ? 'selected' : ''}>All</option><option value="problems" ${s.settings.contractAlerts === 'problems' ? 'selected' : ''}>Problems only</option><option value="off" ${s.settings.contractAlerts === 'off' ? 'selected' : ''}>Off</option></select></label><label class="check auto-toggle"><input type="checkbox" data-change="setting" data-k="autoContracts" ${s.settings.autoContracts ? 'checked' : ''}> <b>Auto-sign contracts</b> <span class="muted">— accept every offer that fits a facility</span></label></div>${body}</div>`;
}

export function businessActions(app: App) {
  const staffActions = {
    autoAssign: () => {
      const n = autoAssignStaff(app.s);
      showToast({ title: n ? `Reassigned ${n} staff` : 'Staff already well placed', body: n ? 'Everyone is now where they help most.' : undefined, kind: 'good', icon: '👥' });
      app.render();
    },
    bulkMove: () => {
      const n = bulkAssign(app.s, app.ui.bulkDept ?? 'all', app.ui.bulkTo ?? 'hq');
      showToast({ title: `Moved ${n} staff`, kind: 'good', icon: '👥' });
      app.render();
    },
  };
  return {
    research: (el: HTMLElement) => app.run(() => startResearch(app.s, el.dataset.id!)),
    ...staffActions,
    hire: (el: HTMLElement) => app.run(() => hire(app.s, el.dataset.id!)),
    fire: (el: HTMLElement) => {
      const e = app.s.employees.find((x) => x.id === el.dataset.id);
      if (!e) return;
      confirmDialog('Fire employee?', `Let <b>${esc(e.name)}</b> go? Severance will be paid.`, 'Fire', () => app.run(() => fire(app.s, e.id)), true);
    },
    promote: (el: HTMLElement) => app.run(() => promote(app.s, el.dataset.id!)),
    refreshCands: () => app.run(() => {
      if (app.s.cash < 25000) return { ok: false, reason: 'Need $25K' };
      app.s.cash -= 25000;
      app.s.finance.ledger.unshift({ t: app.s.gameHours, amount: -25000, cat: 'Recruiting', desc: 'Headhunter fee' });
      refreshCandidates(app.s);
      return { ok: true };
    }),
    upgradeHQ: () => app.run(() => upgradeHQ(app.s)),
    ctTab: (el: HTMLElement) => { app.ui.contractsTab = el.dataset.v; app.render(); },
    acceptOffer: (el: HTMLElement) => {
      const sel = document.getElementById(`fac-${el.dataset.id}`) as HTMLSelectElement | null;
      app.run(() => acceptOffer(app.s, el.dataset.id!, sel?.value ?? ''));
    },
    declineOffer: (el: HTMLElement) => app.run(() => declineOffer(app.s, el.dataset.id!)),
    cancelContract: (el: HTMLElement) => {
      const c = app.s.contracts.active.find((x) => x.id === el.dataset.id);
      if (!c) return;
      confirmDialog('Terminate contract?', `End the contract with <b>${esc(c.customer)}</b> early? You pay a ${money(c.ratePerHour * 24)} termination fee and lose reputation.`, 'Terminate', () => app.run(() => cancelContract(app.s, c.id)), true);
    },
  };
}

export function businessChanges(app: App) {
  return {
    bulkDept: (el: HTMLElement) => { app.ui.bulkDept = (el as HTMLSelectElement).value; },
    bulkTo: (el: HTMLElement) => { app.ui.bulkTo = (el as HTMLSelectElement).value; },
    assign: (el: HTMLElement) => { assign(app.s, el.dataset.id!, (el as HTMLSelectElement).value); app.render(); },
    reassign: (el: HTMLElement) => app.run(() => reassignContract(app.s, el.dataset.id!, (el as HTMLSelectElement).value)),
    noop: () => {},
  };
}

export { openModal, closeModal };
