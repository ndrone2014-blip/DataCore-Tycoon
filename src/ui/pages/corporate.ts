// Corporate Strategy, Global Network, Markets & Rules, Suppliers and Industry pages.

import type { App } from '../app';
import { money, num, pct, esc, gameDate } from '../../core/format';
import { stat, btn, bar, empty, confirmDialog } from '../components';
import { chart } from '../charts';
import { CITIES, COUNTRIES, cityById, countryById } from '../../config/world';
import { CITY_NATURAL, CITY_SPECS, COUNTRY_RULES, FIBER_KIND, FIBER_LINKS, POLICIES, POLICY_COOLDOWN_HOURS, SPEC_COOLDOWN_HOURS, SUPPLIERS, SUPPLY_CATS, SUPPLY_DEALS, citySpecById, fiberLink, specFee, supplierById, type SupplyCat } from '../../config/expansion';
import { currentPolicy, policyFee, policyQuote, setCitySpec, setPolicy } from '../../systems/strategy';
import { REP_REQ, REP_WEIGHTS, repOfferMult, repParts, repTarget, repValuationMult } from '../../systems/reputation';
import { buildHub, buildRoute, hubQuote, linkStatus, routeQuote, arc } from '../../systems/fiber';
import { cityMods, specQuote } from '../../systems/regulation';
import { activeSupplier, chooseSupplier, dealFee, signDeal, supplierTerms } from '../../systems/suppliers';
import { RANK_METRICS, cityBoard, companyRows, countryBoard, ranked, type RankMetric } from '../../systems/rankings';
import { fallbackLand } from '../../map/fallbackGeo';
import { eventText } from '../../systems/events';
import type { ActiveEvent } from '../../core/state';

const START = Date.UTC(2027, 0, 1, 8);
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

// ---------- Corporate Strategy ----------
export function renderStrategy(app: App): string {
  const s = app.s, d = app.d;
  const rep = s.company.reputation;
  const parts = repParts(s, d);
  const target = repTarget(s, d, parts);
  const fee = policyFee(d.totals.valuation);
  const hist = s.rep.history;
  return `
  <div class="grid4">
    ${stat('Reputation', rep.toFixed(1), `Heading toward ${target.toFixed(0)}`, 'accent')}
    ${stat('Customer interest', `${Math.round(repOfferMult(rep) * 100)}%`, 'How often new offers arrive')}
    ${stat('Contract pricing', signedPct((rep - 50) / 500), 'From reputation alone')}
    ${stat('Valuation multiple', `${repValuationMult(rep).toFixed(2)}×`, 'Applied to your earnings')}
  </div>
  <div class="card mt">
    <div class="row between wrap"><h3>🧭 Company policies</h3><small class="muted">Changing a policy costs ${money(fee)}, and the board won't revisit it for ${Math.round(POLICY_COOLDOWN_HOURS / 24)} days.</small></div>
    ${POLICIES.map((p) => {
      const cur = currentPolicy(s, p.id);
      const at = s.policyAt[p.id];
      return `<div class="policy"><div class="policy-head"><b>${esc(p.title)}</b><small class="muted">${esc(p.question)}</small>${s.level < p.level ? `<span class="tag">🔒 Level ${p.level}</span>` : at !== undefined ? `<small class="muted">Set ${gameDate(START, at, false)}</small>` : ''}</div>
        <div class="policy-opts">${p.options.map((o) => {
          const q = policyQuote(s, d.totals.valuation, p.id, o.id);
          const on = cur.id === o.id;
          return `<div class="opt-card ${on ? 'on' : ''}"><div class="opt-title"><span>${o.icon}</span><b>${esc(o.label)}</b>${on ? '<span class="tag ok sm">Active</span>' : ''}</div>
            <p class="small muted">${esc(o.desc)}</p>
            <ul class="pc">${o.pros.map((x) => `<li class="pos">${esc(x)}</li>`).join('')}${o.cons.map((x) => `<li class="neg">${esc(x)}</li>`).join('')}</ul>
            ${on ? '' : btn('Adopt', 'setPolicy', { p: p.id, o: o.id }, 'ghost sm', q.ok ? undefined : q.reason)}</div>`;
        }).join('')}</div></div>`;
    }).join('')}
  </div>
  <div class="grid2 mt">
    <div class="card"><h3>🏅 What drives your reputation</h3>
      ${REP_WEIGHTS.map((w) => `<div class="rep-row" title="${esc(w.hint)}"><span>${w.label}<small class="muted"> ${Math.round(w.weight * 100)}%</small></span>${bar(parts[w.id] / 100, parts[w.id] < 50 ? 'bad' : parts[w.id] < 75 ? 'warn' : 'ok')}<b>${Math.round(parts[w.id])}</b></div>`).join('')}
      <h4 class="sect">What it unlocks</h4>
      <div class="kv small">${Object.entries(REP_REQ).map(([k, v]) => `<span>${k === 'government' ? 'Government agencies' : 'Technology companies'}</span><b class="${rep >= (v as number) ? 'pos' : 'neg'}">Needs ${v} ${rep >= (v as number) ? '✓' : ''}</b>`).join('')}<span>Supplier prices</span><b>${signedPct(-(rep - 50) / 1000)}</b></div>
    </div>
    <div class="card"><h3>Reputation over time</h3>${hist.length > 1 ? chart('rep-hist', { type: 'line', height: 250, labels: hist.map((_, i) => `Day ${i + 1}`), datasets: [{ label: 'Reputation', data: hist, color: '#a78bfa', fill: true }] }) : empty('📈', 'Tracking started', 'Reputation is recorded every game day.')}</div>
  </div>`;
}

