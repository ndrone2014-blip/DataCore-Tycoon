// Minimal DOM morphing + event delegation so pages can be re-rendered from
// HTML strings every tick without losing focus, scroll or hover state.

const tpl = document.createElement('template');

function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 1) {
    const ea = a as Element, eb = b as Element;
    if (ea.tagName !== eb.tagName) return false;
    const ka = ea.getAttribute('data-key'), kb = eb.getAttribute('data-key');
    return ka === kb;
  }
  return true;
}

function morphAttrs(from: Element, to: Element) {
  for (const attr of Array.from(to.attributes)) {
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
  for (const attr of Array.from(from.attributes)) {
    if (!to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
  }
}

function morphNode(from: Node, to: Node) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  const fe = from as HTMLElement, te = to as HTMLElement;
  if (fe.hasAttribute('data-keep')) {
    // keep subtree (e.g. canvases), only sync attributes other than children
    morphAttrs(fe, te);
    return;
  }
  const active = document.activeElement;
  const isInput = fe instanceof HTMLInputElement || fe instanceof HTMLTextAreaElement || fe instanceof HTMLSelectElement;
  if (isInput && fe === active) {
    // don't fight the user while they type
    return;
  }
  morphAttrs(fe, te);
  if (fe instanceof HTMLInputElement && te instanceof HTMLInputElement) {
    if (fe.type === 'checkbox' || fe.type === 'radio') fe.checked = te.hasAttribute('checked');
    else if (fe.value !== (te.getAttribute('value') ?? '')) fe.value = te.getAttribute('value') ?? '';
  }
  if (fe instanceof HTMLSelectElement && te instanceof HTMLSelectElement) {
    morphChildren(fe, te);
    const sel = Array.from(te.options).find((o) => o.hasAttribute('selected'));
    if (sel && fe.value !== sel.value) fe.value = sel.value;
    return;
  }
  morphChildren(fe, te);
}

function morphChildren(from: Node, to: Node) {
  const fc = Array.from(from.childNodes);
  const tc = Array.from(to.childNodes);
  let i = 0;
  for (; i < tc.length; i++) {
    const t = tc[i];
    const f = fc[i];
    if (!f) {
      from.appendChild(t);
      continue;
    }
    if (sameNode(f, t)) morphNode(f, t);
    else from.replaceChild(t, f);
  }
  for (let j = fc.length - 1; j >= i; j--) {
    if (fc[j].parentNode === from) from.removeChild(fc[j]);
  }
}

export function morph(target: HTMLElement, html: string) {
  tpl.innerHTML = html;
  morphChildren(target, tpl.content);
}

type Handler = (el: HTMLElement, ev: Event) => void;
const acts: Record<string, Handler> = {};
const changes: Record<string, Handler> = {};

export function registerActions(map: Record<string, Handler>) {
  Object.assign(acts, map);
}
export function registerChanges(map: Record<string, Handler>) {
  Object.assign(changes, map);
}

export function installDelegation(root: HTMLElement | Document = document) {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest?.('[data-act]') as HTMLElement | null;
    if (!el) return;
    if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return;
    const name = el.getAttribute('data-act')!;
    const h = acts[name];
    if (h) {
      ev.preventDefault();
      ev.stopPropagation();
      h(el, ev);
    } else console.warn('No action handler for', name);
  });
  const onChange = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest?.('[data-change]') as HTMLElement | null;
    if (!el) return;
    const h = changes[el.getAttribute('data-change')!];
    h?.(el, ev);
  };
  root.addEventListener('change', onChange);
  root.addEventListener('input', (ev) => {
    const el = ev.target as HTMLElement;
    if (el.hasAttribute('data-live')) onChange(ev);
  });
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
