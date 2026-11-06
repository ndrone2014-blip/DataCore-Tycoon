// Hidden Developer Tools dashboard inside Settings. Tap the version number under About five times
// to reveal it, then enter the password.

import type { App } from '../app';
import { esc, money, num, gameDate, duration } from '../../core/format';
import { confirmDialog, showToast } from '../components';
import { AUTOLOCK_CHOICES, autoLockMinutes, changePassword, checkAutoLock, isUnlocked, lock, lockoutLeft, restoreDefaultPassword, secondsToLock, setAutoLockMinutes, touch, unlock, usingDefaultPassword } from '../../core/devAuth';
import { clearDevLog, devLogEntries } from '../../core/devLog';
import { CITIES, COUNTRIES, cityById } from '../../config/world';
import { BLUEPRINTS } from '../../config/buildings';
import { EVENT_DEFS } from '../../config/content';
import { RESEARCH } from '../../config/research';
import { SUPPLIERS } from '../../config/expansion';
import { ACHIEVEMENTS, storyOf } from '../../systems/progression';
import { DECISIONS } from '../../systems/decisions';
import * as dev from '../../systems/devtools';
import { deleteBackup, deleteSaves, exportSave, importSaveFile, listBackups, readBackup, saveGame, serialize, writeBackup } from '../../save/save';
import { eventText } from '../../systems/events';

const TABS = [
  ['economy', '💰', 'Economy'], ['world', '🌍', 'World'], ['build', '🏗️', 'Construction'], ['progress', '⭐', 'Progression'], ['rivals', '🏢', 'Competitors'],
  ['time', '⏱️', 'Time'], ['events', '📣', 'Events'], ['saves', '💾', 'Saves'], ['debug', '🐞', 'Debugging'], ['password', '🔑', 'Password'],
] as const;
const REGIONS = ['North America', 'Europe', 'Asia', 'Oceania'];

let revealed = false, taps = 0, lastTap = 0, tab = 'economy', showPw = false, listening = false;

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
const numVal = (id: string) => { const v = val(id).replace(/[$,\s]/g, ''); return v === '' ? NaN : Number(v); };
const clear = (...ids: string[]) => { for (const id of ids) { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ''; } };

// Inputs keep what you typed across UI refreshes (data-keep), and are read when a button is pressed.
const input = (id: string, label: string, value = '', type = 'text', hint = '') => `<label class="dev-field"><span>${label}</span><input id="${id}" data-key="${id}" data-keep type="${type}" value="${esc(value)}" ${hint ? `placeholder="${esc(hint)}"` : ''} autocomplete="off" spellcheck="false"></label>`;
const pwInput = (id: string, label: string) => `<label class="dev-field"><span>${label}</span><input id="${id}" data-key="${id}" data-keep type="${showPw ? 'text' : 'password'}" autocomplete="new-password" spellcheck="false"></label>`;
const select = (id: string, label: string, opts: [string, string][], key = '') => `<label class="dev-field"><span>${label}</span><select id="${id}" data-key="${id}-${key}" data-keep>${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`;
const act = (label: string, name: string, attrs: Record<string, string | number> = {}, cls = 'ghost') => `<button class="btn ${cls} sm" data-act="${name}" ${Object.entries(attrs).map(([k, v]) => `data-${k}="${esc(String(v))}"`).join(' ')}>${label}</button>`;
const box = (title: string, body: string, wide = false) => `<div class="dev-box ${wide ? 'wide' : ''}"><h4>${title}</h4>${body}</div>`;
const cityOpts = (): [string, string][] => CITIES.map((c) => [c.id, c.name]);

export function renderDevTools(app: App): string {
  if (!revealed) return '';
  if (!isUnlocked()) return lockedView();
  const left = secondsToLock();
  return `<section class="dev-shell mt" id="dev-shell">
    <header class="dev-head">
      <div><span class="dev-badge">DEV</span><b>Developer Tools</b><small>Testing tools for this save. Changes apply immediately.</small></div>
      <div class="dev-head-r">
        <small class="${left < 30 ? 'neg' : 'muted'}">Auto-lock in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</small>
        ${act('🔒 Lock', 'devLock', {}, 'warn')}
      </div>
    </header>
    <nav class="dev-tabs">${TABS.map(([id, ic, l]) => `<button class="${tab === id ? 'on' : ''}" data-act="devTab" data-v="${id}"><span>${ic}</span>${l}</button>`).join('')}</nav>
    <div class="dev-body">${view(app)}</div>
  </section>`;
}