// ---------- Global Network ----------
let landPath = '';
const MAP_W = 960, MAP_H = 430;
const landX = (lng: number) => ((Math.max(-180, Math.min(180, lng)) + 180) / 360) * MAP_W;
const px = (lng: number) => ((((lng + 180) % 360) + 360) % 360) / 360 * MAP_W;
// close-together cities label outward so the names stay readable
const LABEL: Record<string, [number, number, string]> = {
  chicago: [-8, -7, 'end'], toronto: [0, -10, 'middle'], nova: [9, 11, 'start'], newyork: [9, 0, 'start'], dallas: [0, 16, 'middle'], phoenix: [-2, 16, 'middle'], losangeles: [-8, 3, 'end'],
  london: [-8, -2, 'end'], amsterdam: [0, -10, 'middle'], paris: [-8, 10, 'end'], frankfurt: [9, 4, 'start'], seoul: [-8, -3, 'end'], tokyo: [9, 3, 'start'], singapore: [0, 16, 'middle'], sydney: [9, -2, 'start'], melbourne: [-8, 8, 'end'],
};
const py = (lat: number) => ((80 - lat) / 140) * MAP_H;
function landSvg(): string {
  if (landPath) return landPath;
  let out = '';
  for (const f of fallbackLand().features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) out += `M${ring.map((p: number[]) => `${landX(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join('L')}Z`;
  }
  landPath = out;
  return out;
}
function routePath(a: [number, number], b: [number, number]): string {
  let out = '';
  let last: number | null = null;
  for (const [lng, lat] of arc(a, b, 24)) {
    const x = px(lng), y = py(lat);
    out += `${last === null || Math.abs(x - last) > MAP_W / 2 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    last = x;
  }
  return out;
}

export function renderNetwork(app: App): string {
  const s = app.s, d = app.d, n = d.net;
  const sel = app.ui.netCity as string | null;
  const colors: Record<string, string> = { player: s.company.color };
  for (const c of s.competitors) colors[c.id] = c.color;
  const names: Record<string, string> = { player: s.company.name };
  for (const c of s.competitors) names[c.id] = c.name;
  const live = s.fiber.routes.filter((r) => r.owner === 'player' && r.doneAt <= s.gameHours).length;
  const building = s.fiber.routes.filter((r) => r.owner === 'player' && r.doneAt > s.gameHours).length;
  const links = FIBER_LINKS.filter((l) => !sel || l.a === sel || l.b === sel).sort((a, b) => {
    const ka = linkStatus(s, a).mine ? 0 : routeQuote(s, a.id).ok ? 1 : 2, kb = linkStatus(s, b).mine ? 0 : routeQuote(s, b.id).ok ? 1 : 2;
    return ka - kb || a.km - b.km;
  });
  const hub = sel ? hubQuote(s, sel) : null;
  const selNet = sel ? n.city[sel] : null;
  return `
  <div class="grid4">
    ${stat('Routes online', `${live}`, building ? `${building} under construction` : 'Connect your markets', 'accent')}
    ${stat('Transit income / hr', money(n.transitHr), 'Other carriers paying to use your fiber')}
    ${stat('Upkeep / hr', money(n.upkeepHr), 'Repairs, power and leases')}
    ${stat('Cities covered', `${n.coverage.player ?? 0} / ${CITIES.length}`, 'Better prices, cheaper connectivity')}
  </div>
  <div class="card mt netmap-card">
    <div class="row between wrap"><h3>🌐 Worldwide network</h3><small class="muted">Select a city to filter routes. Rival carriers are shown as thin lines.</small></div>
    <svg class="netmap" viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="World map of fiber routes" data-key="netmap">
      <path class="land" d="${landSvg()}"/>
      ${s.fiber.routes.filter((r) => r.owner !== 'player').map((r) => { const l = fiberLink(r.link); return l ? `<path class="rt rival" stroke="${colors[r.owner] ?? '#64748b'}" d="${routePath(cityById(l.a).center, cityById(l.b).center)}"/>` : ''; }).join('')}
      ${s.fiber.routes.filter((r) => r.owner === 'player').map((r) => { const l = fiberLink(r.link); return l ? `<path class="rt mine ${r.doneAt > s.gameHours ? 'building' : ''}" stroke="${s.company.color}" stroke-width="${1.2 + r.tier * 0.7}" d="${routePath(cityById(l.a).center, cityById(l.b).center)}"/>` : ''; }).join('')}
      ${CITIES.map((c) => { const open = s.unlockedCities.includes(c.id); const x = px(c.center[0]), y = py(c.center[1]); return `<g class="nd ${open ? '' : 'locked'} ${sel === c.id ? 'sel' : ''}" data-act="netCity" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)}"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(n.city[c.id]?.hub ?? 0) ? 7 : 5}"/><text x="${(x + (LABEL[c.id]?.[0] ?? 0)).toFixed(1)}" y="${(y + (LABEL[c.id]?.[1] ?? -9)).toFixed(1)}" text-anchor="${LABEL[c.id]?.[2] ?? 'middle'}">${esc(c.name)}</text></g>`; }).join('')}
    </svg>
  </div>
  ${sel ? `<div class="card mt"><div class="row between wrap"><h3>${countryById(cityById(sel).country).flag} ${esc(cityById(sel).name)}</h3><button class="btn ghost sm" data-act="netCity" data-id="">Show all routes</button></div>
    <div class="grid4 mini-stats">
      <div><label>Your routes</label><b>${selNet?.links ?? 0}</b></div>
      <div><label>Connectivity savings</label><b>${pct(selNet?.connectCut ?? 0)}</b></div>
      <div><label>Spot price bonus</label><b>${signedPct(selNet?.spotBonus ?? 0)}</b></div>
      <div><label>New contract bonus</label><b>${signedPct(selNet?.contractBonus ?? 0)}</b></div>
    </div>
    ${hub?.next ? `<div class="row between wrap mt"><span><b>${esc(hub.next.name)}</b><br><small class="muted">Adds transit income on every route here, and improves all the bonuses above.</small></span>${btn(`Build ${money(hub.cost)}`, 'buildHub', { id: sel }, 'primary sm', hub.ok ? undefined : hub.reason)}</div>` : `<p class="small muted mt">This city has a fully developed internet hub.</p>`}
  </div>` : ''}
  <div class="card mt"><h3>Routes</h3>
    <table class="tbl"><thead><tr><th>Route</th><th>Type</th><th>Length</th><th>Carriers</th><th>Income/h</th><th>Status</th><th></th></tr></thead><tbody>
    ${links.map((l) => {
      const st = linkStatus(s, l), q = routeQuote(s, l.id);
      const label = st.mine ? (st.mine.tier >= 3 ? '' : `Upgrade ${money(q.cost)}`) : `Build ${money(q.cost)}`;
      return `<tr class="${st.mine ? 'me' : ''}"><td><b>${esc(cityById(l.a).name)} ⇄ ${esc(cityById(l.b).name)}</b></td><td>${FIBER_KIND[l.kind].icon} ${FIBER_KIND[l.kind].label}</td><td>${num(l.km)} km</td>
        <td><span class="dots">${st.mine ? `<i style="background:${s.company.color}" title="You"></i>` : ''}${st.rivals.map((r) => `<i style="background:${colors[r.owner] ?? '#64748b'}" title="${esc(names[r.owner] ?? 'Rival')}"></i>`).join('')}</span></td>
        <td>${st.mine && n.byRoute[st.mine.id] ? money(n.byRoute[st.mine.id]) : '—'}</td>
        <td>${st.mine ? (st.building ? `<span class="tag">Building · ${Math.ceil(st.mine.doneAt - s.gameHours)}h</span>` : `<span class="tag ok">Tier ${st.mine.tier}</span>`) : `<small class="muted">${esc(q.reason && !q.ok ? q.reason : `${q.hours}h to build`)}</small>`}</td>
        <td>${label ? btn(label, 'buildRoute', { id: l.id }, st.mine ? 'ghost sm' : 'primary sm', q.ok ? undefined : q.reason) : ''}</td></tr>`;
    }).join('')}
    </tbody></table>
    <p class="small muted mt">A route on its own pays back in about ${Math.round(1000 / 24)} game days. Each rival on the same link takes a share of the income, and upgrades win a bigger share.</p>
  </div>`;
}

