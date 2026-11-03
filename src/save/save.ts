// Persistent storage: IndexedDB primary, localStorage mirror as recovery backup.
// Includes validation, repair of partial/older saves, export and import.

import { SAVE_VERSION, defaultSettings, emptyReport, type GameState } from '../core/state';
import { CITIES } from '../config/world';
import { ECONOMY } from '../config/economy';
import { ensureExpansion } from '../systems/expansionState';
import { fiberLink } from '../config/expansion';

const DB_NAME = 'ai-datacenter-empire';
const STORE = 'saves';
const LS_KEY = 'aidce-backup';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbPut(key: string, value: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function serialize(s: GameState): string {
  return JSON.stringify({ magic: 'AIDCE', v: SAVE_VERSION, savedAt: Date.now(), state: s });
}

export interface LoadResult {
  state: GameState | null;
  repaired: string[];
  error?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Validate a parsed state and repair what can be repaired. */
export function validate(raw: any): LoadResult {
  const repaired: string[] = [];
  if (!raw || typeof raw !== 'object') return { state: null, repaired, error: 'Save is empty or not an object' };
  const s = (raw.magic === 'AIDCE' ? raw.state : raw) as GameState;
  if (!s || typeof s !== 'object' || !s.company || typeof s.company !== 'object') return { state: null, repaired, error: 'Save is missing company data' };
  const fixNum = (obj: any, key: string, def: number, label: string) => {
    if (!isNum(obj[key])) {
      obj[key] = def;
      repaired.push(label);
    }
  };
  fixNum(s, 'cash', 0, 'cash');
  fixNum(s, 'debt', 0, 'debt');
  fixNum(s, 'xp', 0, 'xp');
  fixNum(s, 'level', 1, 'level');
  fixNum(s, 'gameHours', 0, 'game time');
  fixNum(s, 'speed', 1, 'speed');
  fixNum(s, 'idCounter', 1000, 'id counter');
  fixNum(s, 'nextEventAt', s.gameHours + 48, 'events');
  fixNum(s, 'lastRealTime', Date.now(), 'timestamp');
  if (s.lastRealTime > Date.now() + 86400_000) {
    s.lastRealTime = Date.now();
    repaired.push('future timestamp');
  }
  s.level = Math.max(1, Math.min(100, Math.floor(s.level)));
  s.speed = [1, 2, 4].includes(s.speed) ? s.speed : 1;
  s.paused = !!s.paused;
  s.difficulty = ECONOMY.difficulties[s.difficulty] ? s.difficulty : 'standard';
  s.company.reputation = isNum(s.company.reputation) ? s.company.reputation : 50;
  s.company.hqTier = isNum(s.company.hqTier) ? s.company.hqTier : 0;
  s.company.name ||= 'NewCo';
  s.company.logo ||= '⬡';
  s.company.color ||= '#3b82f6';
  if (!Array.isArray(s.unlockedCities) || !s.unlockedCities.length) {
    s.unlockedCities = CITIES.filter((c) => c.unlockLevel <= 1 && c.license === 0).map((c) => c.id);
    repaired.push('unlocked cities');
  }
  s.unlockedCities = s.unlockedCities.filter((id) => CITIES.some((c) => c.id === id));
  for (const k of ['parcels', 'facilities', 'projects', 'achievements', 'stats', 'permanent', 'cityDemand'] as const) {
    if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) {
      (s as any)[k] = {};
      repaired.push(k);
    }
  }
  for (const c of CITIES) if (!isNum(s.cityDemand[c.id])) s.cityDemand[c.id] = 1;
  for (const k of ['employees', 'candidates', 'competitors', 'events', 'log'] as const) {
    if (!Array.isArray(s[k])) {
      (s as any)[k] = [];
      repaired.push(k);
    }
  }
  s.research ??= { done: [] };
  if (!Array.isArray(s.research.done)) s.research.done = [];
  s.contracts ??= { offers: [], active: [], history: [], nextOfferAt: s.gameHours + 4 };
  for (const k of ['offers', 'active', 'history'] as const) if (!Array.isArray(s.contracts[k])) s.contracts[k] = [];
  s.contracts.active = s.contracts.active.filter((c) => c && isNum(c.ratePerHour) && isNum(c.amount));
  s.finance ??= {} as any;
  const f = s.finance;
  for (const k of ['ledger', 'hourly', 'daily', 'monthly', 'valuationHistory'] as const) if (!Array.isArray(f[k])) (f as any)[k] = [];
  f.cur ??= { hour: emptyReport(s.gameHours), day: emptyReport(s.gameHours), month: emptyReport(s.gameHours) };
  for (const k of ['totalRevenue', 'totalExpenses', 'totalCapex', 'lastHourProfit', 'avgHourProfit'] as const) if (!isNum(f[k])) f[k] = 0;
  s.missions ??= { tutorial: 0, daily: { date: '', items: [] }, claimed: [] };
  s.missions.daily ??= { date: '', items: [] };
  s.missions.claimed ??= [];
  if (!isNum(s.missions.tutorial)) s.missions.tutorial = 0;
  s.settings = { ...defaultSettings(), ...(s.settings ?? {}) };
  s.offline ??= { capHours: ECONOMY.baseOfflineCapHours };
  // facility sanity
  for (const [id, fac] of Object.entries(s.facilities)) {
    if (!fac || !fac.parcelId || !fac.cityId) {
      delete s.facilities[id];
      repaired.push(`facility ${id}`);
      continue;
    }
    fac.equipment ??= {};
    for (const [eid, n] of Object.entries(fac.equipment)) if (!isNum(n) || n < 0) delete fac.equipment[eid];
    if (!isNum(fac.condition)) fac.condition = 100;
    for (const k of ['slots', 'bays', 'basePower', 'baseCooling', 'shellValue', 'buildCost', 'equipmentSpent', 'revenueTotal', 'profitTotal'] as const) if (!isNum(fac[k])) (fac as any)[k] = 0;
  }
  for (const [id, pr] of Object.entries(s.projects)) {
    if (!pr || !isNum(pr.totalSeconds) || pr.totalSeconds <= 0 || !isNum(pr.doneSeconds)) {
      delete s.projects[id];
      repaired.push(`project ${id}`);
    }
  }
  for (const c of s.competitors) {
    if (!Array.isArray(c.sites)) c.sites = [];
    if (!Array.isArray(c.history)) c.history = [];
    if (!isNum(c.cash)) c.cash = 1_000_000;
  }
  ensureExpansion(s);
  s.fiber.routes = s.fiber.routes.filter((r) => r && fiberLink(r.link) && isNum(r.doneAt) && isNum(r.tier));
  for (const fac of Object.values(s.facilities)) if (fac.orders && !Array.isArray(fac.orders)) fac.orders = undefined;
  s.version = SAVE_VERSION;
  return { state: s, repaired };
}

export function parse(text: string): LoadResult {
  try {
    return validate(JSON.parse(text));
  } catch (e) {
    return { state: null, repaired: [], error: 'Save file is corrupted (invalid JSON)' };
  }
}

export async function saveGame(s: GameState, slot = 'auto'): Promise<boolean> {
  s.lastRealTime = Date.now();
  const text = serialize(s);
  const ok = await idbPut(slot, text);
  try {
    localStorage.setItem(LS_KEY, text);
  } catch {
    /* storage full — IndexedDB copy is primary */
  }
  try {
    localStorage.setItem('aidce-meta', JSON.stringify({ slot, savedAt: Date.now(), name: s.company.name, level: s.level }));
  } catch { /* ignore */ }
  return ok;
}

/** Synchronous best-effort save for page unload. */
export function saveSync(s: GameState) {
  s.lastRealTime = Date.now();
  try {
    localStorage.setItem(LS_KEY, serialize(s));
  } catch { /* ignore */ }
  void idbPut('auto', serialize(s));
}

export async function loadGame(slot = 'auto'): Promise<LoadResult & { source?: string }> {
  const candidates: { text: string | null; source: string }[] = [
    { text: await idbGet(slot), source: 'IndexedDB' },
  ];
  try {
    candidates.push({ text: localStorage.getItem(LS_KEY), source: 'backup' });
  } catch { /* ignore */ }
  // choose the newest valid save between IndexedDB and the localStorage mirror
  let best: (LoadResult & { source?: string; savedAt: number }) | null = null;
  let lastErr: string | undefined;
  for (const c of candidates) {
    if (!c.text) continue;
    const r = parse(c.text);
    if (!r.state) {
      lastErr = r.error;
      continue;
    }
    const savedAt = r.state.lastRealTime ?? 0;
    if (!best || savedAt > best.savedAt) best = { ...r, source: c.source, savedAt };
  }
  if (best) return best;
  return { state: null, repaired: [], error: lastErr };
}

export async function hasSave(): Promise<boolean> {
  const r = await loadGame();
  return !!r.state;
}

export async function deleteSaves() {
  await idbDel('auto');
  await idbDel('manual');
  try {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem('aidce-meta');
  } catch { /* ignore */ }
}

// ---- developer backups: separate slots that resets never touch ----
const BACKUP_META = 'aidce-dev-backups';
export interface BackupInfo { slot: number; savedAt: number; name: string; level: number; kb: number }
export function listBackups(): BackupInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(BACKUP_META) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
export async function writeBackup(s: GameState, slot: number): Promise<boolean> {
  const text = serialize(s);
  if (!(await idbPut(`backup-${slot}`, text))) return false;
  const list = listBackups().filter((b) => b.slot !== slot);
  list.push({ slot, savedAt: Date.now(), name: s.company.name, level: s.level, kb: Math.round(text.length / 1024) });
  try { localStorage.setItem(BACKUP_META, JSON.stringify(list.sort((a, b) => a.slot - b.slot))); } catch { /* the backup itself is safe */ }
  return true;
}
export async function readBackup(slot: number): Promise<LoadResult> {
  const text = await idbGet(`backup-${slot}`);
  return text ? parse(text) : { state: null, repaired: [], error: 'That backup is empty' };
}
export async function deleteBackup(slot: number) {
  await idbDel(`backup-${slot}`);
  try { localStorage.setItem(BACKUP_META, JSON.stringify(listBackups().filter((b) => b.slot !== slot))); } catch { /* ignore */ }
}

export function exportSave(s: GameState) {
  const blob = new Blob([serialize(s)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `${s.company.name.replace(/[^a-z0-9]+/gi, '_')}_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.aidce.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function importSaveFile(): Promise<LoadResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ state: null, repaired: [], error: 'No file selected' });
      const text = await file.text();
      resolve(parse(text));
    };
    input.click();
  });
}
