// Construction dialog: premade blueprints or a fully custom building.

import type { App } from '../app';
import { BLUEPRINTS, blueprintById, COOLING_TIERS, ELECTRICAL_TIERS, EXTERIOR_STYLES, type CustomOptions } from '../../config/buildings';
import { getParcel } from '../../world/parcels';
import { quoteBuild, startBuild, defaultCustom } from '../../systems/construction';
import { openModal, closeModal } from '../components';
import { registerActions, registerChanges } from '../dom';
import { money, area, power, esc, duration } from '../../core/format';

interface BuildUI {
  parcelId: string;
  mode: 'premade' | 'custom';
  bp: string;
  custom: CustomOptions;
  name: string;
}

let ui: BuildUI | null = null;
let installed = false;

export function openBuildModal(app: App, parcelId: string) {
  const p = getParcel(parcelId)!;
  const feasible = BLUEPRINTS.filter((b) => (app.s.dev?.unlockAll || b.level <= app.s.level) && b.minLot <= p.area);
  const bp = feasible[feasible.length - 1] ?? BLUEPRINTS[0];
  ui = { parcelId, mode: 'premade', bp: bp.id, custom: defaultCustom(bp, p), name: '' };
  if (!installed) install(app);
  openModal(() => render(app), { wide: true, onClose: () => (ui = null) });
}