// ---------- Markets & Rules ----------
export function renderMarkets(app: App): string {
  const s = app.s, d = app.d;
  const myCities = new Set(Object.values(s.facilities).filter((f) => !f.isHQ).map((f) => f.cityId));
  const cityRows = CITIES.filter((c) => s.unlockedCities.includes(c.id)).sort((a, b) => Number(myCities.has(b.id)) - Number(myCities.has(a.id)));
  const lim = (v: number) => (v >= 9 ? 'None' : v.toFixed(2));
  return `
  <div class="card"><div class="row between wrap"><h3>🎯 Regional focus</h3><small class="muted">Optional. Build anything anywhere; a focus adds bonuses and trade-offs. Matching what a city is known for makes the upside 50% stronger.</small></div>
    ${cityRows.map((c) => {
      const cur = s.citySpec[c.id];
      const curDef = cur ? citySpecById(cur.spec) : undefined;
      const natural = CITY_SPECS.find((x) => x.id === CITY_NATURAL[c.id]);
      const left = cur ? SPEC_COOLDOWN_HOURS - (s.gameHours - cur.since) : 0;
      return `<div class="spec-row ${myCities.has(c.id) ? '' : 'dim'}">
        <div class="spec-city"><b>${countryById(c.country).flag} ${esc(c.name)}</b><small class="muted">${curDef ? `${curDef.icon} ${esc(curDef.name)}${left > 0 ? ` · can change in ${Math.ceil(left / 24)}d` : ''}` : myCities.has(c.id) ? 'No focus yet' : 'No data centers here yet'}</small><small class="muted">Known for: ${natural ? `${natural.icon} ${esc(natural.name)}` : '—'}</small></div>
        <div class="spec-opts">${CITY_SPECS.map((o) => { const q = specQuote(s, c.id, o.id); const on = cur?.spec === o.id; return `<button class="chip ${on ? 'on' : ''} ${natural?.id === o.id ? 'nat' : ''}" data-act="setSpec" data-city="${c.id}" data-spec="${o.id}" ${q.ok || on ? '' : `disabled`} title="${esc(on ? o.desc : `${o.desc} ${q.ok ? `Costs ${money(q.cost)}.` : q.reason}`)}">${o.icon} ${esc(o.name)}</button>`; }).join('')}</div>
      </div>`;
    }).join('')}
    <p class="small muted mt">Setting a focus costs from ${money(150_000)}, depending on the city (${esc(cityById(cityRows[0]?.id ?? 'nova').name)}: ${money(specFee(cityRows[0]?.id ?? 'nova'))}).</p>
  </div>
  <div class="card mt"><h3>🏛️ Country rules</h3><p class="small muted">Check these before you buy land. Events can change them for months at a time.</p>
    <table class="tbl"><thead><tr><th>Country</th><th>Climate</th><th>Property tax</th><th>Permit cost</th><th>Permit time</th><th>PUE limit</th><th>Over-limit fee</th><th>Privacy tier</th><th>Gov. demand</th></tr></thead><tbody>
    ${COUNTRIES.map((c) => {
      const rule = COUNTRY_RULES[c.id];
      const city = CITIES.find((x) => x.country === c.id)!;
      const m = cityMods(s, city.id);
      const mark = (now: number, base: number, invert = false) => (Math.abs(now - base) > 1e-6 ? `<b class="${(now > base) !== invert ? 'neg' : 'pos'}">` : '<b>');
      const here = CITIES.some((x) => x.country === c.id && myCities.has(x.id));
      return `<tr class="${here ? 'me' : ''}"><td>${c.flag} <b>${esc(c.name)}</b></td><td title="${esc(rule.note)}">${esc(rule.label)}</td><td>${mark(m.taxMult, rule.taxMult)}${pct(m.taxMult)}</b></td><td>${mark(m.permitCost, rule.permitCost)}${pct(m.permitCost)}</b></td><td>${mark(m.permitTime, rule.permitTime)}${pct(m.permitTime)}</b></td><td>${mark(m.pueLimit, rule.pueLimit, true)}${lim(m.pueLimit)}</b></td><td>${pct(m.carbonFee)}</td><td>${m.privacyTier || '—'}</td><td>${mark(m.govDemand, rule.govDemand, true)}${m.govDemand.toFixed(1)}×</b></td></tr>`;
    }).join('')}
    </tbody></table>
    <p class="small muted mt">Colored figures show a temporary change from a world event. Over-limit fees are a share of the power bill at any facility whose PUE is above the local limit. Your average PUE today: ${(() => { const list = Object.values(d.fac).filter((x) => x.servers > 0); return list.length ? (list.reduce((a, x) => a + x.pue, 0) / list.length).toFixed(2) : '—'; })()}.</p>
  </div>`;
}

