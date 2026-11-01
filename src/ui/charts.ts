// Chart.js wrapper with a built-in canvas fallback renderer.

import { loadChart } from '../lib/loader';
import { money, num } from '../core/format';

export interface ChartSpec {
  type: 'line' | 'bar';
  labels: string[];
  datasets: { label: string; data: number[]; color: string; fill?: boolean; stack?: string; dashed?: boolean }[];
  money?: boolean;
  stacked?: boolean;
  height?: number;
  log?: boolean;
}

const specs = new Map<string, ChartSpec>();
const instances = new Map<string, any>();
let ChartLib: any = null;
let tried = false;

export function chart(id: string, spec: ChartSpec): string {
  specs.set(id, spec);
  return `<div class="chart-box" style="height:${spec.height ?? 220}px" data-keep data-key="chart-${id}"><canvas id="chart-${id}"></canvas></div>`;
}

const sig = (s: ChartSpec) => JSON.stringify([s.type, s.labels.length, s.datasets.map((d) => d.label + d.data.length + (d.data[d.data.length - 1] ?? 0).toFixed(0))]);
const lastSig = new Map<string, string>();

export async function updateCharts() {
  if (!tried) {
    tried = true;
    ChartLib = await loadChart();
  }
  for (const [id, spec] of specs) {
    const canvas = document.getElementById(`chart-${id}`) as HTMLCanvasElement | null;
    if (!canvas) {
      instances.get(id)?.destroy?.();
      instances.delete(id);
      specs.delete(id);
      lastSig.delete(id);
      continue;
    }
    const sg = sig(spec);
    const inst = instances.get(id);
    if (inst && inst.canvas !== canvas) {
      inst.destroy?.();
      instances.delete(id);
    }
    if (lastSig.get(id) === sg && instances.has(id)) continue;
    lastSig.set(id, sg);
    if (ChartLib) renderChartJs(id, canvas, spec);
    else renderFallback(canvas, spec);
  }
}

function renderChartJs(id: string, canvas: HTMLCanvasElement, spec: ChartSpec) {
  const fmt = (v: number) => (spec.money ? money(v) : num(v));
  const data = {
    labels: spec.labels,
    datasets: spec.datasets.map((d) => ({
      label: d.label,
      data: d.data,
      borderColor: d.color,
      backgroundColor: spec.type === 'bar' ? d.color + 'cc' : d.color + '22',
      fill: d.fill ?? false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
      borderDash: d.dashed ? [5, 4] : undefined,
      stack: d.stack,
    })),
  };
  const existing = instances.get(id);
  if (existing) {
    existing.data = data;
    existing.update('none');
    return;
  }
  const ch = new ChartLib(canvas, {
    type: spec.type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#9fb0c8', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { stacked: spec.stacked, ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
        y: { stacked: spec.stacked, type: spec.log ? 'logarithmic' : 'linear', ticks: { color: '#64748b', callback: (v: number) => fmt(v), font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
      },
    },
  });
  instances.set(id, ch);
}

function renderFallback(canvas: HTMLCanvasElement, spec: ChartSpec) {
  const box = canvas.parentElement!.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = box.width * dpr;
  canvas.height = box.height * dpr;
  canvas.style.width = box.width + 'px';
  canvas.style.height = box.height + 'px';
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = box.width, H = box.height, L = 56, B = 22, T = 22;
  c.clearRect(0, 0, W, H);
  const n = spec.labels.length;
  if (!n) return;
  let max = 0, min = 0;
  if (spec.stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      for (const d of spec.datasets) (d.data[i] >= 0 ? (pos += d.data[i]) : (neg += d.data[i]));
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    }
  } else for (const d of spec.datasets) for (const v of d.data) { if (v == null) continue; max = Math.max(max, v); min = Math.min(min, v); }
  if (max === min) max = min + 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const x = (i: number) => L + ((W - L - 8) * (i + 0.5)) / n;
  c.strokeStyle = 'rgba(148,163,184,0.12)';
  c.fillStyle = '#64748b';
  c.font = '10px Inter, system-ui';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    c.beginPath();
    c.moveTo(L, y(v));
    c.lineTo(W, y(v));
    c.stroke();
    c.fillText(spec.money ? money(v) : num(v), 4, y(v) + 3);
  }
  const bw = ((W - L - 8) / n) * 0.7;
  const stackPos = new Array(n).fill(0), stackNeg = new Array(n).fill(0);
  spec.datasets.forEach((d, di) => {
    c.strokeStyle = d.color;
    c.fillStyle = d.color;
    c.lineWidth = 2;
    if (spec.type === 'bar') {
      d.data.forEach((v, i) => {
        const base = spec.stacked ? (v >= 0 ? stackPos[i] : stackNeg[i]) : 0;
        const w = spec.stacked ? bw : bw / spec.datasets.length;
        const xx = spec.stacked ? x(i) - bw / 2 : x(i) - bw / 2 + w * di;
        c.fillRect(xx, Math.min(y(base), y(base + v)), w, Math.abs(y(base + v) - y(base)));
        if (spec.stacked) v >= 0 ? (stackPos[i] += v) : (stackNeg[i] += v);
      });
    } else {
      c.beginPath();
      let started = false;
      d.data.forEach((v, i) => {
        if (v == null) return;
        if (started) c.lineTo(x(i), y(v));
        else { c.moveTo(x(i), y(v)); started = true; }
      });
      c.stroke();
    }
    c.fillText(d.label, L + di * 110, 12);
  });
}