function lockedView(): string {
  const wait = lockoutLeft();
  return `<section class="dev-shell dev-locked mt" id="dev-shell">
    <div class="dev-lock-ic">🔒</div>
    <b>Developer Tools</b>
    <small class="muted">Enter your password to continue.</small>
    <div class="dev-lock-row">${pwInput('dev-pass', 'Password')}${act(showPw ? '🙈 Hide' : '👁️ Show', 'devShowPw')}</div>
    <button class="btn primary" data-act="devUnlock" ${wait ? `disabled title="Try again in ${Math.ceil(wait / 1000)} seconds"` : ''}>${wait ? `Locked for ${Math.ceil(wait / 1000)}s` : 'Unlock'}</button>
  </section>`;
}

function view(app: App): string {
  switch (tab) {
    case 'world': return worldView(app);
    case 'build': return buildView(app);
    case 'progress': return progressView(app);
    case 'rivals': return rivalsView(app);
    case 'time': return timeView(app);
    case 'events': return eventsView(app);
    case 'saves': return savesView(app);
    case 'debug': return debugView(app);
    case 'password': return passwordView();
    default: return economyView(app);
  }
}

function economyView(app: App): string {
  const s = app.s;
  const changed = dev.PRICE_KEYS.some(({ id }) => (s.dev?.[id] ?? 1) !== 1);
  return `<div class="dev-grid">
    ${box('Money', `<div class="kv small"><span>Cash</span><b>${money(s.cash, 2)}</b><span>Debt</span><b>${money(s.debt)}</b></div>
      ${input('dev-amt', 'Amount', '1000000', 'text')}
      <div class="dev-acts">${act('Add', 'devCash', { m: 1 }, 'primary')}${act('Remove', 'devCash', { m: -1 })}${act('Set cash to this', 'devSetCash')}${act('Clear debt', 'devClearDebt')}</div>
      <div class="dev-acts">${[1e6, 1e8, 1e9, 1e11].map((v) => act(`+${money(v)}`, 'devCashQuick', { v })).join('')}</div>`)}
    ${box('Prices', `<p class="small muted">Multipliers: 1 is normal, 0.5 is half price, 2 is double.</p>
      <div class="dev-fields">${dev.PRICE_KEYS.map(({ id, label }) => input(`dev-p-${id}`, label, String(s.dev?.[id] ?? 1))).join('')}</div>
      <div class="dev-acts">${act('Apply prices', 'devPrices', {}, 'primary')}${act('Back to normal', 'devPricesReset')}</div>
      ${changed ? '<p class="small neg">Custom prices are active on this save.</p>' : ''}`)}
  </div>`;
}

function worldView(app: App): string {
  const s = app.s;
  return `<div class="dev-grid">
    ${box('Markets', `<div class="kv small"><span>Cities unlocked</span><b>${s.unlockedCities.length} / ${CITIES.length}</b><span>Countries</span><b>${new Set(s.unlockedCities.map((c) => cityById(c).country)).size} / ${COUNTRIES.length}</b></div>
      <div class="dev-acts">${act('Unlock all countries and cities', 'devUnlockCities', {}, 'primary')}</div>`)}
    ${box('Blueprints and equipment', `<p class="small muted">Ignores level and research requirements for buildings, hardware and suppliers. A building still needs a lot big enough for it.</p>
      <div class="dev-acts">${s.dev?.unlockAll ? act('Turn off', 'devUnlockAll', { v: 0 }) : act('Unlock all', 'devUnlockAll', { v: 1 }, 'primary')}</div>${s.dev?.unlockAll ? '<p class="small pos">Everything is unlocked on this save.</p>' : ''}`)}
    ${box('Properties', `<p class="small muted">Gives you every lot nobody owns, for free. Rival land is left alone. Land tax still applies.</p>
      ${select('dev-prop-city', 'City', cityOpts())}
      <div class="dev-acts">${act('Give me this city', 'devGrantCity', {}, 'primary')}${act('Give me the whole world', 'devGrantAll')}</div>`)}
  </div>`;
}

