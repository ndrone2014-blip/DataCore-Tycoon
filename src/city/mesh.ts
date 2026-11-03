// Small CPU mesh builder. One interleaved vertex layout is shared by every city object:
// position3 normal3 uv2 color3 material4 (style, seed, floorHeight, bayWidth) ao1 = 16 floats.

export type RGB = [number, number, number];
export interface Mat { st: number; seed: number; flr?: number; bay?: number }
export const STRIDE = 16;

export function hex(c: string | number): RGB {
  const n = typeof c === 'number' ? c : parseInt(c.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scalec = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

export class Mesh {
  v = new Float32Array(16 * 4096);
  i = new Uint32Array(6 * 4096);
  nv = 0;
  ni = 0;

  reset() { this.nv = 0; this.ni = 0; }

  private reserve(nv: number, ni: number) {
    if ((this.nv + nv) * STRIDE > this.v.length) { const a = new Float32Array(Math.max(this.v.length * 2, (this.nv + nv) * STRIDE)); a.set(this.v.subarray(0, this.nv * STRIDE)); this.v = a; }
    if (this.ni + ni > this.i.length) { const a = new Uint32Array(Math.max(this.i.length * 2, this.ni + ni)); a.set(this.i.subarray(0, this.ni)); this.i = a; }
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, c: RGB, m: Mat, ao: number) {
    const o = this.nv * STRIDE, v = this.v;
    v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = nx; v[o + 4] = ny; v[o + 5] = nz; v[o + 6] = u; v[o + 7] = w;
    v[o + 8] = c[0]; v[o + 9] = c[1]; v[o + 10] = c[2]; v[o + 11] = m.st; v[o + 12] = m.seed; v[o + 13] = m.flr ?? 3.6; v[o + 14] = m.bay ?? 3; v[o + 15] = ao;
    this.nv++;
  }

  /** Quad a-b-c-d with per-corner uv and ao. Winding is corrected from the given normal. */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[], col: RGB, m: Mat, ao: number[] = [1, 1, 1, 1]) {
    this.reserve(4, 6);
    const s = this.nv;
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], col, m, ao[0]);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[3], col, m, ao[1]);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], col, m, ao[2]);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], uv[6], uv[7], col, m, ao[3]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const I = this.i; let k = this.ni;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) { I[k++] = s; I[k++] = s + 1; I[k++] = s + 2; I[k++] = s; I[k++] = s + 2; I[k++] = s + 3; }
    else { I[k++] = s; I[k++] = s + 2; I[k++] = s + 1; I[k++] = s; I[k++] = s + 3; I[k++] = s + 2; }
    this.ni = k;
  }

  /** Axis-aligned box. Windows are fitted so each wall holds a whole number of bays. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, m: Mat, top?: { col: RGB; m: Mat } | null, baseAO = 0.62) {
    const fit = (w: number) => { const b = m.bay ?? 3; return { ...m, bay: Math.max(0.5, w / Math.max(1, Math.round(w / b))) }; };
    const H = y1 - y0;
    const lo = y0 < 1 ? baseAO : 0.9;
    const dark = H > 3 ? 1 : 1;
    const wx = x1 - x0, wz = z1 - z0;
    const mx = fit(wx), mz = fit(wz);
    const ao = [lo, lo, dark, dark];
    const uvx = [0, y0, wx, y0, wx, y1, 0, y1], uvz = [0, y0, wz, y0, wz, y1, 0, y1];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvx, col, mx, ao);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvx, col, mx, ao);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvz, col, mz, ao);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvz, col, mz, ao);
    if (top !== null) {
      const t = top ?? { col, m };
      this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], [x0, z0, x1, z0, x1, z1, x0, z1], t.col, t.m);
    }
  }

  /** Flat rectangle on the ground (or at a height). uv = world metres. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, col: RGB, m: Mat) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], [x0, z0, x1, z0, x1, z1, x0, z1], col, m);
  }

  /** Pitched roof running along the longer side, sitting on a wall top at y. */
  gable(x0: number, y: number, z0: number, x1: number, z1: number, rise: number, roof: RGB, wall: RGB, seed: number, wallM: Mat) {
    const over = 0.45;
    const alongX = x1 - x0 >= z1 - z0;
    const rm: Mat = { st: 18, seed };
    if (alongX) {
      const zc = (z0 + z1) / 2, r = y + rise, sl = Math.hypot(zc - z0 + over, rise);
      const n = rise / Math.hypot(rise, zc - z0), nz = (zc - z0) / Math.hypot(rise, zc - z0);
      this.quad([x0 - over, y - 0.2, z0 - over], [x1 + over, y - 0.2, z0 - over], [x1 + over, r, zc], [x0 - over, r, zc], [0, nz, -n], [0, 0, x1 - x0, 0, x1 - x0, sl, 0, sl], roof, rm);
      this.quad([x1 + over, y - 0.2, z1 + over], [x0 - over, y - 0.2, z1 + over], [x0 - over, r, zc], [x1 + over, r, zc], [0, nz, n], [0, 0, x1 - x0, 0, x1 - x0, sl, 0, sl], roof, rm);
      this.tri([x0, y, z0], [x0, y, z1], [x0, r, zc], [-1, 0, 0], wall, wallM);
      this.tri([x1, y, z1], [x1, y, z0], [x1, r, zc], [1, 0, 0], wall, wallM);
    } else {
      const xc = (x0 + x1) / 2, r = y + rise, sl = Math.hypot(xc - x0 + over, rise);
      const n = rise / Math.hypot(rise, xc - x0), ny = (xc - x0) / Math.hypot(rise, xc - x0);
      this.quad([x0 - over, y - 0.2, z1 + over], [x0 - over, y - 0.2, z0 - over], [xc, r, z0 - over], [xc, r, z1 + over], [-n, ny, 0], [0, 0, z1 - z0, 0, z1 - z0, sl, 0, sl], roof, rm);
      this.quad([x1 + over, y - 0.2, z0 - over], [x1 + over, y - 0.2, z1 + over], [xc, r, z1 + over], [xc, r, z0 - over], [n, ny, 0], [0, 0, z1 - z0, 0, z1 - z0, sl, 0, sl], roof, rm);
      this.tri([x0, y, z1], [x1, y, z1], [xc, r, z1], [0, 0, 1], wall, wallM);
      this.tri([x1, y, z0], [x0, y, z0], [xc, r, z0], [0, 0, -1], wall, wallM);
    }
  }

  tri(a: number[], b: number[], c: number[], n: number[], col: RGB, m: Mat) {
    // a degenerate quad keeps one code path; d duplicates c
    this.quad(a, b, c, c, n, [0, 0, 1, 0, 0.5, 1, 0.5, 1], col, { ...m, st: 0 });
  }

  /** Upright cylinder (tanks, stacks, silos). */
  cyl(cx: number, y0: number, cz: number, r: number, h: number, col: RGB, m: Mat, seg = 10, cap = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), cm = Math.cos((a0 + a1) / 2), sm = Math.sin((a0 + a1) / 2);
      this.quad([cx + c0 * r, y0, cz + s0 * r], [cx + c1 * r, y0, cz + s1 * r], [cx + c1 * r, y0 + h, cz + s1 * r], [cx + c0 * r, y0 + h, cz + s0 * r], [cm, 0, sm], [a0 * r, y0, a1 * r, y0, a1 * r, y0 + h, a0 * r, y0 + h], col, m);
      if (cap) this.quad([cx, y0 + h, cz], [cx + c0 * r, y0 + h, cz + s0 * r], [cx + c1 * r, y0 + h, cz + s1 * r], [cx + c1 * r, y0 + h, cz + s1 * r], [0, 1, 0], [0, 0, 1, 0, 1, 1, 1, 1], col, m);
    }
  }

  /** Lumpy sphere used for tree crowns. uv.y carries height inside the crown for fake self-shadowing. */
  blob(cx: number, cy: number, cz: number, r: number, col: RGB, m: Mat, squash = 0.9) {
    const rings = 4, seg = 7;
    const p = (ri: number, si: number) => {
      const t = (ri / rings) * Math.PI, a = (si / seg) * Math.PI * 2;
      const wob = 1 + 0.16 * Math.sin(a * 3 + cx * 2) * Math.sin(t * 2 + cz);
      const nx = Math.sin(t) * Math.cos(a), ny = Math.cos(t), nz = Math.sin(t) * Math.sin(a);
      return { pos: [cx + nx * r * wob, cy + ny * r * squash * wob, cz + nz * r * wob], n: [nx, ny, nz], h: (ny + 1) / 2 };
    };
    for (let ri = 0; ri < rings; ri++) for (let si = 0; si < seg; si++) {
      const a = p(ri, si), b = p(ri, si + 1), c = p(ri + 1, si + 1), d = p(ri + 1, si);
      this.reserve(4, 6);
      const s = this.nv;
      for (const q of [a, b, c, d]) this.vert(q.pos[0], q.pos[1], q.pos[2], q.n[0], q.n[1], q.n[2], 0, q.h, col, m, 1);
      const I = this.i; let k = this.ni;
      I[k++] = s; I[k++] = s + 1; I[k++] = s + 2; I[k++] = s; I[k++] = s + 2; I[k++] = s + 3;
      this.ni = k;
    }
  }

  /** Soft shadow ring on the ground around a footprint. */
  contact(x0: number, z0: number, x1: number, z1: number, spread: number) {
    const m: Mat = { st: 30, seed: 0 }, c: RGB = [0, 0, 0], y = 0.09, s = spread;
    const uv = [0, 0, 0, 0, 0, 1, 0, 1];
    this.quad([x0, y, z0], [x1, y, z0], [x1 + s, y, z0 - s], [x0 - s, y, z0 - s], [0, 1, 0], uv, c, m);
    this.quad([x1, y, z1], [x0, y, z1], [x0 - s, y, z1 + s], [x1 + s, y, z1 + s], [0, 1, 0], uv, c, m);
    this.quad([x1, y, z0], [x1, y, z1], [x1 + s, y, z1 + s], [x1 + s, y, z0 - s], [0, 1, 0], uv, c, m);
    this.quad([x0, y, z1], [x0, y, z0], [x0 - s, y, z0 - s], [x0 - s, y, z1 + s], [0, 1, 0], uv, c, m);
  }
}
