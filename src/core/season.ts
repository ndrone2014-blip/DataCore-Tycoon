// Seasonal theming. 'auto' follows the calendar, so Thanksgiving decorations appear in November.

export type SeasonSetting = 'auto' | 'on' | 'off';

export function seasonOn(setting: SeasonSetting | undefined, now = new Date()): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return now.getMonth() === 10;
}

/** Saved outside the game state so the title screen, which loads first, can match. */
export function rememberSeason(setting: SeasonSetting) {
  try { localStorage.setItem('aidce-season', setting); } catch { /* cosmetic only */ }
}
export function rememberedSeason(): SeasonSetting {
  try {
    const v = localStorage.getItem('aidce-season');
    if (v === 'on' || v === 'off' || v === 'auto') return v;
  } catch { /* cosmetic only */ }
  return 'auto';
}
export function applySeasonClass(setting: SeasonSetting) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('season-fall', seasonOn(setting));
}
