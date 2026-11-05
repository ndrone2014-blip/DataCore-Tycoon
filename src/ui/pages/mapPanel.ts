// Right-hand panel of the World Map, contextual to the current map level.

import type { App } from '../app';
import { CITIES, COUNTRIES, cityById, countryById, citiesInCountry } from '../../config/world';
import { getCityLayout, getParcel, getZone, PROPERTY_TYPE_INFO, type ParcelDef } from '../../world/parcels';
import { parcelState, canBuy, demolitionCost, demolitionSeconds, zoneQuote, consolidateQuote, licenseFee, buyParcel, buyZone, startDemolition, sellParcel, consolidateZone, unlockCity, canSell } from '../../systems/property';
import { landValue } from '../../systems/derive';
import { quoteBuild, hqQuote, startHQ, speedUp } from '../../systems/construction';
import { hqUpgradeQuote, upgradeHQ } from '../../systems/equipment';
import { BLUEPRINTS, CAP_LABEL } from '../../config/buildings';
import { HQ_TIERS } from '../../config/economy';
import { money, area, esc, pct, power, num, duration } from '../../core/format';
import { bar, btn, confirmDialog, gauge } from '../components';
import { dcNeed, projectCard } from './shared';
import { openBuildModal } from './buildModal';
import { staffCap } from '../../systems/employees';
import { isMobile } from '../../core/device';
import { COUNTRY_RULES, citySpecById } from '../../config/expansion';
import { cityMods } from '../../systems/regulation';
import { hasFeature, isCareer, STAGES } from '../../systems/career';
import { hookupCard, loanCards } from './progress';

export function renderMapPanel(app: App): string {
  const m = app.map;
  if (!m || !m.engine) return `<div class="panel-loading"><div class="spinner"></div><p>Loading world map…</p><small class="muted">Fetching real geography (MapLibre + OpenStreetMap). Falls back to an offline map if unavailable.</small></div>`;
  if (m.level === 'property' && m.parcelId) return propertyPanel(app, getParcel(m.parcelId)!);
  if ((m.level === 'city' || m.level === 'property') && m.cityId) return cityPanel(app, m.cityId, m.zoneId);
  if (m.level === 'country' && m.countryId) return countryPanel(app, m.countryId);
  return worldPanel(app);
}

function cityRow(app: App, id: string): string {
  const s = app.s;
  const c = cityById(id);
  const unlocked = s.unlockedCities.includes(id);
  const mine = Object.values(s.facilities).filter((f) => f.cityId === id && !f.isHQ).length;
  const comps = s.competitors.filter((x) => x.sites.some((y) => y.cityId === id));
  return `<button class="list-row ${unlocked ? '' : 'locked'}" data-act="mapCity" data-id="${id}">
    <span class="flag">${countryById(c.country).flag}</span>
    <span class="grow"><b>${esc(c.name)}</b><small>${unlocked ? `${mine} facilities · market ${Math.round((app.d.cityPrice[id] ?? 1) * 100)}%` : !hasFeature(s, 'g_stage2') ? `🔒 ${STAGES[2].name} status` : `🔒 Level ${c.unlockLevel}${licenseFee(s, c.id) ? ` · ${money(licenseFee(s, c.id))}` : ''}`}</small></span>
    <span class="dots">${comps.map((x) => `<i style="background:${x.color}" title="${esc(x.name)}"></i>`).join('')}</span>
  </button>`;
}