// ---------- Suppliers ----------
export function renderSuppliers(app: App): string {
  const s = app.s, d = app.d;
  const shortages = s.events.filter((e) => e.defId === 'supply_crunch' && e.supplier);
  return `
  ${shortages.length ? `<div class="callout warn">⚠️ <b>Supply crunch:</b> ${shortages.map((e) => esc(supplierById(e.supplier!)?.name ?? '')).join(', ')} ${shortages.length > 1 ? 'are' : 'is'} short of stock. Prices are up and deliveries are slower.</div>` : ''}
  <p class="small muted">Your chosen vendor sets the price, quality and delivery time for everything you buy from now on. Hardware you already own keeps the quality it was bought with. Hardware with a delivery time takes up its slot straight away and starts running when it arrives.</p>
  ${SUPPLY_CATS.map((c) => {
    const cur = activeSupplier(s, c.id);
    const deal = s.supply.deals[c.id];
    const dealOn = deal && deal.until > s.gameHours;
    return `<div class="card mt"><div class="row between wrap"><h3>${c.icon} ${esc(c.label)}</h3>
      ${dealOn ? `<span class="tag ok">${Math.round(deal.discount * 100)}% off with ${esc(supplierById(deal.supplier)?.name ?? '')} · ${Math.ceil((deal.until - s.gameHours) / 24)} days left</span>` : `<div class="row gap wrap">${SUPPLY_DEALS.map((x) => { const fee = dealFee(d.totals.valuation, x.id); return btn(`${x.label}: ${Math.round(x.discount * 100)}% off · ${money(fee)}`, 'signDeal', { cat: c.id, deal: x.id }, 'ghost sm', s.cash < fee ? `Need ${money(fee)}` : undefined); }).join('')}</div>`}</div>
      <div class="sup-grid">${SUPPLIERS.filter((x) => x.cat === c.id).map((x) => {
        const t = supplierTerms(s, x);
        const on = cur.id === x.id;
        const locked = s.level < x.level;
        const tied = dealOn && deal.supplier !== x.id;
        return `<div class="opt-card ${on ? 'on' : ''}"><div class="opt-title"><b>${esc(x.name)}</b><span class="tag sm">${esc(x.tag)}</span>${t.short ? '<span class="tag warn sm">Shortage</span>' : ''}</div>
          <p class="small muted">${esc(x.desc)}</p>
          <div class="kv small"><span>Price</span><b class="${t.price > 1.001 ? 'neg' : t.price < 0.999 ? 'pos' : ''}">${pct(t.price)}</b><span>Performance</span><b class="${t.perf > 1 ? 'pos' : t.perf < 1 ? 'neg' : ''}">${pct(t.perf)}</b><span>Upkeep</span><b class="${t.rel > 1 ? 'neg' : t.rel < 1 ? 'pos' : ''}">${pct(t.rel)}</b><span>Delivery</span><b>${t.lead ? `${t.lead} hours` : 'Immediate'}</b><span>Technology</span><b>Generation ${t.gen + 1}</b></div>
          ${on ? '<span class="tag ok">Your supplier</span>' : btn('Switch', 'chooseSupplier', { cat: c.id, id: x.id }, 'ghost sm', locked ? `Requires level ${x.level}` : tied ? 'You are under contract with another vendor' : undefined)}</div>`;
      }).join('')}</div></div>`;
  }).join('')}`;
}

