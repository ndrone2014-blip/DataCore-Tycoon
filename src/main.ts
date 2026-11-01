// Entry point: title screen, new-game wizard, load + offline catch-up.

import { App } from './ui/app';
import { installDelegation, registerActions, registerChanges } from './ui/dom';
import { loadGame, saveGame } from './save/save';
import { newGame, catchUp } from './systems/sim';
import { CITIES, countryById } from './config/world';
import { ECONOMY } from './config/economy';
import { COMPANY_COLORS, COMPANY_LOGOS } from './config/content';
import { esc, money, duration } from './core/format';
import { unlockAudio, playSfx } from './audio/sound';
import { startTitleScene, stopTitleScene } from './ui/titleScene';

const app = new App();
(window as any).__app = app;
installDelegation(document);

const wizard = { name: 'Nimbus Compute', logo: COMPANY_LOGOS[0], color: COMPANY_COLORS[0], city: 'nova', difficulty: 'standard' };

function bootRoot(): HTMLElement {
  return document.getElementById('boot')!;
}

function titleScreen(hasSave: { name: string; level: number; savedAt: number } | null, repaired: string[] = [], error?: string) {
  bootRoot().innerHTML = `
    <canvas id="title-scene"></canvas>
    <div class="boot-card">
      <div class="boot-logo">◢◤</div>
      <h1>AI DATA CENTER <span>EMPIRE</span></h1>
      <p class="tag-line">Buy land anywhere on Earth. Demolish. Build hyperscale AI campuses. Outgrow your rivals.</p>
      ${error ? `<div class="callout bad small">${esc(error)} — a new game is required.</div>` : ''}
      ${repaired.length ? `<div class="callout warn small">Your save was repaired (${esc(repaired.slice(0, 4).join(', '))}${repaired.length > 4 ? '…' : ''}).</div>` : ''}
      <div class="boot-actions">
        ${hasSave ? `<button class="btn primary xl" data-act="bootContinue">Continue — ${esc(hasSave.name)} <small>Level ${hasSave.level} · saved ${duration((Date.now() - hasSave.savedAt) / 1000)} ago</small></button>` : ''}
        <button class="btn ${hasSave ? 'ghost' : 'primary'} xl" data-act="bootNew">New company</button>
        <button class="btn ghost" data-act="bootImport">Import save file</button>
      </div>
      <p class="boot-foot">Single-player · Autosaves locally · Developed by Drone Hive Studios | Developer @ndrone40</p>
    </div>`;
  startTitleScene(document.getElementById('title-scene') as HTMLCanvasElement);
}

function wizardScreen() {
  const starters = CITIES.filter((c) => c.unlockLevel <= 1 && c.license === 0);
  bootRoot().innerHTML = `
    <canvas id="title-scene"></canvas>
    <div class="boot-card wide">
      <h2>Found your company</h2>
      <div class="wizard">
        <label>Company name<input type="text" id="wz-name" value="${esc(wizard.name)}" maxlength="28" data-change="wzName" data-live></label>
        <div><span class="lbl">Logo</span><div class="logo-pick">${COMPANY_LOGOS.map((l) => `<button class="${wizard.logo === l ? 'on' : ''}" data-act="wzLogo" data-v="${l}">${l}</button>`).join('')}</div></div>
        <div><span class="lbl">Brand color</span><div class="color-pick">${COMPANY_COLORS.map((c) => `<button class="${wizard.color === c ? 'on' : ''}" style="background:${c}" data-act="wzColor" data-v="${c}"></button>`).join('')}</div></div>
        <div><span class="lbl">Starting city</span><div class="city-pick">${starters.map((c) => `<button class="${wizard.city === c.id ? 'on' : ''}" data-act="wzCity" data-v="${c.id}"><b>${countryById(c.country).flag} ${c.name}</b><small>${esc(c.blurb)}</small><em>Power $${c.powerPrice.toFixed(2)}/kWh · Land ${Math.round(c.landMult * 100)}% · Demand ${Math.round(c.demand / 1000)}k</em></button>`).join('')}</div></div>
        <div><span class="lbl">Difficulty</span><div class="diff-pick">${Object.entries(ECONOMY.difficulties).map(([k, v]) => `<button class="${wizard.difficulty === k ? 'on' : ''}" data-act="wzDiff" data-v="${k}"><b>${v.label}</b><small>${money(v.cash)} starting cash</small></button>`).join('')}</div></div>
      </div>
      <div class="preview" style="--c:${wizard.color}"><span class="tb-logo">${esc(wizard.logo)}</span><b>${esc(wizard.name || 'Your Company')}</b><small>Headquartered in ${CITIES.find((c) => c.id === wizard.city)!.name}</small></div>
      <div class="row between mt"><button class="btn ghost" data-act="bootBack">Back</button><button class="btn primary xl" data-act="bootStart">Launch company →</button></div>
    </div>`;
  startTitleScene(document.getElementById('title-scene') as HTMLCanvasElement);
}

let cachedMeta: { name: string; level: number; savedAt: number } | null = null;

registerActions({
  bootContinue: async () => {
    unlockAudio();
    playSfx('complete');
    const r = await loadGame();
    if (!r.state) return titleScreen(null, [], r.error);
    const rep = catchUp(r.state);
    app.start(r.state, rep && rep.seconds > 30 ? rep : null);
  },
  bootNew: () => {
    unlockAudio();
    playSfx('nav');
    wizardScreen();
  },
  bootBack: () => titleScreen(cachedMeta),
  bootImport: async () => {
    const { importSaveFile } = await import('./save/save');
    const r = await importSaveFile();
    if (!r.state) return titleScreen(cachedMeta, [], r.error);
    await saveGame(r.state, 'auto');
    const rep = catchUp(r.state);
    app.start(r.state, rep && rep.seconds > 30 ? rep : null);
  },
  wzLogo: (el) => { wizard.logo = el.dataset.v!; wizardScreen(); },
  wzColor: (el) => { wizard.color = el.dataset.v!; wizardScreen(); },
  wzCity: (el) => { wizard.city = el.dataset.v!; wizardScreen(); },
  wzDiff: (el) => { wizard.difficulty = el.dataset.v!; wizardScreen(); },
  bootStart: async () => {
    playSfx('levelup');
    const s = newGame({ name: wizard.name.trim() || 'Nimbus Compute', logo: wizard.logo, color: wizard.color, startCity: wizard.city, difficulty: wizard.difficulty });
    await saveGame(s, 'auto');
    app.start(s, null);
    setTimeout(() => {
      if (s.company.startParcel) app.openCity(s.company.startCity);
      setTimeout(() => s.company.startParcel && app.map?.goProperty(s.company.startParcel), 3200);
    }, 300);
  },
});
registerChanges({
  wzName: (el) => {
    wizard.name = (el as HTMLInputElement).value;
    const pv = document.querySelector('.preview b');
    if (pv) pv.textContent = wizard.name || 'Your Company';
  },
});

async function boot() {
  const r = await loadGame();
  cachedMeta = r.state ? { name: r.state.company.name, level: r.state.level, savedAt: r.state.lastRealTime } : null;
  titleScreen(cachedMeta, r.state ? r.repaired : [], r.state ? undefined : r.error);
}

boot().catch((err) => {
  console.error(err);
  bootRoot().innerHTML = `<div class="boot-card"><h2>Something went wrong</h2><p>${esc(String(err))}</p></div>`;
});
