// Canvas2D isometric fallback for the Property View (used when Three.js /
// WebGL is unavailable). Shows the same states in simplified form.

import type { GameState } from '../core/state';
import type { Derived } from '../systems/derive';
import type { PropertyViewLike } from './propertyView';
import { getParcel, PROPERTY_TYPE_INFO, type ParcelDef } from '../world/parcels';
import { parcelState } from '../systems/property';
import { stageOf } from '../systems/construction';
import { blueprintById, equipmentById } from '../config/buildings';

function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function createIsoView(container: HTMLElement, getS: () => GameState, getD: () => Derived): PropertyViewLike {
  const canvas = document.createElement('canvas');
  canvas.className = 'pv-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let parcel: ParcelDef | null = null;
  let visible = false;
  let xray = false;
  let rot = 0;
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
  }
  new ResizeObserver(resize).observe(container);

  // iso projection: x,y meters on ground, z height
  let scale = 3;
  const iso = (x: number, y: number, z: number): [number, number] => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const rx = x * c - y * s, ry = x * s + y * c;
    return [W / 2 + (rx - ry) * scale * 0.87, H * 0.62 + (rx + ry) * scale * 0.5 - z * scale];
  };
  const poly = (pts: [number, number][], fill: string, stroke?: string) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };
  const quad = (w: number, d: number, z: number, fill: string, stroke?: string) =>
    poly([iso(-w / 2, -d / 2, z), iso(w / 2, -d / 2, z), iso(w / 2, d / 2, z), iso(-w / 2, d / 2, z)], fill, stroke);
  const block = (w: number, d: number, h: number, color: string, z0 = 0, alpha = 1) => {
    ctx.globalAlpha = alpha;
    poly([iso(w / 2, -d / 2, z0), iso(w / 2, d / 2, z0), iso(w / 2, d / 2, z0 + h), iso(w / 2, -d / 2, z0 + h)], shade(color, 0.7));
    poly([iso(-w / 2, d / 2, z0), iso(w / 2, d / 2, z0), iso(w / 2, d / 2, z0 + h), iso(-w / 2, d / 2, z0 + h)], shade(color, 0.85));
    quad(w, d, z0 + h, shade(color, 1.05), 'rgba(0,0,0,0.3)');
    ctx.globalAlpha = 1;
  };

  function draw(t: number) {
    requestAnimationFrame(draw);
    if (!visible || !parcel) return;
    if (!getS().settings.reduceMotion) rot = Math.sin(t / 9000) * 0.25;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1b33');
    g.addColorStop(1, '#070d1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const s = getS();
    const st = parcelState(s, parcel.id);
    const w = parcel.rect.x1 - parcel.rect.x0, d = parcel.rect.y1 - parcel.rect.y0;
    scale = Math.min(W, H) / (Math.max(w, d) * 1.9);
    quad(w * 1.6, d * 1.6, 0, '#111b2c');
    quad(w, d, 0, st.status === 'existing' ? '#2a3646' : '#5a4a36', st.owner === 'player' ? '#fbbf24' : '#60a5fa');
    const k = Math.sqrt(PROPERTY_TYPE_INFO[parcel.type].coverage || 0.5);
    let caption = '';
    if (st.status === 'existing') {
      block(w * k, d * k, Math.max(4, parcel.buildingHeight), PROPERTY_TYPE_INFO[parcel.type].color);
      caption = PROPERTY_TYPE_INFO[parcel.type].label;
    } else if (st.status === 'demolishing') {
      const pr = st.projectId ? s.projects[st.projectId] : undefined;
      const p = pr ? pr.doneSeconds / pr.totalSeconds : 0.5;
      block(w * k, d * k, Math.max(0.5, parcel.buildingHeight * (1 - p)), '#a16207');
      ctx.fillStyle = 'rgba(200,184,154,0.25)';
      for (let i = 0; i < 30; i++) {
        const [x, y] = iso((Math.random() - 0.5) * w * 0.8, (Math.random() - 0.5) * d * 0.8, Math.random() * 25);
        ctx.beginPath();
        ctx.arc(x, y, 3 + Math.random() * 4, 0, 6.3);
        ctx.fill();
      }
      caption = `Demolition ${Math.round(p * 100)}%`;
    } else if (st.status === 'construction') {
      const pr = st.projectId ? s.projects[st.projectId] : undefined;
      let floors = 2, fp = 0.5, col = '#94a3b8', prog = 0.3, stageName = 'Construction';
      if (pr?.draft) {
        floors = pr.draft.floors;
        fp = pr.draft.footprint;
        col = pr.draft.color;
        prog = pr.doneSeconds / pr.totalSeconds;
        stageName = stageOf(pr).name;
      } else {
        for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel.id) {
          const bp = blueprintById(site.blueprintId);
          floors = bp.floors;
          fp = bp.footprint;
          col = c.color;
          prog = site.progress / site.total;
        }
      }
      const kk = Math.sqrt(fp);
      const Hh = floors * 5.5;
      if (prog > 0.08) block(w * kk + 2, d * kk + 2, 1.2, '#a3a3a3');
      if (prog > 0.2) {
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1.5;
        const hh = Hh * Math.min(1, (prog - 0.2) / 0.2);
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
          const x = -w * kk / 2 + (w * kk * i) / 4, y = -d * kk / 2 + (d * kk * j) / 4;
          const [a, b] = iso(x, y, 1.2), [c2, d2] = iso(x, y, 1.2 + hh);
          ctx.beginPath();
          ctx.moveTo(a, b);
          ctx.lineTo(c2, d2);
          ctx.stroke();
        }
      }
      if (prog > 0.68) block(w * kk, d * kk, Hh * Math.min(1, (prog - 0.68) / 0.14), col, 1.2, 0.85);
      caption = `${stageName} · ${Math.round(prog * 100)}%`;
    } else if (st.status === 'facility' || st.status === 'hq') {
      const f = st.facilityId ? s.facilities[st.facilityId] : undefined;
      if (f) {
        const kk = Math.sqrt(f.isHQ ? 0.35 : f.footprint);
        const Hh = f.isHQ ? 8 + f.floors * 4 : f.floors * 5.5;
        block(w * kk, d * kk, Hh, f.color || s.company.color, 0, xray ? 0.25 : 1);
        if (xray && !f.isHQ) {
          let i = 0;
          for (const [id, n] of Object.entries(f.equipment)) {
            const e = equipmentById(id);
            if (e.kind !== 'server') continue;
            const col = e.cap === 'gpu' ? '#a855f7' : e.cap === 'storage' ? '#10b981' : e.cap === 'cpu' ? '#3b82f6' : '#f59e0b';
            for (let j = 0; j < n && i < 400; j++, i++) {
              const row = Math.floor(i / 20), c = i % 20;
              const [x, y] = iso(-w * kk / 2 + 2 + c * (w * kk - 4) / 20, -d * kk / 2 + 2 + row * 2.5, 2);
              ctx.fillStyle = Math.random() < 0.15 ? '#111' : col;
              ctx.fillRect(x - 2, y - 6, 4, 6);
            }
          }
        }
        caption = f.name;
        const warn = getD().fac[f.id]?.warnings.length;
        if (warn) {
          const [x, y] = iso(0, 0, Hh + 4);
          ctx.fillStyle = Math.sin(t / 150) > 0 ? '#ef4444' : '#7f1d1d';
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, 6.3);
          ctx.fill();
        }
      } else {
        let col = '#ef4444', name = 'Competitor';
        for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel.id) {
          col = c.color;
          name = c.name;
        }
        block(w * 0.7, d * 0.7, 18, col);
        caption = name;
      }
    } else {
      caption = st.owner === 'player' ? 'Ready to build' : 'Empty land';
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(caption, W / 2, 34);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('Simplified view (WebGL / Three.js unavailable)', W / 2, H - 16);
  }
  requestAnimationFrame(draw);

  return {
    kind: 'iso',
    show(id) {
      parcel = getParcel(id) ?? null;
      visible = true;
      container.classList.add('visible');
      resize();
    },
    hide() {
      visible = false;
      container.classList.remove('visible');
    },
    setXray(v) {
      xray = v;
    },
    update() {},
    resize,
  };
}
