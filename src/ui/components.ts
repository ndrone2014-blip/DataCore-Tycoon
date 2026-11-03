// Shared UI pieces: modal, toasts, confirm dialog, small HTML helpers.

import { morph } from './dom';
import { esc, money } from '../core/format';
import type { ToastMsg } from '../core/bus';

// ---------- Modal ----------
let modalRender: (() => string) | null = null;
let modalOnClose: (() => void) | null = null;
let modalClass = '';

export function openModal(render: () => string, opts: { wide?: boolean; onClose?: () => void; cls?: string } = {}) {
  modalRender = render;
  modalOnClose = opts.onClose ?? null;
  modalClass = `${opts.wide ? 'wide' : ''} ${opts.cls ?? ''}`;
  const root = document.getElementById('modal-root')!;
  root.classList.add('open');
  root.innerHTML = `<div class="modal-backdrop" data-act="closeModal"></div><div class="modal ${modalClass}"><button class="modal-x" data-act="closeModal" aria-label="Close">✕</button><div class="modal-body"></div></div>`;
  refreshModal();
}

export function refreshModal() {
  if (!modalRender) return;
  const body = document.querySelector('#modal-root .modal-body') as HTMLElement | null;
  if (body) morph(body, modalRender());
}

export function closeModal() {
  const root = document.getElementById('modal-root')!;
  root.classList.remove('open');
  root.innerHTML = '';
  modalRender = null;
  const cb = modalOnClose;
  modalOnClose = null;
  cb?.();
}

export const isModalOpen = () => !!modalRender;

let confirmCb: (() => void) | null = null;
export function confirmDialog(title: string, body: string, okLabel: string, onOk: () => void, danger = false) {
  confirmCb = onOk;
  openModal(() => `
    <h2>${esc(title)}</h2>
    <p class="muted">${body}</p>
    <div class="row gap end mt">
      <button class="btn ghost" data-act="closeModal">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirmOk">${esc(okLabel)}</button>
    </div>`);
}
export function runConfirm() {
  const cb = confirmCb;
  confirmCb = null;
  closeModal();
  cb?.();
}

// ---------- Toasts ----------
export function showToast(t: ToastMsg) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${t.kind ?? 'info'}`;
  el.innerHTML = `<div class="toast-icon">${t.icon ?? 'ℹ️'}</div><div><b>${esc(t.title)}</b>${t.body ? `<p>${esc(t.body)}</p>` : ''}</div>`;
  if (t.onClick) el.classList.add('clickable');
  el.addEventListener('click', () => { el.remove(); t.onClick?.(); });
  root.appendChild(el);
  while (root.children.length > 5) root.firstElementChild?.remove();
  setTimeout(() => el.classList.add('out'), t.kind === 'level' || t.kind === 'achievement' ? 6000 : 4200);
  setTimeout(() => el.remove(), t.kind === 'level' || t.kind === 'achievement' ? 6600 : 4800);
}

// ---------- HTML helpers ----------
export function bar(v: number, cls = '', label = ''): string {
  const p = Math.max(0, Math.min(1, v)) * 100;
  if (label && !cls.includes('big')) return `<div class="barwrap"><div class="bar ${cls}"><i style="width:${p.toFixed(1)}%"></i></div><span class="bar-label">${label}</span></div>`;
  return `<div class="bar ${cls}"><i style="width:${p.toFixed(1)}%"></i>${label ? `<span>${label}</span>` : ''}</div>`;
}

export function stat(label: string, value: string, sub = '', cls = ''): string {
  return `<div class="stat ${cls}"><label>${label}</label><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

export function btn(label: string, act: string, attrs: Record<string, string | number | undefined> = {}, cls = 'primary', disabledReason?: string): string {
  const a = Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `data-${k}="${esc(String(v))}"`).join(' ');
  const dis = disabledReason ? ` disabled title="${esc(disabledReason)}"` : '';
  return `<button class="btn ${cls}" data-act="${act}" ${a}${dis}>${label}</button>`;
}

export function moneyClass(v: number): string {
  return v >= 0 ? 'pos' : 'neg';
}

export function signedMoney(v: number): string {
  return `<span class="${moneyClass(v)}">${v >= 0 ? '+' : ''}${money(v)}</span>`;
}

export function empty(icon: string, title: string, body: string, action = ''): string {
  return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${body}</p>${action}</div>`;
}

export function gauge(v: number, max: number, label: string, unit: string, warn = 0.9): string {
  const r = max > 0 ? v / max : 0;
  const cls = r > 1 ? 'bad' : r > warn ? 'warn' : 'ok';
  return `<div class="gauge ${cls}"><div class="gauge-top"><span>${label}</span><b>${unit}</b></div>${bar(Math.min(1, r), cls)}<small>${(r * 100).toFixed(0)}% used</small></div>`;
}
