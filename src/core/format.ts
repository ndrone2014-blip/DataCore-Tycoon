// Number and time formatting helpers.

export function money(v: number, digits = 1): string {
  if (!isFinite(v)) return '$—';
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e12) s = (a / 1e12).toFixed(digits) + 'T';
  else if (a >= 1e9) s = (a / 1e9).toFixed(digits) + 'B';
  else if (a >= 1e6) s = (a / 1e6).toFixed(digits) + 'M';
  else if (a >= 1e4) s = (a / 1e3).toFixed(digits) + 'K';
  else s = a.toFixed(a < 100 && a % 1 !== 0 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + s;
}

export function moneyFull(v: number): string {
  const neg = v < 0;
  return (neg ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
}

export function num(v: number, digits = 0): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(v: number, digits = 0): string {
  return (v * 100).toFixed(digits) + '%';
}

export function area(m2: number): string {
  return m2 >= 10000 ? (m2 / 10000).toFixed(2) + ' ha' : Math.round(m2).toLocaleString('en-US') + ' m²';
}

export function power(kw: number): string {
  return kw >= 1000 ? (kw / 1000).toFixed(kw >= 10000 ? 0 : 1) + ' MW' : Math.round(kw) + ' kW';
}

/** Duration in real seconds → short text. */
export function duration(sec: number): string {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

/** Game hours → "3d 4h" */
export function gameDuration(hours: number): string {
  hours = Math.max(0, hours);
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function gameDate(startMs: number, hours: number, withHour = true): string {
  const d = new Date(startMs + hours * 3600_000);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return withHour ? `${base} · ${d.getUTCHours().toString().padStart(2, '0')}:00` : base;
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
