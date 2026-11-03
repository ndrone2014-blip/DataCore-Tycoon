// Street-level city renderer (raw WebGL2, no external libraries, so it works offline and stays
// light on phones). Replaces the flat "plot" view: the map hands over to this view when you
// reach a city, and it stays on screen as you zoom right into a single property.

import type { GameState } from '../core/state';
import type { Derived } from '../systems/derive';
import { getCityLayout, districtFrame, CITY_RINGS, type ParcelDef } from '../world/parcels';
import { getCityscape } from '../world/cityscape';
import { parcelState } from '../systems/property';
import { getLighting } from '../core/timeOfDay';
import { hashString, mulberry32 } from '../core/rng';
import { esc } from '../core/format';
import { Mesh, STRIDE, hex, type RGB } from './mesh';
import { MAIN_FS, MAIN_VS, SHADOW_FS, SHADOW_VS, GROUND_FS, GROUND_VS, SKY_FS, SKY_VS, POINT_FS, POINT_VS, LINE_FS, LINE_VS, STYLE as S } from './shaders';
import { buildParcel, buildPark, buildSky, carModel, lampModel, treeModel, truckModel, type Glow, type Inst, type Out, type ParcelRender } from './models';

export interface CityPin { id: string; x: number; y: number; z: number; title: string; sub: string; cls: string }
export interface CityViewOpts {
  container: HTMLElement;
  getS: () => GameState;
  getD: () => Derived;
  mobile: () => boolean;
  /** 0 low, 1 medium, 2 high. */
  quality: () => number;
  pins: () => CityPin[];
  onPick: (parcelId: string | null) => void;
  onHover: (parcelId: string | null) => void;
  onExit: () => void;
  onFrameInfo?: (fps: number) => void;
}

export interface CityView {
  show(cityId: string): void;
  hide(): void;
  focusCity(animate?: boolean): void;
  focusParcel(id: string): void;
  setSelected(id: string | null): void;
  setZone(id: string | null): void;
  setXray(v: boolean): void;
  zoomBy(d: number): void;
  resize(): void;
  refresh(): void;
  setBottomInset(px: number): void;
  readonly visible: boolean;
  stats(): Record<string, number | string>;
}

