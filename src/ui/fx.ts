// Celebration effects: confetti bursts and floating income pops.

export function confetti(intensity = 1, colors = ['#60a5fa', '#a78bfa', '#22d3ee', '#4ade80', '#facc15', '#f472b6']) {
  if (document.documentElement.classList.contains('reduce-motion')) return;
  const c = document.createElement('canvas');
  c.className = 'fx-confetti';
  document.body.appendChild(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const n = Math.round(140 * intensity);
  const parts = Array.from({ length: n }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? W * 0.15 : W * 0.85,
      y: H * 0.75,
      vx: (fromLeft ? 1 : -1) * (3 + Math.random() * 8),
      vy: -(9 + Math.random() * 10),
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      col: colors[i % colors.length],
    };
  });
  const t0 = performance.now();
  const frame = (t: number) => {
    const el = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - el / 2.6);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (el < 2.8) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

/** Floating "+$1.2K" near an element. */
export function moneyPop(anchor: HTMLElement | null, text: string, positive = true) {
  if (!anchor || document.documentElement.classList.contains('reduce-motion')) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `fx-pop ${positive ? 'pos' : 'neg'}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2 + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${r.top + 4}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
