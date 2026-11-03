// Keeps the most recent errors and warnings so they can be read inside the game.

export interface DevLogEntry { t: number; level: 'error' | 'warn'; msg: string; count: number }
const entries: DevLogEntry[] = [];
let installed = false;

function add(level: DevLogEntry['level'], parts: unknown[]) {
  const msg = parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : safe(p))).join(' ').slice(0, 1500);
  const last = entries[entries.length - 1];
  if (last && last.msg === msg && last.level === level) { last.count++; last.t = Date.now(); return; }
  entries.push({ t: Date.now(), level, msg, count: 1 });
  if (entries.length > 200) entries.shift();
}
function safe(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

export function installDevLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const { error, warn } = console;
  console.error = (...a: unknown[]) => { add('error', a); error.apply(console, a); };
  console.warn = (...a: unknown[]) => { add('warn', a); warn.apply(console, a); };
  window.addEventListener('error', (e) => add('error', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => add('error', ['Unhandled promise rejection:', (e as PromiseRejectionEvent).reason]));
}
export const devLogEntries = () => entries;
export const clearDevLog = () => { entries.length = 0; };
