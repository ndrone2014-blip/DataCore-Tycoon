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
import { applyMode, deviceMode, recommendedMode, rememberedMode, type DeviceMode } from './core/device';

declare const __GAME_VERSION__: string;
export const GAME_VERSION = typeof __GAME_VERSION__ !== 'undefined' ? __GAME_VERSION__ : 'dev';
(window as any).__GAME_VERSION__ = GAME_VERSION;
const app = new App();
(window as any).__app = app;
installDelegation(document);

const wizard = { name: 'Nimbus Compute', logo: COMPANY_LOGOS[0], color: COMPANY_COLORS[0], city: 'nova', difficulty: 'standard' };

function bootRoot(): HTMLElement {
  return document.getElementById('boot')!;
}

/** First screen: how are you playing? Sets up the controls, layout and graphics for that device. */
function deviceScreen() {
  const rec = recommendedMode();
  const card = (m: DeviceMode, icon: string, title: string, lines: string[]) => `
    <button class="device-card ${rec === m ? 'rec' : ''}" data-act="pickDevice" data-v="${m}">
      ${rec === m ? '<em>Recommended for this device</em>' : ''}
      <span class="device-ic">${icon}</span>
      <b>${title}</b>
      <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    </button>`;
  bootRoot().innerHTML = `
    <canvas id="title-scene"></canvas>
    <div class="boot-card device-screen">
      <div class="boot-logo">◢◤</div>
      <h1>AI DATA CENTER <span>EMPIRE</span></h1>
      <p class="tag-line">How are you playing today?</p>
      <div class="device-pick">
        ${card('pc', '🖥️', 'PC', ['Mouse &amp; keyboard camera', 'Full sidebar and data tables', 'Highest graphics'])}
        ${card('mobile', '📱', 'Mobile', ['Touch: drag, pinch and twist', 'Bottom tabs and slide-up panels', 'Tuned for speed and battery'])}
      </div>
      <label class="check device-remember"><input type="checkbox" id="device-remember"> Remember my choice on this device</label>
      <p class="boot-foot">Developed by Drone Hive Studios | Developer @ndrone40<br><span class="ver">${GAME_VERSION}</span></p>
    </div>`;
  startTitleScene(document.getElementById('title-scene') as HTMLCanvasElement);
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
        <button class="link device-change" data-act="changeDevice">Playing on ${deviceMode() === 'mobile' ? '📱 Mobile' : '🖥️ PC'} · Change</button>
      </div>
      <p class="boot-foot">Single-player · Autosaves locally · Developed by Drone Hive Studios | Developer @ndrone40<br><span class="ver">${GAME_VERSION}</span></p>
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
let bootRepaired: string[] = [];
let bootError: string | undefined;

registerActions({
  pickDevice: (el) => {
    const remember = (document.getElementById('device-remember') as HTMLInputElement | null)?.checked ?? false;
    applyMode(el.dataset.v as DeviceMode, remember);
    unlockAudio();
    playSfx('nav');
    titleScreen(cachedMeta, bootRepaired, bootError);
  },
  changeDevice: () => { applyMode(deviceMode(), false); deviceScreen(); },
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
  bootRepaired = r.state ? r.repaired : [];
  bootError = r.state ? undefined : r.error;
  const saved = rememberedMode();
  applyMode(saved ?? recommendedMode());
  if (saved) titleScreen(cachedMeta, bootRepaired, bootError);
  else deviceScreen();
}

boot().catch((err) => {
  console.error(err);
  bootRoot().innerHTML = `<div class="boot-card"><h2>Something went wrong</h2><p>${esc(String(err))}</p></div>`;
});