// ---- matrices (column major) ----
type M4 = Float32Array;
const mul = (a: M4, b: M4): M4 => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; };
function perspective(fovy: number, asp: number, n: number, f: number): M4 { const t = 1 / Math.tan(fovy / 2); const m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f); return m; }
function ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 { const m = new Float32Array(16); m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1; return m; }
const nrm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(e: number[], c: number[], up: number[]): M4 { const z = nrm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]); const x = nrm(cross(up, z)); const y = cross(z, x); const m = new Float32Array(16); m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[12] = -dot(x, e); m[13] = -dot(y, e); m[14] = -dot(z, e); m[15] = 1; return m; }
function invert(m: M4): M4 {
  const r = new Float32Array(16), a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  r[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; r[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d; r[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; r[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
  r[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; r[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d; r[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; r[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
  r[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; r[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d; r[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; r[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
  r[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; r[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d; r[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; r[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
  return r;
}
const srgb = (c: RGB): number[] => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

export function createCityView(o: CityViewOpts): CityView | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'city-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block';
  const gl = canvas.getContext('webgl2', { antialias: o.quality() > 0, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const pinLayer = document.createElement('div');
  pinLayer.className = 'city-pins';
  const fade = document.createElement('div');
  fade.className = 'city-fade';
  o.container.append(canvas, pinLayer, fade);
  const Q = o.quality();
  gl.getExtension('OES_texture_float_linear');

  // ---- programs ----
  function prog(vs: string, fs: string, defs = ''): { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> } {
    const head = `#version 300 es\n#define Q ${Q}\n${defs}`;
    const compile = (t: number, src: string) => {
      const sh = gl!.createShader(t)!;
      gl!.shaderSource(sh, src.replace('#version 300 es', head));
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const p = gl!.createProgram()!;
    gl!.attachShader(p, compile(gl!.VERTEX_SHADER, vs));
    gl!.attachShader(p, compile(gl!.FRAGMENT_SHADER, fs));
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) ?? 'link error');
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl!.getProgramParameter(p, gl!.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl!.getActiveUniform(p, i)!.name; u[name] = gl!.getUniformLocation(p, name); }
    return { p, u };
  }
  const P = {
    main: prog(MAIN_VS, MAIN_FS),
    inst: prog(MAIN_VS, MAIN_FS, '#define INST\n'),
    shadow: prog(SHADOW_VS, SHADOW_FS),
    shadowI: prog(SHADOW_VS, SHADOW_FS, '#define INST\n'),
    ground: prog(GROUND_VS, GROUND_FS),
    sky: prog(SKY_VS, SKY_FS),
    point: prog(POINT_VS, POINT_FS),
    line: prog(LINE_VS, LINE_FS),
  };

  // ---- buffers ----
  interface Geo { vao: WebGLVertexArrayObject; vb: WebGLBuffer; ib: WebGLBuffer; count: number }
  const emptyVao = gl.createVertexArray()!;
  function meshAttribs() {
    const B = STRIDE * 4;
    gl!.enableVertexAttribArray(0); gl!.vertexAttribPointer(0, 3, gl!.FLOAT, false, B, 0);
    gl!.enableVertexAttribArray(1); gl!.vertexAttribPointer(1, 3, gl!.FLOAT, false, B, 12);
    gl!.enableVertexAttribArray(2); gl!.vertexAttribPointer(2, 2, gl!.FLOAT, false, B, 24);
    gl!.enableVertexAttribArray(3); gl!.vertexAttribPointer(3, 3, gl!.FLOAT, false, B, 32);
    gl!.enableVertexAttribArray(4); gl!.vertexAttribPointer(4, 4, gl!.FLOAT, false, B, 44);
    gl!.enableVertexAttribArray(5); gl!.vertexAttribPointer(5, 1, gl!.FLOAT, false, B, 60);
  }
  function makeGeo(): Geo {
    const vao = gl!.createVertexArray()!, vb = gl!.createBuffer()!, ib = gl!.createBuffer()!;
    gl!.bindVertexArray(vao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vb);
    meshAttribs();
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ib);
    gl!.bindVertexArray(null);
    return { vao, vb, ib, count: 0 };
  }
  function upload(g: Geo, m: Mesh, usage: number) {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, g.vb);
    gl!.bufferData(gl!.ARRAY_BUFFER, m.v.subarray(0, m.nv * STRIDE), usage);
    gl!.bindVertexArray(g.vao);
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, g.ib);
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, m.i.subarray(0, m.ni), usage);
    gl!.bindVertexArray(null);
    g.count = m.ni;
  }
  // instanced model + per-instance buffer
  interface IGeo extends Geo { ib2: WebGLBuffer; instances: number; data: Float32Array }
  function makeInst(model: Mesh): IGeo {
    const g = makeGeo() as IGeo;
    upload(g, model, gl!.STATIC_DRAW);
    g.ib2 = gl!.createBuffer()!;
    g.instances = 0;
    g.data = new Float32Array(0);
    gl!.bindVertexArray(g.vao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, g.ib2);
    gl!.enableVertexAttribArray(6); gl!.vertexAttribPointer(6, 4, gl!.FLOAT, false, 32, 0); gl!.vertexAttribDivisor(6, 1);
    gl!.enableVertexAttribArray(7); gl!.vertexAttribPointer(7, 4, gl!.FLOAT, false, 32, 16); gl!.vertexAttribDivisor(7, 1);
    gl!.bindVertexArray(null);
    return g;
  }
  function setInst(g: IGeo, items: Inst[], extra = 0) {
    g.data = new Float32Array((items.length + extra) * 8);
    items.forEach((t, i) => { const k = i * 8; g.data[k] = t.x; g.data[k + 1] = t.y; g.data[k + 2] = t.z; g.data[k + 3] = t.s; g.data[k + 4] = t.yaw; g.data[k + 5] = t.c[0]; g.data[k + 6] = t.c[1]; g.data[k + 7] = t.c[2]; });
    g.instances = items.length + extra;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, g.ib2);
    gl!.bufferData(gl!.ARRAY_BUFFER, g.data, extra ? gl!.DYNAMIC_DRAW : gl!.STATIC_DRAW);
  }
  const G = { stat: makeGeo(), statDecal: makeGeo(), dyn: makeGeo(), dynDecal: makeGeo(), clear: makeGeo() };
  const scratch = new Mesh();
  const I = { tree: makeInst(treeModel(scratch)), car: makeInst(carModel(scratch)), truck: makeInst(truckModel(scratch)), lamp: makeInst(lampModel(scratch)) };
  // ground
  const groundVao = gl.createVertexArray()!, groundVb = gl.createBuffer()!;
  gl.bindVertexArray(groundVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, groundVb);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  // points & outlines
  const pointVao = gl.createVertexArray()!, pointVb = gl.createBuffer()!;
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointVb);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
  const lineVao = gl.createVertexArray()!, lineVb = gl.createBuffer()!;
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVb);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  gl.bindVertexArray(null);
  let lineCount = 0;

  // ---- shadow map ----
  const shadowSize = Q >= 2 ? 2048 : Q === 1 ? 1024 : 0;
  let shadowFb: WebGLFramebuffer | null = null, shadowTex: WebGLTexture | null = null;
  if (shadowSize) {
    shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, shadowSize, shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- city state ----
  let cityId: string | null = null;
  let visible = false;
  let frame: ReturnType<typeof districtFrame> | null = null;
  let extent = { x0: 0, z0: 0, x1: 0, z1: 0 };
  let parcelsList: ParcelDef[] = [];
  let boxes: { id: string; x0: number; z0: number; x1: number; z1: number; h: number }[] = [];
  let staticTrees: Inst[] = [], staticCars: Inst[] = [], staticTrucks: Inst[] = [], staticGlows: Glow[] = [];
  let lastSig = '';
  let selected: string | null = null, hover: string | null = null, zoneSel: string | null = null;
  let xray = false;
  let shadowDirty = true;
  let bottomInset = 0;
  interface Car { axis: 0 | 1; line: number; lane: number; dir: number; speed: number; t: number; a: number; b: number }
  let traffic: Car[] = [];
  let parkedCount = 0;
  let pointData = new Float32Array(0), staticPointCount = 0;

  // ---- camera ----
  const cam = { x: 0, z: 0, dist: 500, yaw: -0.65, pitch: 0.55 };
  const goal = { x: 0, z: 0, dist: 500, yaw: -0.65, pitch: 0.55 };
  let camPos = [0, 200, 400], VP = new Float32Array(16) as M4, invVP = new Float32Array(16) as M4;
  const MIN_D = 28, MAX_D = 1050;
  let W = 1, H = 1, dpr = 1, scale = 1;
  const clampGoal = () => {
    goal.dist = Math.max(MIN_D, Math.min(MAX_D, goal.dist));
    goal.pitch = Math.max(0.12, Math.min(1.45, goal.pitch));
    goal.x = Math.max(extent.x0, Math.min(extent.x1, goal.x));
    goal.z = Math.max(extent.z0, Math.min(extent.z1, goal.z));
  };

  function resize() {
    const r = o.container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const cap = o.mobile() ? (Q >= 2 ? 1.6 : Q === 1 ? 1.35 : 1) : Q >= 2 ? 2 : Q === 1 ? 1.5 : 1;
    dpr = Math.min(cap, window.devicePixelRatio || 1) * scale;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(o.container);
  resize();

  // ---- building the city ----
  function newOut(detail: number): Out {
    return { m: new Mesh(), decal: new Mesh(), clear: new Mesh(), trees: [], cars: [], trucks: [], glows: [], detail };
  }

  function buildStatic(id: string) {
    const f = districtFrame(id);
    frame = f;
    const lay = getCityLayout(id);
    const sky = getCityscape(id);
    const detail = o.mobile() ? Math.min(1, Q) : Q;
    const out = newOut(detail);
    const px = f.BW + f.ST, py = f.BH + f.ST;
    const R = 2 + CITY_RINGS;
    extent = { x0: -2 * px - 60, z0: -2 * py - 60, x1: f.totalW + 2 * px + 60, z1: f.totalH + 2 * py + 60 };
    const mx = f.totalW / 2, mz = f.totalH / 2;
    for (const b of sky.buildings) {
      const cx = (b.rect.x0 + b.rect.x1) / 2, cz = (b.rect.y0 + b.rect.y1) / 2;
      const far = Math.hypot(cx - mx, cz - mz);
      const lim = detail === 0 ? 800 : detail === 1 ? (o.mobile() ? 900 : 1500) : 9999;
      if (far > lim) {
        // distant filler: facade only, no roof clutter
        const tint: RGB = b.kind === 'glass' || b.kind === 'tower' ? [0.42, 0.55, 0.66] : [0.62, 0.59, 0.54];
        out.m.box(b.rect.x0, 0, b.rect.y0, b.rect.x1, b.rect.y1 > 0 ? b.height : b.height, b.rect.y1, tint, { st: b.kind === 'glass' || b.kind === 'tower' ? S.glass : S.office, seed: b.seed, flr: 3.8, bay: 3.4 }, { col: [0.4, 0.4, 0.4], m: { st: S.roof, seed: b.seed } });
      } else buildSky(out, b);
    }
    sky.parks.forEach((p, i) => buildPark(out, p.rect, (i + 1) * 0.0137));
    // zone superblocks pave over the street that runs through them
    for (const site of lay.sites) out.m.flat(site.rect.x0, site.rect.y0, site.rect.x1, site.rect.y1, 0.03, [0.46, 0.46, 0.44], { st: S.pavement, seed: 0.5 });
    const zoneRects = lay.sites.map((z) => z.rect);
    const inZone = (x: number, z: number, pad = 0) => zoneRects.some((q) => x > q.x0 - pad && x < q.x1 + pad && z > q.y0 - pad && z < q.y1 + pad);
    const r = mulberry32(hashString('street:' + id));

    // far horizon so the city never just stops
    const rimRings = detail === 0 ? 1 : 3;
    for (let j = -R - rimRings; j < f.BY + R + rimRings; j++) for (let i = -R - rimRings; i < f.BX + R + rimRings; i++) {
      if (i >= -R && i < f.BX + R && j >= -R && j < f.BY + R) continue;
      const bx = f.ST + i * px + 6, bz = f.ST + j * py + 6;
      for (let k = 0; k < 2; k++) {
        const w = f.BW * 0.42, h = 8 + r() * r() * 70;
        const qx = bx + k * (f.BW * 0.5);
        const tint: RGB = r() < 0.4 ? [0.4, 0.52, 0.62] : [0.58, 0.55, 0.5];
        out.m.box(qx, 0, bz, qx + w, h, bz + f.BH - 14, tint, { st: tint[0] < 0.5 ? S.glass : S.office, seed: r(), flr: 3.8, bay: 3.4 }, { col: [0.4, 0.4, 0.4], m: { st: S.roof, seed: 0.2 } });
      }
    }
    // street trees, lamps and traffic follow the road grid
    const lampInst: Inst[] = [];
    const grey: RGB = [1, 1, 1];
    const spanX = [-R * px, f.totalW + R * px], spanZ = [-R * py, f.totalH + R * py];
    const treeKeep = detail === 2 ? 0.8 : detail === 1 ? 0.45 : 0.16;
    const lampKeep = detail === 2 ? 1 : detail === 1 ? 0.7 : 0.3;
    const glowLamp = (x: number, z: number, along: 0 | 1, side: number) => {
      const lx = along === 0 ? x : x - side * 2.2, lz = along === 0 ? z - side * 2.2 : z;
      staticGlows.push({ x: lx, y: 7.8, z: lz, c: [1, 0.78, 0.5], a: 0.9, size: 34 });
    };
    staticGlows = [];
    const carsWanted = o.mobile() ? (Q === 0 ? 40 : 90) : Q >= 2 ? 240 : Q === 1 ? 130 : 60;
    traffic = [];
    const streetsX: number[] = [], streetsZ: number[] = [];
    for (let i = -R; i <= f.BX + R; i++) streetsX.push(i * px + f.ST / 2);
    for (let j = -R; j <= f.BY + R; j++) streetsZ.push(j * py + f.ST / 2);
    const nearCentre = (x: number, z: number) => Math.hypot(x - mx, z - mz) < (detail === 2 ? 1400 : 800);
    for (const x of streetsX) for (const side of [-1, 1]) for (let z = spanZ[0]; z < spanZ[1]; z += 14) {
      const k = Math.round((z - f.ST / 2) / py), dj = Math.abs(z - (k * py + f.ST / 2));
      if (dj < 19 || inZone(x + side * 14, z, 2)) continue;
      const lamp = ((Math.round(z / 14) % 2) + 2) % 2 === 1;
      if (lamp) {
        if (r() < lampKeep && nearCentre(x, z)) { lampInst.push({ x: x + side * 14, y: 0, z: z, s: 1, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, c: grey }); glowLamp(x + side * 14, z, 1, side); }
      } else if (r() < treeKeep && nearCentre(x, z)) out.trees.push({ x: x + side * 14, y: 0, z, s: 0.62 + r() * 0.4, yaw: r() * 6.28, c: [0.3 + r() * 0.14, 0.45 + r() * 0.13, 0.19 + r() * 0.08] });
    }
    for (const z of streetsZ) for (const side of [-1, 1]) for (let x = spanX[0]; x < spanX[1]; x += 14) {
      const k = Math.round((x - f.ST / 2) / px), dj = Math.abs(x - (k * px + f.ST / 2));
      if (dj < 19 || inZone(x, z + side * 14, 2)) continue;
      const lamp = ((Math.round(x / 14) % 2) + 2) % 2 === 1;
      if (lamp) {
        if (r() < lampKeep && nearCentre(x, z)) { lampInst.push({ x, y: 0, z: z + side * 14, s: 1, yaw: side > 0 ? Math.PI : 0, c: grey }); glowLamp(x, z + side * 14, 0, side); }
      } else if (r() < treeKeep && nearCentre(x, z)) out.trees.push({ x, y: 0, z: z + side * 14, s: 0.62 + r() * 0.4, yaw: r() * 6.28, c: [0.3 + r() * 0.14, 0.45 + r() * 0.13, 0.19 + r() * 0.08] });
    }
    // streets running through a development zone are closed to traffic
    const openX = streetsX.filter((x) => !zoneRects.some((q) => x > q.x0 && x < q.x1));
    for (let i = 0; i < carsWanted; i++) {
      const axis: 0 | 1 = r() < 0.5 ? 0 : 1;
      const list = axis === 0 ? streetsZ : openX;
      const line = list[Math.floor(r() * list.length)];
      if (line === undefined) continue;
      const dir = r() < 0.5 ? 1 : -1;
      const lane = dir * (r() < 0.5 ? 2.8 : 8.2);
      const [a, b] = axis === 0 ? spanX : spanZ;
      traffic.push({ axis, line, lane, dir, speed: 8 + r() * 6, t: r(), a, b });
    }
    upload(G.stat, out.m, gl!.STATIC_DRAW);
    upload(G.statDecal, out.decal, gl!.STATIC_DRAW);
    staticTrees = out.trees;
    staticCars = out.cars;
    staticTrucks = out.trucks;
    staticGlows.push(...out.glows);
    setInst(I.lamp, lampInst);
    // ground
    const big = 9000;
    const gv = new Float32Array([mx - big, 0, mz - big, mx + big, 0, mz - big, mx + big, 0, mz + big, mx - big, 0, mz - big, mx + big, 0, mz + big, mx - big, 0, mz + big]);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, groundVb);
    gl!.bufferData(gl!.ARRAY_BUFFER, gv, gl!.STATIC_DRAW);
    parcelsList = [...lay.parcels, ...lay.sites];
    lastSig = '';
  }

  function renderInfo(p: ParcelDef): ParcelRender {
    const s = o.getS();
    const st = parcelState(s, p.id);
    const info: ParcelRender = { status: st.status, owner: st.owner, progress: 0, xray: false };
    if (st.owner === 'player') {
      if (st.facilityId && s.facilities[st.facilityId]) {
        info.facility = s.facilities[st.facilityId];
        info.xray = xray && selected === p.id && !info.facility.isHQ;
      }
      const pr = st.projectId ? s.projects[st.projectId] : undefined;
      if (pr) {
        info.progress = pr.doneSeconds / Math.max(1, pr.totalSeconds);
        if (pr.draft) info.facility = { floors: pr.draft.floors, footprint: pr.draft.footprint } as any;
      }
    } else if (st.owner) {
      const c = s.competitors.find((x) => x.id === st.owner);
      const site = c?.sites.find((x) => x.parcelId === p.id);
      if (c) info.color = c.color;
      if (site) { info.bp = site.blueprintId; info.progress = site.progress / Math.max(1, site.total); }
    }
    return info;
  }

  function signature(): string {
    const s = o.getS();
    let sig = `${xray}|${xray ? selected : ''}|${s.company.hqTier}|`;
    for (const p of parcelsList) {
      const st = s.parcels[p.id];
      if (!st) continue;
      sig += `${p.id}:${st.status}:${st.owner}:${st.mergedInto ?? ''}`;
      if (st.facilityId && s.facilities[st.facilityId]) sig += `:${JSON.stringify(s.facilities[st.facilityId].equipment)}:${s.facilities[st.facilityId].color}`;
      if (st.status === 'construction' || st.status === 'demolishing') {
        const i = renderInfo(p);
        sig += `:${Math.floor(i.progress * 20)}`;
      }
      sig += ';';
    }
    return sig;
  }

  function buildDynamic() {
    const s = o.getS();
    const detail = o.mobile() ? Math.min(1, Q) : Q;
    const out = newOut(detail);
    const list: typeof boxes = [];
    for (const p of parcelsList) {
      const st = s.parcels[p.id];
      if (p.isSite && st?.owner !== 'player') continue;
      if (st?.mergedInto) continue;
      const h = buildParcel(out, p, renderInfo(p), s);
      list.push({ id: p.id, x0: p.rect.x0, z0: p.rect.y0, x1: p.rect.x1, z1: p.rect.y1, h });
    }
    boxes = list;
    upload(G.dyn, out.m, gl!.DYNAMIC_DRAW);
    upload(G.dynDecal, out.decal, gl!.DYNAMIC_DRAW);
    upload(G.clear, out.clear, gl!.DYNAMIC_DRAW);
    setInst(I.tree, [...staticTrees, ...out.trees]);
    const parked = [...staticCars, ...out.cars];
    parkedCount = parked.length;
    setInst(I.car, parked, traffic.length);
    const r = mulberry32(99);
    const COLS: RGB[] = ['#d9dce0', '#15171b', '#8b8f96', '#9c1e1e', '#1f3f7a', '#ececec', '#3b3f45', '#6d7f8c'].map(hex);
    for (let i = 0; i < traffic.length; i++) { const c = COLS[Math.floor(r() * COLS.length)], k = (parkedCount + i) * 8 + 5; I.car.data[k] = c[0]; I.car.data[k + 1] = c[1]; I.car.data[k + 2] = c[2]; }
    setInst(I.truck, [...staticTrucks, ...out.trucks]);
    // lights: static part, then two per moving car
    const glows = [...staticGlows, ...out.glows];
    staticPointCount = glows.length;
    pointData = new Float32Array((glows.length + traffic.length * 2) * 8);
    glows.forEach((g, i) => { const k = i * 8; pointData[k] = g.x; pointData[k + 1] = g.y; pointData[k + 2] = g.z; pointData[k + 3] = g.c[0]; pointData[k + 4] = g.c[1]; pointData[k + 5] = g.c[2]; pointData[k + 6] = g.a; pointData[k + 7] = g.size; });
    gl!.bindBuffer(gl!.ARRAY_BUFFER, pointVb);
    gl!.bufferData(gl!.ARRAY_BUFFER, pointData, gl!.DYNAMIC_DRAW);
    shadowDirty = true;
    buildOutlines();
  }

  function rectFrame(arr: number[], q: { x0: number; z0: number; x1: number; z1: number }, c: RGB, a: number, t: number, y = 0.28, dash = 0) {
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const seg = (ax: number, az: number, bx: number, bz: number) => arr.push(ax, y, az, c[0], c[1], c[2], a, bx, y, az, c[0], c[1], c[2], a, bx, y, bz, c[0], c[1], c[2], a, ax, y, az, c[0], c[1], c[2], a, bx, y, bz, c[0], c[1], c[2], a, ax, y, bz, c[0], c[1], c[2], a);
      if (!dash) return seg(x0, z0, x1, z1);
      const horiz = x1 - x0 > z1 - z0;
      const len = horiz ? x1 - x0 : z1 - z0;
      for (let u = 0; u < len; u += dash * 2) horiz ? seg(x0 + u, z0, Math.min(x1, x0 + u + dash), z1) : seg(x0, z0 + u, x1, Math.min(z1, z0 + u + dash));
    };
    edge(q.x0, q.z0, q.x1, q.z0 + t); edge(q.x0, q.z1 - t, q.x1, q.z1); edge(q.x0, q.z0, q.x0 + t, q.z1); edge(q.x1 - t, q.z0, q.x1, q.z1);
  }

  function buildOutlines() {
    const s = o.getS();
    const arr: number[] = [];
    const me = hex(s.company.color);
    const comp = new Map(s.competitors.map((c) => [c.id, hex(c.color)]));
    for (const b of boxes) {
      const st = s.parcels[b.id];
      if (!st?.owner) continue;
      rectFrame(arr, b, st.owner === 'player' ? me : comp.get(st.owner) ?? [1, 0.3, 0.3], st.owner === 'player' ? 0.95 : 0.55, st.owner === 'player' ? 1.1 : 0.7);
    }
    if (cityId) for (const z of getCityLayout(cityId).zones) {
      const site = getCityLayout(cityId).sites.find((q) => q.zoneId === z.id);
      if (!site) continue;
      const q = { x0: site.rect.x0 - 2, z0: site.rect.y0 - 2, x1: site.rect.x1 + 2, z1: site.rect.y1 + 2 };
      rectFrame(arr, q, z.id === zoneSel ? [0.5, 1, 0.6] : [0.76, 0.7, 1], z.id === zoneSel ? 1 : 0.5, 0.8, 0.26, 6);
    }
    if (hover) { const b = boxes.find((x) => x.id === hover); if (b) rectFrame(arr, b, [0.6, 0.8, 1], 1, 1.3, 0.32); }
    if (selected) { const b = boxes.find((x) => x.id === selected); if (b) rectFrame(arr, b, [1, 0.75, 0.2], 1, 1.7, 0.36); }
    lineCount = arr.length / 7;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, lineVb);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(arr), gl!.DYNAMIC_DRAW);
  }

  // ---- pins ----
  let pins: (CityPin & { el: HTMLElement })[] = [];
  function refreshPins() {
    const list = o.pins().slice(0, 60);
    const keep = new Set(list.map((p) => p.id));
    pins = pins.filter((p) => { if (keep.has(p.id)) return true; p.el.remove(); return false; });
    for (const l of list) {
      let e = pins.find((p) => p.id === l.id);
      if (!e) {
        const el = document.createElement('button');
        el.addEventListener('click', (ev) => { ev.stopPropagation(); o.onPick(l.id); });
        pinLayer.appendChild(el);
        e = { ...l, el };
        pins.push(e);
      }
      Object.assign(e, l);
      const html = `<span class="cp-dot"></span><span class="cp-txt"><b>${esc(l.title)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</span>`;
      if (e.el.dataset.h !== html) { e.el.innerHTML = html; e.el.dataset.h = html; }
      e.el.className = `city-pin ${l.cls}`;
    }
  }
  function placePins() {
    const close = cam.dist < 620;
    const placed: number[][] = [];
    for (const p of [...pins].sort((a, b) => Number(b.cls.includes('alert')) - Number(a.cls.includes('alert')))) {
      const X = VP[0] * p.x + VP[4] * p.y + VP[8] * p.z + VP[12], Y = VP[1] * p.x + VP[5] * p.y + VP[9] * p.z + VP[13], w = VP[3] * p.x + VP[7] * p.y + VP[11] * p.z + VP[15];
      if (w < 1) { p.el.style.display = 'none'; continue; }
      const sx = (X / w * 0.5 + 0.5) * W, sy = (1 - (Y / w * 0.5 + 0.5)) * H;
      if (sx < -60 || sy < -40 || sx > W + 60 || sy > H + 40) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      // keep name tags readable at the screen edges
      const px = Math.max(62, Math.min(W - 62, sx)), py = Math.max(44, sy);
      p.el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
      // full label only where there's room; otherwise it shrinks to a dot and expands on approach
      const hit = placed.some((q) => Math.abs(q[0] - px) < 118 && Math.abs(q[1] - py) < 36);
      if (!hit) placed.push([px, py]);
      p.el.classList.toggle('compact', hit || (!close && !p.cls.includes('alert')));
    }
  }

  // ---- input ----
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let dragMode: 'pan' | 'rotate' | null = null;
  let moved = 0;
  let pinch = { d: 0, a: 0, my: 0 };
  let exitAcc = 0;
  let lastHover = 0;

  const groundPerPx = () => (2 * cam.dist * Math.tan(0.45)) / H;
  function panBy(dx: number, dy: number) {
    const k = groundPerPx();
    const cy = Math.cos(goal.yaw), sy = Math.sin(goal.yaw);
    // screen right → world along camera right; screen down → toward camera
    goal.x -= (dx * cy + dy * sy / Math.max(0.35, Math.sin(goal.pitch))) * k;
    goal.z -= (-dx * sy + dy * cy / Math.max(0.35, Math.sin(goal.pitch))) * k;
    clampGoal();
  }

  function pick(px: number, py: number): string | null {
    const ndcX = (px / W) * 2 - 1, ndcY = 1 - (py / H) * 2;
    const a = applyInv(ndcX, ndcY, -1), b = applyInv(ndcX, ndcY, 1);
    const d = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    let best: string | null = null, bestT = Infinity;
    for (const q of boxes) {
      let t0 = 0, t1 = 1e9;
      const slab = (o0: number, dd: number, lo: number, hi: number) => {
        if (Math.abs(dd) < 1e-6) return o0 >= lo && o0 <= hi;
        let u = (lo - o0) / dd, v = (hi - o0) / dd;
        if (u > v) { const w = u; u = v; v = w; }
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        return t0 <= t1;
      };
      if (slab(a[0], d[0], q.x0, q.x1) && slab(a[1], d[1], 0, q.h) && slab(a[2], d[2], q.z0, q.z1) && t0 < bestT) { bestT = t0; best = q.id; }
    }
    return best;
  }
  function applyInv(x: number, y: number, z: number): number[] {
    const m = invVP, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  }
  const shiftY = () => (bottomInset / H);

  const rel = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const q = rel(e);
    pointers.set(e.pointerId, { x: q.x, y: q.y, sx: q.x, sy: q.y });
    moved = 0;
    dragMode = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey) ? 'rotate' : 'pan';
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
    }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const q = rel(e);
    const cur = pointers.get(e.pointerId);
    if (!cur) {
      if (e.pointerType === 'mouse' && performance.now() - lastHover > 70) {
        lastHover = performance.now();
        const h = pick(q.x, q.y);
        if (h !== hover) { hover = h; buildOutlines(); o.onHover(h); canvas.style.cursor = h ? 'pointer' : 'grab'; }
      }
      return;
    }
    const dx = q.x - cur.x, dy = q.y - cur.y;
    cur.x = q.x; cur.y = q.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
      if (pinch.d > 0) {
        goal.dist *= pinch.d / Math.max(10, d);
        let da = ang - pinch.a;
        if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
        goal.yaw -= da;
        goal.pitch += (my - pinch.my) * 0.004;
        if (goal.dist > MAX_D * 1.25) { o.onExit(); goal.dist = MAX_D; }
      }
      pinch = { d, a: ang, my };
      clampGoal();
      moved += 8;
    } else if (dragMode === 'rotate') {
      goal.yaw -= dx * 0.0055 * sens();
      goal.pitch += dy * 0.004 * sens();
      clampGoal();
    } else if (moved > 4) panBy(dx * sens(), dy * sens());
  });
  const release = (e: PointerEvent) => {
    const q = rel(e);
    const had = pointers.delete(e.pointerId);
    canvas.style.cursor = 'grab';
    if (had && pointers.size === 0 && moved < (e.pointerType === 'mouse' ? 5 : 12) && e.type === 'pointerup') o.onPick(pick(q.x, q.y));
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (hover && !pointers.size) { hover = null; buildOutlines(); o.onHover(null); } });
  const sens = () => o.getS().settings.cameraSensitivity || 1;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const inv = o.getS().settings.invertZoom ? -1 : 1;
    const k = Math.exp(e.deltaY * 0.0012 * sens() * inv);
    // zoom toward what's under the cursor
    if (k < 1) {
      const q = rel(e as unknown as PointerEvent);
      const f = (1 - k) * 0.5;
      panBy(-(q.x - W / 2) * f, -(q.y - H / 2) * f);
    }
    if (goal.dist >= MAX_D - 1 && k > 1) {
      exitAcc += e.deltaY;
      if (exitAcc > 500) { exitAcc = 0; o.onExit(); }
    } else exitAcc = 0;
    goal.dist *= k;
    clampGoal();
  }, { passive: false });
  // PC keyboard camera
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => { const t = (e.target as HTMLElement).tagName; if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.ctrlKey || e.metaKey) return; if (visible && 'wasdqe'.includes(e.key.toLowerCase())) keys.add(e.key.toLowerCase()); };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  // ---- frame ----
  let raf = 0, last = performance.now(), frames = 0, fpsT = last, fps = 60, lastSigCheck = 0, slowSecs = 0;
  let shadowCenter = [0, 0], shadowExt = 0, shadowSun = [0, 1, 0], sunVP = new Float32Array(16) as M4;
  let lightUse = getLighting('auto');

  function sharedUniforms(p: { u: Record<string, WebGLUniformLocation | null> }, sun: number[], sunCol: number[], top: number[], hor: number[], gnd: number[], t: number, shadowOn: boolean) {
    const u = p.u;
    gl!.uniformMatrix4fv(u.uVP ?? null, false, VP);
    gl!.uniform3fv(u.uCam ?? null, camPos);
    gl!.uniform3fv(u.uSunDir ?? null, sun);
    gl!.uniform3fv(u.uSunCol ?? null, sunCol);
    gl!.uniform3fv(u.uSkyTop ?? null, top);
    gl!.uniform3fv(u.uSkyHor ?? null, hor);
    gl!.uniform3fv(u.uSkyGnd ?? null, gnd);
    gl!.uniform1f(u.uAmbient ?? null, lightUse.ambient);
    gl!.uniform1f(u.uNight ?? null, lightUse.night);
    gl!.uniform1f(u.uTime ?? null, t);
    gl!.uniform1f(u.uFogK ?? null, 1 / 2500);
    if (u.uShadow) {
      gl!.uniformMatrix4fv(u.uSunVP ?? null, false, sunVP);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, shadowTex);
      gl!.uniform1i(u.uShadow, 0);
      gl!.uniform1f(u.uShadowOn ?? null, shadowOn ? 1 : 0);
      gl!.uniform1f(u.uTexel ?? null, 1 / Math.max(1, shadowSize));
    }
  }

  function drawOpaque(shadowPass: boolean) {
    gl!.bindVertexArray(G.stat.vao); gl!.drawElements(gl!.TRIANGLES, G.stat.count, gl!.UNSIGNED_INT, 0);
    gl!.bindVertexArray(G.dyn.vao); gl!.drawElements(gl!.TRIANGLES, G.dyn.count, gl!.UNSIGNED_INT, 0);
    void shadowPass;
  }
  function drawInstanced(items: IGeo[]) {
    for (const g of items) {
      if (!g.instances) continue;
      gl!.bindVertexArray(g.vao);
      gl!.drawElementsInstanced(gl!.TRIANGLES, g.count, gl!.UNSIGNED_INT, 0, g.instances);
    }
  }

  function renderShadow(sun: number[]) {
    if (!shadowFb) return;
    const ext = Math.max(240, Math.min(1000, cam.dist * 1.5));
    const texel = (ext * 2) / shadowSize;
    const lp = [cam.x - Math.sin(cam.yaw) * ext * 0.12, cam.z - Math.cos(cam.yaw) * ext * 0.12];
    const c = [Math.round(lp[0] / texel) * texel, 0, Math.round(lp[1] / texel) * texel];
    const eye = [c[0] + sun[0] * 1800, sun[1] * 1800, c[2] + sun[2] * 1800];
    sunVP = mul(ortho(-ext, ext, -ext, ext, 100, 3600), lookAt(eye, c, [0, 1, 0.001]));
    shadowCenter = [cam.x, cam.z]; shadowExt = ext; shadowSun = sun.slice();
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, shadowFb);
    gl!.viewport(0, 0, shadowSize, shadowSize);
    gl!.clear(gl!.DEPTH_BUFFER_BIT);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.disable(gl!.BLEND);
    gl!.disable(gl!.CULL_FACE);
    gl!.colorMask(false, false, false, false);
    gl!.useProgram(P.shadow.p);
    gl!.uniformMatrix4fv(P.shadow.u.uSunVP, false, sunVP);
    drawOpaque(true);
    gl!.useProgram(P.shadowI.p);
    gl!.uniformMatrix4fv(P.shadowI.u.uSunVP, false, sunVP);
    drawInstanced([I.tree, I.truck]);
    gl!.colorMask(true, true, true, true);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    shadowDirty = false;
  }

  function updateTraffic(dt: number) {
    const d = I.car.data;
    if (!traffic.length || !d.length) return;
    const night = lightUse.night > 0.15;
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i];
      const len = c.b - c.a;
      c.t = (c.t + (c.dir * c.speed * dt) / len + 1) % 1;
      const along = c.a + len * c.t;
      const x = c.axis === 0 ? along : c.line + c.lane;
      const z = c.axis === 0 ? c.line - c.lane : along;
      const yaw = c.axis === 0 ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      const k = (parkedCount + i) * 8;
      d[k] = x; d[k + 1] = 0.02; d[k + 2] = z; d[k + 3] = 1; d[k + 4] = yaw;
      if (night) {
        const q = (staticPointCount + i * 2) * 8;
        const fx = c.axis === 0 ? c.dir : 0, fz = c.axis === 0 ? 0 : c.dir;
        pointData[q] = x + fx * 2.2; pointData[q + 1] = 0.7; pointData[q + 2] = z + fz * 2.2; pointData[q + 3] = 1; pointData[q + 4] = 0.93; pointData[q + 5] = 0.75; pointData[q + 6] = 0.9; pointData[q + 7] = 26;
        const u = q + 8;
        pointData[u] = x - fx * 2.2; pointData[u + 1] = 0.7; pointData[u + 2] = z - fz * 2.2; pointData[u + 3] = 1; pointData[u + 4] = 0.1; pointData[u + 5] = 0.06; pointData[u + 6] = 0.7; pointData[u + 7] = 16;
      }
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, I.car.ib2);
    gl!.bufferSubData(gl!.ARRAY_BUFFER, parkedCount * 32, d, parkedCount * 8, traffic.length * 8);
  }

  function loop(t: number) {
    raf = requestAnimationFrame(loop);
    if (!visible || !cityId || document.hidden || (window as any).__cityFreeze) return;
    const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
    // phones: 30fps is plenty for a tycoon camera and saves a lot of battery
    if (o.mobile() && t - last < 30 && !pointers.size) return;
    last = t;
    frames++;
    if (t - fpsT > 1000) {
      fps = frames; frames = 0; fpsT = t;
      o.onFrameInfo?.(fps);
      // adapt resolution if the device struggles
      const floor = o.mobile() ? 22 : 28;
      if (fps < floor) slowSecs++; else slowSecs = Math.max(0, slowSecs - 1);
      if (slowSecs >= 3 && scale > 0.6 && !(window as any).__cityFixedScale) { scale = Math.max(0.6, scale - 0.15); slowSecs = 0; resize(); }
    }
    if (t - lastSigCheck > 500) {
      lastSigCheck = t;
      const sig = signature();
      if (sig !== lastSig) { lastSig = sig; buildDynamic(); }
      refreshPins();
    }
    // keyboard
    if (keys.size) {
      const v = cam.dist * dt * 1.1, c = Math.cos(goal.yaw), n = Math.sin(goal.yaw);
      if (keys.has('w')) { goal.x -= n * v; goal.z -= c * v; }
      if (keys.has('s')) { goal.x += n * v; goal.z += c * v; }
      if (keys.has('a')) { goal.x -= c * v; goal.z += n * v; }
      if (keys.has('d')) { goal.x += c * v; goal.z -= n * v; }
      if (keys.has('q')) goal.yaw += dt * 1.1;
      if (keys.has('e')) goal.yaw -= dt * 1.1;
      clampGoal();
    }
    const k = 1 - Math.exp(-dt * (o.getS().settings.reduceMotion ? 30 : 7));
    cam.x += (goal.x - cam.x) * k; cam.z += (goal.z - cam.z) * k; cam.dist += (goal.dist - cam.dist) * k; cam.yaw += (goal.yaw - cam.yaw) * k; cam.pitch += (goal.pitch - cam.pitch) * k;
    // view
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const lookY = Math.min(16, cam.dist * 0.05);
    camPos = [cam.x + Math.sin(cam.yaw) * cp * cam.dist, Math.max(3, lookY + sp * cam.dist), cam.z + Math.cos(cam.yaw) * cp * cam.dist];
    const pr = perspective(0.9, W / H, Math.max(1.5, cam.dist * 0.04), 12000);
    // lift the scene above a bottom sheet so the selected lot stays visible
    pr[9] -= shiftY();
    VP = mul(pr, lookAt(camPos, [cam.x, lookY, cam.z], [0, 1, 0]));
    invVP = invert(VP);
    // light
    lightUse = getLighting(o.getS().settings.timeOfDay ?? 'auto');
    const L = lightUse;
    const elev = Math.max(0.16, L.sunElevation);
    const ce = Math.sqrt(1 - elev * elev);
    const sun = nrm([Math.cos(L.sunAzimuth) * ce, elev, Math.sin(L.sunAzimuth) * ce]);
    const sunUp = L.sunElevation > 0.02 && L.sunIntensity > 0.05;
    const sc = srgb(hex(L.sunColor)).map((v) => v * Math.max(0.16, Math.min(1.15, L.sunIntensity)));
    const top = srgb(hex(L.sky.top)), hor = srgb(hex(L.sky.horizon)), gnd = srgb(hex(L.sky.ground));
    if (shadowFb && sunUp) {
      const moved = Math.hypot(cam.x - shadowCenter[0], cam.z - shadowCenter[1]) > shadowExt * 0.14 || Math.abs(Math.max(240, Math.min(1000, cam.dist * 1.5)) - shadowExt) > shadowExt * 0.14 || dot(sun, shadowSun) < 0.99998;
      if (shadowDirty || moved) renderShadow(sun);
    }
    updateTraffic(dt);
    // ---- main pass ----
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.clearColor(0.5, 0.6, 0.7, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    const time = (t / 1000) % 3600;
    const on = !!shadowFb && sunUp;
    gl!.disable(gl!.BLEND);
    // sky
    gl!.depthMask(false); gl!.disable(gl!.DEPTH_TEST); gl!.disable(gl!.CULL_FACE);
    gl!.useProgram(P.sky.p);
    sharedUniforms(P.sky, sun, sc, top, hor, gnd, time, false);
    gl!.uniformMatrix4fv(P.sky.u.uInvVP, false, invVP);
    gl!.uniform3fv(P.sky.u.uCamS, camPos);
    gl!.bindVertexArray(emptyVao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.depthMask(true); gl!.enable(gl!.DEPTH_TEST);
    // ground
    gl!.useProgram(P.ground.p);
    sharedUniforms(P.ground, sun, sc, top, hor, gnd, time, on);
    gl!.uniform2f(P.ground.u.uGrid, frame!.BW + frame!.ST, frame!.BH + frame!.ST);
    gl!.uniform1f(P.ground.u.uSt, frame!.ST);
    gl!.enable(gl!.POLYGON_OFFSET_FILL); gl!.polygonOffset(3, 3);
    gl!.bindVertexArray(groundVao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    gl!.disable(gl!.POLYGON_OFFSET_FILL);
    // buildings
    gl!.enable(gl!.CULL_FACE);
    gl!.useProgram(P.main.p);
    sharedUniforms(P.main, sun, sc, top, hor, gnd, time, on);
    drawOpaque(false);
    gl!.disable(gl!.CULL_FACE);
    gl!.useProgram(P.inst.p);
    sharedUniforms(P.inst, sun, sc, top, hor, gnd, time, on);
    drawInstanced([I.tree, I.car, I.truck, I.lamp]);
    // contact shadows
    gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA); gl!.depthMask(false);
    gl!.enable(gl!.POLYGON_OFFSET_FILL); gl!.polygonOffset(-1, -1);
    gl!.useProgram(P.main.p);
    gl!.bindVertexArray(G.statDecal.vao); gl!.drawElements(gl!.TRIANGLES, G.statDecal.count, gl!.UNSIGNED_INT, 0);
    gl!.bindVertexArray(G.dynDecal.vao); gl!.drawElements(gl!.TRIANGLES, G.dynDecal.count, gl!.UNSIGNED_INT, 0);
    gl!.disable(gl!.POLYGON_OFFSET_FILL);
    // ownership outlines
    if (lineCount) {
      gl!.useProgram(P.line.p);
      gl!.uniformMatrix4fv(P.line.u.uVP, false, VP);
      gl!.uniform1f(P.line.u.uPulse, 0.82 + 0.18 * Math.sin(t / 380));
      gl!.bindVertexArray(lineVao);
      gl!.drawArrays(gl!.TRIANGLES, 0, lineCount);
    }
    // x-ray shell
    if (G.clear.count) {
      gl!.useProgram(P.main.p);
      gl!.bindVertexArray(G.clear.vao);
      gl!.drawElements(gl!.TRIANGLES, G.clear.count, gl!.UNSIGNED_INT, 0);
    }
    // lights
    if (L.night > 0.08 && pointData.length) {
      gl!.blendFunc(gl!.ONE, gl!.ONE);
      gl!.useProgram(P.point.p);
      gl!.uniformMatrix4fv(P.point.u.uVP, false, VP);
      gl!.uniform1f(P.point.u.uPx, (canvas.height / (2 * Math.tan(0.45))) * (L.night * 0.9));
      gl!.bindVertexArray(pointVao);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, pointVb);
      gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, pointData);
      gl!.drawArrays(gl!.POINTS, 0, pointData.length / 8);
    }
    gl!.disable(gl!.BLEND); gl!.depthMask(true);
    gl!.bindVertexArray(null);
    placePins();
  }

  const view: CityView = {
    show(id) {
      if (id !== cityId) {
        fade.classList.add('on');
        buildStatic(id);
        cityId = id;
        selected = hover = zoneSel = null;
        buildDynamic();
        lastSig = signature();
        for (const p of pins) p.el.remove();
        pins = [];
        refreshPins();
        view.focusCity(false);
      }
      if (!visible) {
        visible = true;
        o.container.classList.add('on');
        resize();
        last = performance.now();
      }
      requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove('on')));
      if (!raf) raf = requestAnimationFrame(loop);
    },
    hide() {
      visible = false;
      o.container.classList.remove('on');
      keys.clear();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    focusCity(animate = true) {
      if (!frame) return;
      const portrait = H > W;
      goal.x = frame.totalW / 2; goal.z = frame.totalH / 2; goal.dist = portrait ? 620 : 470; goal.pitch = 0.5; goal.yaw = -0.68;
      clampGoal();
      if (!animate) { Object.assign(cam, goal, { dist: goal.dist * 1.7, pitch: goal.pitch + 0.3, yaw: goal.yaw + 0.25 }); }
    },
    focusParcel(id) {
      const p = parcelsList.find((x) => x.id === id);
      if (!p) return;
      const size = Math.max(p.rect.x1 - p.rect.x0, p.rect.y1 - p.rect.y0);
      const b = boxes.find((x) => x.id === id);
      const portrait = H > W;
      goal.x = (p.rect.x0 + p.rect.x1) / 2; goal.z = (p.rect.y0 + p.rect.y1) / 2;
      goal.dist = Math.max(60, Math.min(560, Math.max(size * 1.7, (b?.h ?? 10) * 1.9) * (portrait ? 1.45 : 1)));
      goal.pitch = 0.42;
      clampGoal();
    },
    setSelected(id) { if (id !== selected) { selected = id; buildOutlines(); } },
    setZone(id) { if (id !== zoneSel) { zoneSel = id; buildOutlines(); } },
    setXray(v) { xray = v; },
    zoomBy(d) { goal.dist *= Math.pow(0.62, d); if (goal.dist > MAX_D * 1.05) o.onExit(); clampGoal(); },
    resize,
    refresh() { lastSigCheck = 0; },
    setBottomInset(px) { bottomInset = px; },
    get visible() { return visible; },
    stats: () => ({ fps, scale, tris: (G.stat.count + G.dyn.count) / 3, trees: I.tree.instances, cars: I.car.instances, q: Q, boxes: boxes.length, glErr: gl!.getError() }),
  };
  (window as any).__city = { view, cam, goal, pick: (x: number, y: number) => pick(x, y), project: (x: number, y: number, z: number) => { const X = VP[0] * x + VP[4] * y + VP[8] * z + VP[12], Y = VP[1] * x + VP[5] * y + VP[9] * z + VP[13], w = VP[3] * x + VP[7] * y + VP[11] * z + VP[15]; return [(X / w * 0.5 + 0.5) * W, (1 - (Y / w * 0.5 + 0.5)) * H]; } };
  return view;
}
