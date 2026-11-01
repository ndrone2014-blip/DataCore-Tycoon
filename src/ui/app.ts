// Application shell: main loop, routing, top bar, sidebar, autosave, map & 3D wiring.

import type { GameState } from '../core/state';
import { deriveAll, type Derived } from '../systems/derive';
import { advance, advanceFrozen, catchUp, type OfflineReport } from '../systems/sim';
import { confetti, moneyPop } from './fx';
import { DECISIONS, resolveDecision } from '../systems/decisions';
import { saveGame, saveSync } from '../save/save';
import { on, emit } from '../core/bus';
import { morph, registerActions, registerChanges } from './dom';
import { showToast, refreshModal, closeModal, runConfirm, isModalOpen, openModal } from './components';
import { updateCharts } from './charts';
import { icon } from './icons';
import { playSfx, setAudioSettings, unlockAudio } from '../audio/sound';
import { MapController } from '../map/controller';
import { createThreeView, type PropertyViewLike } from '../three/propertyView';
import { createIsoView } from '../three/isoView';
import { money, gameDate, esc, duration } from '../core/format';
import { xpForLevel, titleForLevel } from '../config/economy';
import { PAGES, type PageDef } from './pages';
import { renderMapPanel } from './pages/mapPanel';
import { currentStory, missionProgress } from '../systems/progression';
import { countryById, cityById } from '../config/world';
import { getParcel } from '../world/parcels';
import { stopTitleScene } from './titleScene';

export type Result = { ok: boolean; reason?: string } | void | undefined | boolean;

export class App {
  s!: GameState;
  d!: Derived;
  page = 'dashboard';
  map: MapController | null = null;
  pv: PropertyViewLike | null = null;
  pvLoading = false;
  show3D = true;
  xray = false;
  ui: Record<string, any> = { financeTab: 'hourly', dcId: null, reCity: 'all', reType: 'all', reSort: 'price', contractsTab: 'offers', compId: null, achTab: 'missions', eqFacility: null };
  private lastTick = performance.now();
  private lastRender = 0;
  private lastSave = Date.now();
  private saving = false;
  private savedAt = 0;
  private fps = 0;
  private frames = 0;
  private fpsT = performance.now();
  private loopTimer = 0;
  private bootTime = Date.now();
  private lastPop = 0;
  private popCash = 0;

