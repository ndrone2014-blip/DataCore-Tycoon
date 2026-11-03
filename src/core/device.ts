// PC / Mobile mode, chosen on the start screen and remembered per device if the player asks.

export type DeviceMode = 'pc' | 'mobile';
const KEY = 'aidce-device-mode';
let mode: DeviceMode = 'pc';

export function recommendedMode(): DeviceMode {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse && Math.min(window.innerWidth, window.innerHeight) < 900 ? 'mobile' : 'pc';
}
export function rememberedMode(): DeviceMode | null {
  try { const v = localStorage.getItem(KEY); return v === 'pc' || v === 'mobile' ? v : null; } catch { return null; }
}
export function applyMode(m: DeviceMode, remember?: boolean) {
  mode = m;
  document.documentElement.classList.toggle('mobile', m === 'mobile');
  document.documentElement.classList.toggle('pc', m === 'pc');
  try {
    if (remember === true) localStorage.setItem(KEY, m);
    else if (remember === false) localStorage.removeItem(KEY);
  } catch { /* private window: choice just isn't remembered */ }
}
export const isMobile = () => mode === 'mobile';
export const deviceMode = () => mode;
