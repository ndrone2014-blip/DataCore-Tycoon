// Animated isometric data-center skyline for the title / new-game screens.

let raf = 0;

interface Block { gx: number; gy: number; w: number; d: number; h: number; hue: number; seed: number; kind: 'dc' | 'tower' | 'tank' }

export function startTitleScene(canvas: HTMLCanvasElement) {
  stopTitleScene();
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  };
  resize();
  window.addEventListener('resize', resize);
  // procedural campus on a 14x14 grid
  const blocks: Block[] = [];
  const rnd = (() => { let a = 1337; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  for (let gx = -7; gx < 7; gx++) {
    for (let gy = -7; gy < 7; gy++) {
      if ((gx + 70) % 3 === 0 || (gy + 70) % 3 === 0) continue; // streets
      if (rnd() < 0.18) continue;
      const r = rnd();
      blocks.push({ gx, gy, w: 0.82, d: 0.82, h: r < 0.12 ? 2.4 + rnd() * 2 : 0.5 + rnd() * 1.1, hue: rnd() < 0.2 ? 270 : rnd() < 0.5 ? 210 : 190, seed: rnd(), kind: r < 0.12 ? 'tower' : r < 0.2 ? 'tank' : 'dc' });
    }
  }
  const packets = Array.from({ length: 70 }, () => ({ lane: Math.floor(rnd() * 10), t: rnd(), v: 0.04 + rnd() * 0.08, axis: rnd() < 0.5 ? 0 : 1, col: rnd() < 0.5 ? '#60a5fa' : rnd() < 0.5 ? '#a78bfa' : '#22d3ee' }));

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!canvas.isConnected) return stopTitleScene();
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#030712');
    g.addColorStop(0.55, '#0a1a3a');
    g.addColorStop(1, '#10264f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars
    for (let i = 0; i < 90; i++) {
      const x = (i * 137.5) % W, y = ((i * 71.3) % (H * 0.45));
      ctx.fillStyle = `rgba(200,220,255,${0.25 + 0.35 * Math.sin(t * 1.5 + i)})`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    const S = Math.min(W, H) / 13; // tile size
    const ox = W / 2 + Math.sin(t * 0.05) * S * 0.6, oy = H * 0.62;
    const rot = t * 0.04;
    const iso = (x: number, y: number, z: number): [number, number] => {
      const c = Math.cos(rot), s = Math.sin(rot);
      const rx = x * c - y * s, ry = x * s + y * c;
      return [ox + (rx - ry) * S * 0.87, oy + (rx + ry) * S * 0.5 - z * S];
    };
    // ground grid glow
    ctx.strokeStyle = 'rgba(59,130,246,0.18)';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      let [a, b] = iso(i, -8, 0), [c, d] = iso(i, 8, 0);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      [a, b] = iso(-8, i, 0); [c, d] = iso(8, i, 0);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    // data packets along street lines
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of packets) {
      p.t = (p.t + p.v * 0.016) % 1;
      const lane = -7 + (p.lane % 5) * 3 - 0.5;
      const u = -8 + p.t * 16;
      const [x, y] = p.axis ? iso(lane, u, 0.02) : iso(u, lane, 0.02);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 9);
      gr.addColorStop(0, p.col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
    ctx.restore();
    // depth sort
    const c = Math.cos(rot), s = Math.sin(rot);
    const sorted = blocks.slice().sort((A, B) => (A.gx * c - A.gy * s + A.gx * s + A.gy * c) - (B.gx * c - B.gy * s + B.gx * s + B.gy * c));
    for (const b of sorted) {
      const x0 = b.gx, y0 = b.gy, x1 = b.gx + b.w, y1 = b.gy + b.d, h = b.h;
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const top = corners.map(([x, y]) => iso(x, y, h));
      const base = corners.map(([x, y]) => iso(x, y, 0));
      // draw the two visible faces (largest screen y edges)
      const faces = [0, 1, 2, 3].map((i) => ({ i, y: (base[i][1] + base[(i + 1) % 4][1]) / 2 })).sort((a, b2) => a.y - b2.y).slice(2);
      for (const { i } of faces) {
        const j = (i + 1) % 4;
        ctx.beginPath();
        ctx.moveTo(base[i][0], base[i][1]);
        ctx.lineTo(base[j][0], base[j][1]);
        ctx.lineTo(top[j][0], top[j][1]);
        ctx.lineTo(top[i][0], top[i][1]);
        ctx.closePath();
        const light = base[j][0] > base[i][0] ? 22 : 30;
        ctx.fillStyle = b.kind === 'tank' ? `hsl(200,10%,${light + 8}%)` : `hsl(${b.hue},35%,${light - 8}%)`;
        ctx.fill();
        // LED strips / windows
        const rows = Math.max(1, Math.floor(h * 4));
        for (let r = 1; r < rows; r++) {
          const v = r / rows;
          const n = 6;
          for (let k = 0; k < n; k++) {
            const tt = (k + 0.5) / n;
            const px = base[i][0] + (base[j][0] - base[i][0]) * tt;
            const py = base[i][1] + (base[j][1] - base[i][1]) * tt - (top[i][1] - base[i][1]) * -v;
            const on = Math.sin(t * (2 + b.seed * 5) + k * 1.7 + r * 2.3 + b.seed * 50) > 0.1;
            if (!on) continue;
            ctx.fillStyle = b.kind === 'tower' ? 'rgba(255,214,140,0.85)' : b.hue === 270 ? 'rgba(196,181,253,0.9)' : 'rgba(125,211,252,0.9)';
            ctx.fillRect(px - 1.2, py - 0.8, 2.4, 1.6);
          }
        }
      }
      ctx.beginPath();
      top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = b.kind === 'tank' ? 'hsl(200,10%,46%)' : `hsl(${b.hue},30%,${38 + b.seed * 8}%)`;
      ctx.fill();
      // rooftop fans / beacons
      const [cx, cy] = iso(b.gx + b.w / 2, b.gy + b.d / 2, h);
      if (b.kind === 'dc') {
        ctx.fillStyle = 'rgba(15,23,42,0.6)';
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx - S * 0.2 + k * S * 0.2, cy, S * 0.06, S * 0.035, 0, 0, 6.3); ctx.fill(); }
      }
      if (b.kind === 'tower' && Math.sin(t * 3 + b.seed * 10) > 0.4) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(cx, cy - 4, 0, cx, cy - 4, 14);
        gr.addColorStop(0, 'rgba(255,60,60,0.95)');
        gr.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(cx - 14, cy - 18, 28, 28);
        ctx.restore();
      }
    }
    // atmospheric haze at the horizon
    const hz = ctx.createLinearGradient(0, H * 0.35, 0, H);
    hz.addColorStop(0, 'rgba(10,26,58,0)');
    hz.addColorStop(1, 'rgba(6,12,26,0.55)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(frame);
}

export function stopTitleScene() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