  start(state: GameState, offline: OfflineReport | null) {
    this.s = state;
    this.d = deriveAll(state);
    document.getElementById('boot')?.remove();
    stopTitleScene();
    const root = document.getElementById('app')!;
    root.innerHTML = this.shellHtml();
    this.applySettings();
    this.installActions();
    on('toast', (t) => showToast(t));
    on('sfx', (n) => playSfx(n));
    on('world', () => {
      this.d = deriveAll(this.s);
      this.map?.requestRefresh();
      this.pv?.update();
    });
    on('mapstate', () => this.onMapState());
    on('levelup', () => { if (this.s.settings.celebrations !== false) confetti(1.3); });
    on('facilityBuilt', () => { if (this.s.settings.celebrations !== false) confetti(0.7); });
    on('achievement', () => { if (this.s.settings.celebrations !== false) confetti(0.6, ['#facc15', '#fde68a', '#f59e0b', '#ffffff']); });
    on('decision', () => this.render());
    on('maphover', (t: string) => {
      const el = document.getElementById('map-hover');
      if (el) {
        el.textContent = t;
        el.style.opacity = t ? '1' : '0';
      }
    });
    window.addEventListener('beforeunload', () => {
      if (!(window as any).__skipUnloadSave) saveSync(this.s);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.save(true);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
    this.navigate(state.gameHours < 1 && Object.keys(state.facilities).length === 0 ? 'map' : 'dashboard');
    this.loopTimer = window.setInterval(() => this.tick(), 100);
    this.render(true);
    if (offline) this.showOfflineReport(offline);
  }

  // ---------- loop ----------
  private tick() {
    const now = performance.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.frames++;
    if (now - this.fpsT > 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.fpsT = now;
    }
    if (dt > 8) {
      // tab was suspended — catch up like offline progress
      this.s.lastRealTime = Date.now() - dt * 1000;
      const rep = catchUp(this.s);
      this.d = deriveAll(this.s);
      if (rep && rep.seconds > 60) this.showOfflineReport(rep);
      dt = 0;
    }
    this.s.lastRealTime = Date.now();
    try {
      if (!this.s.paused && dt > 0) this.d = advance(this.s, dt * this.s.speed);
      else if (dt > 0) this.d = advanceFrozen(this.s, dt * this.s.speed);
      else this.d = deriveAll(this.s);
    } catch (err) {
      console.error('Simulation error', err);
    }
    // floating income pops
    if (now - this.lastPop > 2500) {
      const delta = this.s.cash - this.popCash;
      if (!this.s.paused && this.popCash !== 0 && Math.abs(delta) >= 1 && this.s.settings.celebrations !== false && Math.abs(delta) < Math.max(1e6, Math.abs(this.d.totals.revenueHr) * 50)) {
        moneyPop(document.querySelector('.tb-stat.cash'), `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))}`, delta >= 0);
      }
      this.popCash = this.s.cash;
      this.lastPop = now;
    }
    if (now - this.lastRender > 450) {
      this.lastRender = now;
      this.render();
    }
    if (Date.now() - this.lastSave > this.s.settings.autosaveSeconds * 1000) void this.save(true);
  }

  async save(auto = false) {
    if (this.saving || (window as any).__skipUnloadSave) return;
    this.saving = true;
    this.lastSave = Date.now();
    const ok = await saveGame(this.s, auto ? 'auto' : 'manual');
    if (!auto) await saveGame(this.s, 'auto');
    this.saving = false;
    this.savedAt = Date.now();
    if (!auto) showToast({ title: ok ? 'Game saved' : 'Saved to backup storage', body: ok ? 'Stored in IndexedDB.' : 'IndexedDB unavailable — saved to localStorage.', kind: 'good', icon: '💾' });
  }

  // ---------- rendering ----------
  private shellHtml(): string {
    return `
    <div class="game">
      <aside class="sidebar">
        <div class="brand"><div class="brand-logo">◢◤</div><div><b>AI Data Center</b><small>EMPIRE</small></div></div>
        <nav id="nav"></nav>
        <div class="side-foot" id="side-foot"></div>
      </aside>
      <header class="topbar" id="topbar"></header>
      <main class="main">
        <section id="map-page" class="map-page hidden">
          <div id="map-container" class="map-container"></div>
          <div id="pv-container" class="pv-container"></div>
          <div class="map-ui">
            <div class="crumbs" id="crumbs"></div>
            <div class="map-tools" id="map-tools"></div>
            <div class="map-legend" id="map-legend"></div>
            <div class="map-hover" id="map-hover"></div>
            <div class="map-attrib" id="map-attrib"></div>
          </div>
          <aside class="map-panel" id="map-panel"></aside>
        </section>
        <section id="page" class="page"></section>
        <div id="time-banner" class="time-banner"></div>
        <div id="decision-root" class="decision-root"></div>
      </main>
    </div>
    <div id="toasts" class="toasts"></div>
    <div id="modal-root" class="modal-root"></div>`;
  }

  render(force = false) {
    const s = this.s;
    if (Object.keys(s.facilities).some((id) => !this.d.fac[id])) this.d = deriveAll(s);
    morph(document.getElementById('topbar')!, this.topbarHtml());
    morph(document.getElementById('nav')!, this.navHtml());
    morph(document.getElementById('side-foot')!, this.sideFootHtml());
    if (this.page === 'map') {
      morph(document.getElementById('map-panel')!, renderMapPanel(this));
      morph(document.getElementById('crumbs')!, this.crumbsHtml());
      morph(document.getElementById('map-tools')!, this.mapToolsHtml());
      morph(document.getElementById('map-legend')!, this.legendHtml());
      const at = document.getElementById('map-attrib');
      if (at) at.textContent = this.map?.attribution ?? 'Loading map…';
      if (this.map?.level === 'property') this.pv?.update();
    } else {
      const p = PAGES.find((x) => x.id === this.page);
      if (p) {
        const el = document.getElementById('page')!;
        morph(el, `<div class="page-head"><h1>${p.title}</h1>${p.subtitle ? `<p>${p.subtitle(this)}</p>` : ''}</div>${p.render(this)}`);
      }
    }
    morph(document.getElementById('time-banner')!, s.paused ? `<div class="tb-inner"><span class="tb-ico">⏸</span><div><b>Time is stopped</b><small>No income, expenses, rivals or events. Construction &amp; research keep going — buy, build and upgrade freely.</small></div><button class="btn primary sm" data-act="pause">▶ Resume</button></div>` : '');
    document.getElementById('time-banner')!.classList.toggle('show', s.paused);
    document.documentElement.classList.toggle('paused-world', s.paused);
    morph(document.getElementById('decision-root')!, this.decisionHtml());
    if (isModalOpen()) refreshModal();
    void updateCharts();
    void force;
    void s;
  }

  private topbarHtml(): string {
    const s = this.s, d = this.d;
    const lvlBase = xpForLevel(s.level), lvlNext = xpForLevel(s.level + 1);
    const xpFrac = s.level >= 100 ? 1 : (s.xp - lvlBase) / Math.max(1, lvlNext - lvlBase);
    const saved = this.savedAt ? Math.round((Date.now() - this.savedAt) / 1000) : null;
    return `
      <div class="tb-company" style="--c:${s.company.color}">
        <div class="tb-logo">${esc(s.company.logo)}</div>
        <div><b>${esc(s.company.name)}</b><small>Lv ${s.level} · ${titleForLevel(s.level)}</small>
          <div class="xpbar" title="${Math.round(s.xp).toLocaleString()} / ${lvlNext.toLocaleString()} XP"><i style="width:${(xpFrac * 100).toFixed(1)}%"></i></div></div>
      </div>
      <div class="tb-stats">
        <div class="tb-stat cash"><label>Cash</label><b>${money(s.cash, 2)}</b></div>
        <div class="tb-stat"><label>Profit / hr</label><b class="${d.totals.profitHr >= 0 ? 'pos' : 'neg'}">${d.totals.profitHr >= 0 ? '+' : ''}${money(d.totals.profitHr)}</b></div>
        <div class="tb-stat"><label>Revenue / hr</label><b>${money(d.totals.revenueHr)}</b></div>
        <div class="tb-stat hide-sm"><label>Valuation</label><b>${money(d.totals.valuation)}</b></div>
        ${s.debt > 0 ? `<div class="tb-stat hide-sm"><label>Debt</label><b class="neg">${money(s.debt)}</b></div>` : ''}
      </div>
      <div class="tb-time">
        <div class="tb-date">${gameDate(Date.UTC(2027, 0, 1, 8), s.gameHours)}</div>
        <div class="speed">
          <button class="stop-btn ${s.paused ? 'on' : ''}" data-act="pause" title="Stop / resume time (Space). While stopped you can still buy, build and upgrade.">${s.paused ? '▶ Resume' : '⏸ Stop time'}</button>
          ${[1, 2, 4].map((v) => `<button class="sp ${!s.paused && s.speed === v ? 'on' : ''}" data-act="speed" data-v="${v}" title="${v}x speed">${v}×</button>`).join('')}
          <button class="icon-btn" data-act="saveNow" title="Save now (Ctrl+S)">${icon('save')}</button>
          <button class="icon-btn" data-act="toggleMute" title="Mute">${s.settings.muted ? icon('mute') : icon('sound')}</button>
        </div>
        <small class="save-ind">${this.saving ? 'Saving…' : saved !== null ? `Saved ${saved < 5 ? 'just now' : saved + 's ago'}` : 'Autosave on'}${s.settings.showFps ? ` · ${this.fps * 1} ticks/s` : ''}</small>
      </div>`;
  }

  private navHtml(): string {
    const s = this.s;
    const badges: Record<string, number> = {
      construction: Object.keys(s.projects).length,
      contracts: s.contracts.offers.length,
      achievements: this.claimableMissions(),
      research: s.research.active ? 0 : 0,
    };
    return PAGES.map((p) => `<button class="nav-item ${this.page === p.id ? 'active' : ''}" data-act="nav" data-page="${p.id}" title="${p.title}">
      <span class="nav-ic">${icon(p.icon)}</span><span class="nav-label">${p.title}</span>${badges[p.id] ? `<span class="badge">${badges[p.id]}</span>` : ''}</button>`).join('');
  }

  private sideFootHtml(): string {
    const st = currentStory(this.s);
    if (!st) return `<div class="mission-mini done">All story missions complete 🏆</div>`;
    const p = missionProgress(this.s, this.d, { ...st, base: 0 });
    return `<div class="mission-mini ${p >= 1 ? 'ready' : ''}" data-act="nav" data-page="achievements" title="${esc(st.desc)}">
      <small>Mission ${this.s.missions.tutorial + 1}</small><b>${esc(st.title)}</b>
      <div class="bar sm"><i style="width:${(p * 100).toFixed(0)}%"></i></div>
      ${p >= 1 ? '<em>Claim reward →</em>' : `<p>${esc(st.desc)}</p>`}</div>`;
  }

  private decisionHtml(): string {
    const pd = this.s.decision;
    if (!pd) return '';
    const def = DECISIONS.find((x) => x.id === pd.defId);
    if (!def) return '';
    const choices = def.choices(this.s, pd.data);
    const left = Math.max(0, pd.expiresAt - this.s.gameHours);
    return `<div class="decision-card" data-key="dec-${pd.id}">
      <div class="dc-head"><span class="dc-ico">${def.icon}</span><div><small>Opportunity · expires in ${Math.ceil(left / 24)}d</small><b>${esc(def.title)}</b></div>
      <button class="dc-x" data-act="decisionDismiss" title="Ignore">✕</button></div>
      <p>${esc(def.text(this.s, pd.data))}</p>
      <div class="dc-choices">${choices.map((c, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'} sm" data-act="decisionChoose" data-i="${i}" ${c.cost && this.s.cash < c.cost ? `disabled title="Need ${money(c.cost)}"` : ''}>${esc(c.label)}<small>${esc(c.hint)}</small></button>`).join('')}</div>
    </div>`;
  }

  claimableMissions(): number {
    let n = 0;
    const st = currentStory(this.s);
    if (st && missionProgress(this.s, this.d, { ...st, base: 0 }) >= 1) n++;
    for (const m of this.s.missions.daily.items) if (!m.claimed && missionProgress(this.s, this.d, m) >= 1) n++;
    return n;
  }

  // ---------- map ----------
  private crumbsHtml(): string {
    const m = this.map;
    if (!m) return '';
    const parts: string[] = [`<button data-act="mapWorld" class="${m.level === 'world' ? 'cur' : ''}">🌐 World</button>`];
    if (m.countryId) {
      const c = countryById(m.countryId);
      parts.push(`<button data-act="mapCountry" data-id="${m.countryId}" class="${m.level === 'country' ? 'cur' : ''}">${c ? `${c.flag} ${esc(c.name)}` : m.countryId}</button>`);
    }
    if (m.cityId) parts.push(`<button data-act="mapCity" data-id="${m.cityId}" class="${m.level === 'city' ? 'cur' : ''}">${esc(cityById(m.cityId).name)}</button>`);
    if (m.parcelId && m.level === 'property') parts.push(`<button class="cur">${esc(getParcel(m.parcelId)?.name ?? 'Property')}</button>`);
    return `${m.level !== 'world' ? `<button class="crumb-back" data-act="mapBack" title="Back (Esc)">${icon('back')}</button>` : ''}${parts.join('<span class="sep">›</span>')}`;
  }

  private mapToolsHtml(): string {
    const prop = this.map?.level === 'property';
    return `
      <button class="icon-btn" data-act="mapZoom" data-v="1" title="Zoom in">${icon('plus')}</button>
      <button class="icon-btn" data-act="mapZoom" data-v="-1" title="Zoom out">${icon('minus')}</button>
      <button class="icon-btn" data-act="mapReset" title="Reset camera">${icon('reset')}</button>
      ${prop ? `<span class="tool-sep"></span>
      <button class="icon-btn ${this.show3D ? 'on' : ''}" data-act="toggle3D" title="3D property view">${icon('cube')}</button>
      <button class="icon-btn ${this.xray ? 'on' : ''}" data-act="toggleXray" title="X-ray interior (see racks)">${icon('xray')}</button>` : ''}`;
  }

  private legendHtml(): string {
    const lvl = this.map?.level;
    if (lvl === 'world' || lvl === 'country') return `<div class="lg"><i class="dot unlocked"></i>Open market</div><div class="lg"><i class="dot locked"></i>Locked market</div><div class="lg"><i class="dot mine"></i>Your facilities</div><div class="lg"><i class="sq comp"></i>Competitor present</div>`;
    return `<div class="lg"><i class="sq" style="background:#5b6b86"></i>Available</div><div class="lg"><i class="sq" style="background:${this.s.company.color}"></i>Yours</div><div class="lg"><i class="sq" style="background:#ef4444"></i>Competitor</div><div class="lg"><i class="sq" style="background:#f59e0b"></i>Construction</div><div class="lg"><i class="sq dash"></i>Development zone</div>`;
  }

  async ensureMap() {
    if (this.map) return;
    const container = document.getElementById('map-container')!;
    this.map = new MapController(container, () => this.s, () => this.d);
    (window as any).__map = this.map;
    try {
      await this.map.init(this.s.settings.forceFallbackMap);
      this.applySettings();
    } catch (err) {
      console.error('Map init failed', err);
    }
    this.render();
  }

  private async onMapState() {
    const m = this.map;
    if (!m) return;
    if (m.level === 'property' && m.parcelId && this.show3D) {
      if (!this.pv && !this.pvLoading) {
        this.pvLoading = true;
        const cont = document.getElementById('pv-container')!;
        let pv: PropertyViewLike | null = null;
        try {
          pv = await createThreeView(cont, () => this.s, () => this.d, () => this.s.settings.graphics);
        } catch (err) {
          console.warn('Three.js view failed', err);
          pv = null;
        }
        this.pv = pv ?? createIsoView(cont, () => this.s, () => this.d);
        this.pv.setXray(this.xray);
        this.pvLoading = false;
      }
      if (this.pv && this.map?.level === 'property' && this.map.parcelId) {
        const id = this.map.parcelId;
        setTimeout(() => {
          if (this.map?.level === 'property' && this.map.parcelId === id && this.show3D) this.pv?.show(id);
        }, this.s.settings.reduceMotion ? 0 : 900);
      }
    } else {
      this.pv?.hide();
    }
    document.getElementById('map-page')?.classList.toggle('prop3d', m.level === 'property' && this.show3D);
    this.render();
  }

  navigate(page: string) {
    this.page = page;
    document.getElementById('map-page')!.classList.toggle('hidden', page !== 'map');
    document.getElementById('page')!.classList.toggle('hidden', page === 'map');
    if (page === 'map') {
      void this.ensureMap().then(() => this.map?.engine?.resize());
    }
    const el = document.getElementById('page');
    if (el) el.scrollTop = 0;
    this.render();
  }

  /** Jump to a parcel on the map (level 4). */
  openParcel(parcelId: string) {
    this.navigate('map');
    void this.ensureMap().then(() => setTimeout(() => this.map?.goProperty(parcelId), 50));
  }
  openCity(cityId: string) {
    this.navigate('map');
    void this.ensureMap().then(() => setTimeout(() => this.map?.goCity(cityId), 50));
  }

  // ---------- actions ----------
  run(fn: () => Result, okMsg?: string): boolean {
    let r: Result;
    try {
      r = fn();
    } catch (err: any) {
      r = { ok: false, reason: err?.message ?? String(err) };
    }
    const ok = r === undefined || r === true || (typeof r === 'object' && r !== null && (r as any).ok !== false);
    if (!ok) {
      const reason = typeof r === 'object' && r ? (r as any).reason ?? ((r as any).reasons?.[0]) : 'Not possible';
      showToast({ title: 'Can’t do that', body: reason, kind: 'bad', icon: '⛔' });
      playSfx('error');
    } else if (okMsg) showToast({ title: okMsg, kind: 'good', icon: '✔️' });
    this.d = deriveAll(this.s);
    this.render();
    return ok;
  }

  private installActions() {
    registerActions({
      nav: (el) => {
        playSfx('nav');
        this.navigate(el.dataset.page!);
      },
      pause: () => {
        this.s.paused = !this.s.paused;
        this.render();
      },
      speed: (el) => {
        this.s.speed = Number(el.dataset.v);
        this.s.paused = false;
        this.render();
      },
      saveNow: () => void this.save(false),
      toggleMute: () => {
        this.s.settings.muted = !this.s.settings.muted;
        this.applySettings();
        this.render();
      },
      closeModal: () => closeModal(),
      confirmOk: () => runConfirm(),
      mapWorld: () => this.map?.goWorld(),
      mapCountry: (el) => this.map?.goCountry(el.dataset.id!),
      mapCity: (el) => this.map?.goCity(el.dataset.id!),
      mapBack: () => this.map?.back(),
      mapZoom: (el) => this.map?.engine?.zoomBy(Number(el.dataset.v)),
      mapReset: () => {
        const m = this.map;
        if (!m) return;
        if (m.level === 'property' && m.parcelId) m.goProperty(m.parcelId);
        else if (m.level === 'city' && m.cityId) m.goCity(m.cityId);
        else if (m.level === 'country' && m.countryId) m.goCountry(m.countryId);
        else m.goWorld();
      },
      toggle3D: () => {
        this.show3D = !this.show3D;
        void this.onMapState();
      },
      toggleXray: () => {
        this.xray = !this.xray;
        this.pv?.setXray(this.xray);
        this.render();
      },
      openParcel: (el) => this.openParcel(el.dataset.id!),
      decisionChoose: (el) => this.run(() => resolveDecision(this.s, Number(el.dataset.i))),
      decisionDismiss: () => { this.s.decision = undefined; this.render(); },
      openCity: (el) => this.openCity(el.dataset.id!),
    });
    for (const p of PAGES) if (p.actions) registerActions(p.actions(this));
    for (const p of PAGES) if (p.changes) registerChanges(p.changes(this));
  }

  applySettings() {
    const st = this.s.settings;
    document.documentElement.style.setProperty('--ui-scale', String(st.uiScale));
    document.documentElement.style.fontSize = `${14 * st.uiScale}px`;
    document.documentElement.classList.toggle('reduce-motion', st.reduceMotion);
    document.documentElement.style.setProperty('--accent-co', this.s.company.color);
    setAudioSettings(st.sfxVolume, st.musicVolume, st.muted);
    this.map?.engine?.setSensitivity(st.cameraSensitivity, st.invertZoom);
    this.map?.engine?.setEffects?.({ glow: st.bloom !== false, timeOfDay: st.timeOfDay ?? 'auto' });
    document.documentElement.classList.toggle('no-glow', st.bloom === false);
    this.pv?.resize();
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === ' ') {
      e.preventDefault();
      this.s.paused = !this.s.paused;
      this.render();
    } else if (e.key === 'Escape') {
      if (isModalOpen()) closeModal();
      else if (this.page === 'map') this.map?.back();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void this.save(false);
    } else if (e.key >= '1' && e.key <= '3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.s.speed = [1, 2, 4][Number(e.key) - 1];
      this.s.paused = false;
      this.render();
    } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) {
      this.navigate('map');
    }
  }

  showOfflineReport(r: OfflineReport) {
    openModal(() => `
      <div class="offline-report">
        <div class="big-icon">🌙</div>
        <h2>While you were away</h2>
        <p class="muted">${duration(r.seconds)} of operations were simulated${r.cappedFrom ? ` (capped from ${duration(r.cappedFrom)} — upgrade your HQ or research automation to extend the offline limit)` : ''}.</p>
        <div class="grid3 mt">
          <div class="stat"><label>Revenue</label><b class="pos">+${money(r.revenue)}</b></div>
          <div class="stat"><label>Expenses</label><b class="neg">−${money(r.expenses)}</b></div>
          <div class="stat"><label>Net cash change</label><b class="${r.cash >= 0 ? 'pos' : 'neg'}">${r.cash >= 0 ? '+' : ''}${money(r.cash)}</b></div>
        </div>
        <ul class="report-list">
          ${r.builds ? `<li>🏗️ ${r.builds} construction project${r.builds > 1 ? 's' : ''} completed</li>` : ''}
          ${r.research ? `<li>🔬 ${r.research} research project${r.research > 1 ? 's' : ''} completed</li>` : ''}
          ${r.contracts ? `<li>✅ ${r.contracts} contract${r.contracts > 1 ? 's' : ''} completed</li>` : ''}
          ${r.levels ? `<li>⭐ Gained ${r.levels} company level${r.levels > 1 ? 's' : ''}</li>` : ''}
          ${r.compMoves ? `<li>🏢 Competitors made ${r.compMoves} moves — check the Competitors page</li>` : ''}
        </ul>
        <div class="row end mt"><button class="btn primary" data-act="closeModal">Back to work</button></div>
      </div>`);
  }

  get uptime() {
    return (Date.now() - this.bootTime) / 1000;
  }
}

export type { PageDef };
export { emit };
