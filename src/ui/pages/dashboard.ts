// Dashboard, Real Estate and Construction pages.

import type { App } from '../app';
import { money, num, pct, esc, area, gameDate, gameDuration } from '../../core/format';
import { stat, empty, btn } from '../components';
import { chart } from '../charts';
import { projectCard } from './shared';
import { getParcel, allParcels, PROPERTY_TYPE_INFO } from '../../world/parcels';
import { parcelState } from '../../systems/property';
import { landValue } from '../../systems/derive';
import { cityById, CITIES } from '../../config/world';
import { CAP_LABEL } from '../../config/buildings';
import { eventText } from '../../systems/events';
import { currentStory, missionProgress } from '../../systems/progression';
import { statusLabel } from './mapPanel';

const sumRec = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export function renderDashboard(app: App): string {
  const s = app.s, d = app.d, t = d.totals;
  const hourly = s.finance.hourly.slice(-48);
  const projects = Object.values(s.projects);
  const story = currentStory(s);
  const sp = story ? missionProgress(s, d, { ...story, base: 0 }) : 0;
  const warnings = Object.values(s.facilities).filter((f) => d.fac[f.id]?.warnings.length);
  return `
  ${s.cash < 0 ? `<div class="callout bad">⚠️ <b>Your cash is negative.</b> Expenses keep running — take a bank loan on the Finances page, sell idle property, or cut staff before things get worse.</div>` : ''}
  ${story ? `<div class="card mission-banner ${sp >= 1 ? 'ready' : ''}">
    <div><small>Current mission</small><h3>${esc(story.title)}</h3><p>${esc(story.desc)}</p></div>
    <div class="mb-right"><div class="bar"><i style="width:${(sp * 100).toFixed(0)}%"></i></div>
    ${sp >= 1 ? btn(`Claim ${story.reward.cash ? money(story.reward.cash) : ''}`, 'claimStory', { id: story.id }, 'primary') : `<small class="muted">Reward: ${story.reward.cash ? money(story.reward.cash) : ''} ${story.reward.xp ? `+${story.reward.xp} XP` : ''}</small>`}</div>
  </div>` : ''}
  <div class="grid4">
    ${stat('Available cash', money(s.cash, 2), s.debt ? `Debt ${money(s.debt)}` : 'No debt', 'accent')}
    ${stat('Revenue / hour', money(t.revenueHr), `Total ${money(s.finance.totalRevenue)}`)}
    ${stat('Expenses / hour', money(t.expenseHr), `Total ${money(s.finance.totalExpenses)}`)}
    ${stat('Net profit / hour', `<span class="${t.profitHr >= 0 ? 'pos' : 'neg'}">${money(t.profitHr)}</span>`, `Margin ${t.revenueHr ? pct(t.profitHr / t.revenueHr) : '—'}`)}
    ${stat('Company valuation', money(t.valuation), `Rank #${1 + s.competitors.filter((c) => c.valuation > t.valuation).length} of ${s.competitors.length + 1}`)}
    ${stat('Company level', `${s.level}`, `${Math.round(s.xp).toLocaleString()} XP`)}
    ${stat('Properties', `${t.properties}`, `${t.cities} cities · ${t.countries} countries`)}
    ${stat('Operational DCs', `${t.facilities}`, `${projects.length} active project${projects.length === 1 ? '' : 's'}`)}
  </div>
  <div class="grid2-1 mt">
    <div class="card">
      <div class="row between"><h3>Revenue vs expenses</h3><small class="muted">last ${hourly.length} game hours</small></div>
      ${hourly.length > 1 ? chart('dash-rev', {
        type: 'line', money: true, height: 230,
        labels: hourly.map((h) => gameDate(Date.UTC(2027, 0, 1, 8), h.t).split('·')[1] ?? ''),
        datasets: [
          { label: 'Operating revenue', data: hourly.map((h) => (h.revenue.Contracts ?? 0) + (h.revenue['Spot Market'] ?? 0)), color: '#22c55e', fill: true },
          { label: 'Expenses', data: hourly.map((h) => sumRec(h.expenses)), color: '#ef4444' },
        ],
      }) : empty('📈', 'No data yet', 'Charts appear after the first game hour.')}
    </div>
    <div class="card">
      <h3>Compute capacity</h3>
      ${(['cpu', 'gpu', 'storage'] as const).map((c) => `<div class="cap-line"><span style="color:${CAP_LABEL[c].color}">●</span> ${CAP_LABEL[c].name}<b>${num(t.delivered[c])} ${CAP_LABEL[c].unit}</b></div>`).join('')}
      <h3 class="mt">World events</h3>
      ${s.events.length ? s.events.map((e) => {
        const tx = eventText(e.defId, e.cityId);
        return `<div class="event ${tx.good ? 'good' : 'bad'}"><b>${tx.good ? '📣' : '⚠️'} ${esc(tx.title)}</b><small>${esc(tx.desc)} · ${gameDuration(e.endsAt - s.gameHours)} left</small></div>`;
      }).join('') : '<p class="muted small">Markets are calm.</p>'}
      ${warnings.length ? `<h3 class="mt">Facility alerts</h3>${warnings.map((f) => `<button class="list-row" data-act="manageDC" data-id="${f.id}"><span class="flag">⚠️</span><span class="grow"><b>${esc(f.name)}</b><small>${esc(d.fac[f.id].warnings.join(' · '))}</small></span></button>`).join('')}` : ''}
    </div>
  </div>
  <div class="grid2 mt">
    <div class="card">
      <div class="row between"><h3>Active construction</h3><button class="link" data-act="nav" data-page="construction">View all</button></div>
      ${projects.length ? projects.slice(0, 3).map((p) => projectCard(app, p, true)).join('') : empty('🏗️', 'No active projects', 'Buy land on the World Map, demolish, and build a data center.', `<button class="btn primary" data-act="nav" data-page="map">Open World Map</button>`)}
    </div>
    <div class="card">
      <h3>Recent activity</h3>
      <div class="log">${s.log.slice(0, 14).map((l) => `<div class="log-row ${l.kind}"><small>${gameDate(Date.UTC(2027, 0, 1, 8), l.t)}</small><span>${esc(l.msg)}</span></div>`).join('')}</div>
    </div>
  </div>`;
}

export function renderRealEstate(app: App): string {
  const s = app.s;
  const owned = Object.entries(s.parcels).filter(([, ps]) => ps.owner === 'player' && !ps.mergedInto);
  const city = app.ui.reCity as string;
  const type = app.ui.reType as string;
  const maxPrice = Number(app.ui.reMax ?? 0);
  let opps = allParcels()
    .filter((p) => s.unlockedCities.includes(p.cityId) && !parcelState(s, p.id).owner)
    .filter((p) => (city === 'all' || p.cityId === city) && (type === 'all' || p.type === type))
    .map((p) => ({ p, price: landValue(s, p.id) }))
    .filter((x) => !maxPrice || x.price <= maxPrice);
  const sort = app.ui.reSort;
  opps.sort((a, b) => (sort === 'area' ? b.p.area - a.p.area : sort === 'ppm' ? a.price / a.p.area - b.price / b.p.area : a.price - b.price));
  const total = opps.length;
  opps = opps.slice(0, 60);
  const value = owned.reduce((a, [pid]) => a + landValue(s, pid), 0);
  return `
  <div class="grid4">
    ${stat('Owned properties', `${owned.length}`)}
    ${stat('Portfolio land value', money(value))}
    ${stat('Paid', money(owned.reduce((a, [, ps]) => a + (ps.boughtFor ?? 0), 0)))}
    ${stat('Unlocked markets', `${s.unlockedCities.length} / ${CITIES.length}`)}
  </div>
  <div class="card mt">
    <h3>Your portfolio</h3>
    ${owned.length ? `<table class="tbl"><thead><tr><th>Property</th><th>City</th><th>Type</th><th>Size</th><th>Status</th><th>Value</th><th></th></tr></thead><tbody>
    ${owned.map(([pid, ps]) => {
      const p = getParcel(pid)!;
      const f = ps.facilityId ? s.facilities[ps.facilityId] : undefined;
      return `<tr><td><b>${esc(f?.name ?? p.name)}</b><br><small class="muted mono">${pid.toUpperCase()}</small></td><td>${cityById(p.cityId).name}</td><td>${p.isSite ? 'Campus site' : PROPERTY_TYPE_INFO[p.type].label}</td><td>${area(p.area)}</td><td>${statusLabel(ps.status)}</td><td>${money(landValue(s, pid))}</td><td><button class="btn ghost sm" data-act="openParcel" data-id="${pid}">Open</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('🏷️', 'No properties', 'Find land on the World Map or in the opportunities list below.')}
  </div>
  <div class="card mt">
    <div class="row between wrap gap"><h3>Development opportunities <small class="muted">(${total} available)</small></h3>
      <div class="row gap wrap">
        <select data-change="reCity"><option value="all">All unlocked cities</option>${s.unlockedCities.map((c) => `<option value="${c}" ${city === c ? 'selected' : ''}>${cityById(c).name}</option>`).join('')}</select>
        <select data-change="reType"><option value="all">All types</option>${Object.entries(PROPERTY_TYPE_INFO).filter(([k]) => k !== 'commercial_zone').map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <select data-change="reMax"><option value="0">Any price</option>${[150_000, 500_000, 1_000_000, 3_000_000, 10_000_000, 30_000_000].map((v) => `<option value="${v}" ${maxPrice === v ? 'selected' : ''}>≤ ${money(v)}</option>`).join('')}</select>
        <select data-change="reSort"><option value="price" ${sort === 'price' ? 'selected' : ''}>Cheapest</option><option value="area" ${sort === 'area' ? 'selected' : ''}>Largest</option><option value="ppm" ${sort === 'ppm' ? 'selected' : ''}>Best $/m²</option></select>
      </div></div>
    <table class="tbl"><thead><tr><th>Property</th><th>City</th><th>Type</th><th>Size</th><th>Zoning</th><th>Price</th><th></th></tr></thead><tbody>
    ${opps.map(({ p, price }) => `<tr><td>${PROPERTY_TYPE_INFO[p.type].icon} <b>${esc(p.name)}</b>${p.zoneId ? ' <span class="tag sm">zone</span>' : ''}</td><td>${cityById(p.cityId).name}</td><td>${PROPERTY_TYPE_INFO[p.type].label}</td><td>${area(p.area)}</td><td>${p.zoning.code}</td><td><b>${money(price)}</b></td><td class="row gap"><button class="btn ghost sm" data-act="openParcel" data-id="${p.id}">View</button>${btn('Buy', 'buyParcel', { id: p.id }, 'primary sm', s.cash < price ? `Need ${money(price)}` : undefined)}</td></tr>`).join('')}
    </tbody></table>
  </div>`;
}

export function renderConstruction(app: App): string {
  const s = app.s;
  const projects = Object.values(s.projects).sort((a, b) => a.startedAt - b.startedAt);
  const ready = Object.entries(s.parcels).filter(([, ps]) => ps.owner === 'player' && ps.status === 'cleared' && !ps.mergedInto);
  const existing = Object.entries(s.parcels).filter(([, ps]) => ps.owner === 'player' && ps.status === 'existing');
  return `
  <div class="grid3">
    ${stat('Active projects', `${projects.length}`)}
    ${stat('Committed spend', money(projects.reduce((a, p) => a + p.cost, 0)))}
    ${stat('Sites ready to build', `${ready.length}`, existing.length ? `${existing.length} need demolition` : '')}
  </div>
  ${projects.length ? `<div class="mt">${projects.map((p) => projectCard(app, p)).join('')}</div>` : `<div class="card mt">${empty('🏗️', 'Nothing under construction', 'Open a property you own on the World Map and choose Build Data Center.', `<button class="btn primary" data-act="nav" data-page="map">Open World Map</button>`)}</div>`}
  ${ready.length || existing.length ? `<div class="card mt"><h3>Your sites</h3>
    ${[...ready, ...existing].map(([pid, ps]) => {
      const p = getParcel(pid)!;
      return `<div class="list-row static"><span class="flag">${ps.status === 'cleared' ? '🟩' : PROPERTY_TYPE_INFO[p.type].icon}</span><span class="grow"><b>${esc(p.name)}</b><small>${cityById(p.cityId).name} · ${area(p.area)} · ${statusLabel(ps.status)}</small></span>
      ${ps.status === 'cleared' ? `<button class="btn primary sm" data-act="openBuild" data-id="${pid}">Build</button>` : `<button class="btn danger sm" data-act="demolish" data-id="${pid}">Demolish</button>`}
      <button class="btn ghost sm" data-act="openParcel" data-id="${pid}">View</button></div>`;
    }).join('')}</div>` : ''}`;
}

export function realEstateChanges(app: App) {
  return {
    reCity: (el: HTMLElement) => { app.ui.reCity = (el as HTMLSelectElement).value; app.render(); },
    reType: (el: HTMLElement) => { app.ui.reType = (el as HTMLSelectElement).value; app.render(); },
    reSort: (el: HTMLElement) => { app.ui.reSort = (el as HTMLSelectElement).value; app.render(); },
    reMax: (el: HTMLElement) => { app.ui.reMax = (el as HTMLSelectElement).value; app.render(); },
  };
}