/** Plain-English answer to "how do I unlock a new city?", with one-tap unlock buttons. */
function marketsCard(app: App): string {
  const s = app.s;
  const locked = CITIES.filter((c) => !s.unlockedCities.includes(c.id)).sort((a, b) => a.unlockLevel - b.unlockLevel || a.license - b.license);
  if (!locked.length) return '';
  if (!hasFeature(s, 'g_stage2')) return `<div class="card markets-card"><h3>🔓 New cities</h3><p class="small muted">Your company has one market for now. Every other city opens once you reach <b>${STAGES[2].name}</b> status. Check Company Progress to see how close you are.</p></div>`;
  const ready = locked.filter((c) => s.level >= c.unlockLevel);
  const next = locked.filter((c) => s.level < c.unlockLevel).slice(0, 2);
  return `<div class="card markets-card">
    <h3>🔓 Unlocking new cities</h3>
    <p class="small muted">Each city needs your company to reach a <b>level</b>, then a one-time <b>market license</b>. Earn levels from building, contracts and missions. You are level ${s.level}.</p>
    ${[...ready, ...next].map((c) => {
      const lvlOk = s.level >= c.unlockLevel;
      return `<div class="market-row"><span class="flag">${countryById(c.country).flag}</span><span class="grow"><b>${esc(c.name)}</b><small>Level ${c.unlockLevel}${c.license ? ` · ${money(licenseFee(app.s, c.id))} license` : ' · free'}</small></span>
        ${lvlOk ? btn('Unlock', 'unlockCity', { id: c.id }, 'primary sm', s.cash < licenseFee(s, c.id) ? `Need ${money(licenseFee(app.s, c.id))}` : undefined) : `<span class="tag">Lv ${c.unlockLevel}</span>`}</div>`;
    }).join('')}
  </div>`;
}

function myFacilitiesCard(app: App): string {
  const s = app.s, d = app.d;
  const list = Object.values(s.facilities).filter((f) => !f.isHQ);
  if (!list.length) return '';
  const ranked = list.map((f) => ({ f, need: dcNeed(f, d.fac[f.id]) })).sort((a, b) => (d.fac[a.f.id]?.slotsUsed ?? 0) / a.f.slots - (d.fac[b.f.id]?.slotsUsed ?? 0) / b.f.slots);
  return `<h4 class="sect">Your data centers (${list.length})</h4>
    ${ranked.slice(0, 6).map(({ f, need }) => `<button class="list-row ${need.level !== 'ok' ? 'needs' : ''}" data-act="mapProp" data-id="${f.parcelId}"><span class="flag">${need.level === 'ok' ? '🖥️' : '⚠️'}</span><span class="grow"><b>${esc(f.name)}</b><small>${esc(cityById(f.cityId).name)} · ${need.label}</small></span></button>`).join('')}
    ${list.length > 6 ? `<button class="link sm" data-act="nav" data-page="datacenters">See all ${list.length}</button>` : ''}`;
}

function worldPanel(app: App): string {
  const s = app.s, d = app.d;
  const regions = ['North America', 'Europe', 'Asia', 'Oceania'] as const;
  return `
    <div class="panel-head"><h2>🌐 World Map</h2><p class="muted">${isMobile() ? 'Tap a city marker. Pinch to zoom, drag to pan.' : 'Click a highlighted country or a city marker. Scroll to zoom, drag to pan.'}</p></div>
    <div class="grid2 mini-stats">
      <div><label>Facilities</label><b>${d.totals.facilities}</b></div>
      <div><label>Properties</label><b>${d.totals.properties}</b></div>
      <div><label>Cities</label><b>${d.totals.cities}</b></div>
      <div><label>Countries</label><b>${d.totals.countries}</b></div>
    </div>
    ${marketsCard(app)}
    ${myFacilitiesCard(app)}
    ${regions.map((r) => `<h4 class="sect">${r}</h4>${CITIES.filter((c) => c.region === r).map((c) => cityRow(app, c.id)).join('')}`).join('')}
    <h4 class="sect">Competitors</h4>
    ${s.competitors.map((c) => `<div class="list-row static"><span class="logo-dot" style="background:${c.color}">${esc(c.logo)}</span><span class="grow"><b>${esc(c.name)}</b><small>${c.sites.length} sites · ${new Set(c.sites.map((x) => x.cityId)).size} cities · ${money(c.valuation)}</small></span></div>`).join('')}`;
}

