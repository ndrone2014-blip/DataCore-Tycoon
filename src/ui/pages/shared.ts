// Shared page fragments.

import type { App } from '../app';
import type { Project } from '../../core/state';
import { ECONOMY } from '../../config/economy';
import { BUILD_STAGES, DEMO_STAGES, stageOf, speedUpQuote } from '../../systems/construction';
import { constructionSpeed } from '../../systems/property';
import { getParcel } from '../../world/parcels';
import { cityById } from '../../config/world';
import { bar } from '../components';
import { money, duration, esc } from '../../core/format';

export function projectCard(app: App, pr: Project, compact = false): string {
  const s = app.s;
  const p = getParcel(pr.parcelId)!;
  const prog = Math.min(1, pr.doneSeconds / pr.totalSeconds);
  const st = stageOf(pr);
  const speed = constructionSpeed(s);
  const remaining = Math.max(0, (pr.totalSeconds - pr.doneSeconds) / speed / s.speed);
  const stages = pr.kind === 'build' ? BUILD_STAGES : DEMO_STAGES;
  const title = pr.kind === 'build' ? pr.draft?.name ?? 'Construction' : `Demolition: ${p.name}`;
  const eta = new Date(Date.now() + remaining * 1000);
  return `
  <div class="card project ${pr.kind}" data-key="pr-${pr.id}">
    <div class="row between">
      <div><h3>${pr.kind === 'build' ? '🏗️' : '🧱'} ${esc(title)}</h3>
      <small class="muted">${esc(p.name)} · ${cityById(p.cityId).name}${pr.draft ? ` · ${esc(pr.draft.blueprintId === 'hq' ? 'Headquarters' : pr.draft.custom ? 'Custom build' : 'Premade blueprint')}` : ''}</small></div>
      <button class="btn ghost sm" data-act="openParcel" data-id="${pr.parcelId}">Inspect 3D</button>
    </div>
    ${bar(prog, 'big', `${(prog * 100).toFixed(1)}% · ${st.name}`)}
    <div class="grid4 mini-stats">
      <div><label>Stage</label><b>${st.index + 1} / ${st.count}</b></div>
      <div><label>Time left</label><b>${duration(remaining)}</b></div>
      <div><label>Completes</label><b>${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></div>
      <div><label>Workers</label><b>${pr.workers}${speed > 1.01 ? ` <span class="pos">×${speed.toFixed(2)}</span>` : ''}</b></div>
    </div>
    ${compact ? '' : `<div class="stages">${stages.map((x, i) => `<span class="${i < st.index ? 'done' : i === st.index ? 'cur' : ''}">${i < st.index ? '✓' : i + 1}. ${x.name}</span>`).join('')}</div>
    <div class="row gap wrap small muted">Project cost ${money(pr.cost)}${pr.speedSpent ? ` · speed-ups ${money(pr.speedSpent)}` : ''} · ${Object.entries(pr.breakdown).map(([k, v]) => `${k} ${money(v)}`).join(' · ')}</div>`}
    <div class="speedups">
      ${ECONOMY.speedUps.map((o) => {
        const c = speedUpQuote(s, pr.id, o.id);
        const can = s.cash >= c;
        return `<button class="btn ${o.id === 'instant' ? 'warn' : 'ghost'} sm" data-act="speedUp" data-id="${pr.id}" data-opt="${o.id}" ${can ? '' : `disabled title="Need ${money(c)}"`}>⏩ ${o.label}${o.id !== 'instant' ? ` −${o.cut * 100}%` : ''}<br><small>${money(c)}</small></button>`;
      }).join('')}
    </div>
  </div>`;
}

export function capBar(used: number, total: number, label: string, unit: string): string {
  const r = total > 0 ? used / total : 0;
  return `<div class="capbar"><div class="row between"><span>${label}</span><small>${Math.round(used).toLocaleString()} / ${Math.round(total).toLocaleString()} ${unit}</small></div>${bar(r, r > 1 ? 'bad' : r > 0.9 ? 'warn' : '')}</div>`;
}

/** How badly a data center needs servers. Drives the alert chip, map pins and the Data Centers filter. */
export function dcNeed(f: { slots: number }, st: { slotsUsed: number } | undefined): { level: 'empty' | 'low' | 'ok'; label: string } {
  const used = st?.slotsUsed ?? 0;
  if (used === 0) return { level: 'empty', label: 'No servers yet' };
  if (used < f.slots * 0.5) return { level: 'low', label: `Racks ${Math.round((used / f.slots) * 100)}% full` };
  return { level: 'ok', label: `Racks ${Math.round((used / f.slots) * 100)}% full` };
}
