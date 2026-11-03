// Finances, Competitors, Achievements and Settings pages.

import type { App } from '../app';
import type { Report } from '../../core/state';
import { money, num, pct, esc, gameDate } from '../../core/format';
import { stat, empty, btn, bar, confirmDialog, openModal, closeModal } from '../components';
import { chart } from '../charts';
import { loanLimit, takeLoan, repayLoan, offlineCap } from '../../systems/sim';
import { cityById } from '../../config/world';
import { blueprintById } from '../../config/buildings';
import { ACHIEVEMENTS, METRICS, currentStory, missionProgress, claimMission, STORY } from '../../systems/progression';
import { COMPANY_COLORS, COMPANY_LOGOS } from '../../config/content';
import { applyMode, deviceMode, type DeviceMode } from '../../core/device';
import { acquireCompetitor, acquisitionQuote } from '../../systems/competitors';
import { exportSave, importSaveFile, deleteSaves, saveGame } from '../../save/save';

const START = Date.UTC(2027, 0, 1, 8);
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const REV_COLORS: Record<string, string> = { Contracts: '#22c55e', 'Spot Market': '#06b6d4', 'Contract Bonus': '#a3e635', Rewards: '#facc15', 'Property Sale': '#f97316', 'Equipment Sale': '#fb923c', 'Asset Sale': '#fdba74' };
const EXP_COLORS = ['#ef4444', '#f97316', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#6366f1', '#64748b', '#84cc16', '#f43f5e', '#0ea5e9'];

function reportTable(rows: Report[], label: (r: Report) => string): string {
  if (!rows.length) return '<p class="muted">No completed periods yet.</p>';
  return `<table class="tbl"><thead><tr><th>Period</th><th>Revenue</th><th>Expenses</th><th>Operating profit</th><th>Capital spending</th></tr></thead><tbody>
    ${rows.slice().reverse().slice(0, 30).map((r) => {
      const rv = sum(r.revenue), ex = sum(r.expenses);
      return `<tr><td>${label(r)}</td><td class="pos">${money(rv)}</td><td class="neg">${money(ex)}</td><td class="${rv - ex >= 0 ? 'pos' : 'neg'}">${money(rv - ex)}</td><td>${money(r.capex)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

export function renderFinances(app: App): string {
  const s = app.s, d = app.d, f = s.finance;
  const tab = app.ui.financeTab as 'hourly' | 'daily' | 'monthly';
  const rows = tab === 'hourly' ? f.hourly.slice(-48) : tab === 'daily' ? f.daily.slice(-60) : f.monthly;
  const lbl = (r: Report) => (tab === 'hourly' ? gameDate(START, r.t) : tab === 'daily' ? gameDate(START, r.t, false) : `Month of ${gameDate(START, r.t, false)}`);
  const cats = new Set<string>();
  const ecats = new Set<string>();
  rows.forEach((r) => { Object.keys(r.revenue).forEach((k) => cats.add(k)); Object.keys(r.expenses).forEach((k) => ecats.add(k)); });
  const limit = loanLimit(s, d);
  const cur = f.cur.day;
  return `
  <div class="grid4">
    ${stat('Cash', money(s.cash, 2))}
    ${stat('Revenue / hour', money(d.totals.revenueHr))}
    ${stat('Expenses / hour', money(d.totals.expenseHr))}
    ${stat('Company valuation', money(d.totals.valuation), `Land ${money(d.totals.landValue)} · Buildings ${money(d.totals.buildingValue)} · Equipment ${money(d.totals.equipmentValue)}`)}
  </div>
  <div class="grid2 mt">
    <div class="card">
      <h3>Today so far</h3>
      <div class="grid2"><div><h4 class="sect">Revenue</h4><div class="kv">${Object.entries(cur.revenue).map(([k, v]) => `<span>${k}</span><b class="pos">${money(v)}</b>`).join('') || '<span class="muted">—</span>'}</div></div>
      <div><h4 class="sect">Expenses</h4><div class="kv">${Object.entries(cur.expenses).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${k}</span><b class="neg">${money(v)}</b>`).join('') || '<span class="muted">—</span>'}</div></div></div>
      <p class="small muted mt">Capital spending today: ${money(cur.capex)} · Lifetime revenue ${money(f.totalRevenue)} · expenses ${money(f.totalExpenses)} · capex ${money(f.totalCapex)}</p>
    </div>
    <div class="card">
      <h3>Bank & loans</h3>
      <div class="kv"><span>Outstanding debt</span><b class="${s.debt ? 'neg' : ''}">${money(s.debt)}</b><span>Interest</span><b>${money(d.totals.interestHr)}/h (≈${(0.11 * 30).toFixed(1)}%/month)</b><span>Available credit</span><b>${money(limit)}</b></div>
      <div class="row gap wrap mt">
        ${[0.25, 0.5, 1].map((k) => btn(`Borrow ${money(Math.round((limit * k) / 10000) * 10000)}`, 'loan', { v: Math.round((limit * k) / 10000) * 10000 }, 'ghost sm', limit < 10000 ? 'No credit available' : undefined)).join('')}
        ${btn(`Repay ${money(Math.min(s.debt, s.cash))}`, 'repay', { v: Math.min(s.debt, s.cash) }, 'primary sm', s.debt <= 0 ? 'No debt' : s.cash <= 0 ? 'No cash' : undefined)}
      </div>
      <p class="small muted mt">Credit limit is 35% of company valuation. Leverage carefully — interest is charged every hour.</p>
    </div>
  </div>
  <div class="card mt">
    <div class="row between wrap"><h3>Financial reports</h3><div class="tabs">${(['hourly', 'daily', 'monthly'] as const).map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="finTab" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
    <div class="grid2">
      <div>${rows.length > 1 ? chart(`fin-rev-${tab}`, { type: 'bar', stacked: true, money: true, height: 240, labels: rows.map((r) => lbl(r).split('·')[0]), datasets: [...cats].map((c) => ({ label: c, data: rows.map((r) => r.revenue[c] ?? 0), color: REV_COLORS[c] ?? '#22c55e', stack: 'r' })) }) : empty('📊', 'Not enough data', 'Reports build up as game time passes.')}<p class="small center muted">Revenue by source</p></div>
      <div>${rows.length > 1 ? chart(`fin-exp-${tab}`, { type: 'bar', stacked: true, money: true, height: 240, labels: rows.map((r) => lbl(r).split('·')[0]), datasets: [...ecats].map((c, i) => ({ label: c, data: rows.map((r) => r.expenses[c] ?? 0), color: EXP_COLORS[i % EXP_COLORS.length], stack: 'e' })) }) : ''}<p class="small center muted">Expenses by category</p></div>
    </div>
    ${reportTable(rows, lbl)}
  </div>
  <div class="grid2 mt">
    <div class="card"><h3>Company valuation</h3>${f.valuationHistory.length > 1 ? chart('fin-val', { type: 'line', money: true, height: 220, labels: f.valuationHistory.map((_, i) => `Day ${i + 1}`), datasets: [{ label: 'Valuation', data: f.valuationHistory, color: '#60a5fa', fill: true }] }) : empty('📈', 'Tracking started', 'Valuation is recorded every game day.')}</div>
    <div class="card"><h3>Transaction history</h3><div class="tx-list">${f.ledger.slice(0, 60).map((t) => `<div class="tx"><small>${gameDate(START, t.t)}</small><span>${esc(t.desc)}</span><em>${esc(t.cat)}</em><b class="${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${money(t.amount)}</b></div>`).join('') || '<p class="muted">No transactions yet.</p>'}</div></div>
  </div>`;
}

export function renderCompetitors(app: App): string {
  const s = app.s, d = app.d;
  const me = { id: 'player', name: s.company.name, color: s.company.color, logo: s.company.logo, valuation: d.totals.valuation, revenueHr: d.totals.revenueHr, expenseHr: d.totals.expenseHr, sites: Object.values(s.facilities).filter((f) => !f.isHQ).length, cities: d.totals.cities, tech: s.research.done.length, cu: d.totals.cu };
  const rows = [me, ...s.competitors.map((c) => ({ id: c.id, name: c.name, color: c.color, logo: c.logo, valuation: c.valuation, revenueHr: c.revenueHr, expenseHr: c.expenseHr, sites: c.sites.filter((x) => x.stage === 'operational').length, cities: new Set(c.sites.map((x) => x.cityId)).size, tech: c.techLevel, cu: c.sites.reduce((a, x) => a + (x.stage === 'operational' ? x.cu : 0), 0) }))].sort((a, b) => b.valuation - a.valuation);
  const sel = app.ui.compId ? s.competitors.find((c) => c.id === app.ui.compId) : null;
  const days = Math.max(...s.competitors.map((c) => c.history.length), s.finance.valuationHistory.length);
  const labels = Array.from({ length: Math.min(60, days) }, (_, i) => `D${Math.max(1, days - Math.min(60, days) + i + 1)}`);
  const tail = (arr: number[]) => { const a = arr.slice(-labels.length); return [...new Array(labels.length - a.length).fill(null), ...a]; };
  return `
  <div class="card">
    <h3>Industry leaderboard</h3>
    <table class="tbl"><thead><tr><th>#</th><th>Company</th><th>Valuation</th><th>Revenue/h</th><th>Profit/h</th><th>Facilities</th><th>Cities</th><th>Compute (CU)</th><th>Tech</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.id === 'player' ? 'me' : ''}"><td>${i + 1}</td><td><span class="logo-dot" style="background:${r.color}">${esc(r.logo)}</span> <b>${esc(r.name)}</b>${r.id === 'player' ? ' <span class="tag ok sm">You</span>' : ''}</td><td>${money(r.valuation)}</td><td>${money(r.revenueHr)}</td><td class="${r.revenueHr - r.expenseHr >= 0 ? 'pos' : 'neg'}">${money(r.revenueHr - r.expenseHr)}</td><td>${r.sites}</td><td>${r.cities}</td><td>${num(r.cu)}</td><td>${r.id === 'player' ? `${r.tech} researched` : `Level ${r.tech}`}</td><td class="row gap">${r.id !== 'player' ? `<button class="btn ghost sm" data-act="compSel" data-id="${r.id}">Inspect</button>${(() => { const q = acquisitionQuote(s, r.id); return btn('🤝 Buy', 'buyComp', { id: r.id }, 'primary sm', q.ok ? undefined : q.reason); })()}` : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="card mt"><h3>Valuation over time</h3>${labels.length > 1 ? chart('comp-val', { type: 'line', money: true, height: 260, labels, datasets: [{ label: s.company.name, data: tail(s.finance.valuationHistory) as number[], color: s.company.color }, ...s.competitors.map((c) => ({ label: c.name, data: tail(c.history) as number[], color: c.color, dashed: true }))] }) : empty('📈', 'Gathering data', 'History is recorded every game day.')}</div>
  ${sel ? `<div class="card mt comp-detail" style="border-color:${sel.color}">
    <div class="row between"><h2><span class="logo-dot lg" style="background:${sel.color}">${esc(sel.logo)}</span> ${esc(sel.name)}</h2><button class="btn ghost sm" data-act="compSel" data-id="">Close</button></div>
    <p class="muted">${esc(sel.desc)} Strategy: <b>${sel.personality}</b> · Aggression ${sel.aggression.toFixed(1)} · Profit focus ${sel.profitFocus.toFixed(1)} · Tech focus ${sel.techFocus.toFixed(1)} · Frugality ${sel.frugality.toFixed(1)}</p>
    <div class="grid6 mini-stats"><div><label>Valuation</label><b>${money(sel.valuation)}</b></div><div><label>Cash</label><b>${money(sel.cash)}</b></div><div><label>Revenue/h</label><b>${money(sel.revenueHr)}</b></div><div><label>Expenses/h</label><b>${money(sel.expenseHr)}</b></div><div><label>Tech level</label><b>${sel.techLevel}</b></div><div><label>Deals won</label><b>${sel.contractsWon}</b></div></div>
    <p class="small"><b>Latest move:</b> ${esc(sel.lastAction)}</p>
    ${(() => { const q = acquisitionQuote(s, sel.id); return `<div class="callout acquire"><div><b>Buy ${esc(sel.name)} for ${money(q.price)}</b><br><small>The price is their valuation. You get their ${q.lots} properties, ${q.facilities} running data centers (hardware included) and ${money(q.cashAcquired)} in cash. Half-finished projects are written off, and they leave the market for good.</small></div>${btn('🤝 Buy company', 'buyComp', { id: sel.id }, 'primary', q.ok ? undefined : q.reason)}</div>`; })()}
    <table class="tbl"><thead><tr><th>Site</th><th>City</th><th>Facility</th><th>Status</th><th>Capacity</th><th></th></tr></thead><tbody>
    ${sel.sites.map((x) => `<tr><td class="mono">${x.parcelId.toUpperCase()}</td><td>${cityById(x.cityId).name}</td><td>${blueprintById(x.blueprintId).name}</td><td>${x.stage === 'operational' ? '<span class="tag ok">Operational</span>' : `<span class="tag">${x.stage === 'demolish' ? 'Demolishing' : 'Building'} ${pct(x.progress / x.total)}</span>`}</td><td>${bar(x.maxCu ? x.cu / x.maxCu : 0, '', `${num(x.cu)} / ${num(x.maxCu)} CU`)}</td><td><button class="btn ghost sm" data-act="openParcel" data-id="${x.parcelId}">View</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
}

export function renderAchievements(app: App): string {
  const s = app.s, d = app.d;
  const tab = app.ui.achTab;
  const st = currentStory(s);
  const missions = `
    <div class="grid2">
      <div class="card">
        <h3>📖 Story missions <small class="muted">(${s.missions.tutorial}/${STORY.length})</small></h3>
        ${st ? (() => { const p = missionProgress(s, d, { ...st, base: 0 }); const v = METRICS[st.metric](s, d); return `<div class="mission ${p >= 1 ? 'ready' : ''}"><b>${esc(st.title)}</b><p>${esc(st.desc)}</p>${bar(p, '', `${num(Math.min(v, st.target))} / ${num(st.target)}`)}<div class="row between mt"><small>Reward: ${st.reward.cash ? money(st.reward.cash) : ''} ${st.reward.xp ? `+${st.reward.xp} XP` : ''}</small>${btn('Claim', 'claimStory', { id: st.id }, 'primary sm', p >= 1 ? undefined : 'Not complete')}</div></div>`; })() : '<p class="pos">All story missions complete!</p>'}
        <div class="story-list">${STORY.map((m, i) => `<span class="${i < s.missions.tutorial ? 'done' : i === s.missions.tutorial ? 'cur' : ''}">${i < s.missions.tutorial ? '✓' : i + 1}. ${esc(m.title)}</span>`).join('')}</div>
      </div>
      <div class="card">
        <h3>📅 Daily missions <small class="muted">reset at midnight</small></h3>
        ${s.missions.daily.items.map((m) => { const p = missionProgress(s, d, m); return `<div class="mission ${m.claimed ? 'claimed' : p >= 1 ? 'ready' : ''}"><b>${esc(m.title)}</b><p>${esc(m.desc)}</p>${bar(p, '', pct(p))}<div class="row between mt"><small>Reward: ${money(m.reward.cash ?? 0)} +${m.reward.xp} XP</small>${m.claimed ? '<span class="tag ok">Claimed</span>' : btn('Claim', 'claimDaily', { id: m.id }, 'primary sm', p >= 1 ? undefined : 'Not complete')}</div></div>`; }).join('')}
      </div>
    </div>`;
  const unlocked = Object.keys(s.achievements).length;
  const ach = `<div class="ach-grid">${ACHIEVEMENTS.map((a) => {
    const done = s.achievements[a.id] !== undefined;
    const v = METRICS[a.metric](s, d);
    return `<div class="ach ${done ? 'done' : ''}"><div class="ach-icon">${a.icon}</div><div><b>${esc(a.title)}</b><p>${esc(a.desc)}</p>${done ? `<small class="pos">Unlocked ${gameDate(START, s.achievements[a.id], false)}</small>` : bar(Math.min(1, v / a.target), 'sm')}<small class="muted">${[a.reward.cash ? money(a.reward.cash) : '', a.reward.xp ? `+${a.reward.xp} XP` : '', a.reward.permLabel ?? ''].filter(Boolean).join(' · ')}</small></div></div>`;
  }).join('')}</div>`;
  return `<div class="tabs"><button class="${tab === 'missions' ? 'on' : ''}" data-act="achTab" data-v="missions">Missions</button><button class="${tab === 'achievements' ? 'on' : ''}" data-act="achTab" data-v="achievements">Achievements (${unlocked}/${ACHIEVEMENTS.length})</button></div>
    <div class="mt">${tab === 'missions' ? missions : ach}</div>`;
}

export function renderSettings(app: App): string {
  const s = app.s, st = s.settings;
  const range = (k: string, label: string, min: number, max: number, stepv: number, v: number, fmt: (x: number) => string) => `<label class="set-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${stepv}" value="${v}" data-change="setting" data-k="${k}" data-live><b>${fmt(v)}</b></label>`;
  const check = (k: string, label: string, v: boolean, hint = '') => `<label class="set-row check"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-change="setting" data-k="${k}" ${v ? 'checked' : ''}></label>`;
  return `
  <div class="grid2">
    <div class="card">
      <h3>🏢 Company</h3>
      <label class="set-row"><span>Company name</span><input type="text" value="${esc(s.company.name)}" maxlength="28" data-change="coName"></label>
      <div class="set-row"><span>Logo</span><div class="logo-pick">${COMPANY_LOGOS.map((l) => `<button class="${s.company.logo === l ? 'on' : ''}" data-act="coLogo" data-v="${l}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><span>Company color</span><div class="color-pick">${COMPANY_COLORS.map((c) => `<button class="${s.company.color === c ? 'on' : ''}" style="background:${c}" data-act="coColor" data-v="${c}"></button>`).join('')}</div></div>
      <h3 class="mt">🎨 Graphics & performance</h3>
      <label class="set-row"><span>Graphics quality<small>City detail updates after a reload</small></span><select data-change="setting" data-k="graphics">${['low', 'medium', 'high'].map((g) => `<option value="${g}" ${st.graphics === g ? 'selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></label>
      <label class="set-row"><span>Time of day<small>Lighting for the 3D view & map</small></span><select data-change="setting" data-k="timeOfDay">${[['auto', 'Cinematic cycle'], ['day', 'Day'], ['sunset', 'Golden hour'], ['night', 'Night']].map(([v, l]) => `<option value="${v}" ${st.timeOfDay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${check('bloom', 'Glow effects', st.bloom, 'Neon accents, light halos, pulsing markers')}
      ${check('celebrations', 'Celebrations', st.celebrations !== false, 'Confetti on level-ups & achievements, income pops')}
      ${range('uiScale', 'UI scale', 0.8, 1.3, 0.05, st.uiScale, (x) => Math.round(x * 100) + '%')}
      ${check('reduceMotion', 'Reduce motion', st.reduceMotion, 'Fewer camera animations')}
      ${check('forceFallbackMap', 'Use offline map', st.forceFallbackMap, 'Skips MapLibre / online tiles (reload required)')}
      ${check('showFps', 'Show tick rate', st.showFps)}
      <label class="set-row"><span>Device mode<small>Layout, controls and graphics limits</small></span><select data-change="deviceMode"><option value="pc" ${deviceMode() === 'pc' ? 'selected' : ''}>🖥️ PC</option><option value="mobile" ${deviceMode() === 'mobile' ? 'selected' : ''}>📱 Mobile</option></select></label>
      <h3 class="mt">🎥 Camera</h3>
      ${range('cameraSensitivity', 'Camera sensitivity', 0.3, 2.5, 0.1, st.cameraSensitivity, (x) => x.toFixed(1) + '×')}
      ${check('invertZoom', 'Invert scroll zoom', st.invertZoom, 'Offline map & 3D view')}
    </div>
    <div class="card">
      <h3>🔊 Audio</h3>
      ${check('muted', 'Mute all', st.muted)}
      ${range('sfxVolume', 'Sound effects', 0, 1, 0.05, st.sfxVolume, (x) => Math.round(x * 100) + '%')}
      ${range('musicVolume', 'Ambient music', 0, 1, 0.05, st.musicVolume, (x) => Math.round(x * 100) + '%')}
      <h3 class="mt">😌 Comfort</h3>
      ${check('autoContracts', 'Auto-sign contracts', !!st.autoContracts, 'Accept every offer that fits a facility')}
      ${check('autoAssignStaff', 'Auto-assign staff', !!st.autoAssignStaff, 'New hires and new sites get staffed automatically')}
      <label class="set-row"><span>Contract notifications<small>Pop-ups, sounds and the menu badge</small></span><select data-change="setting" data-k="contractAlerts">${[['all', 'All'], ['problems', 'Problems only'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${(st.contractAlerts ?? 'all') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${check('autoLoan', 'Overdraft protection', st.autoLoan !== false, 'The bank covers shortfalls instead of letting cash go negative')}
      <p class="small muted">Tip: press <b>Space</b> or <b>⏸ Stop time</b> to freeze the economy while you plan — construction and research keep going.</p>
      <h3 class="mt">💾 Save management</h3>
      <label class="set-row"><span>Autosave interval</span><select data-change="setting" data-k="autosaveSeconds">${[10, 15, 30, 60].map((v) => `<option value="${v}" ${st.autosaveSeconds === v ? 'selected' : ''}>${v} seconds</option>`).join('')}</select></label>
      <p class="small muted">Saves go to IndexedDB with a localStorage backup. Offline progress cap: <b>${offlineCap(s).toFixed(0)} hours</b> (upgrade HQ / research automation to extend).</p>
      <div class="row gap wrap mt">
        <button class="btn primary" data-act="saveNow">Save now</button>
        <button class="btn ghost" data-act="loadSave">Load last save</button>
        <button class="btn ghost" data-act="exportSave">Export save file</button>
        <button class="btn ghost" data-act="importSave">Import save file</button>
      </div>
      <div class="row gap wrap mt">
        <button class="btn warn" data-act="newGame">New game</button>
        <button class="btn danger" data-act="resetGame">Reset & delete all saves</button>
      </div>
      <h3 class="mt">⌨️ Shortcuts</h3>
      <div class="kv small"><span>Pause / resume</span><b>Space</b><span>Game speed</span><b>1 · 2 · 3</b><span>World map</span><b>M</b><span>Back / close</span><b>Esc</b><span>Save</span><b>Ctrl+S</b></div>
      <h3 class="mt">ℹ️ About</h3>
      <p class="small muted">AI Data Center Empire <b>${(window as any).__GAME_VERSION__ ?? ''}</b> · Map: ${esc(app.map?.attribution ?? 'not loaded yet')} · 3D: ${app.pv ? (app.pv.kind === 'three' ? 'Three.js / WebGL' : 'Canvas fallback') : 'loads on first property view'}.</p>
    </div>
  </div>`;
}

export function companyActions(app: App) {
  return {
    buyComp: (el: HTMLElement) => {
      const id = el.dataset.id!;
      const c = app.s.competitors.find((x) => x.id === id);
      if (!c) return;
      const q = acquisitionQuote(app.s, id);
      confirmDialog(`Buy ${esc(c.name)}?`, `Pay <b>${money(q.price)}</b> (their valuation). You receive their ${q.lots} properties, ${q.facilities} data centers and ${money(q.cashAcquired)} of cash. This can't be undone.`, 'Buy company', () => {
        if (app.run(() => acquireCompetitor(app.s, id))) app.ui.compId = null;
      });
    },
    finTab: (el: HTMLElement) => { app.ui.financeTab = el.dataset.v; app.render(); },
    loan: (el: HTMLElement) => app.run(() => takeLoan(app.s, app.d, Number(el.dataset.v))),
    repay: (el: HTMLElement) => app.run(() => repayLoan(app.s, Number(el.dataset.v))),
    compSel: (el: HTMLElement) => { app.ui.compId = el.dataset.id || null; app.render(); },
    achTab: (el: HTMLElement) => { app.ui.achTab = el.dataset.v; app.render(); },
    claimStory: (el: HTMLElement) => app.run(() => claimMission(app.s, app.d, 'story', el.dataset.id!)),
    claimDaily: (el: HTMLElement) => app.run(() => claimMission(app.s, app.d, 'daily', el.dataset.id!)),
    coLogo: (el: HTMLElement) => { app.s.company.logo = el.dataset.v!; app.map?.requestRefresh(); app.render(); },
    coColor: (el: HTMLElement) => { app.s.company.color = el.dataset.v!; app.applySettings(); app.map?.requestRefresh(); app.render(); },
    exportSave: () => exportSave(app.s),
    importSave: async () => {
      const r = await importSaveFile();
      if (!r.state) return app.run(() => ({ ok: false, reason: r.error ?? 'Invalid save' }));
      await saveGame(r.state, 'auto');
      location.reload();
    },
    loadSave: () => confirmDialog('Load last save?', 'Unsaved progress since the last autosave will be lost.', 'Load', () => location.reload()),
    newGame: () => confirmDialog('Start a new game?', 'Your current company will be replaced. Export your save first if you want to keep it.', 'New game', async () => {
      await deleteSaves();
      (window as any).__skipUnloadSave = true;
      location.reload();
    }, true),
    resetGame: () => confirmDialog('Delete everything?', 'This permanently deletes all saves on this device.', 'Delete all', async () => {
      await deleteSaves();
      (window as any).__skipUnloadSave = true;
      location.reload();
    }, true),
  };
}

export function companyChanges(app: App) {
  return {
    deviceMode: (el: HTMLElement) => {
      applyMode((el as HTMLSelectElement).value as DeviceMode, true);
      void app.save(true).then(() => location.reload());
    },
    setting: (el: HTMLElement) => {
      const k = el.dataset.k! as keyof typeof app.s.settings;
      const inp = el as HTMLInputElement;
      const cur = app.s.settings[k];
      (app.s.settings as any)[k] = typeof cur === 'boolean' ? inp.checked : typeof cur === 'number' ? Number(inp.value) : inp.value;
      app.applySettings();
      app.render();
    },
    coName: (el: HTMLElement) => { const v = (el as HTMLInputElement).value.trim(); if (v) app.s.company.name = v.slice(0, 28); app.render(); },
  };
}

export { openModal, closeModal };
