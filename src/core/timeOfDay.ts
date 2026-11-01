// Visual time of day shared by the 3D view and the maps.
// 'auto' runs a slow cinematic cycle (one full day every 8 real minutes).

export type TimeMode = 'auto' | 'day' | 'sunset' | 'night';

export interface Lighting {
  hour: number; // 0..24
  sunElevation: number; // -1..1 (sin of angle)
  sunAzimuth: number; // radians
  night: number; // 0 (day) .. 1 (full night)
  golden: number; // 0..1 warmth near horizon
  sky: { top: string; horizon: string; ground: string };
  sunColor: string;
  sunIntensity: number;
  ambient: number;
  fog: string;
}

const CYCLE_MS = 8 * 60 * 1000;

function hourFor(mode: TimeMode): number {
  switch (mode) {
    case 'day': return 13.5;
    case 'sunset': return 18.6;
    case 'night': return 22.5;
    default: return ((Date.now() % CYCLE_MS) / CYCLE_MS) * 24;
  }
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}

// key frames over the day
const KEYS: { h: number; top: string; horizon: string; ground: string; sun: string; fog: string }[] = [
  { h: 0, top: '#02040b', horizon: '#0b1530', ground: '#05080f', sun: '#5b6fa8', fog: '#070d1c' },
  { h: 5, top: '#060b1f', horizon: '#2a2347', ground: '#0a0d18', sun: '#7a6aa8', fog: '#14152a' },
  { h: 6.5, top: '#27406f', horizon: '#f2a46b', ground: '#2a2a30', sun: '#ffb27a', fog: '#6d6a7a' },
  { h: 9, top: '#2f6fd0', horizon: '#a9d4ff', ground: '#3a4250', sun: '#fff1dc', fog: '#9fb8d6' },
  { h: 13, top: '#1f63d6', horizon: '#b8dcff', ground: '#3d4554', sun: '#ffffff', fog: '#a7c2e2' },
  { h: 17, top: '#2a5fc0', horizon: '#ffd2a1', ground: '#3a3c44', sun: '#ffd9a8', fog: '#b9a7a0' },
  { h: 18.7, top: '#1c2b5a', horizon: '#ff7a45', ground: '#2a2228', sun: '#ff8a50', fog: '#5a3c40' },
  { h: 20, top: '#0a1230', horizon: '#3a2a55', ground: '#0b0d16', sun: '#7a6aa8', fog: '#161a30' },
  { h: 24, top: '#02040b', horizon: '#0b1530', ground: '#05080f', sun: '#5b6fa8', fog: '#070d1c' },
];

export function getLighting(mode: TimeMode = 'auto'): Lighting {
  const hour = hourFor(mode);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (hour - a.h) / (b.h - a.h)));
  // sun path: rises 6:00, sets 19:00
  const dayT = (hour - 6) / 13;
  const sunElevation = Math.sin(Math.PI * dayT);
  const night = Math.max(0, Math.min(1, (-sunElevation + 0.08) / 0.35));
  const golden = Math.max(0, 1 - Math.abs(sunElevation) / 0.35) * (1 - night * 0.7);
  return {
    hour,
    sunElevation,
    sunAzimuth: Math.PI * (0.15 + dayT * 0.9),
    night,
    golden,
    sky: { top: lerpColor(a.top, b.top, t), horizon: lerpColor(a.horizon, b.horizon, t), ground: lerpColor(a.ground, b.ground, t) },
    sunColor: lerpColor(a.sun, b.sun, t),
    sunIntensity: Math.max(0.05, sunElevation) * 2.4 + 0.08,
    ambient: 0.25 + (1 - night) * 0.55,
    fog: lerpColor(a.fog, b.fog, t),
  };
}