function countryPanel(app: App, id: string): string {
  const c = countryById(id);
  const cities = citiesInCountry(id);
  return `
    <div class="panel-head"><h2>${c.flag} ${esc(c.name)}</h2><p class="muted">${cities.length} market${cities.length > 1 ? 's' : ''}. Select a city to see its tech district.</p></div>
    ${cities.map((city) => {
      const s = app.s;
      const unlocked = s.unlockedCities.includes(city.id);
      const supply = app.d.citySupply[city.id] ?? 0, demand = app.d.cityDemand[city.id] ?? 1;
      return `<div class="card city-card">
        <div class="row between"><h3>${esc(city.name)}</h3>${unlocked ? '<span class="tag ok">Open</span>' : `<span class="tag">🔒 Lv ${city.unlockLevel}</span>`}</div>
        <p class="small muted">${esc(city.blurb)}</p>
        <div class="kv">
          <span>Land prices</span><b>${pct(city.landMult)}</b>
          <span>Electricity</span><b>$${city.powerPrice.toFixed(2)}/kWh</b>
          <span>Construction cost</span><b>${pct(city.constructionMult)}</b>
          <span>Property tax</span><b>${(city.tax * 100).toFixed(1)}%</b>
          <span>Grid reliability</span><b>${pct(city.grid)}</b>
          <span>Country rules</span><b title="${esc(COUNTRY_RULES[city.country]?.note ?? '')}">${esc(COUNTRY_RULES[city.country]?.label ?? '—')}</b>
          <span>Permits</span><b>${pct(cityMods(s, city.id).permitCost)} cost · ${pct(cityMods(s, city.id).permitTime)} time</b>
          <span>PUE limit</span><b>${cityMods(s, city.id).pueLimit >= 9 ? 'None' : cityMods(s, city.id).pueLimit.toFixed(2)}</b>
          <span>Market saturation</span><b>${pct(supply / demand)}</b>
          <span>Spot price</span><b>${pct(app.d.cityPrice[city.id] ?? 1)}</b>
        </div>
        <div class="row gap mt">
          <button class="btn primary sm" data-act="mapCity" data-id="${city.id}">View city</button>
          ${unlocked ? '' : btn(`Unlock ${city.license ? money(licenseFee(app.s, city.id)) : ''}`, 'unlockCity', { id: city.id }, 'warn sm', s.level < city.unlockLevel ? `Requires level ${city.unlockLevel}` : s.cash < licenseFee(app.s, city.id) ? `Need ${money(licenseFee(app.s, city.id))}` : undefined)}
        </div>
      </div>`;
    }).join('')}`;
}