function buildView(app: App): string {
  const s = app.s;
  const projects = Object.values(s.projects);
  const fac = Object.values(s.facilities);
  const rows = fac.slice(0, 40);
  return `<div class="dev-grid">
    ${box('Spawn a data center', `${select('dev-sp-city', 'City', cityOpts())}${select('dev-sp-bp', 'Building', BLUEPRINTS.map((b) => [b.id, b.name]))}${input('dev-sp-n', 'How many', '1')}
      <label class="dev-check"><input id="dev-sp-fill" data-key="dev-sp-fill" data-keep type="checkbox" checked> Fill with free hardware</label>
      <div class="dev-acts">${act('Spawn', 'devSpawn', {}, 'primary')}${act('Repair every building', 'devRepair')}</div>`)}
    ${box(`Construction in progress (${projects.length})`, `${projects.slice(0, 8).map((p) => `<div class="dev-row"><span>${p.kind === 'build' ? esc(p.draft?.name ?? 'Building') : 'Demolition'}<small class="muted"> ${esc(cityById(p.cityId).name)} · ${Math.round((p.doneSeconds / Math.max(1, p.totalSeconds)) * 100)}%</small></span>${act('Finish', 'devFinish', { id: p.id })}</div>`).join('') || '<p class="small muted">Nothing is being built.</p>'}
      <div class="dev-acts">${act('Finish everything now', 'devFinishAll', {}, 'primary')}</div>`)}
    ${box(`Data centers (${fac.length})`, `<div class="dev-list">${rows.map((f) => `<div class="dev-row"><span>${esc(f.name)}<small class="muted"> ${esc(cityById(f.cityId).name)}${f.isHQ ? ' · HQ' : ''}</small></span>${act('Remove', 'devRemoveFac', { id: f.id }, 'danger')}</div>`).join('') || '<p class="small muted">No data centers yet.</p>'}</div>${fac.length > rows.length ? `<small class="muted">Showing the first ${rows.length}.</small>` : ''}`, true)}
  </div>`;
}

function progressView(app: App): string {
  const s = app.s;
  return `<div class="dev-grid">
    ${box('Company', `<div class="kv small"><span>Level</span><b>${s.level}</b><span>XP</span><b>${num(s.xp)}</b><span>Reputation</span><b>${s.company.reputation.toFixed(1)}</b></div>
      <div class="dev-fields">${input('dev-level', 'Level (1 to 100)', String(s.level))}${input('dev-xp', 'XP to add', '5000')}${input('dev-rep', 'Reputation (0 to 100)', '90')}</div>
      <div class="dev-acts">${act('Set level', 'devLevel', {}, 'primary')}${act('Add XP', 'devXp')}${act('Set reputation', 'devRep')}</div>`)}
    ${box('Research', `<div class="kv small"><span>Finished</span><b>${s.research.done.length} / ${RESEARCH.length}</b></div><div class="dev-acts">${act('Unlock all research', 'devResearch', {}, 'primary')}${act('Reset research', 'devResearchReset', {}, 'danger')}</div>`)}
    ${box('Achievements and missions', `<div class="kv small"><span>Achievements</span><b>${Object.keys(s.achievements).length} / ${ACHIEVEMENTS.length}</b><span>Story missions</span><b>${s.missions.tutorial} / ${storyOf(s).length}</b></div>
      <div class="dev-acts">${act('Unlock all achievements', 'devAch', {}, 'primary')}${act('Finish story missions', 'devStory')}${act('Reset achievements', 'devAchReset', {}, 'danger')}</div>`)}
  </div>`;
}