// ---------- Industry ----------
function fmtMetric(v: number, f: string): string {
  return f === 'money' ? money(v) : f === 'pct' ? pct(v) : num(v);
}
export function renderIndustry(app: App): string {
  const s = app.s, d = app.d;
  const tab = app.ui.indTab ?? 'news';
  const tabs = `<div class="tabs">${[['news', '📰 Industry news'], ['rankings', '🏆 Global rankings'], ['local', '📍 By market'], ['compare', '⚔️ Compare']].map(([id, l]) => `<button class="${tab === id ? 'on' : ''}" data-act="indTab" data-v="${id}">${l}</button>`).join('')}</div>`;
  const rows = companyRows(s, d);
  let body = '';
  if (tab === 'news') {
    const filter = app.ui.newsTag ?? 'all';
    const tags = ['all', ...new Set(s.news.map((n) => n.tag))];
    const items = s.news.filter((n) => filter === 'all' || n.tag === filter);
    body = `<div class="grid2-1"><div class="card"><div class="row between wrap"><h3>Headlines</h3><div class="row gap wrap">${tags.map((t) => `<button class="chip ${filter === t ? 'on' : ''}" data-act="newsTag" data-v="${esc(t)}">${t === 'all' ? 'All' : esc(t)}</button>`).join('')}</div></div>
      ${items.length ? items.slice(0, 40).map((n) => `<div class="news ${n.kind}"><small>${gameDate(START, n.t)} · ${esc(n.tag)}</small><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`).join('') : empty('📰', 'Nothing yet', 'News appears as the market moves.')}</div>
      <div class="card"><h3>In force now</h3>${s.events.length ? s.events.map((e) => `<div class="event ${eventGood(e.defId) ? 'good' : 'bad'}"><b>${esc(eventTitle(e))}</b><small>${esc(eventDesc(e))} · ${Math.ceil((e.endsAt - s.gameHours) / 24)}d left</small></div>`).join('') : '<p class="small muted">Markets are calm.</p>'}</div></div>`;
  } else if (tab === 'rankings') {
    const metric = (app.ui.rankMetric ?? 'valuation') as RankMetric;
    const def = RANK_METRICS.find((m) => m.id === metric)!;
    const list = ranked(rows, metric);
    const top = Math.max(1e-9, Math.abs(list[0][metric] as number));
    body = `<div class="card"><div class="row between wrap"><h3>Worldwide leaderboard</h3><select data-change="rankMetric">${RANK_METRICS.map((m) => `<option value="${m.id}" ${m.id === metric ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
      <table class="tbl"><thead><tr><th>#</th><th>Company</th><th>${def.label}</th><th style="width:40%"></th></tr></thead><tbody>
      ${list.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="logo-dot" style="background:${r.color}">${esc(r.logo)}</span> <b>${esc(r.name)}</b></td><td>${fmtMetric(r[metric] as number, def.fmt)}</td><td>${bar(Math.max(0, (r[metric] as number) / top))}</td></tr>`).join('')}</tbody></table></div>
      <div class="card mt"><h3>Where you stand</h3><div class="rank-grid">${RANK_METRICS.map((m) => { const pos = ranked(rows, m.id).findIndex((r) => r.me) + 1; return `<button class="rank-chip ${m.id === metric ? 'on' : ''}" data-act="rankMetric" data-v="${m.id}"><b>#${pos}</b><small>${m.label}</small></button>`; }).join('')}</div></div>`;
  } else if (tab === 'local') {
    const countries = COUNTRIES.map((c) => ({ c, list: countryBoard(s, d, c.id) })).filter((x) => x.list.length);
    const cities = CITIES.map((c) => ({ c, list: cityBoard(s, d, c.id) })).filter((x) => x.list.length);
    const board = (list: ReturnType<typeof cityBoard>) => { const tot = list.reduce((a, r) => a + r.cu, 0) || 1; return `<div class="share-bar">${list.map((r) => `<i style="width:${((r.cu / tot) * 100).toFixed(1)}%;background:${r.color}" title="${esc(r.name)} ${pct(r.cu / tot)}"></i>`).join('')}</div><small class="muted">#1 ${esc(list[0].name)} ${pct(list[0].cu / tot)}${list.some((r) => r.me) ? ` · You: #${list.findIndex((r) => r.me) + 1}, ${pct(list.find((r) => r.me)!.cu / tot)}` : ''}</small>`; };
    body = `<div class="grid2"><div class="card"><h3>Countries</h3>${countries.map(({ c, list }) => `<div class="share-row"><b>${c.flag} ${esc(c.name)}</b>${board(list)}</div>`).join('') || '<p class="muted small">No capacity online yet.</p>'}</div>
      <div class="card"><h3>Cities</h3>${cities.map(({ c, list }) => `<div class="share-row"><b>${esc(c.name)}</b>${board(list)}</div>`).join('') || '<p class="muted small">No capacity online yet.</p>'}</div></div>`;
  } else {
    const rivals = rows.filter((r) => !r.me);
    const id = app.ui.compareId && rivals.some((r) => r.id === app.ui.compareId) ? app.ui.compareId : rivals[0]?.id;
    const r = rivals.find((x) => x.id === id);
    const me = rows[0];
    body = r ? `<div class="card"><div class="row between wrap"><h3>${esc(me.name)} vs ${esc(r.name)}</h3><select data-change="compareId">${rivals.map((x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <table class="tbl"><thead><tr><th>Measure</th><th>You</th><th>${esc(r.name)}</th><th>Lead</th></tr></thead><tbody>${RANK_METRICS.map((m) => { const a = me[m.id] as number, b = r[m.id] as number; return `<tr><td>${m.label}</td><td>${fmtMetric(a, m.fmt)}</td><td>${fmtMetric(b, m.fmt)}</td><td class="${a >= b ? 'pos' : 'neg'}">${a >= b ? 'You' : esc(r.name)}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="card">${empty('🏆', 'No rivals left', 'You own the industry.')}</div>`;
  }
  return `${tabs}<div class="mt">${body}</div>`;
}

const eventGood = (id: string) => eventText(id).good;
const eventTitle = (e: ActiveEvent) => `${eventText(e.defId, e.cityId, e).title}`;
const eventDesc = (e: ActiveEvent) => eventText(e.defId, e.cityId, e).desc;

// ---------- actions ----------
export function corporateActions(app: App) {
  return {
    setPolicy: (el: HTMLElement) => {
      const { p, o } = el.dataset as { p: string; o: string };
      const fee = policyFee(app.d.totals.valuation);
      const opt = POLICIES.find((x) => x.id === p)!.options.find((x) => x.id === o)!;
      confirmDialog(`Adopt "${opt.label}"?`, `Restructuring costs <b>${money(fee)}</b>. You won't be able to change this policy again for ${Math.round(POLICY_COOLDOWN_HOURS / 24)} days.`, 'Adopt policy', () => app.run(() => setPolicy(app.s, app.d.totals.valuation, p, o)));
    },
    setSpec: (el: HTMLElement) => {
      const { city, spec } = el.dataset as { city: string; spec: string };
      const def = citySpecById(spec)!;
      const q = specQuote(app.s, city, spec);
      if (!q.ok) return;
      confirmDialog(`Make ${esc(cityById(city).name)} a ${esc(def.name)}?`, `${esc(def.desc)} This costs <b>${money(q.cost)}</b> and can't be changed for ${Math.round(SPEC_COOLDOWN_HOURS / 24)} days.`, 'Set focus', () => app.run(() => setCitySpec(app.s, city, spec)));
    },
    netCity: (el: HTMLElement) => { const id = el.dataset.id || null; app.ui.netCity = app.ui.netCity === id ? null : id; app.render(); },
    buildRoute: (el: HTMLElement) => app.run(() => buildRoute(app.s, el.dataset.id!)),
    buildHub: (el: HTMLElement) => app.run(() => buildHub(app.s, el.dataset.id!)),
    chooseSupplier: (el: HTMLElement) => app.run(() => chooseSupplier(app.s, el.dataset.cat as SupplyCat, el.dataset.id!)),
    signDeal: (el: HTMLElement) => app.run(() => signDeal(app.s, app.d.totals.valuation, el.dataset.cat as SupplyCat, el.dataset.deal!)),
    indTab: (el: HTMLElement) => { app.ui.indTab = el.dataset.v; app.render(); },
    newsTag: (el: HTMLElement) => { app.ui.newsTag = el.dataset.v; app.render(); },
    rankMetric: (el: HTMLElement) => { app.ui.rankMetric = el.dataset.v; app.render(); },
  };
}
export function corporateChanges(app: App) {
  return {
    rankMetric: (el: HTMLElement) => { app.ui.rankMetric = (el as HTMLSelectElement).value; app.render(); },
    compareId: (el: HTMLElement) => { app.ui.compareId = (el as HTMLSelectElement).value; app.render(); },
  };
}
