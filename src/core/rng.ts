// Deterministic random helpers.

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Global non-deterministic RNG used for gameplay rolls (events, offers). */
export const rand = Math.random;
export const randRange = (a: number, b: number, r: () => number = rand) => a + (b - a) * r();
export const randInt = (a: number, b: number, r: () => number = rand) => Math.floor(randRange(a, b + 1, r));
export function pick<T>(arr: readonly T[], r: () => number = rand): T {
  return arr[Math.floor(r() * arr.length)];
}
export function weightedPick<T extends { weight: number }>(arr: readonly T[], r: () => number = rand): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let v = r() * total;
  for (const x of arr) {
    v -= x.weight;
    if (v <= 0) return x;
  }
  return arr[arr.length - 1];
}
