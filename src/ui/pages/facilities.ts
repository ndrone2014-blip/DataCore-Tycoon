// Data Centers (list + management interface) and Servers & Equipment pages.

import type { App } from '../app';
import { money, num, pct, esc, power, area, gameDate } from '../../core/format';
import { stat, empty, btn, gauge, confirmDialog, bar, openModal, closeModal } from '../components';
import { chart } from '../charts';
import { EQUIPMENT, equipmentById, blueprintById, CAP_LABEL, type EquipmentDef } from '../../config/buildings';
import { cityById } from '../../config/world';
import { getParcel } from '../../world/parcels';
import { pendingUnits } from '../../systems/suppliers';
import { autoEquip, install, installQuote, sellEquipment, upgradeQuote, upgradeEquipment, repair, repairQuote, renameFacility, decommission, equipmentUnlocked, unitPrice } from '../../systems/equipment';
import { landValue } from '../../systems/derive';
import { capBar, dcNeed } from './shared';
import { DEPARTMENTS } from '../../config/content';
import { researchById } from '../../config/research';
import { hookupCard } from './progress';
import { hasFeature } from '../../systems/career';
import { hookupsDone } from '../../systems/careerCore';

export function renderDataCenters(app: App): string {
  const s = app.s, d = app.d;
  const list = Object.values(s.facilities).filter((f) => !f.isHQ);
  if (app.ui.dcId && s.facilities[app.ui.dcId] && !s.facilities[app.ui.dcId].isHQ) return renderFacility(app, app.ui.dcId);
  if (!list.length) return `<div class="card">${empty('🖥️', 'No operational data centers', 'Construct your first facility from the World Map. Completed facilities appear here.', `<button class="btn primary" data-act="nav" data-page="map">Open World Map</button>`)}</div>`;
  return `
  <div class="grid4">
    ${stat('Facilities', `${list.length}`)}
    ${stat('Total revenue/h', money(list.reduce((a, f) => a + d.fac[f.id].revenueHr, 0)))}
    ${stat('Total facility profit/h', money(list.reduce((a, f) => a + d.fac[f.id].profitHr, 0)))}
    ${stat('IT load', power(list.reduce((a, f) => a + d.fac[f.id].itLoad, 0)))}
  </div>
  ${(() => {
    const filter = app.ui.dcFilter ?? 'all', city = app.ui.dcCity ?? 'all';
    const needing = list.filter((f) => dcNeed(f, d.fac[f.id]).level !== 'ok').length;
    const warned = list.filter((f) => d.fac[f.id].warnings.length).length;
    const cities = [...new Set(list.map((f) => f.cityId))];
    const tab = (k: string, label: string) => `<button class="${filter === k ? 'on' : ''}" data-act="dcFilter" data-v="${k}">${label}</button>`;
    return `<div class="card mt dc-toolbar"><div class="tabs">${tab('all', `All (${list.length})`)}${tab('need', `Needs servers (${needing})`)}${tab('warn', `Warnings (${warned})`)}</div>
      ${cities.length > 1 ? `<select data-change="dcCity"><option value="all">All cities</option>${cities.map((c) => `<option value="${c}" ${city === c ? 'selected' : ''}>${esc(cityById(c).name)}</option>`).join('')}</select>` : ''}</div>`;
  })()}
  <div class="dc-grid mt">${list.filter((f) => {
    const filter = app.ui.dcFilter ?? 'all', city = app.ui.dcCity ?? 'all';
    if (city !== 'all' && f.cityId !== city) return false;
    if (filter === 'need') return dcNeed(f, d.fac[f.id]).level !== 'ok';
    if (filter === 'warn') return d.fac[f.id].warnings.length > 0;
    return true;
  }).sort((a, b) => d.fac[a.id].slotsUsed / a.slots - d.fac[b.id].slotsUsed / b.slots).map((f) => {
    const st = d.fac[f.id];
    const need = dcNeed(f, st);
    return `<div class="card dc-card ${need.level !== 'ok' ? 'needs' : ''}" data-act="openDC" data-id="${f.id}">
      <div class="row between"><h3><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</h3><span class="tag ${st.warnings.length ? 'bad' : 'ok'}">${st.warnings.length ? '⚠ ' + st.warnings.length : 'OK'}</span></div>
      <small class="muted">${blueprintById(f.blueprintId).name}${f.custom ? ' (custom)' : ''} · ${cityById(f.cityId).name}</small>
      <div class="grid3 mini-stats">
        <div><label>Revenue/h</label><b class="pos">${money(st.revenueHr)}</b></div>
        <div><label>Profit/h</label><b class="${st.profitHr >= 0 ? 'pos' : 'neg'}">${money(st.profitHr)}</b></div>
        <div><label>Perf</label><b>${pct(st.perf)}</b></div>
      </div>
      ${capBar(st.slotsUsed, f.slots, 'Racks', 'slots')}
      ${capBar(st.itLoad, st.powerCap, 'Power', 'kW')}
      ${capBar(st.itLoad, st.coolingCap, 'Cooling', 'kW')}
      <div class="row between small muted"><span>Condition ${f.condition.toFixed(0)}%</span><span>${s.contracts.active.filter((c) => c.facilityId === f.id).length} contracts</span></div>
      <div class="row gap mt wrap dc-actions">
        ${need.level !== 'ok' ? `<span class="tag bad sm">⚠ ${need.label}</span>` : ''}
        ${!hookupsDone(f) ? `<span class="tag bad sm">🔌 Not connected</span>` : ''}
        ${st.slotsUsed < f.slots && hasFeature(s, 'g_stage2') ? btn('⚡ Fill racks', 'autoEquip', { id: f.id, k: 1 }, 'primary sm', s.cash < 15000 ? 'Not enough cash' : undefined) : ''}
        <button class="btn ghost sm" data-act="openParcel" data-id="${f.parcelId}">📍 Show on map</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderFacility(app: App, id: string): string {
  const s = app.s, d = app.d;
  const f = s.facilities[id];
  const st = d.fac[id];
  const p = getParcel(f.parcelId)!;
  const contracts = s.contracts.active.filter((c) => c.facilityId === id);
  const servers = EQUIPMENT.filter((e) => e.kind === 'server');
  const infra = EQUIPMENT.filter((e) => e.kind === 'infra');
  const rq = repairQuote(s, id);
  const eqRow = (e: EquipmentDef) => {
    const n = f.equipment[e.id] ?? 0;
    const u = equipmentUnlocked(s, e);
    const q1 = installQuote(s, id, e.id, 1, d);
    const q5 = installQuote(s, id, e.id, 5, d);
    const uq = n ? upgradeQuote(s, id, e.id, d) : null;
    return `<tr class="${u.ok ? '' : 'locked'}"><td>${e.icon} <b>${e.name}</b><br><small class="muted">${esc(e.desc)}</small></td>
      <td class="num">${n}${pendingUnits(f, e.id) ? `<br><small class="muted">${pendingUnits(f, e.id)} arriving</small>` : ''}</td>
      <td>${u.ok ? money(unitPrice(s, e, f.cityId)) : `<small>${u.reason}${e.research ? `: ${researchById(e.research).name}` : ''}</small>`}</td>
      <td class="num">${e.power ? e.power + ' kW' : '—'}</td>
      <td class="row gap">
        ${u.ok ? `<button class="btn primary sm" data-act="install" data-id="${id}" data-eq="${e.id}" data-n="1" ${q1.ok ? '' : `disabled title="${esc(q1.reason ?? '')}"`}>+1</button>
        <button class="btn ghost sm" data-act="install" data-id="${id}" data-eq="${e.id}" data-n="5" ${q5.ok ? '' : `disabled title="${esc(q5.reason ?? '')}"`}>+5</button>` : ''}
        ${n ? `<button class="btn ghost sm" data-act="sellEq" data-id="${id}" data-eq="${e.id}" title="Sell one for ${money(e.cost * 0.4)}">−1</button>` : ''}
        ${uq && uq.to ? `<button class="btn ghost sm" data-act="upgradeEq" data-id="${id}" data-eq="${e.id}" ${uq.ok ? '' : `disabled title="${esc(uq.reason ?? '')}"`} title="Upgrade one to ${uq.to.name}">⬆ ${uq.ok ? money(uq.cost) : ''}</button>` : ''}
      </td></tr>${q1.warn && u.ok && q1.ok ? `<tr class="warnrow"><td colspan="5">⚠ ${q1.warn}</td></tr>` : ''}`;
  };
  const revHist = s.finance.hourly.slice(-1);
  void revHist;
  return `
  <div class="row between wrap gap">
    <button class="btn ghost" data-act="closeDC">← All facilities</button>
    <div class="row gap">
      <button class="btn ghost" data-act="openParcel" data-id="${f.parcelId}">🧊 Inspect in 3D</button>
      <button class="btn ghost" data-act="renameDC" data-id="${id}">✏️ Rename</button>
      <button class="btn danger" data-act="decommission" data-id="${id}">Decommission</button>
    </div>
  </div>
  <div class="card mt facility-head">
    <div class="row between wrap">
      <div><h2><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</h2>
        <p class="muted">${blueprintById(f.blueprintId).name}${f.custom ? ' (custom design)' : ''} · ${esc(p.name)}, ${cityById(f.cityId).name} · built ${gameDate(Date.UTC(2027, 0, 1, 8), f.builtAt, false)}</p></div>
      <div class="row gap">${st.warnings.map((w) => `<span class="tag bad">⚠ ${esc(w)}</span>`).join('') || '<span class="tag ok">All systems nominal</span>'}</div>
    </div>
    <div class="grid6 mini-stats mt">
      <div><label>Revenue/h</label><b class="pos">${money(st.revenueHr)}</b></div>
      <div><label>Expenses/h</label><b class="neg">${money(st.expenseHr)}</b></div>
      <div><label>Net profit/h</label><b class="${st.profitHr >= 0 ? 'pos' : 'neg'}">${money(st.profitHr)}</b></div>
      <div><label>Building value</label><b>${money(st.value - st.equipmentValue + landValue(s, f.parcelId))}</b></div>
      <div><label>Total construction</label><b>${money(f.buildCost)}</b></div>
      <div><label>Lifetime profit</label><b class="${f.profitTotal >= 0 ? 'pos' : 'neg'}">${money(f.profitTotal)}</b></div>
    </div>
  </div>
  ${hookupCard(app, f)}
  <div class="grid3 mt">
    <div class="card">
      <h3>Capacity</h3>
      ${(['cpu', 'gpu', 'storage'] as const).map((c) => `<div class="capbar"><div class="row between"><span style="color:${CAP_LABEL[c].color}">${CAP_LABEL[c].name}</span><small>${num(st.allocated[c])} contracted / ${num(st.delivered[c])} ${CAP_LABEL[c].unit}</small></div>${bar(st.delivered[c] ? st.allocated[c] / st.delivered[c] : 0)}</div>`).join('')}
      <div class="kv mt"><span>Server racks</span><b>${st.servers} servers · ${st.slotsUsed}/${f.slots} slots</b><span>Infra bays</span><b>${st.baysUsed}/${f.bays}</b><span>GPU utilization</span><b>${st.delivered.gpu ? pct(st.allocated.gpu / st.delivered.gpu) : '—'}</b><span>Storage capacity</span><b>${num(st.delivered.storage)} TB</b><span>Network ports</span><b>${Math.round(st.network)} servers supported</b><span>Security tier</span><b>${st.security}</b></div>
    </div>
    <div class="card">
      <h3>Power & cooling</h3>
      ${gauge(st.itLoad, st.powerCap, 'Electrical load', `${power(st.itLoad)} / ${power(st.powerCap)}`)}
      ${gauge(st.itLoad, st.coolingCap, 'Heat load', `${power(st.itLoad)} / ${power(st.coolingCap)}`)}
      <div class="kv mt">
        <span>Facility temperature</span><b class="${st.temperature > 35 ? 'neg' : st.temperature > 30 ? 'warn-t' : ''}">${st.temperature.toFixed(1)} °C</b>
        <span>PUE (power efficiency)</span><b>${st.pue.toFixed(2)}</b>
        <span>Backup power</span><b>${power(st.backup)}${st.backup < st.itLoad ? ' <span class="warn-t">(partial)</span>' : ''}</b>
        <span>Equipment performance</span><b>${pct(st.perf)}</b>
        <span>Campus synergy</span><b>${st.campus > 0 ? `<span class="pos">+${pct(st.campus)}</span>` : '<span class="muted">Build neighbors in this block</span>'}</b>
        <span>Power / cooling / network</span><b>${pct(st.powerFactor)} · ${pct(st.coolingFactor)} · ${pct(st.networkFactor)}</b>
      </div>
    </div>
    <div class="card">
      <h3>Operating expenses / h</h3>
      <div class="kv">${Object.entries(st.expenses).map(([k, v]) => `<span>${k[0].toUpperCase() + k.slice(1)}</span><b>${money(v)}</b>`).join('')}</div>
      <h3 class="mt">Facility condition</h3>
      ${bar(f.condition / 100, f.condition < 70 ? 'bad' : f.condition < 85 ? 'warn' : '', `${f.condition.toFixed(1)}%`)}
      <label class="check mt"><input type="checkbox" data-change="autoRepair" data-id="${id}" ${f.autoRepair !== false ? 'checked' : ''}> Automatic maintenance (keeps condition above 85%)</label>
      <div class="row gap mt">${btn(`Full overhaul ${rq ? money(rq) : ''}`, 'repairDC', { id }, 'ghost sm', f.condition >= 99.5 ? 'Perfect condition' : s.cash < rq ? `Need ${money(rq)}` : undefined)}</div>
    </div>
  </div>
  <div class="card mt">
    <div class="row between"><h3>Customer contracts (${contracts.length})</h3><button class="btn ghost sm" data-act="nav" data-page="contracts">Find customers</button></div>
    ${contracts.length ? `<table class="tbl"><thead><tr><th>Customer</th><th>Type</th><th>Capacity</th><th>Revenue/h</th><th>Fulfillment</th><th>Remaining</th></tr></thead><tbody>
      ${contracts.map((c) => `<tr><td><b>${esc(c.customer)}</b></td><td>${esc(c.label)}</td><td>${num(c.amount)} ${CAP_LABEL[c.cap].unit}</td><td>${money(c.ratePerHour)}</td><td class="${c.fulfillment < c.sla ? 'neg' : 'pos'}">${pct(c.fulfillment)} <small>(SLA ${pct(c.sla)})</small></td><td>${Math.ceil(c.hoursLeft / 24)}d</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No contracts here yet. Idle capacity earns spot-market rates — sign contracts for better pay.</p>'}
  </div>
  <div class="card mt">
    <div class="row between wrap gap"><h3>👥 Staff on site (${s.employees.filter((e) => e.assigned === id).length})</h3>
      <select data-change="addStaffHere" data-id="${id}"><option value="">＋ Assign someone here…</option>${s.employees.filter((e) => e.assigned !== id).map((e) => `<option value="${e.id}">${DEPARTMENTS[e.dept].icon} ${esc(e.name)} (${'★'.repeat(e.skill)})</option>`).join('')}</select></div>
    <p class="small muted">${s.employees.filter((e) => e.assigned === id).map((e) => `${DEPARTMENTS[e.dept].icon} ${esc(e.name)}`).join(' · ') || 'Nobody assigned here. Staff at HQ still help every site a little.'}</p>
  </div>
  ${hasFeature(s, 'g_stage2') ? '' : '<div class="card mt"><p class="small muted">🔒 Auto-equip unlocks with Established Company status. Until then, every rack is your call: watch power, cooling and network as you add servers.</p></div>'}
  <div class="card mt auto-equip ${hasFeature(s, 'g_stage2') ? '' : 'hidden'}">
    <div class="row between wrap gap"><div><h3>⚡ Auto-equip</h3><p class="small muted">Fill free rack slots with a balanced mix of the best servers you've unlocked. Networking, power and cooling are added automatically so nothing overloads.</p></div>
    <div class="row gap wrap">${[0.25, 0.5, 1].map((k) => `<button class="btn ${k === 1 ? 'primary' : 'ghost'}" data-act="autoEquip" data-id="${id}" data-k="${k}" ${st.slotsUsed >= f.slots || s.cash < 20000 ? 'disabled' : ''}>Spend up to ${money(Math.max(0, s.cash) * k)}</button>`).join('')}</div></div>
  </div>
  <div class="card mt">
    <h3>Servers & networking <small class="muted">(rack slots: ${st.slotsUsed}/${f.slots})</small></h3>
    <table class="tbl eq"><thead><tr><th>Equipment</th><th>Installed</th><th>Unit price</th><th>Power</th><th></th></tr></thead><tbody>${servers.map(eqRow).join('')}</tbody></table>
  </div>
  <div class="card mt">
    <h3>Infrastructure <small class="muted">(bays: ${st.baysUsed}/${f.bays})</small></h3>
    <table class="tbl eq"><thead><tr><th>Equipment</th><th>Installed</th><th>Unit price</th><th>Power</th><th></th></tr></thead><tbody>${infra.map(eqRow).join('')}</tbody></table>
  </div>`;
}

export function renderEquipment(app: App): string {
  const s = app.s, d = app.d;
  const facs = Object.values(s.facilities).filter((f) => !f.isHQ);
  let fid = app.ui.eqFacility as string | null;
  if (!fid || !s.facilities[fid]) fid = facs[0]?.id ?? null;
  const st = fid ? d.fac[fid] : null;
  const cat = (kind: 'server' | 'infra') => EQUIPMENT.filter((e) => e.kind === kind).map((e) => {
    const u = equipmentUnlocked(s, e);
    const q = fid ? installQuote(s, fid, e.id, 1, d) : { ok: false, reason: 'Build a data center first' };
    const owned = facs.reduce((a, f) => a + (f.equipment[e.id] ?? 0), 0);
    return `<div class="card eq-card ${u.ok ? '' : 'locked'}">
      <div class="row between"><h3>${e.icon} ${e.name}</h3><span class="tag">${owned} owned</span></div>
      <p class="small muted">${esc(e.desc)}</p>
      <div class="kv small">
        <span>Purchase</span><b>${money(e.cost)}</b><span>Installation</span><b>${money(e.install)}</b>
        ${e.cap ? `<span>Capacity</span><b>${num(e.capacity)} ${CAP_LABEL[e.cap].unit}</b>` : ''}
        ${e.addPower ? `<span>Adds power</span><b>${power(e.addPower)}</b>` : ''}${e.addCooling ? `<span>Adds cooling</span><b>${power(e.addCooling)}</b>` : ''}
        ${e.addNetwork ? `<span>Network</span><b>${e.addNetwork} servers</b>` : ''}${e.backup ? `<span>Backup</span><b>${power(e.backup)}</b>` : ''}
        <span>Electricity</span><b>${e.power ? e.power + ' kW' : '—'}</b><span>Maintenance</span><b>${money(e.maint)}/h</b>
        <span>Performance</span><b>${'★'.repeat(Math.round(e.rating / 2))}${'☆'.repeat(5 - Math.round(e.rating / 2))}</b>
        ${e.upgradeTo ? `<span>Upgrades to</span><b>${equipmentById(e.upgradeTo).name}</b>` : ''}
      </div>
      ${u.ok ? `<div class="row gap mt"><button class="btn primary sm" data-act="install" data-id="${fid ?? ''}" data-eq="${e.id}" data-n="1" ${q.ok ? '' : `disabled title="${esc(q.reason ?? '')}"`}>Install 1 · ${money(unitPrice(s, e))}</button><button class="btn ghost sm" data-act="install" data-id="${fid ?? ''}" data-eq="${e.id}" data-n="5" ${fid && installQuote(s, fid, e.id, 5, d).ok ? '' : 'disabled'}>+5</button></div>` : `<p class="small warn-t mt">🔒 ${u.reason}${e.research ? `: ${researchById(e.research).name}` : ''}</p>`}
    </div>`;
  }).join('');
  return `
  ${facs.length ? `<div class="card row between wrap gap">
    <label class="row gap">Install into <select data-change="eqFacility">${facs.map((f) => `<option value="${f.id}" ${fid === f.id ? 'selected' : ''}>${esc(f.name)} — ${cityById(f.cityId).name}</option>`).join('')}</select></label>
    ${st && fid ? `<div class="row gap wrap small"><span>Slots <b>${st.slotsUsed}/${s.facilities[fid].slots}</b></span><span>Bays <b>${st.baysUsed}/${s.facilities[fid].bays}</b></span><span>Power <b>${power(st.itLoad)}/${power(st.powerCap)}</b></span><span>Cooling <b>${power(st.itLoad)}/${power(st.coolingCap)}</b></span></div>` : ''}
  </div>` : `<div class="callout">Build a data center to install equipment. You can browse the catalog below.</div>`}
  <h3 class="sect">Servers & networking</h3><div class="eq-grid">${cat('server')}</div>
  <h3 class="sect">Power, cooling & security infrastructure</h3><div class="eq-grid">${cat('infra')}</div>`;
}

export function facilityActions(app: App) {
  return {
    openDC: (el: HTMLElement) => { app.ui.dcId = el.dataset.id; app.render(); document.getElementById('page')!.scrollTop = 0; },
    closeDC: () => { app.ui.dcId = null; app.render(); },
    dcFilter: (el: HTMLElement) => { app.ui.dcFilter = el.dataset.v; app.render(); },
    staffHere: (el: HTMLElement) => { app.ui.staffHere = el.dataset.id; app.render(); },
    install: (el: HTMLElement) => {
      if (!el.dataset.id) return app.run(() => ({ ok: false, reason: 'Build a data center first' }));
      app.run(() => install(app.s, el.dataset.id!, el.dataset.eq!, Number(el.dataset.n ?? 1)));
    },
    autoEquip: (el: HTMLElement) => app.run(() => autoEquip(app.s, el.dataset.id!, Math.max(0, app.s.cash) * Number(el.dataset.k))),
    sellEq: (el: HTMLElement) => app.run(() => sellEquipment(app.s, el.dataset.id!, el.dataset.eq!, 1)),
    upgradeEq: (el: HTMLElement) => app.run(() => upgradeEquipment(app.s, el.dataset.id!, el.dataset.eq!)),
    repairDC: (el: HTMLElement) => app.run(() => repair(app.s, el.dataset.id!)),
    renameDC: (el: HTMLElement) => {
      const f = app.s.facilities[el.dataset.id!];
      app.ui.renameId = f.id;
      app.ui.renameVal = f.name;
      openModal(() => `<h2>Rename facility</h2><label class="set-row" style="grid-template-columns:1fr"><input type="text" id="rename-input" value="${esc(app.ui.renameVal)}" maxlength="40" data-change="renameVal" data-live></label>
        <div class="row gap end mt"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary" data-act="renameSave">Save</button></div>`);
      setTimeout(() => (document.getElementById('rename-input') as HTMLInputElement | null)?.select(), 50);
    },
    renameSave: () => {
      const v = String(app.ui.renameVal ?? '').trim();
      if (v) app.run(() => renameFacility(app.s, app.ui.renameId, v));
      closeModal();
    },
    decommission: (el: HTMLElement) => {
      const f = app.s.facilities[el.dataset.id!];
      confirmDialog('Decommission facility?', `Tear down <b>${esc(f.name)}</b>? Equipment is sold at 40% value and the building is demolished. The land stays yours.`, 'Decommission', () => {
        if (app.run(() => decommission(app.s, f.id))) app.ui.dcId = null;
      }, true);
    },
  };
}

export function facilityChanges(app: App) {
  return {
    renameVal: (el: HTMLElement) => { app.ui.renameVal = (el as HTMLInputElement).value; },
    dcCity: (el: HTMLElement) => { app.ui.dcCity = (el as HTMLSelectElement).value; app.render(); },
    addStaffHere: (el: HTMLElement) => {
      const emp = app.s.employees.find((x) => x.id === (el as HTMLSelectElement).value);
      if (emp) { emp.assigned = el.dataset.id!; app.d = app.d; app.run(() => undefined); }
    },
    eqFacility: (el: HTMLElement) => { app.ui.eqFacility = (el as HTMLSelectElement).value; app.render(); },
    autoRepair: (el: HTMLElement) => {
      const f = app.s.facilities[el.dataset.id!];
      if (f) f.autoRepair = (el as HTMLInputElement).checked;
      app.render();
    },
  };
}

export { area, chart };
