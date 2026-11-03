// Password lock for the Developer Tools. It is stored apart from saves, so it survives new games,
// resets and imports. The game runs entirely in the browser, so this keeps out casual access only.

const KEY = 'aidce-dev-auth';
const LOCK_KEY = 'aidce-dev-autolock';
const DEFAULT_SALT = 'aidce-dev-v1';
const DEFAULT_HASH = 'd98379a3567262853362e324b588e033';
const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;
export const AUTOLOCK_CHOICES = [1, 5, 15, 30, 60];

let memory: Record<string, string> = {};
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  del(k: string) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
};

function round(str: string, seed: number): string {
  let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}
export function hashPassword(pw: string, salt: string): string {
  let h = `${salt}:${pw}`;
  for (let i = 0; i < 2000; i++) h = round(`${h}${salt}`, i) + round(h, i ^ 0x5bd1);
  return h;
}

interface Rec { salt: string; hash: string }
function record(): Rec {
  try {
    const r = JSON.parse(store.get(KEY) ?? 'null');
    if (r && typeof r.salt === 'string' && typeof r.hash === 'string') return r;
  } catch { /* unreadable: fall back to the default */ }
  return { salt: DEFAULT_SALT, hash: DEFAULT_HASH };
}
export const checkPassword = (pw: string) => { const r = record(); return hashPassword(pw, r.salt) === r.hash; };
export const usingDefaultPassword = () => record().hash === DEFAULT_HASH;

let unlocked = false, lastActive = 0, fails = 0, lockedUntil = 0;
export const isUnlocked = () => unlocked;
export const lockoutLeft = (now = Date.now()) => Math.max(0, lockedUntil - now);

export function unlock(pw: string, now = Date.now()): { ok: boolean; reason?: string } {
  if (lockoutLeft(now) > 0) return { ok: false, reason: `Too many attempts. Try again in ${Math.ceil(lockoutLeft(now) / 1000)} seconds.` };
  if (!checkPassword(pw)) {
    if (++fails >= MAX_FAILS) { fails = 0; lockedUntil = now + LOCKOUT_MS; return { ok: false, reason: `Too many attempts. Try again in ${LOCKOUT_MS / 1000} seconds.` }; }
    return { ok: false, reason: 'Incorrect password' };
  }
  fails = 0;
  unlocked = true;
  lastActive = now;
  return { ok: true };
}
export function lock() { unlocked = false; }
export function touch(now = Date.now()) { if (unlocked) lastActive = now; }

export function autoLockMinutes(): number {
  const v = Number(store.get(LOCK_KEY));
  return AUTOLOCK_CHOICES.includes(v) ? v : 5;
}
export const setAutoLockMinutes = (m: number) => { if (AUTOLOCK_CHOICES.includes(m)) store.set(LOCK_KEY, String(m)); };
export const secondsToLock = (now = Date.now()) => Math.max(0, Math.ceil((lastActive + autoLockMinutes() * 60_000 - now) / 1000));
/** Locks if the player has been idle too long. Returns true when it just locked. */
export function checkAutoLock(now = Date.now()): boolean {
  if (!unlocked || secondsToLock(now) > 0) return false;
  unlocked = false;
  return true;
}

export function changePassword(current: string, next: string, confirm: string): { ok: boolean; reason?: string } {
  if (!checkPassword(current)) return { ok: false, reason: 'Your current password is incorrect' };
  if (next.length < 4) return { ok: false, reason: 'Use at least 4 characters' };
  if (next !== confirm) return { ok: false, reason: 'The new passwords do not match' };
  if (next === current) return { ok: false, reason: 'That is already your password' };
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set(KEY, JSON.stringify({ salt, hash: hashPassword(next, salt) }));
  return { ok: true };
}
export const restoreDefaultPassword = () => store.del(KEY);