function cityPanel(app: App, cityId: string, zoneId: string | null): string {
  const s = app.s, d = app.d;
  const city = cityById(cityId);
  const lay = getCityLayout(cityId);
  const unlocked = s.unlockedCities.includes(cityId);
  const supply = d.citySupply[cityId] ?? 0, demand = d.cityDemand[cityId] ?? 1;
  const filter = app.ui.mapFilter ?? 'all';
  const avail = lay.parcels
    .filter((p) => hasFeature(s, 'g_profit') || p.id === s.company.startParcel)
    .filter((p) => !parcelState(s, p.id).owner && (filter === 'all' || p.type === filter))
    .map((p) => ({ p, price: landValue(s, p.id) }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);
  const mine = Object.entries(s.parcels).filter(([pid, ps]) => ps.owner === 'player' && !ps.mergedInto && getParcel(pid)?.cityId === cityId);
  const zone = zoneId ? getZone(zoneId) : undefined;
  const rule = COUNTRY_RULES[city.country], mods = cityMods(s, cityId), spec = s.citySpec[cityId] ? citySpecById(s.citySpec[cityId].spec) : undefined;
  const rulesCard = `<div class="callout small rules-card"><b>🏛️ ${esc(rule?.label ?? 'Local rules')}</b>${spec ? ` · ${spec.icon} ${esc(spec.name)}` : ''}<br><small>${esc(rule?.note ?? '')} Tax ${pct(mods.taxMult)} · permits ${pct(mods.permitCost)} cost, ${pct(mods.permitTime)} time · PUE limit ${mods.pueLimit >= 9 ? 'none' : mods.pueLimit.toFixed(2)}${mods.privacyTier ? ` · privacy tier ${mods.privacyTier}` : ''}.</small></div>`;
  return `
    <div class="panel-head"><h2>${countryById(city.country).flag} ${esc(city.name)}</h2><p class="muted">${esc(city.districtName)} · ${lay.parcels.length} parcels · ${lay.zones.length} development zones</p>${city.town ? `<p class="small muted">${esc(city.blurb)}</p>` : ''}</div>
    ${rulesCard}
    ${unlocked ? '' : `<div class="callout warn">🔒 This market is locked. ${!hasFeature(s, 'g_stage2') ? `It opens when your company reaches ${STAGES[2].name} status.` : s.level < city.unlockLevel ? `Reach company level ${city.unlockLevel} (you are level ${s.level}), then buy the market license.` : 'Buy the market license to start building here.'} ${btn(`Buy market license ${money(licenseFee(app.s, city.id))}`, 'unlockCity', { id: cityId }, 'warn sm', !hasFeature(s, 'g_stage2') ? `Requires ${STAGES[2].name} status` : s.level < city.unlockLevel ? `Requires level ${city.unlockLevel}` : s.cash < licenseFee(app.s, city.id) ? `Need ${money(licenseFee(app.s, city.id))}` : undefined)}</div>`}
    <div class="card">
      <div class="row between"><b>Market</b><small class="muted">Spot price ${pct(d.cityPrice[cityId] ?? 1)}</small></div>
      ${bar(Math.min(1, supply / demand), supply / demand > 0.9 ? 'warn' : '', `Supply ${num(supply)} / demand ${num(demand)} CU`)}
      <div class="kv mt"><span>Electricity</span><b>$${city.powerPrice.toFixed(2)}/kWh</b><span>Land</span><b>${pct(city.landMult)}</b><span>Construction</span><b>${pct(city.constructionMult)}</b><span>Tax</span><b>${(city.tax * 100).toFixed(1)}%</b></div>
    </div>
    ${zone ? zoneCard(app, zone.id, true) : ''}
    <h4 class="sect">Development zones</h4>
    ${hasFeature(s, 'g_zones') ? lay.zones.map((z) => zoneCard(app, z.id, false)).join('') : `<p class="muted small">🔒 ${lay.zones.length} zones here. Buying whole zones unlocks with Large Development Projects.</p>`}
    <h4 class="sect">Your properties here (${mine.length})</h4>
    ${mine.length ? mine.map(([pid, ps]) => {
      const p = getParcel(pid)!;
      const f = ps.facilityId ? s.facilities[ps.facilityId] : undefined;
      const need = f && !f.isHQ ? dcNeed(f, d.fac[f.id]) : null;
      return `<button class="list-row ${need && need.level !== 'ok' ? 'needs' : ''}" data-act="mapProp" data-id="${pid}"><span class="flag">${need && need.level !== 'ok' ? '⚠️' : f ? (f.isHQ ? '🏢' : '🖥️') : PROPERTY_TYPE_INFO[p.type].icon}</span><span class="grow"><b>${esc(f?.name ?? p.name)}</b><small>${need ? need.label : statusLabel(ps.status)} · ${area(p.area)}</small></span></button>`;
    }).join('') : `<p class="muted small">None yet. ${isMobile() ? 'Tap' : 'Click'} any building in the city to see its price.</p>`}
    <h4 class="sect row between">Cheapest available lots
      <select data-change="mapFilter" class="sel-sm">${['all', 'empty_lot', 'retail', 'restaurant', 'warehouse', 'office', 'industrial', 'industrial_land', 'shopping_center', 'premium'].map((t) => `<option value="${t}" ${filter === t ? 'selected' : ''}>${t === 'all' ? 'All types' : PROPERTY_TYPE_INFO[t as keyof typeof PROPERTY_TYPE_INFO].label}</option>`).join('')}</select></h4>
 ${!hasFeature(s, 'g_profit') ? `<p class="small muted">Only one property is on the market for a company with no track record. Get your first data center profitable and the rest of ${esc(city.name)} opens up.</p>` : ''}
    ${avail.map(({ p, price }) => `<button class="list-row" data-act="mapProp" data-id="${p.id}"><span class="flag">${PROPERTY_TYPE_INFO[p.type].icon}</span><span class="grow"><b>${esc(p.name)}</b><small>${PROPERTY_TYPE_INFO[p.type].label} · ${area(p.area)}${p.zoneId ? ' · in zone' : ''}</small></span><b class="price">${money(price)}</b></button>`).join('') || '<p class="muted small">No lots match.</p>'}`;
}

function zoneCard(app: App, zoneId: string, selected: boolean): string {
  const s = app.s;
  const z = getZone(zoneId)!;
  const q = zoneQuote(s, zoneId);
  const owners = new Set(z.parcelIds.map((pid) => parcelState(s, pid).owner));
  const allMine = owners.size === 1 && owners.has('player');
  const site = parcelState(s, z.siteId);
  const cq = consolidateQuote(s, zoneId);
  const compOwner = [...owners].find((o) => o && o !== 'player');
  const comp = compOwner ? s.competitors.find((c) => c.id === compOwner) : undefined;
  return `<div class="card zone ${selected ? 'sel' : ''}">
    <div class="row between"><b>📐 ${esc(z.name)}</b><small class="muted">${z.parcelIds.length} lots · ${area(z.area)}</small></div>
    ${site.owner === 'player' ? `<p class="small pos">Consolidated into a single campus site.</p><button class="btn primary sm" data-act="mapProp" data-id="${z.siteId}">Open campus site</button>` :
      allMine ? `<p class="small">You own the entire zone. Consolidate cleared lots into one ${area(z.area)} mega-site for hyperscale campuses.</p>
        <div class="row gap">${btn(`Consolidate ${cq.cost ? money(cq.cost) : ''}`, 'consolidate', { id: zoneId }, 'primary sm', cq.ok ? undefined : cq.reason)}</div>` :
      comp ? `<p class="small neg">${esc(comp.name)} owns part of this zone.</p>` :
      `<p class="small muted">Buy all lots together and save 15%.</p>
       <div class="row gap between"><span>${q.full ? `<s class="muted">${money(q.full)}</s> <b>${money(q.price)}</b>` : ''}</span>${btn('Buy entire zone', 'buyZone', { id: zoneId }, 'primary sm', q.ok ? undefined : q.reason)}</div>`}
    ${selected ? '' : `<button class="link sm" data-act="mapZone" data-id="${zoneId}">Select zone</button>`}
  </div>`;
}

export function statusLabel(st: string): string {
  return { existing: 'Existing building', cleared: 'Cleared land', demolishing: 'Demolition in progress', construction: 'Under construction', facility: 'Operational data center', hq: 'Headquarters' }[st] ?? st;
}

function bestBlueprintQuote(app: App, p: ParcelDef) {
  const s = app.s;
  let best: { name: string; total: number } | null = null;
  for (const bp of BLUEPRINTS) {
    if (bp.level > Math.max(s.level, 1) || p.area < bp.minLot) continue;
    if (!p.zoning.heavy && ['hyperscale', 'ai_center', 'supercomputer', 'mega'].includes(bp.id)) continue;
    if (bp.floors > p.zoning.maxFloors) continue;
    const prev = s.parcels[p.id];
    // quote as if cleared & owned to show expected cost
    const saved = prev ? { ...prev } : undefined;
    s.parcels[p.id] = { ...(prev ?? { owner: null, status: 'cleared' }), owner: 'player', status: 'cleared' };
    const q = quoteBuild(s, p.id, bp.id);
    if (saved) s.parcels[p.id] = saved;
    else delete s.parcels[p.id];
    best = { name: bp.name, total: q.total };
  }
  return best;
}

function propertyPanel(app: App, p: ParcelDef): string {
  const s = app.s, d = app.d;
  const st = parcelState(s, p.id);
  const info = PROPERTY_TYPE_INFO[p.type];
  const city = cityById(p.cityId);
  const price = landValue(s, p.id);
  const demo = demolitionCost(s, p);
  const owner = st.owner === 'player' ? 'You' : st.owner ? s.competitors.find((c) => c.id === st.owner)?.name ?? 'Competitor' : 'Available';
  const est = bestBlueprintQuote(app, p);
  const zone = p.zoneId ? getZone(p.zoneId) : undefined;
  let actions = '';
  const pr = st.projectId ? s.projects[st.projectId] : undefined;
  if (!st.owner) {
    const cb = canBuy(s, p.id);
    actions = `<div class="buy-box"><div><label>Purchase price</label><b class="price-big">${money(price)}</b></div>${btn('Buy property', 'buyParcel', { id: p.id }, 'primary lg', cb.ok ? undefined : cb.reason)}</div>`;
    if (!cb.ok && cb.reason) actions += `<p class="small muted buy-why">${esc(cb.reason)}.</p>${isCareer(s) && p.id === s.company.startParcel && !hasFeature(s, 'g_property') ? '<button class="btn primary mt" data-act="nav" data-page="dashboard">🧰 Find freelance work</button>' : ''}`;
    if (zone && !p.isSite) {
      const zq = zoneQuote(s, zone.id);
      actions += `<div class="row between mt small"><span>Part of <b>${esc(zone.name)}</b> (${zone.parcelIds.length} lots)</span>${btn(`Buy zone ${zq.price ? money(zq.price) : ''}`, 'buyZone', { id: zone.id }, 'ghost sm', zq.ok ? undefined : zq.reason)}</div>`;
    }
  } else if (st.owner !== 'player') {
    const comp = s.competitors.find((c) => c.id === st.owner);
    actions = `<div class="callout" style="border-color:${comp?.color}">Owned by <b style="color:${comp?.color}">${esc(comp?.name ?? 'a competitor')}</b>. Not for sale.${comp ? ` <button class="link" data-act="viewComp" data-id="${comp.id}">View company</button>` : ''}</div>`;
  } else if (st.status === 'existing') {
    actions = `<div class="action-grid">
      <button class="btn danger lg" data-act="demolish" data-id="${p.id}" ${s.cash < demo ? `disabled title="Need ${money(demo)}"` : ''}>🧱 Demolish building<br><small>${money(demo)} · ~${duration(demolitionSeconds(p))}</small></button>
      ${canSell(s, p.id).ok ? `<button class="btn ghost" data-act="sellParcel" data-id="${p.id}">Sell for ${money(price * 0.85)}</button>` : ''}
    </div>${s.cash < demo ? `<p class="small muted buy-why">You need ${money(demo)} to demolish it.</p>` : ''}<p class="small muted">Demolish the existing ${info.label.toLowerCase()} to clear the site for a data center.</p>`;
  } else if ((st.status === 'demolishing' || st.status === 'construction') && pr) {
    actions = projectCard(app, pr, true);
  } else if (st.status === 'cleared') {
    const hq = hqQuote(s, p.id);
    actions = `<div class="action-grid">
      <button class="btn primary lg" data-act="openBuild" data-id="${p.id}">🏗️ Build data center<br><small>Premade or custom design</small></button>
      ${!s.company.hqFacility && hasFeature(s, 'g_profit') ? `<button class="btn ghost" data-act="buildHQ" data-id="${p.id}" ${hq.ok ? '' : `disabled title="${esc(hq.reasons[0] ?? '')}"`}>🏢 Build headquarters · ${money(hq.cost)}</button>` : ''}
      ${canSell(s, p.id).ok ? `<button class="btn ghost" data-act="sellParcel" data-id="${p.id}">Sell for ${money(price * 0.85)}</button>` : ''}
    </div>`;
    actions += loanCards(app);
    if (zone && !p.isSite) {
      const cq = consolidateQuote(s, zone.id);
      if (zone.parcelIds.every((pid) => parcelState(s, pid).owner === 'player')) actions += `<div class="row between mt small"><span>You own the whole zone.</span>${btn('Consolidate zone', 'consolidate', { id: zone.id }, 'ghost sm', cq.ok ? undefined : cq.reason)}</div>`;
    }
  } else if (st.status === 'facility' && st.facilityId) {
    const f = s.facilities[st.facilityId];
    const fs = d.fac[f.id];
    actions = `${hookupCard(app, f)}${loanCards(app)}<div class="card">
      <div class="row between"><h3>🖥️ ${esc(f.name)}</h3><span class="tag ${fs.warnings.length ? 'bad' : 'ok'}">${fs.warnings.length ? '⚠ ' + esc(fs.warnings[0]) : 'Healthy'}</span></div>
      <div class="grid3 mini-stats">
        <div><label>Revenue/h</label><b class="pos">${money(fs.revenueHr)}</b></div>
        <div><label>Profit/h</label><b class="${fs.profitHr >= 0 ? 'pos' : 'neg'}">${money(fs.profitHr)}</b></div>
        <div><label>Performance</label><b>${pct(fs.perf)}</b></div>
      </div>
      ${gauge(fs.slotsUsed, f.slots, 'Rack slots', `${fs.slotsUsed}/${f.slots}`)}
      ${gauge(fs.itLoad, fs.powerCap, 'Power', `${power(fs.itLoad)} / ${power(fs.powerCap)}`)}
      ${gauge(fs.itLoad, fs.coolingCap, 'Cooling', `${power(fs.itLoad)} / ${power(fs.coolingCap)}`)}
      <div class="kv small">${(['cpu', 'gpu', 'storage'] as const).map((c) => `<span>${CAP_LABEL[c].name}</span><b>${num(fs.delivered[c])} ${CAP_LABEL[c].unit}</b>`).join('')}</div>
      <div class="row gap mt wrap">${hasFeature(s, 'g_stage2') ? `<button class="btn primary" data-act="autoEquip" data-id="${f.id}" data-k="0.5" ${fs.slotsUsed >= f.slots || s.cash < 20000 ? 'disabled title="No free slots or not enough cash"' : ''}>⚡ Auto-equip (${money(Math.max(0, s.cash) * 0.5)})</button>` : ''}<button class="btn ${hasFeature(s, 'g_stage2') ? 'ghost' : 'primary'}" data-act="manageDC" data-id="${f.id}">Manage facility</button></div>
    </div>`;
  } else if (st.status === 'hq') {
    const q = hqUpgradeQuote(s);
    const tier = HQ_TIERS[s.company.hqTier];
    actions = `<div class="card"><h3>🏢 ${esc(s.company.name)} Headquarters</h3>
      <p class="small">${tier.name} · ${s.employees.length}/${staffCap(s)} staff · +${tier.offlineBonus}h offline cap</p>
      ${q.next ? btn(`Upgrade to ${q.next.name} · ${money(q.cost)}`, 'upgradeHQ', {}, 'primary', q.ok ? undefined : q.reason) : '<p class="pos small">Maximum tier</p>'}
      <button class="btn ghost sm mt" data-act="nav" data-page="employees">Manage staff</button></div>`;
  }
  return `
    <div class="panel-head">
      <div class="row gap"><span class="big-emoji">${p.isSite ? '🏟️' : info.icon}</span><div><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.address)} · ${esc(city.name)}, ${countryById(city.country).name}</p></div></div>
      <div class="row gap mt"><span class="tag">${p.isSite ? 'Consolidated Campus Site' : info.label}</span><span class="tag ${st.owner === 'player' ? 'ok' : st.owner ? 'bad' : ''}">${owner}</span><span class="tag">${statusLabel(st.status)}</span></div>
    </div>
    ${actions}
    <h4 class="sect">Property details</h4>
    <div class="kv">
      <span>Property ID</span><b class="mono">${p.id.toUpperCase()}</b>
      <span>Land size</span><b>${area(p.area)}</b>
      <span>Current building</span><b>${st.status === 'existing' && p.buildingFloors > 0 ? `${p.buildingFloors} fl · ${area(p.buildingArea)}` : st.status === 'facility' || st.status === 'hq' ? 'Your facility' : 'None'}</b>
      <span>Market value</span><b>${money(price)}</b>
      ${st.boughtFor !== undefined && st.owner === 'player' ? `<span>You paid</span><b>${money(st.boughtFor)}</b>` : ''}
      <span>Demolition cost</span><b>${demo ? money(demo) : '—'}</b>
      <span>Zoning</span><b>${p.zoning.code} · ${esc(p.zoning.label)}</b>
      <span>Development potential</span><b>${p.potential}</b>
      <span>Est. development</span><b>${est ? `${money(est.total)} <small class="muted">(${esc(est.name)})</small>` : '<span class="muted">Needs higher level</span>'}</b>
    </div>
    <h4 class="sect">Construction restrictions</h4>
    <ul class="restrictions">${p.restrictions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <h4 class="sect">Development options</h4>
    <div class="dev-options">${BLUEPRINTS.map((bp) => {
      const ok = p.area >= bp.minLot && bp.floors <= p.zoning.maxFloors && (p.zoning.heavy || !['hyperscale', 'ai_center', 'supercomputer', 'mega'].includes(bp.id));
      const lvl = s.level >= bp.level;
      return `<span class="opt ${ok && lvl ? 'ok' : ok ? 'lvl' : 'no'}" title="${ok ? (lvl ? 'Buildable' : `Requires level ${bp.level}`) : `Needs ${area(bp.minLot)}${!p.zoning.heavy ? ', heavy zoning' : ''}`}">${ok && lvl ? '✓' : ok ? '🔒' : '✕'} ${bp.name}</span>`;
    }).join('')}</div>`;
}

export function mapActions(app: App) {
  return {
    mapProp: (el: HTMLElement) => app.map?.goProperty(el.dataset.id!),
    mapZone: (el: HTMLElement) => app.map?.selectZone(el.dataset.id!),
    buyParcel: (el: HTMLElement) => app.run(() => buyParcel(app.s, el.dataset.id!)),
    buyZone: (el: HTMLElement) => {
      const z = getZone(el.dataset.id!)!;
      const q = zoneQuote(app.s, z.id);
      if (!q.ok) return app.run(() => q);
      confirmDialog('Buy development zone?', `Acquire all <b>${q.lots.length}</b> remaining lots in <b>${esc(z.name)}</b> for <b>${money(q.price)}</b> (15% bundle discount).`, 'Buy zone', () => app.run(() => buyZone(app.s, z.id)));
    },
    demolish: (el: HTMLElement) => {
      const p = getParcel(el.dataset.id!)!;
      confirmDialog('Demolish building?', `Tear down the existing building at <b>${esc(p.name)}</b> for <b>${money(demolitionCost(app.s, p))}</b>. This cannot be undone.`, 'Demolish', () => app.run(() => startDemolition(app.s, p.id)), true);
    },
    sellParcel: (el: HTMLElement) => {
      const p = getParcel(el.dataset.id!)!;
      confirmDialog('Sell property?', `Sell <b>${esc(p.name)}</b> for <b>${money(landValue(app.s, p.id) * 0.85)}</b>?`, 'Sell', () => app.run(() => sellParcel(app.s, p.id)), true);
    },
    consolidate: (el: HTMLElement) => {
      const q = consolidateQuote(app.s, el.dataset.id!);
      if (!q.ok) return app.run(() => q);
      confirmDialog('Consolidate zone?', `Merge every lot in this zone into one campus site. Permits cost <b>${money(q.cost)}</b>.`, 'Consolidate', () => app.run(() => consolidateZone(app.s, el.dataset.id!)));
    },
    openBuild: (el: HTMLElement) => openBuildModal(app, el.dataset.id!),
    buildHQ: (el: HTMLElement) => app.run(() => startHQ(app.s, el.dataset.id!)),
    upgradeHQ: () => app.run(() => upgradeHQ(app.s)),
    unlockCity: (el: HTMLElement) => app.run(() => unlockCity(app.s, el.dataset.id!)),
    speedUp: (el: HTMLElement) => app.run(() => speedUp(app.s, el.dataset.id!, el.dataset.opt!)),
    manageDC: (el: HTMLElement) => {
      app.ui.dcId = el.dataset.id;
      app.navigate('datacenters');
    },
    viewComp: (el: HTMLElement) => {
      app.ui.compId = el.dataset.id;
      app.navigate('competitors');
    },
  };
}

export function mapChanges(app: App) {
  return {
    mapFilter: (el: HTMLElement) => {
      app.ui.mapFilter = (el as HTMLSelectElement).value;
      app.render();
    },
  };
}

export { COUNTRIES };