function rivalsView(app: App): string {
  const s = app.s;
  return `<div class="dev-grid">
    ${box('Spawn a company', `<div class="dev-fields">${input('dev-c-name', 'Name', '', 'text', 'Company name')}${select('dev-c-type', 'Strategy', Object.entries(dev.RIVAL_TYPES).map(([k, v]) => [k, v.label]))}${input('dev-c-cash', 'Starting cash', '5000000')}${input('dev-c-sites', 'Data centers (0 to 10)', '2')}</div>
      <div class="dev-acts">${act('Spawn company', 'devSpawnRival', {}, 'primary')}</div>`)}
    ${box('Values to apply', `<p class="small muted">Set these, then press Apply on a company below. Blank fields are left alone.</p><div class="dev-fields">${input('dev-m-cash', 'Cash to add', '', 'text', 'e.g. 10000000 or -500000')}${input('dev-m-tech', 'Technology (0 to 8)', '')}${input('dev-m-agg', 'Aggression (0.1 to 5)', '')}</div>`)}
    ${box(`Companies (${s.competitors.length})`, `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Company</th><th>Cash</th><th>Valuation</th><th>Sites</th><th>Tech</th><th>Aggression</th><th></th></tr></thead><tbody>
      ${s.competitors.map((c) => `<tr><td><span class="logo-dot" style="background:${c.color}">${esc(c.logo)}</span> <b>${esc(c.name)}</b></td><td>${money(c.cash)}</td><td>${money(c.valuation)}</td><td>${c.sites.length}</td><td>${c.techLevel}</td><td>${c.aggression.toFixed(1)}</td><td class="row gap">${act('Apply', 'devRivalApply', { id: c.id })}${act('Remove', 'devRivalRemove', { id: c.id }, 'danger')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No rivals left.</td></tr>'}
      </tbody></table></div>`, true)}
  </div>`;
}

function timeView(app: App): string {
  const s = app.s;
  return `<div class="dev-grid">
    ${box('Clock', `<div class="kv small"><span>Game date</span><b>${gameDate(Date.UTC(2027, 0, 1, 8), s.gameHours)}</b><span>Game hours</span><b>${num(s.gameHours)}</b><span>Status</span><b>${s.paused ? 'Stopped' : `Running at ${s.speed}×`}</b></div>
      <div class="dev-acts">${act(s.paused ? '▶ Resume' : '⏸ Pause', 'pause', {}, 'primary')}</div>
      <div class="dev-acts">${dev.DEV_SPEEDS.map((v) => act(`${v}×`, 'devSpeed', { v }, !s.paused && s.speed === v ? 'primary' : 'ghost')).join('')}</div>
      <p class="small muted">Speeds above 4× last until you reload.</p>`)}
    ${box('Skip ahead', `<p class="small muted">Simulates the time for real: income, rivals, events and contracts all run.</p>
      <div class="dev-acts">${[[1, '1 hour'], [24, '1 day'], [168, '1 week'], [720, '30 days']].map(([v, l]) => act(`+${l}`, 'devSkip', { v })).join('')}</div>
      ${input('dev-skip', 'Custom hours (up to 8,760)', '48')}<div class="dev-acts">${act('Skip', 'devSkipCustom', {}, 'primary')}</div>`)}
  </div>`;
}

function placeOpts(defId: string): [string, string][] {
  const def = EVENT_DEFS.find((e) => e.id === defId)!;
  const any: [string, string] = ['', 'Random'];
  if (def.scope === 'city') return [any, ...cityOpts()];
  if (def.scope === 'region') return [any, ...REGIONS.map((r): [string, string] => [r, r])];
  if (def.scope === 'country') return [any, ...COUNTRIES.map((c): [string, string] => [c.id, c.name])];
  if (def.id === 'supply_crunch') return [any, ...SUPPLIERS.map((x): [string, string] => [x.id, x.name])];
  return [['', 'Worldwide']];
}
let eventPick = EVENT_DEFS[0].id;
function eventsView(app: App): string {
  const s = app.s;
  return `<div class="dev-grid">
    ${box('Trigger a world event', `<label class="dev-field"><span>Event</span><select data-change="devEventPick" data-key="dev-ev" data-keep>${EVENT_DEFS.map((e) => `<option value="${e.id}" ${e.id === eventPick ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
      ${select('dev-ev-place', 'Where', placeOpts(eventPick), eventPick)}
      <div class="dev-acts">${act('Trigger', 'devEvent', {}, 'primary')}${act('End all events', 'devEventsEnd')}</div>`)}
    ${box('Other triggers', `${select('dev-card', 'Opportunity card', DECISIONS.map((d) => [d.id, d.title]))}<div class="dev-acts">${act('Show card', 'devCard', {}, 'primary')}${act('New contract offer', 'devOffer')}</div>`)}
    ${box(`Active events (${s.events.length})`, s.events.map((e) => { const t = eventText(e.defId, e.cityId, e); return `<div class="dev-row"><span>${esc(t.title)}<small class="muted"> ${esc(t.desc)}</small></span><small class="muted">${duration(e.endsAt - s.gameHours)}</small></div>`; }).join('') || '<p class="small muted">Markets are calm.</p>', true)}
  </div>`;
}

function savesView(app: App): string {
  const backups = listBackups();
  void app;
  return `<div class="dev-grid">
    ${box('This game', `<div class="dev-acts">${act('Save now', 'saveNow', {}, 'primary')}${act('Export save file', 'exportSave')}${act('Import save file', 'devImport')}</div>`)}
    ${box('Backups', `<p class="small muted">Stored on this device, separate from your normal save. Resets don't touch them.</p>
      ${[1, 2, 3].map((n) => { const b = backups.find((x) => x.slot === n); return `<div class="dev-row"><span>Slot ${n}<small class="muted"> ${b ? `${esc(b.name)} · level ${b.level} · ${new Date(b.savedAt).toLocaleString()} · ${b.kb} KB` : 'Empty'}</small></span><span class="row gap">${act(b ? 'Overwrite' : 'Back up', 'devBackup', { n, used: b ? 1 : 0 })}${b ? act('Restore', 'devRestore', { n }, 'primary') + act('Delete', 'devBackupDel', { n }, 'danger') : ''}</span></div>`; }).join('')}`, true)}
    ${box('Reset', `<p class="small muted">Deletes your current save on this device and starts over. Back up first if you want to keep it.</p><div class="dev-acts">${act('Reset and delete saves', 'devReset', {}, 'danger')}</div>`)}
  </div>`;
}

function debugView(app: App): string {
  const s = app.s, d = app.d;
  const log = devLogEntries();
  const errs = log.filter((e) => e.level === 'error').length;
  const city = (window as any).__city?.view?.stats?.();
  const mem = (performance as any).memory;
  const stats: [string, string][] = [
    ['Version', String((window as any).__GAME_VERSION__ ?? 'dev')], ['Save format', `v${s.version}`], ['Session', duration(app.uptime)], ['Simulation ticks/s', String(app.tickRate)], ['UI refresh', `${app.renderMs.toFixed(1)} ms`],
    ['City FPS', city && (window as any).__city.view.visible ? `${city.fps} (${Math.round(city.scale * 100)}% resolution)` : 'Not showing'], ['Triangles drawn', city?.drawnTris ? num(city.drawnTris) : '—'], ['Memory', mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : 'Not available'],
    ['Facilities', String(Object.keys(s.facilities).length)], ['Parcels in save', String(Object.keys(s.parcels).length)], ['Projects', String(Object.keys(s.projects).length)], ['Employees', String(s.employees.length)],
    ['Contracts', `${s.contracts.active.length} active, ${s.contracts.offers.length} offers`], ['Rivals', `${s.competitors.length}, ${s.competitors.reduce((a, c) => a + c.sites.length, 0)} sites`], ['Fiber routes', String(s.fiber.routes.length)], ['Events', String(s.events.length)],
    ['Revenue/h', money(d.totals.revenueHr)], ['Expenses/h', money(d.totals.expenseHr)], ['Valuation', money(d.totals.valuation)],
  ];
  return `<div class="dev-grid">
    ${box('Game statistics', `<div class="kv small">${stats.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div><div class="dev-acts">${act('Copy report', 'devCopy')}</div>`)}
    ${box(`Errors and warnings (${errs} errors, ${log.length - errs} warnings)`, `<div class="dev-acts">${act('Clear', 'devLogClear')}${act('Log a test error', 'devLogTest')}</div><div class="dev-log">${log.slice().reverse().slice(0, 60).map((e) => `<div class="${e.level}"><small>${new Date(e.t).toLocaleTimeString()}${e.count > 1 ? ` · ×${e.count}` : ''}</small><code>${esc(e.msg)}</code></div>`).join('') || '<p class="small muted">Nothing logged. That\'s good.</p>'}</div>`, true)}
  </div>`;
}

function passwordView(): string {
  return `<div class="dev-grid">
    ${box('Change password', `<div class="dev-fields">${pwInput('dev-pw-cur', 'Current password')}${pwInput('dev-pw-new', 'New password')}${pwInput('dev-pw-conf', 'Confirm new password')}</div>
      <div class="dev-acts">${act('Save new password', 'devPwSave', {}, 'primary')}${act(showPw ? '🙈 Hide' : '👁️ Show', 'devShowPw')}</div>
      <p class="small muted">Currently using ${usingDefaultPassword() ? 'the default password' : 'your own password'}. It stays with this browser, across new games and reloads.</p>`)}
    ${box('Restore default', `<p class="small muted">Puts the password back to the original default.</p><div class="dev-acts">${act('Restore default password', 'devPwDefault', {}, 'danger')}</div>`)}
    ${box('Auto-lock', `<p class="small muted">Locks after this much inactivity. Developer Tools also lock when you reload.</p><div class="dev-acts">${AUTOLOCK_CHOICES.map((m) => act(`${m} min`, 'devAutoLock', { m }, autoLockMinutes() === m ? 'primary' : 'ghost')).join('')}</div>`)}
  </div>`;
}

// ---------- actions ----------
const say = (title: string, kind: 'good' | 'bad' = 'good') => showToast({ title, kind, icon: kind === 'good' ? '🛠️' : '⛔' });

export function devActions(app: App) {
  const s = () => app.s;
  const run = (fn: () => { ok: boolean; reason?: string } | void, msg?: string) => app.run(fn as any, msg);
  const leave = () => { (window as any).__skipUnloadSave = true; location.reload(); };
  return {
    devTap: () => {
      const now = Date.now();
      taps = now - lastTap < 1500 ? taps + 1 : 1;
      lastTap = now;
      if (taps < 5) return;
      taps = 0;
      revealed = !revealed;
      app.render();
      if (revealed) document.getElementById('dev-shell')?.scrollIntoView({ behavior: 'smooth' });
    },
    devShowPw: () => { showPw = !showPw; app.render(); },
    devUnlock: () => {
      const r = unlock(val('dev-pass'));
      if (!r.ok) { say(r.reason ?? 'Incorrect password', 'bad'); clear('dev-pass'); }
      else showPw = false;
      app.render();
    },
    devLock: () => { lock(); showPw = false; app.render(); },
    devTab: (el: HTMLElement) => { tab = el.dataset.v!; app.render(); },

    // economy
    devCash: (el: HTMLElement) => run(() => dev.adjustCash(s(), numVal('dev-amt') * Number(el.dataset.m)), 'Cash updated'),
    devSetCash: () => run(() => dev.setCash(s(), numVal('dev-amt')), 'Cash set'),
    devCashQuick: (el: HTMLElement) => run(() => dev.adjustCash(s(), Number(el.dataset.v))),
    devClearDebt: () => run(() => dev.clearDebt(s()), 'Debt cleared'),
    devPrices: () => run(() => dev.setPriceMults(s(), Object.fromEntries(dev.PRICE_KEYS.map(({ id }) => [id, numVal(`dev-p-${id}`)]))), 'Prices updated'),
    devPricesReset: () => { const r = dev.resetPrices(s()); for (const { id } of dev.PRICE_KEYS) { const el = document.getElementById(`dev-p-${id}`) as HTMLInputElement | null; if (el) el.value = '1'; } run(() => r, 'Prices back to normal'); },

    // world
    devUnlockCities: () => run(() => dev.unlockAllCities(s()), 'All markets unlocked'),
    devUnlockAll: (el: HTMLElement) => run(() => dev.setUnlockAll(s(), el.dataset.v === '1'), el.dataset.v === '1' ? 'Everything unlocked' : 'Requirements are back on'),
    devGrantCity: () => { const id = val('dev-prop-city'); confirmDialog(`Take all free land in ${esc(cityById(id).name)}?`, 'Every unowned lot becomes yours for free, and you pay land tax on all of it.', 'Take the land', () => run(() => dev.grantProperties(s(), id), 'Properties added')); },
    devGrantAll: () => confirmDialog('Take every free lot in the world?', 'That can add about 6,900 properties to this save, with land tax on all of them. It can make the game slower and the save larger.', 'Take everything', () => run(() => dev.grantProperties(s()), 'Properties added'), true),

    // construction
    devSpawn: () => {
      const n = Math.max(1, Math.min(50, Math.round(numVal('dev-sp-n') || 1)));
      const fill = (document.getElementById('dev-sp-fill') as HTMLInputElement | null)?.checked ?? true;
      run(() => { for (let i = 0; i < n; i++) { const r = dev.spawnFacility(s(), val('dev-sp-city'), val('dev-sp-bp'), fill); if (!r.ok) return i ? { ok: true } : r; } return { ok: true }; });
    },
    devRepair: () => run(() => dev.repairAll(s()), 'All buildings repaired'),
    devFinish: (el: HTMLElement) => run(() => dev.completeProject(s(), el.dataset.id!)),
    devFinishAll: () => run(() => dev.completeAllProjects(s())),
    devRemoveFac: (el: HTMLElement) => { const f = s().facilities[el.dataset.id!]; if (f) confirmDialog(`Remove ${esc(f.name)}?`, 'The building and its hardware are deleted with no refund. Its contracts lose their capacity, and the land stays yours.', 'Remove', () => run(() => dev.removeFacility(s(), f.id), 'Data center removed'), true); },

    // progression
    devLevel: () => { const v = numVal('dev-level'); if (v < s().level) confirmDialog(`Lower your level to ${Math.round(v)}?`, 'Your XP is reset to match. Things you already unlocked stay unlocked.', 'Set level', () => run(() => dev.setLevel(s(), v), 'Level set'), true); else run(() => dev.setLevel(s(), v), 'Level set'); },
    devXp: () => run(() => dev.grantXp(s(), numVal('dev-xp')), 'XP added'),
    devRep: () => run(() => dev.setReputation(s(), numVal('dev-rep')), 'Reputation set'),
    devResearch: () => run(() => dev.unlockAllResearch(s()), 'All research unlocked'),
    devResearchReset: () => confirmDialog('Reset all research?', 'All research progress on this save is erased.', 'Reset research', () => run(() => dev.resetResearch(s()), 'Research reset'), true),
    devAch: () => run(() => dev.unlockAllAchievements(s()), 'Achievements unlocked'),
    devAchReset: () => confirmDialog('Reset all achievements?', 'They lock again and you lose their permanent bonuses. Ones you still qualify for unlock again by themselves.', 'Reset achievements', () => run(() => dev.resetAchievements(s()), 'Achievements reset'), true),
    devStory: () => run(() => dev.completeStory(s()), 'Story missions finished'),

    // rivals
    devSpawnRival: () => { const ok = run(() => dev.spawnCompetitor(s(), val('dev-c-name'), val('dev-c-type'), numVal('dev-c-cash'), numVal('dev-c-sites') || 0), 'Company spawned'); if (ok) clear('dev-c-name'); },
    devRivalApply: (el: HTMLElement) => {
      const pick = (id: string) => { const v = numVal(id); return isNaN(v) ? undefined : v; };
      run(() => dev.updateCompetitor(s(), el.dataset.id!, { addCash: pick('dev-m-cash'), tech: pick('dev-m-tech'), aggression: pick('dev-m-agg') }), 'Company updated');
    },
    devRivalRemove: (el: HTMLElement) => { const c = s().competitors.find((x) => x.id === el.dataset.id); if (c) confirmDialog(`Remove ${esc(c.name)}?`, 'The company, its data centers and its fiber disappear. Its land goes back on the market.', 'Remove', () => run(() => dev.removeCompetitor(s(), c.id), 'Company removed'), true); },

    // time
    devSpeed: (el: HTMLElement) => run(() => dev.setSpeed(s(), Number(el.dataset.v))),
    devSkip: (el: HTMLElement) => run(() => dev.skipTime(s(), Number(el.dataset.v))),
    devSkipCustom: () => run(() => dev.skipTime(s(), numVal('dev-skip'))),

    // events
    devEvent: () => run(() => dev.triggerEvent(s(), eventPick, val('dev-ev-place') || undefined)),
    devEventsEnd: () => run(() => dev.endAllEvents(s()), 'All events ended'),
    devCard: () => run(() => dev.triggerDecision(s(), val('dev-card'))),
    devOffer: () => run(() => dev.addContractOffer(s()), 'Offer added'),

    // saves
    devImport: () => confirmDialog('Import a save file?', 'It replaces your current game. Back up or export first if you want to keep it.', 'Choose file', async () => {
      const r = await importSaveFile();
      if (!r.state) return void run(() => ({ ok: false, reason: r.error ?? 'Invalid save' }));
      await saveGame(r.state, 'auto');
      leave();
    }, true),
    devBackup: (el: HTMLElement) => {
      const n = Number(el.dataset.n);
      const go = async () => { const ok = await writeBackup(s(), n); say(ok ? `Backed up to slot ${n}` : 'Backup failed: browser storage is unavailable', ok ? 'good' : 'bad'); app.render(); };
      if (el.dataset.used === '1') confirmDialog(`Overwrite slot ${n}?`, 'The backup in this slot is replaced with your current game.', 'Overwrite', () => void go(), true); else void go();
    },
    devRestore: (el: HTMLElement) => {
      const n = Number(el.dataset.n);
      confirmDialog(`Restore slot ${n}?`, 'It replaces your current game, and any unsaved progress is lost.', 'Restore', async () => {
        const r = await readBackup(n);
        if (!r.state) return void run(() => ({ ok: false, reason: r.error }));
        await saveGame(r.state, 'auto');
        leave();
      }, true);
    },
    devBackupDel: (el: HTMLElement) => { const n = Number(el.dataset.n); confirmDialog(`Delete slot ${n}?`, 'This backup is erased for good.', 'Delete', async () => { await deleteBackup(n); app.render(); }, true); },
    devReset: () => confirmDialog('Delete your save and start over?', 'Your current game is deleted from this device. Backups are kept.', 'Delete save', async () => { await deleteSaves(); leave(); }, true),

    // debugging
    devLogClear: () => { clearDevLog(); app.render(); },
    devLogTest: () => { console.error('Developer test error'); console.warn('Developer test warning'); app.render(); },
    devCopy: async () => {
      const a = app.s;
      const text = JSON.stringify({ version: (window as any).__GAME_VERSION__, level: a.level, hours: a.gameHours, facilities: Object.keys(a.facilities).length, parcels: Object.keys(a.parcels).length, rivals: a.competitors.length, saveKB: Math.round(serialize(a).length / 1024), userAgent: navigator.userAgent, log: devLogEntries() }, null, 2);
      try { await navigator.clipboard.writeText(text); say('Report copied'); } catch { say('Your browser blocked the clipboard', 'bad'); }
    },

    // password
    devPwSave: () => {
      const r = changePassword(val('dev-pw-cur'), val('dev-pw-new'), val('dev-pw-conf'));
      if (!r.ok) return say(r.reason ?? 'Could not change the password', 'bad');
      clear('dev-pw-cur', 'dev-pw-new', 'dev-pw-conf');
      say('Password changed');
      app.render();
    },
    devPwDefault: () => confirmDialog('Restore the default password?', 'Your custom password stops working straight away.', 'Restore default', () => { restoreDefaultPassword(); say('Default password restored'); app.render(); }, true),
    devAutoLock: (el: HTMLElement) => { setAutoLockMinutes(Number(el.dataset.m)); touch(); app.render(); },
  };
}

export function devChanges(app: App) {
  // these run once at startup: activity tracking, Enter to unlock, and the inactivity timer
  if (!listening) {
    listening = true;
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'input']) window.addEventListener(ev, () => touch(), { passive: true, capture: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement)?.id === 'dev-pass') (document.querySelector('[data-act="devUnlock"]') as HTMLElement | null)?.click();
    });
    window.setInterval(() => {
      if (checkAutoLock()) { showPw = false; if (document.getElementById('dev-shell')) app.render(); }
    }, 1000);
  }
  return {
    devEventPick: (el: HTMLElement) => { eventPick = (el as HTMLSelectElement).value; app.render(); },
  };
}