function render(app: App): string {
  if (!ui) return '';
  const s = app.s;
  const p = getParcel(ui.parcelId)!;
  const q = quoteBuild(s, ui.parcelId, ui.bp, ui.mode === 'custom' ? ui.custom : undefined);
  const bp = blueprintById(ui.bp);
  const c = ui.custom;
  const left = ui.mode === 'premade'
    ? `<div class="bp-list">${BLUEPRINTS.map((b) => {
        const qq = quoteBuild(s, ui!.parcelId, b.id);
        const locked = s.level < b.level && !s.dev?.unlockAll;
        const fits = p.area >= b.minLot;
        return `<button class="bp ${ui!.bp === b.id ? 'sel' : ''} ${locked || !fits ? 'dim' : ''}" data-act="bpPick" data-id="${b.id}">
          <div class="row between"><b>${b.name}</b><span>${money(b.cost)}</span></div>
          <small>${b.slots} racks · ${power(b.power)} · ${b.floors} fl · min ${area(b.minLot)}</small>
          ${locked ? `<em class="neg">🔒 Level ${b.level}</em>` : !fits ? `<em class="neg">Lot too small</em>` : qq.ok ? `<em class="pos">Total ${money(qq.total)}</em>` : `<em class="warn-t">${esc(qq.reasons[0] ?? '')}</em>`}
        </button>`;
      }).join('')}</div>`
    : `<div class="custom-form">
        <label>Building class<select data-change="bc" data-k="bp">${BLUEPRINTS.map((b) => `<option value="${b.id}" ${ui!.bp === b.id ? 'selected' : ''} ${s.level < b.level ? 'disabled' : ''}>${b.name}${s.level < b.level ? ` (Lv ${b.level})` : ''}</option>`).join('')}</select></label>
        <label>Floors <b>${c.floors}</b><input type="range" min="1" max="${Math.min(bp.maxFloors, p.zoning.maxFloors)}" value="${c.floors}" data-change="bc" data-k="floors" data-live></label>
        <label>Footprint <b>${Math.round(c.footprint * 100)}% of lot (${area(p.area * c.footprint)})</b><input type="range" min="20" max="${Math.round(p.zoning.maxCoverage * 100)}" value="${Math.round(c.footprint * 100)}" data-change="bc" data-k="footprint" data-live></label>
        <label>Server density <b>${Math.round(c.serverDensity * 100)}%</b><input type="range" min="70" max="130" value="${Math.round(c.serverDensity * 100)}" data-change="bc" data-k="serverDensity" data-live></label>
        <label>Exterior<select data-change="bc" data-k="style">${EXTERIOR_STYLES.map((x) => `<option value="${x.id}" ${c.style === x.id ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
        <label>Accent color<input type="color" value="${c.color}" data-change="bc" data-k="color"></label>
        <label>Cooling<select data-change="bc" data-k="coolingTier">${COOLING_TIERS.map((t, i) => `<option value="${i}" ${c.coolingTier === i ? 'selected' : ''} ${t.research && !s.research.done.includes(t.research) ? 'disabled' : ''}>${t.label}${t.research && !s.research.done.includes(t.research) ? ' (research)' : ''}</option>`).join('')}</select></label>
        <label>Electrical<select data-change="bc" data-k="electricalTier">${ELECTRICAL_TIERS.map((t, i) => `<option value="${i}" ${c.electricalTier === i ? 'selected' : ''} ${t.research && !s.research.done.includes(t.research) ? 'disabled' : ''}>${t.label}${t.research && !s.research.done.includes(t.research) ? ' (research)' : ''}</option>`).join('')}</select></label>
        <label>Backup generators <b>${c.generators}</b><input type="range" min="0" max="6" value="${c.generators}" data-change="bc" data-k="generators" data-live></label>
        <label>Security systems <b>Tier ${c.security}</b><input type="range" min="0" max="3" value="${c.security}" data-change="bc" data-k="security" data-live></label>
      </div>`;
  const spec = q.spec;
  return `
    <h2>🏗️ Build on ${esc(p.name)}</h2>
    <p class="muted small">${area(p.area)} lot · zoning ${p.zoning.code} (max ${p.zoning.maxFloors} floors, ${Math.round(p.zoning.maxCoverage * 100)}% coverage)</p>
    <div class="tabs"><button class="${ui.mode === 'premade' ? 'on' : ''}" data-act="bmMode" data-v="premade">Premade blueprints</button><button class="${ui.mode === 'custom' ? 'on' : ''}" data-act="bmMode" data-v="custom">Custom building</button></div>
    <div class="build-grid">
      <div>${left}</div>
      <div class="build-summary">
        <h3>${esc(spec.name)}</h3>
        <div class="kv">
          <span>Server rack slots</span><b>${spec.slots}</b>
          <span>Infrastructure bays</span><b>${spec.bays}</b>
          <span>Electrical capacity</span><b>${power(spec.power)}</b>
          <span>Cooling capacity</span><b>${power(spec.cooling)}</b>
          <span>Floors</span><b>${spec.floors}</b>
          <span>Build time</span><b>${duration(q.seconds)}</b>
          <span>Crew</span><b>${q.workers} workers</b>
        </div>
        <h4 class="sect">Project cost</h4>
        <div class="kv">${Object.entries(q.breakdown).map(([k, v]) => `<span>${k}</span><b>${money(v)}</b>`).join('')}<span><b>Total</b></span><b class="price-big">${money(q.total)}</b></div>
        <p class="small muted">Servers and equipment are purchased separately after completion.</p>
        <label class="mt">Facility name<input type="text" placeholder="Auto-named" value="${esc(ui.name)}" data-change="bmName" data-live maxlength="40"></label>
        ${q.reasons.length ? `<div class="callout bad small">${q.reasons.map(esc).join('<br>')}</div>` : ''}
        <div class="row end gap mt"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary lg" data-act="bmBuild" ${q.ok ? '' : 'disabled'}>Start construction · ${money(q.total)}</button></div>
      </div>
    </div>`;
}

function install(app: App) {
  installed = true;
  registerActions({
    bpPick: (el) => {
      if (!ui) return;
      ui.bp = el.dataset.id!;
      ui.custom = { ...defaultCustom(blueprintById(ui.bp), getParcel(ui.parcelId)!), color: ui.custom.color };
      app.render();
    },
    bmMode: (el) => {
      if (!ui) return;
      ui.mode = el.dataset.v as BuildUI['mode'];
      app.render();
    },
    bmBuild: () => {
      if (!ui) return;
      const u = ui;
      const ok = app.run(() => {
        const q = startBuild(app.s, u.parcelId, u.bp, u.mode === 'custom' ? u.custom : undefined, u.name);
        return { ok: q.ok, reason: q.reasons[0] };
      });
      if (ok) closeModal();
    },
  });
  registerChanges({
    bc: (el) => {
      if (!ui) return;
      const k = el.dataset.k!;
      const v = (el as HTMLInputElement).value;
      const c = ui.custom as any;
      if (k === 'bp') {
        ui.bp = v;
        const keepColor = ui.custom.color;
        ui.custom = { ...defaultCustom(blueprintById(v), getParcel(ui.parcelId)!), color: keepColor };
      } else if (k === 'footprint' || k === 'serverDensity') c[k] = Number(v) / 100;
      else if (k === 'style' || k === 'color') c[k] = v;
      else c[k] = Number(v);
      app.render();
    },
    bmName: (el) => {
      if (ui) ui.name = (el as HTMLInputElement).value;
    },
  });
}
