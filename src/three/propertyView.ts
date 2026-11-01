// Level-4 Property View rendered with Three.js. Shows the lot, its neighborhood,
// the existing building, demolition, every construction stage, the finished data
// center (style, roof cooling, generators, substations, security) and an X-ray
// interior with one rack per installed server.

import type { GameState } from '../core/state';
import { getCityLayout, getParcel, PROPERTY_TYPE_INFO, type ParcelDef } from '../world/parcels';
import { parcelState } from '../systems/property';
import { stageOf } from '../systems/construction';
import { equipmentById, blueprintById } from '../config/buildings';
import { loadThree } from '../lib/loader';
import { getLighting } from '../core/timeOfDay';
import { makeTextures, createSky, createTrees, createTraffic, createLamps, glowTexture, type Lane } from './environment';
import type { Derived } from '../systems/derive';

export interface PropertyViewLike {
  kind: 'three' | 'iso';
  show(parcelId: string): void;
  hide(): void;
  setXray(v: boolean): void;
  update(): void;
  resize(): void;
}

const CAP_COLORS: Record<string, number> = { cpu: 0x3b82f6, gpu: 0xa855f7, storage: 0x10b981, net: 0xf59e0b };

export async function createThreeView(container: HTMLElement, getS: () => GameState, getD: () => Derived, quality: () => string): Promise<PropertyViewLike | null> {
  const THREE = await loadThree();
  if (!THREE) return null;
  let renderer: any;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const canvas: HTMLCanvasElement = renderer.domElement;
  canvas.className = 'pv-canvas';
  container.appendChild(canvas);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const TEX = makeTextures(THREE);
  const sky = createSky(THREE);
  scene.add(sky.mesh);
  scene.fog = new THREE.Fog(0x9fb8d6, 320, 1100);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 3000);
  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x2a2a30, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(120, 180, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  const sc = sun.shadow.camera;
  sc.left = -200; sc.right = 200; sc.top = 200; sc.bottom = -200; sc.near = 10; sc.far = 900;
  scene.add(sun, sun.target);
  const ambient = new THREE.AmbientLight(0x6080b0, 0.25);
  scene.add(ambient);
  // reflections: image-based lighting generated from the live sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = createSky(THREE);
  envScene.add(envSky.mesh);
  let envTarget: any = null;
  let lastEnvHour = -99;
  /** Materials whose emissive glow follows the night (windows, LEDs, signs). */
  const nightMats: { m: any; day: number; night: number }[] = [];
  const nightMat = (m: any, day: number, night: number) => {
    nightMats.push({ m, day, night });
    return m;
  };
  let L = getLighting(getS().settings.timeOfDay ?? 'auto');
  function applyLighting(force = false) {
    L = getLighting(getS().settings.timeOfDay ?? 'auto');
    sky.update(L);
    const sv = sky.sunVector(L, 320);
    sun.position.copy(sv);
    sun.target.position.set(0, 0, 0);
    sun.color.set(L.sunColor);
    sun.intensity = L.night > 0.9 ? 0.25 : L.sunIntensity;
    if (L.night > 0.9) {
      sun.color.set('#8ea6ff');
      sun.position.set(-160, 260, -120);
    }
    hemi.color.set(L.sky.horizon);
    hemi.groundColor.set(L.sky.ground);
    hemi.intensity = 0.25 + (1 - L.night) * 0.7;
    ambient.intensity = 0.12 + L.night * 0.18;
    scene.fog.color.set(L.fog);
    renderer.toneMappingExposure = 1.0 + L.night * 0.35;
    for (const n of nightMats) n.m.emissiveIntensity = n.day + (n.night - n.day) * L.night;
    lamps?.update(L.night);
    if (force || Math.abs(L.hour - lastEnvHour) > 0.35) {
      lastEnvHour = L.hour;
      envSky.update(L);
      try {
        const rt = pmrem.fromScene(envScene, 0.02);
        envTarget?.dispose();
        envTarget = rt;
        scene.environment = rt.texture;
      } catch { /* IBL optional */ }
    }
  }
  let ctxBeacons: any[] = [];
  let lamps: { group: any; update: (n: number) => void } | null = null;
  let traffic: { group: any; update: (dt: number, n: number) => void } | null = null;

  const groundMat = new THREE.MeshStandardMaterial({ map: TEX.grass, color: 0x9fb39a, roughness: 1 });
  groundMat.map.repeat.set(220, 220);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const context = new THREE.Group();
  const subject = new THREE.Group();
  scene.add(context, subject);

  // ---------- helpers ----------
  const matCache = new Map<string, any>();
  const mat = (color: number | string, o: any = {}) => {
    const key = `${color}|${JSON.stringify(o)}`;
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...o }));
    return matCache.get(key);
  };
  const box = (w: number, h: number, d: number, m: any, x = 0, y = 0, z = 0, shadow = true) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    return mesh;
  };
  const cyl = (r: number, h: number, m: any, x = 0, y = 0, z = 0, seg = 12) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  const texCache = new Map<string, any>();
  const windowTex = (kind: 'office' | 'dc' | 'ribs', color = '#9cc9ff') => {
    const key = kind + color;
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const x = c.getContext('2d')!;
    if (kind === 'office') {
      x.fillStyle = '#1b2433';
      x.fillRect(0, 0, 128, 256);
      for (let r = 0; r < 16; r++) for (let k = 0; k < 8; k++) {
        const lit = Math.random() < 0.45;
        x.fillStyle = lit ? 'rgba(255,214,140,0.95)' : 'rgba(80,110,150,0.55)';
        x.fillRect(k * 16 + 3, r * 16 + 4, 10, 9);
      }
    } else if (kind === 'dc') {
      x.fillStyle = '#d7dde6';
      x.fillRect(0, 0, 128, 256);
      x.fillStyle = color;
      for (let r = 0; r < 4; r++) x.fillRect(0, r * 64 + 26, 128, 6);
      x.fillStyle = 'rgba(30,40,60,0.25)';
      for (let k = 0; k < 8; k++) x.fillRect(k * 16, 0, 1, 256);
    } else {
      x.fillStyle = '#c4ccd8';
      x.fillRect(0, 0, 128, 256);
      x.fillStyle = 'rgba(40,50,70,0.35)';
      for (let k = 0; k < 16; k++) x.fillRect(k * 8, 0, 2, 256);
      x.fillStyle = color;
      x.fillRect(0, 200, 128, 10);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
    return t;
  };
  const label = (text: string, color = '#ffffff', bg = 'rgba(10,20,40,0.8)') => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const x = c.getContext('2d')!;
    x.fillStyle = bg;
    x.beginPath();
    (x as any).roundRect?.(4, 8, 504, 80, 18);
    if (!(x as any).roundRect) x.rect(4, 8, 504, 80);
    x.fill();
    x.fillStyle = color;
    x.font = 'bold 42px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text.slice(0, 22), 256, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    sp.scale.set(26, 4.9, 1);
    sp.renderOrder = 10;
    return sp;
  };
  const clear = (g: any) => {
    while (g.children.length) {
      const ch = g.children.pop();
      ch.traverse?.((o: any) => {
        o.geometry?.dispose?.();
        if (o.material && o.material.map && !texCache.has(o.material.map.__k)) {
          /* shared textures are cached */
        }
      });
    }
  };

  // ---------- state ----------
  let parcel: ParcelDef | null = null;
  let center = { x: 0, y: 0 };
  let signature = '';
  let xray = false;
  let visible = false;
  let lastInteract = 0;
  const cam = { theta: -0.7, phi: 1.0, radius: 120, target: new THREE.Vector3(0, 8, 0) };
  const anim: { sinkers: any[]; fans: any[]; crane?: any; dust?: any; leds?: any; ledCount: number; beacons: any[]; blinkers: any[]; floods: any[]; steam: any[]; progressObjs: (() => void)[] } = { sinkers: [], fans: [], ledCount: 0, beacons: [], blinkers: [], floods: [], steam: [], progressObjs: [] };

  const toLocal = (X: number, Y: number) => ({ x: X - center.x, z: -(Y - center.y) });

  function buildContext() {
    clear(context);
    ctxBeacons = [];
    if (!parcel) return;
    const s = getS();
    const lay = getCityLayout(parcel.cityId);
    const R = 280;
    const CLIP = 700;
    const mLng = (parcel.rect.x1 - parcel.rect.x0) / (parcel.poly[1][0] - parcel.poly[0][0]);
    const mLat = (parcel.rect.y1 - parcel.rect.y0) / (parcel.poly[2][1] - parcel.poly[1][1]);
    const lanes: Lane[] = [];
    const lampPos: { x: number; z: number; dx: number; dz: number }[] = [];
    const treePos: { x: number; z: number; s: number }[] = [];
    const flat = (m: any, w: number, d: number, x: number, z: number, y: number, rot = 0) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rot;
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      context.add(mesh);
      return mesh;
    };
    const asphaltMat = (len: number) => {
      const tx = TEX.asphalt.clone();
      tx.needsUpdate = true;
      tx.repeat.set(len / 12, 2);
      return new THREE.MeshStandardMaterial({ map: tx, roughness: 0.92, metalness: 0.02 });
    };
    const walkMat = (len: number) => {
      const tx = TEX.concrete.clone();
      tx.needsUpdate = true;
      tx.repeat.set(len / 6, 1);
      return new THREE.MeshStandardMaterial({ map: tx, roughness: 0.95 });
    };
    const dashPos: number[][] = [];
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2f2e6, roughness: 0.6, emissive: 0x333322, emissiveIntensity: 0.2 });
    for (const st of lay.streets) {
      const a = st.line[0], b = st.line[1];
      const ax = parcel.rect.x0 + (a[0] - parcel.poly[0][0]) * mLng, ay = parcel.rect.y0 + (a[1] - parcel.poly[0][1]) * mLat;
      const bx = parcel.rect.x0 + (b[0] - parcel.poly[0][0]) * mLng, by = parcel.rect.y0 + (b[1] - parcel.poly[0][1]) * mLat;
      const la = toLocal(ax, ay), lb = toLocal(bx, by);
      const vertical = Math.abs(la.x - lb.x) < 1;
      const off = vertical ? Math.abs(la.x) : Math.abs(la.z);
      if (off > R + 120) continue;
      // clip the street to the visible neighbourhood (fog hides the ends)
      let p0: number, p1: number;
      if (vertical) { p0 = Math.max(-CLIP, Math.min(la.z, lb.z)); p1 = Math.min(CLIP, Math.max(la.z, lb.z)); }
      else { p0 = Math.max(-CLIP, Math.min(la.x, lb.x)); p1 = Math.min(CLIP, Math.max(la.x, lb.x)); }
      const len = p1 - p0;
      if (len <= 0) continue;
      const mid = (p0 + p1) / 2;
      const cx = vertical ? la.x : mid, cz = vertical ? mid : la.z;
      const rot = vertical ? Math.PI / 2 : 0;
      flat(asphaltMat(len), len, 22, cx, cz, 0.05, rot);
      // sidewalks + curbs on both sides
      for (const side of [-1, 1]) {
        const sx = vertical ? cx + side * 13.5 : cx, sz = vertical ? cz : cz + side * 13.5;
        flat(walkMat(len), len, 5, sx, sz, 0.18, rot);
        const curb = box(vertical ? 0.35 : len, 0.18, vertical ? len : 0.35, mat(0x9aa0a8), vertical ? cx + side * 11.1 : cx, 0, vertical ? cz : cz + side * 11.1, false);
        context.add(curb);
        // lamps & trees along this sidewalk near the property
        for (let u = Math.ceil(p0 / 30) * 30; u <= p1; u += 30) {
          const lx = vertical ? cx + side * 12.2 : u, lz = vertical ? u : cz + side * 12.2;
          if (Math.hypot(lx, lz) > R) continue;
          lampPos.push({ x: lx, z: lz, dx: vertical ? -side : 0, dz: vertical ? 0 : -side });
          const tx2 = vertical ? cx + side * 14.5 : u + 15, tz2 = vertical ? u + 15 : cz + side * 14.5;
          if (Math.hypot(tx2, tz2) < R) treePos.push({ x: tx2, z: tz2, s: 0.75 + Math.random() * 0.35 });
        }
      }
      // dashed center line
      const dashes = Math.floor(len / 9);
      for (let k = 0; k < dashes; k++) {
        const u = p0 + k * 9 + 4.5;
        if (Math.abs(u) > R * 1.3) continue;
        dashPos.push([vertical ? cx : u, vertical ? u : cz, rot]);
      }
      // traffic lanes (one each direction)
      if (off < R) {
        if (vertical) {
          lanes.push({ ax: cx + 4.5, az: p0, bx: cx + 4.5, bz: p1 }, { ax: cx - 4.5, az: p1, bx: cx - 4.5, bz: p0 });
        } else {
          lanes.push({ ax: p0, az: cz + 4.5, bx: p1, bz: cz + 4.5 }, { ax: p1, az: cz - 4.5, bx: p0, bz: cz - 4.5 });
        }
      }
    }
    // neighbouring lots
    const compColor = new Map(s.competitors.map((c) => [c.id, c.color]));
    for (const p of lay.parcels) {
      if (p.id === parcel.id) continue;
      const cx = (p.rect.x0 + p.rect.x1) / 2, cy = (p.rect.y0 + p.rect.y1) / 2;
      const l = toLocal(cx, cy);
      if (Math.hypot(l.x, l.z) > R) continue;
      const ps = s.parcels[p.id];
      if (ps?.mergedInto && ps.mergedInto === parcel.id) continue;
      const w = p.rect.x1 - p.rect.x0, d = p.rect.y1 - p.rect.y0;
      const st = parcelState(s, p.id);
      const k = Math.sqrt(PROPERTY_TYPE_INFO[p.type].coverage || 0.5);
      const built = st.status === 'existing' && p.buildingFloors > 0;
      const groundTex = (st.status === 'cleared' || st.status === 'construction' || st.status === 'demolishing') ? TEX.dirt : built || st.status === 'facility' ? TEX.parking : TEX.grass;
      const gt = groundTex.clone();
      gt.needsUpdate = true;
      gt.repeat.set(Math.max(1, w / 20), Math.max(1, d / 20));
      flat(new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }), w, d, l.x, l.z, 0.07);
      if (built) {
        context.add(existingBuilding(p, w * k, d * k, l.x, l.z, true));
        if (Math.random() < 0.6) treePos.push({ x: l.x + w * 0.42, z: l.z - d * 0.42, s: 0.8 });
      } else if (st.status === 'facility' || st.status === 'hq') {
        const col = st.owner === 'player' ? getS().company.color : compColor.get(st.owner ?? '') ?? '#94a3b8';
        const f = st.facilityId ? s.facilities[st.facilityId] : undefined;
        const h = f ? f.floors * 5.5 + 2 : 16;
        const tex = windowTex('dc', col).clone();
        tex.needsUpdate = true;
        tex.repeat.set(Math.max(1, (w * 0.7) / 24), Math.max(1, h / 22));
        context.add(box(w * 0.7, h, d * 0.7, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2 }), l.x, 0, l.z));
        context.add(box(w * 0.7 + 0.3, 1.2, d * 0.7 + 0.3, nightMat(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }), 0.35, 2.2), l.x, h * 0.65, l.z, false));
        for (let i = 0; i < 3; i++) context.add(box(3, 1.4, 3, mat(0xdde3ea), l.x - w * 0.2 + i * 5, h, l.z));
      } else if (st.status === 'construction' || st.status === 'demolishing') {
        const cm = new THREE.MeshStandardMaterial({ color: 0xf59e0b, wireframe: true });
        context.add(box(w * 0.6, 10, d * 0.6, cm, l.x, 0, l.z, false));
        context.add(box(1, 32, 1, mat(0xfacc15, { metalness: 0.5 }), l.x + w * 0.3, 0, l.z - d * 0.3));
        context.add(box(22, 0.9, 0.9, mat(0xfacc15, { metalness: 0.5 }), l.x + w * 0.3 + 8, 32, l.z - d * 0.3));
      } else if (!st.owner) {
        for (let i = 0; i < 3; i++) treePos.push({ x: l.x + (Math.random() - 0.5) * w * 0.7, z: l.z + (Math.random() - 0.5) * d * 0.7, s: 0.9 + Math.random() * 0.5 });
      }
    }
    if (dashPos.length) {
      const dg = new THREE.PlaneGeometry(4, 0.35);
      dg.rotateX(-Math.PI / 2);
      const dm = new THREE.InstancedMesh(dg, dashMat, dashPos.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      dashPos.forEach(([x, z, r], i) => { Q.setFromAxisAngle(up, r); P.set(x, 0.09, z); M.compose(P, Q, S); dm.setMatrixAt(i, M); });
      dm.receiveShadow = true;
      context.add(dm);
    }
    context.add(createTrees(THREE, treePos));
    lamps = createLamps(THREE, lampPos);
    context.add(lamps.group);
    traffic = createTraffic(THREE, lanes, 2);
    context.add(traffic.group);
    applyLighting(true);
  }

  function existingBuilding(p: ParcelDef, w: number, d: number, x: number, z: number, simple = false): any {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const h = Math.max(4, p.buildingHeight);
    const info = PROPERTY_TYPE_INFO[p.type];
    const hvac = (n: number, top: number) => {
      for (let i = 0; i < n; i++) g.add(box(2.4, 1.3, 2.4, mat(0xbfc6cf, { metalness: 0.5, roughness: 0.4 }), -w / 3 + (i % 3) * (w / 3), top, -d / 4 + Math.floor(i / 3) * (d / 2)));
    };
    if (p.type === 'office' || p.type === 'premium') {
      const t = windowTex('office').clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, w / 16), Math.max(1, h / 16));
      const m = nightMat(new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.55, emissive: 0xffd28a, emissiveMap: t, emissiveIntensity: 0.15 }), 0.08, simple ? 1.0 : 1.4);
      g.add(box(w, h, d, m));
      g.add(box(w + 0.5, 0.9, d + 0.5, mat(0x2a3446, { metalness: 0.6 }), 0, h, 0));
      g.add(box(w * 0.4, 3, d * 0.4, mat(0x2a3446), 0, h, 0));
      if (p.type === 'premium') {
        g.add(cyl(0.25, 12, mat(0x9ca3af, { metalness: 0.8 }), 0, h + 3, 0, 6));
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
        beacon.position.set(0, h + 15.2, 0);
        g.add(beacon);
        ctxBeacons.push(beacon);
      }
      hvac(3, h + 0.9);
    } else if (p.type === 'warehouse' || p.type === 'industrial') {
      const t = windowTex('ribs', p.type === 'warehouse' ? '#64748b' : '#8b6b4a').clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, w / 18), 1);
      g.add(box(w, h, d, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.35, color: p.type === 'warehouse' ? 0xd0d4da : 0xc8c2b4 })));
      g.add(box(w + 0.6, 0.8, d + 0.6, mat(0x4b5260), 0, h, 0));
      for (let i = 0; i < Math.min(6, Math.floor(w / 9)); i++) g.add(box(4, 4.5, 0.3, mat(0x2f3644, { metalness: 0.4 }), -w / 2 + 6 + i * 9, 0, d / 2 + 0.1, false));
      if (p.type === 'industrial') {
        g.add(cyl(1.3, h + 12, mat(0x6b5b4b), w * 0.3, 0, -d * 0.2));
        g.add(cyl(1.6, 0.8, mat(0xb91c1c), w * 0.3, h + 10, -d * 0.2));
      }
      hvac(4, h + 0.8);
    } else if (p.type === 'shopping_center') {
      g.add(box(w, h, d, mat(0xd9c3a5)));
      const glass = nightMat(new THREE.MeshStandardMaterial({ color: 0x7dd3fc, metalness: 0.8, roughness: 0.08, transparent: true, opacity: 0.85, emissive: 0xffe2a8, emissiveIntensity: 0.05 }), 0.05, 1.4);
      g.add(box(w * 0.35, h + 3, 2, glass, 0, 0, d / 2));
      g.add(box(w * 0.9, 1.6, 0.4, nightMat(new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 0.4 }), 0.4, 2.5), 0, h - 2, d / 2 + 0.3, false));
      hvac(6, h);
    } else {
      g.add(box(w, h, d, mat(info.color, { roughness: 0.8 })));
      const store = nightMat(new THREE.MeshStandardMaterial({ color: 0x9cd3ff, metalness: 0.6, roughness: 0.1, emissive: 0xffe0a0, emissiveIntensity: 0.05 }), 0.05, 1.6);
      g.add(box(w * 0.8, h * 0.55, 0.3, store, 0, 0.3, d / 2 + 0.1, false));
      g.add(box(w + 0.4, 0.6, 3, mat(p.type === 'restaurant' ? 0xb91c1c : 0x15803d), 0, h * 0.72, d / 2 + 1.5, false));
      g.add(box(w * 0.6, 1.4, 0.3, nightMat(new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.3 }), 0.3, 2.4), 0, h + 0.2, d / 2, false));
    }
    return g;
  }

  function lotDims() {
    const w = parcel!.rect.x1 - parcel!.rect.x0, d = parcel!.rect.y1 - parcel!.rect.y0;
    return { w, d };
  }

  function fence(w: number, d: number, color = 0x9ca3af, height = 2.2) {
    const g = new THREE.Group();
    const m = mat(color, { metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.85 });
    g.add(box(w, height, 0.2, m, 0, 0, d / 2, false), box(w, height, 0.2, m, 0, 0, -d / 2, false));
    g.add(box(0.2, height, d, m, w / 2, 0, 0, false), box(0.2, height, d, m, -w / 2, 0, 0, false));
    return g;
  }

  function buildSubject() {
    clear(subject);
    anim.sinkers = [];
    anim.fans = [];
    anim.beacons = [];
    anim.blinkers = [];
    anim.floods = [];
    anim.steam = [];
    anim.crane = undefined;
    anim.dust = undefined;
    anim.leds = undefined;
    anim.progressObjs = [];
    if (!parcel) return;
    const s = getS();
    const d = getD();
    const st = parcelState(s, parcel.id);
    const { w, d: dd } = lotDims();
    // lot surface + boundary
    const lotColor = st.status === 'existing' ? 0x2a3646 : st.status === 'cleared' || st.status === 'demolishing' || st.status === 'construction' ? 0x5a4a36 : 0x2b3442;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), mat(lotColor, { roughness: 1 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.y = 0.1;
    lot.receiveShadow = true;
    subject.add(lot);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.01, dd)), new THREE.LineBasicMaterial({ color: st.owner === 'player' ? 0xfbbf24 : st.owner ? 0xef4444 : 0x60a5fa }));
    edge.position.y = 0.25;
    subject.add(edge);

    if (st.status === 'existing') {
      const k = Math.sqrt(PROPERTY_TYPE_INFO[parcel.type].coverage || 0.5);
      const b = existingBuilding(parcel, w * k, dd * k, 0, 0);
      subject.add(b);
      if (parcel.type === 'empty_lot' || parcel.type === 'industrial_land') addGrass(w, dd);
      const sign = label(st.owner === 'player' ? 'YOUR PROPERTY' : st.owner ? 'OWNED' : 'FOR SALE', st.owner === 'player' ? '#fbbf24' : '#e2e8f0');
      sign.position.set(0, parcel.buildingHeight + 9, 0);
      subject.add(sign);
    } else if (st.status === 'demolishing') {
      const k = Math.sqrt(PROPERTY_TYPE_INFO[parcel.type].coverage || 0.5);
      const b = existingBuilding(parcel, w * k, dd * k, 0, 0);
      subject.add(b);
      anim.sinkers.push(b);
      // excavator
      const ex = new THREE.Group();
      ex.add(box(6, 2.2, 3.5, mat(0xeab308)), box(3, 2.5, 3, mat(0x1f2937), -1, 2.2, 0));
      const arm = box(0.8, 0.8, 9, mat(0xeab308), 2, 3.2, -3, true);
      arm.rotation.x = 0.6;
      ex.add(arm);
      ex.position.set(w * 0.35, 0, dd * 0.38);
      subject.add(ex);
      const pile = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, dd) * 0.22, 1, 9), mat(0x6b5b4a));
      pile.position.set(-w * 0.25, 0, dd * 0.25);
      subject.add(pile);
      anim.progressObjs.push(() => {
        const p = progressOf();
        b.scale.y = Math.max(0.02, 1 - p);
        b.position.x = (Math.random() - 0.5) * 0.3;
        pile.scale.y = 1 + p * 7;
        pile.position.y = (1 + p * 7) / 2;
      });
      addDust(w, dd);
    } else if (st.status === 'cleared') {
      addGrass(w, dd, 0x5a4a36);
      if (st.owner === 'player') {
        const sg = label('READY TO BUILD', '#4ade80');
        sg.position.set(0, 10, 0);
        subject.add(sg);
      } else {
        const sg = label(st.owner ? 'OWNED' : 'FOR SALE', '#e2e8f0');
        sg.position.set(0, 10, 0);
        subject.add(sg);
      }
    } else if (st.status === 'construction') {
      buildConstruction(w, dd);
    } else if (st.status === 'facility' || st.status === 'hq') {
      if (st.owner === 'player' && st.facilityId && s.facilities[st.facilityId]) buildFacility(s.facilities[st.facilityId], d, w, dd);
      else buildCompetitor(w, dd);
    }
  }

  function addGrass(w: number, d: number, color = 0x3f5a35) {
    const isDirt = color === 0x5a4a36;
    const tx = (isDirt ? TEX.dirt : color === 0x2c3e2f ? TEX.grass : TEX.grass).clone();
    tx.needsUpdate = true;
    tx.repeat.set(Math.max(1, w / 16), Math.max(1, d / 16));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, d * 0.98), new THREE.MeshStandardMaterial({ map: tx, roughness: 1, color: isDirt ? 0xffffff : 0xd8e6d0 }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = 0.15;
    g.receiveShadow = true;
    subject.add(g);
  }

  function addSteam(sources: number[][], intensity: number) {
    const per = 14;
    const n = sources.length * per;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    sources.forEach(([x, y, z], si) => {
      for (let k = 0; k < per; k++) {
        const i = si * per + k;
        pos[i * 3] = x; pos[i * 3 + 1] = y + Math.random() * 12; pos[i * 3 + 2] = z;
        seed[i] = Math.random();
      }
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: glowTexture(THREE, 'rgba(235,240,248,1)'), size: 5, transparent: true, opacity: 0.18 + intensity * 0.22, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, m);
    subject.add(pts);
    anim.steam.push({ pts, sources, per, seed });
  }

  function addDust(w: number, d: number) {
    const n = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w * 0.8;
      pos[i * 3 + 1] = Math.random() * 25;
      pos[i * 3 + 2] = (Math.random() - 0.5) * d * 0.8;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc8b89a, size: 1.6, transparent: true, opacity: 0.45, depthWrite: false }));
    subject.add(pts);
    anim.dust = pts;
  }

  function progressOf(): number {
    const s = getS();
    if (!parcel) return 0;
    const st = s.parcels[parcel.id];
    if (st?.projectId && s.projects[st.projectId]) {
      const p = s.projects[st.projectId];
      return Math.min(1, p.doneSeconds / p.totalSeconds);
    }
    for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel.id) return Math.min(1, site.progress / site.total);
    return 0;
  }

  function buildConstruction(w: number, dd: number) {
    const s = getS();
    const st = s.parcels[parcel!.id];
    const pr = st?.projectId ? s.projects[st.projectId] : undefined;
    let floors = 2, fp = 0.5, color = '#94a3b8';
    if (pr?.draft) {
      floors = pr.draft.floors;
      fp = pr.draft.footprint;
      color = pr.draft.color;
    } else {
      for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel!.id) {
        const bp = blueprintById(site.blueprintId);
        floors = bp.floors;
        fp = bp.footprint;
        color = c.color;
      }
    }
    const k = Math.sqrt(fp);
    const bw = w * k, bd = dd * k, H = floors * 5.5;
    subject.add(fence(w * 0.97, dd * 0.97, 0xf59e0b, 2));
    addGrass(w * 0.97, dd * 0.97, 0x5a4a36);
    // cones & site office
    subject.add(box(8, 3, 3, mat(0xf8fafc), w * 0.38, 0, -dd * 0.4), box(8, 0.3, 3.2, mat(0x2563eb), w * 0.38, 3, -dd * 0.4, false));
    const slab = box(bw + 2, 1.2, bd + 2, mat(0xa3a3a3), 0, 0, 0);
    subject.add(slab);
    const frame = new THREE.Group();
    const colM = mat(0x9ca3af, { metalness: 0.7, roughness: 0.35 });
    const nx = Math.max(2, Math.round(bw / 9)), nz = Math.max(2, Math.round(bd / 9));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) frame.add(box(0.6, H, 0.6, colM, -bw / 2 + (bw * i) / nx, 1.2, -bd / 2 + (bd * j) / nz));
    const slabs: any[] = [];
    for (let f = 1; f <= floors; f++) {
      const sl = box(bw, 0.5, bd, mat(0x8f8f8f), 0, 1.2 + f * 5.5 - 0.5, 0);
      slabs.push(sl);
      frame.add(sl);
    }
    subject.add(frame);
    const yard = new THREE.Group();
    const transformers: any[] = [];
    for (let i = 0; i < 3; i++) {
      const t = box(3, 2.6, 2.2, mat(0x4d7c5a), -w * 0.42 + i * 4, 0, dd * 0.38);
      transformers.push(t);
      yard.add(t);
    }
    subject.add(yard);
    const roof = new THREE.Group();
    const units: any[] = [];
    const nu = Math.max(2, Math.round((bw * bd) / 260));
    for (let i = 0; i < nu; i++) {
      const u = box(3.4, 1.8, 3.4, mat(0xcbd5e1), -bw / 2 + 3 + ((i * 5) % Math.max(5, bw - 6)), 1.2 + H, -bd / 2 + 3 + Math.floor((i * 5) / Math.max(5, bw - 6)) * 5);
      units.push(u);
      roof.add(u);
    }
    subject.add(roof);
    const skin = box(bw + 0.3, H, bd + 0.3, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, roughness: 0.6 }), 0, 1.2, 0);
    subject.add(skin);
    // scaffolding + safety netting wrapping the structure
    const scaffold = new THREE.Group();
    const scafMat = mat(0xb0b7c3, { metalness: 0.7, roughness: 0.4 });
    const levels = Math.max(1, floors * 2);
    for (let lv = 0; lv <= levels; lv++) {
      const y = 1.2 + (lv * H) / levels;
      scaffold.add(box(bw + 3, 0.15, 0.15, scafMat, 0, y, bd / 2 + 1.5, false), box(bw + 3, 0.15, 0.15, scafMat, 0, y, -bd / 2 - 1.5, false));
      scaffold.add(box(0.15, 0.15, bd + 3, scafMat, bw / 2 + 1.5, y, 0, false), box(0.15, 0.15, bd + 3, scafMat, -bw / 2 - 1.5, y, 0, false));
    }
    const posts = Math.max(3, Math.round(bw / 6));
    for (let i = 0; i <= posts; i++) {
      const x = -bw / 2 - 1.5 + ((bw + 3) * i) / posts;
      scaffold.add(box(0.15, H + 2, 0.15, scafMat, x, 0, bd / 2 + 1.5, false), box(0.15, H + 2, 0.15, scafMat, x, 0, -bd / 2 - 1.5, false));
    }
    const net = new THREE.Mesh(new THREE.BoxGeometry(bw + 3.2, H, bd + 3.2), new THREE.MeshStandardMaterial({ color: 0x15803d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    net.geometry.translate(0, H / 2 + 1.2, 0);
    scaffold.add(net);
    subject.add(scaffold);
    // site vehicles
    const truck = (x: number, z: number, col: number) => {
      const tg = new THREE.Group();
      tg.add(box(2.6, 2.4, 3, mat(col, { metalness: 0.4 }), 0, 0.4, 3.4), box(2.8, 1.8, 6, mat(0x6b7280, { metalness: 0.5 }), 0, 0.6, -1.2));
      for (const [wx, wz] of [[-1.3, 3], [1.3, 3], [-1.3, -2.5], [1.3, -2.5]]) tg.add(cyl(0.55, 0.5, mat(0x111111), wx, 0, wz, 10));
      tg.position.set(x, 0, z);
      tg.rotation.y = Math.random() * Math.PI;
      subject.add(tg);
    };
    truck(-w * 0.36, dd * 0.36, 0xeab308);
    truck(w * 0.3, dd * 0.4, 0xf97316);
    const warn = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa500 }));
    warn.position.set(w * 0.38, 4.2, -dd * 0.4);
    subject.add(warn);
    anim.blinkers.push(warn);
    // tower crane
    const crane = new THREE.Group();
    const craneM = mat(0xfacc15, { metalness: 0.5, roughness: 0.4 });
    crane.add(box(1.4, H + 22, 1.4, craneM, 0, 0, 0));
    const jib = new THREE.Group();
    jib.add(box(36, 1.2, 1.2, craneM, 10, 0, 0, true), box(6, 2, 2, mat(0x4b5563), -6, -0.4, 0));
    jib.position.y = H + 22;
    crane.add(jib);
    crane.position.set(bw / 2 + 6, 0, -bd / 2 - 4);
    subject.add(crane);
    anim.crane = jib;
    anim.progressObjs.push(() => {
      const p = pr ? stageOf(pr) : { index: Math.floor(progressOf() * 8), stageProgress: (progressOf() * 8) % 1 };
      const i = p.index, sp = p.stageProgress;
      slab.visible = i >= 1;
      slab.scale.y = i === 1 ? Math.max(0.1, sp) : 1;
      frame.visible = i >= 2;
      frame.scale.y = i === 2 ? Math.max(0.05, sp) : 1;
      slabs.forEach((sl, idx) => (sl.visible = i > 2 || (i === 2 && sp > (idx + 1) / (floors + 1))));
      transformers.forEach((t, idx) => (t.visible = i > 3 || (i === 3 && sp > idx / 3)));
      units.forEach((u, idx) => (u.visible = i > 4 || (i === 4 && sp > idx / units.length)));
      scaffold.visible = i >= 2 && i <= 6;
      net.visible = i >= 3 && i <= 5;
      skin.visible = i >= 5;
      skin.scale.y = i === 5 ? Math.max(0.05, sp) : 1;
      (skin.material as any).opacity = i >= 6 ? 0.95 : 0.8;
      crane.visible = i >= 1 && i <= 6;
      (skin.material as any).emissive?.set?.(i === 7 ? 0x224466 : 0x000000);
    });
  }

  function buildFacility(f: GameState['facilities'][string], d: Derived, w: number, dd: number) {
    const k = Math.sqrt(f.isHQ ? 0.35 : f.footprint);
    const bw = w * k, bd = dd * k;
    const H = f.isHQ ? 8 + f.floors * 4 : f.floors * 5.5;
    const accent = f.color || getS().company.color;
    const st = d.fac[f.id];
    const g = new THREE.Group();
    // parking & landscaping
    addGrass(w * 0.98, dd * 0.98, 0x2c3e2f);
    const padTex = TEX.concrete.clone();
    padTex.needsUpdate = true;
    padTex.repeat.set((bw + 12) / 8, (bd + 12) / 8);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(bw + 12, bd + 12), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.95 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.2;
    pad.receiveShadow = true;
    subject.add(pad);
    // parking lot in front with parked cars
    const front = dd / 2 - (dd / 2 - bd / 2 - 6) / 2;
    const lotDepth = Math.max(0, dd / 2 - bd / 2 - 8);
    if (lotDepth > 8) {
      const pt = TEX.parking.clone();
      pt.needsUpdate = true;
      pt.repeat.set(Math.max(1, (bw * 0.8) / 20), 1);
      const lotMesh = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.8, Math.min(18, lotDepth)), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.9 }));
      lotMesh.rotation.x = -Math.PI / 2;
      lotMesh.position.set(0, 0.22, front);
      lotMesh.receiveShadow = true;
      subject.add(lotMesh);
      const nCars = Math.min(16, Math.floor((bw * 0.8) / 2.6));
      const palette = [0xe5e7eb, 0x111827, 0x9ca3af, 0x1d4ed8, 0xb91c1c, 0xf3f4f6];
      for (let i = 0; i < nCars; i++) {
        if (Math.random() < 0.35) continue;
        const cx = -bw * 0.4 + 1.3 + i * ((bw * 0.8) / nCars);
        const cz = front + (i % 2 ? 4.5 : -4.5);
        subject.add(box(1.8, 1.1, 4.2, mat(palette[i % palette.length], { metalness: 0.6, roughness: 0.35 }), cx, 0.2, cz));
        subject.add(box(1.6, 0.7, 2.2, mat(0x1b2433, { metalness: 0.9, roughness: 0.1 }), cx, 1.3, cz - 0.2, false));
      }
    }
    // loading dock + truck at the back
    subject.add(box(12, 1.2, 4, mat(0x6b7280), bw * 0.25, 0, -bd / 2 - 2));
    subject.add(box(2.5, 3.2, 3, mat(0xf8fafc, { metalness: 0.3 }), bw * 0.25 - 4, 0, -bd / 2 - 7));
    subject.add(box(2.6, 3.6, 9, mat(0xe5e7eb, { metalness: 0.2 }), bw * 0.25 - 4, 0, -bd / 2 - 13));
    let bodyMat: any;
    if (f.isHQ) {
      const t = windowTex('office').clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, bw / 14), Math.max(1, H / 14));
      bodyMat = nightMat(new THREE.MeshStandardMaterial({ map: t, emissive: 0xffd8a0, emissiveMap: t, emissiveIntensity: 0.15, metalness: 0.6, roughness: 0.2 }), 0.1, 1.5);
    } else if (f.style === 'glass') {
      bodyMat = new THREE.MeshStandardMaterial({ color: 0x8fc2f0, metalness: 0.95, roughness: 0.05, transparent: true, opacity: 0.88, envMapIntensity: 1.6 });
    } else if (f.style === 'metal') {
      const t = windowTex('ribs', accent).clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, bw / 20), 1);
      bodyMat = new THREE.MeshStandardMaterial({ map: t, metalness: 0.4, roughness: 0.5 });
    } else if (f.style === 'modular') {
      bodyMat = null;
    } else {
      const t = windowTex('dc', accent).clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, bw / 24), Math.max(1, H / 22));
      bodyMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    }
    if (xray && bodyMat) {
      bodyMat = bodyMat.clone();
      bodyMat.transparent = true;
      bodyMat.opacity = 0.14;
      bodyMat.depthWrite = false;
    }
    if (f.style === 'modular' && !f.isHQ) {
      const n = Math.max(2, Math.ceil(f.slots / 4));
      const cols = Math.max(1, Math.floor(bd / 3.4));
      const rowsX = Math.max(1, Math.floor(bw / 13.5));
      const perLevel = cols * rowsX;
      for (let i = 0; i < n; i++) {
        const lvl = Math.floor(i / perLevel), idx = i % perLevel;
        const cx = -bw / 2 + 6.5 + Math.floor(idx / cols) * 13.5;
        const cz = -bd / 2 + 1.6 + (idx % cols) * 3.4;
        const m = mat(i % 3 === 0 ? accent : 0xb8c2d0, xray ? { transparent: true, opacity: 0.25 } : {});
        g.add(box(12.2, 2.9, 2.6, m, cx, lvl * 2.9, cz));
      }
    } else {
      g.add(box(bw, H, bd, bodyMat));
      if (f.style === 'glass' && !xray) {
        // glowing core visible through the glass + mullions and floor slabs
        g.add(box(bw * 0.86, H * 0.98, bd * 0.86, nightMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x7dd3fc, emissiveIntensity: 0.1 }), 0.08, 0.9), 0, 0, 0, false));
        const mull = mat(0x1f2937, { metalness: 0.8, roughness: 0.3 });
        const nm = Math.max(2, Math.floor(bw / 6));
        for (let i = 0; i <= nm; i++) g.add(box(0.25, H, 0.25, mull, -bw / 2 + (bw * i) / nm, 0, bd / 2 + 0.05, false), box(0.25, H, 0.25, mull, -bw / 2 + (bw * i) / nm, 0, -bd / 2 - 0.05, false));
        for (let fl = 1; fl < Math.max(1, f.floors); fl++) g.add(box(bw + 0.2, 0.35, bd + 0.2, mull, 0, fl * (H / f.floors), 0, false));
      }
      if (!f.isHQ) {
        g.add(box(bw + 0.4, 1.4, bd + 0.4, nightMat(new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.4 }), 0.35, 2.6), 0, H - 3, 0, false));
        // illuminated logo plaque + entrance canopy
        g.add(box(Math.min(16, bw * 0.4), 3.2, 0.4, nightMat(new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 }), 0.5, 2.8), 0, Math.max(3, H - 8), bd / 2 + 0.35, false));
        g.add(box(10, 0.4, 4, mat(0x334155, { metalness: 0.6 }), 0, 4, bd / 2 + 2));
        g.add(box(6, 3.8, 0.3, nightMat(new THREE.MeshStandardMaterial({ color: 0x9cd3ff, metalness: 0.7, roughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.05 }), 0.05, 1.2), 0, 0.2, bd / 2 + 0.15, false));
      }
      g.add(box(bw + 0.6, 0.8, bd + 0.6, mat(0x334155), 0, H, 0));
      g.add(box(bw + 0.6, 1.4, 0.4, mat(0x475569), 0, H, bd / 2 + 0.1, false), box(bw + 0.6, 1.4, 0.4, mat(0x475569), 0, H, -bd / 2 - 0.1, false));
      // aviation lights on roof corners
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const al = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
        al.position.set((sx * bw) / 2, H + 1.6, (sz * bd) / 2);
        g.add(al);
        anim.blinkers.push(al);
      }
    }
    // name sign
    const sign = label(f.name, '#ffffff', 'rgba(15,23,42,0.85)');
    sign.position.set(0, H + 12, 0);
    g.add(sign);
    if (f.isHQ) {
      const logo = label(`${getS().company.logo} ${getS().company.name}`, accent, 'rgba(0,0,0,0.6)');
      logo.position.set(0, H + 18, 0);
      g.add(logo);
    }
    subject.add(g);
    if (f.isHQ) return;
    // roof cooling units
    const coolers = 2 + (f.equipment.cooling_air ?? 0) + (f.equipment.cooling_adv ?? 0) * 2;
    const steamSources: number[][] = [];
    const roofCols = Math.max(1, Math.floor((bw - 4) / 5));
    for (let i = 0; i < Math.min(60, coolers); i++) {
      const x = -bw / 2 + 3 + (i % roofCols) * 5, z = -bd / 2 + 3 + Math.floor(i / roofCols) * 5;
      if (z > bd / 2 - 2) break;
      const u = box(3.6, 1.6, 3.6, mat(0xdde3ea), x, H + 0.8, z);
      subject.add(u);
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 10), mat(0x1e293b));
      fan.position.set(x, H + 2.5, z);
      const blade = box(2.6, 0.1, 0.35, mat(0x94a3b8), 0, 0.12, 0, false);
      fan.add(blade);
      subject.add(fan);
      anim.fans.push(fan);
      if (st && st.itLoad > 0 && i % 2 === 0) steamSources.push([x, H + 3, z]);
    }
    if (steamSources.length) addSteam(steamSources.slice(0, 24), Math.min(1, (st?.itLoad ?? 0) / Math.max(1, st?.coolingCap ?? 1)));
    // perimeter floodlights (visible at night)
    const floodMat = new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(210,230,255,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      const pole = cyl(0.15, 9, mat(0x374151, { metalness: 0.7 }), (sx * w) / 2.15, 0, (sz * dd) / 2.15, 6);
      subject.add(pole);
      const sp = new THREE.Sprite(floodMat);
      sp.position.set((sx * w) / 2.15, 9, (sz * dd) / 2.15);
      sp.scale.set(9, 9, 1);
      subject.add(sp);
    }
    anim.floods.push(floodMat);
    // liquid cooling: pipes + dry coolers
    for (let i = 0; i < (f.equipment.liquid ?? 0); i++) {
      subject.add(box(10, 3, 4, mat(0x0ea5e9, { metalness: 0.5 }), bw / 2 + 8, 0, -bd / 2 + 4 + i * 6));
      subject.add(cyl(0.5, 6, mat(0x38bdf8, { metalness: 0.8 }), bw / 2 + 3, 0, -bd / 2 + 4 + i * 6));
    }
    // electrical yard
    const pdus = (f.equipment.pdu ?? 0);
    for (let i = 0; i < Math.min(12, pdus + 2); i++) subject.add(box(2.6, 2.4, 2, mat(0x4d7c5a), -bw / 2 - 5, 0, -bd / 2 + 2 + i * 3.2));
    for (let i = 0; i < (f.equipment.substation ?? 0); i++) {
      const sx = -w / 2 + 10, sz = dd / 2 - 12 - i * 14;
      subject.add(box(10, 0.3, 10, mat(0x6b7280), sx, 0, sz), box(3, 5, 3, mat(0x57534e), sx - 2, 0, sz), box(3, 5, 3, mat(0x57534e), sx + 2, 0, sz));
      for (let j = 0; j < 4; j++) subject.add(box(0.3, 12, 0.3, mat(0x9ca3af, { metalness: 0.8 }), sx - 4 + j * 2.6, 0, sz - 4));
    }
    // generators
    const gens = (f.equipment.generator ?? 0);
    for (let i = 0; i < Math.min(16, gens); i++) {
      const gx = bw / 2 + 5, gz = bd / 2 - 3 - i * 4;
      subject.add(box(6, 2.6, 2.6, mat(0x334155), gx, 0, gz), cyl(0.3, 2, mat(0x111827), gx + 2, 2.6, gz));
    }
    for (let i = 0; i < (f.equipment.generator_x ?? 0); i++) subject.add(cyl(3, 6, mat(0x475569, { metalness: 0.6 }), -bw / 2 - 12, 0, bd / 2 - 6 - i * 8, 16));
    // security
    const sec = (f.equipment.security ?? 0) + (f.custom?.security ?? 0);
    if (sec > 0) {
      subject.add(fence(w * 0.96, dd * 0.96, 0x64748b, 2.8));
      subject.add(box(4, 3.2, 4, mat(0xe2e8f0), 0, 0, dd * 0.48 - 2));
      for (let i = 0; i < Math.min(8, sec * 2); i++) {
        const a = (i / Math.max(1, sec * 2)) * Math.PI * 2;
        subject.add(cyl(0.15, 6, mat(0x1f2937), Math.cos(a) * w * 0.46, 0, Math.sin(a) * dd * 0.46, 6));
      }
    }
    // warning beacon
    if (st && st.warnings.length) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 }));
      b.position.set(bw / 2 - 2, H + 3, bd / 2 - 2);
      subject.add(b);
      anim.beacons.push(b);
    }
    // interior racks (X-ray)
    if (xray) buildRacks(f, bw, bd, H);
  }

  function buildRacks(f: GameState['facilities'][string], bw: number, bd: number, H: number) {
    const items: number[] = [];
    for (const [id, n] of Object.entries(f.equipment)) {
      const e = equipmentById(id);
      if (!e || e.kind !== 'server') continue;
      const col = e.cap ? CAP_COLORS[e.cap] : CAP_COLORS.net;
      for (let i = 0; i < n; i++) items.push(col);
    }
    const empty = Math.max(0, f.slots - items.length);
    const total = Math.min(900, items.length + empty);
    if (!total) return;
    const floors = f.style === 'modular' ? 1 : Math.max(1, f.floors);
    const perFloor = Math.ceil(total / floors);
    const rowLen = Math.max(1, Math.floor((bw - 4) / 0.9));
    const rows = Math.max(1, Math.ceil(perFloor / rowLen));
    const rowGap = Math.min(3, (bd - 4) / Math.max(1, rows));
    const geo = new THREE.BoxGeometry(0.75, Math.min(2.4, H / floors - 1), 1.1);
    geo.translate(0, Math.min(2.4, H / floors - 1) / 2, 0);
    const m = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.4 });
    const inst = new THREE.InstancedMesh(geo, m, total);
    const ledGeo = new THREE.BoxGeometry(0.5, 0.12, 0.05);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const leds = new THREE.InstancedMesh(ledGeo, ledMat, total);
    const M = new THREE.Matrix4();
    const C = new THREE.Color();
    for (let i = 0; i < total; i++) {
      const fl = Math.floor(i / perFloor), k = i % perFloor;
      const r = Math.floor(k / rowLen), c = k % rowLen;
      const x = -bw / 2 + 2 + c * 0.9, z = -bd / 2 + 2 + r * rowGap, y = 0.3 + fl * (H / floors);
      M.makeTranslation(x, y, z);
      inst.setMatrixAt(i, M);
      const filled = i < items.length;
      C.set(filled ? 0x1f2937 : 0x0b0f17);
      inst.setColorAt(i, C);
      M.makeTranslation(x, y + 1.2, z + 0.58);
      leds.setMatrixAt(i, M);
      C.set(filled ? items[i] : 0x111111);
      leds.setColorAt(i, C);
    }
    inst.instanceMatrix.needsUpdate = true;
    leds.instanceMatrix.needsUpdate = true;
    subject.add(inst, leds);
    anim.leds = { mesh: leds, colors: items, total };
  }

  function buildCompetitor(w: number, dd: number) {
    const s = getS();
    let color = '#ef4444', name = 'Competitor', floors = 3, fp = 0.55;
    for (const c of s.competitors) for (const site of c.sites) if (site.parcelId === parcel!.id) {
      color = c.color;
      name = c.name;
      const bp = blueprintById(site.blueprintId);
      floors = bp.floors;
      fp = bp.footprint;
    }
    const k = Math.sqrt(fp);
    const bw = w * k, bd = dd * k, H = floors * 5.5;
    addGrass(w * 0.98, dd * 0.98, 0x2c3e2f);
    const t = windowTex('dc', color).clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, bw / 24), Math.max(1, H / 22));
    subject.add(box(bw, H, bd, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })));
    subject.add(box(bw + 0.4, 1.4, bd + 0.4, mat(color, { emissive: color, emissiveIntensity: 0.4 }), 0, H - 3, 0, false));
    subject.add(fence(w * 0.96, dd * 0.96, 0x64748b, 2.8));
    const l = label(name, color);
    l.position.set(0, H + 10, 0);
    subject.add(l);
  }

  // ---------- camera ----------
  function placeCamera() {
    const t = cam.target;
    camera.position.set(
      t.x + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta),
      t.y + cam.radius * Math.cos(cam.phi),
      t.z + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
    );
    camera.lookAt(t);
  }
  let drag: { x: number; y: number; btn: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, btn: e.button === 2 || e.shiftKey ? 2 : 0 };
    canvas.setPointerCapture(e.pointerId);
    lastInteract = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const sens = getS().settings.cameraSensitivity;
    if (drag.btn === 2) {
      const right = new THREE.Vector3(Math.sin(cam.theta), 0, -Math.cos(cam.theta));
      const fwd = new THREE.Vector3(Math.cos(cam.theta), 0, Math.sin(cam.theta));
      cam.target.addScaledVector(right, dx * 0.15 * sens * (cam.radius / 100));
      cam.target.addScaledVector(fwd, dy * 0.15 * sens * (cam.radius / 100));
    } else {
      cam.theta += dx * 0.006 * sens;
      cam.phi = Math.max(0.15, Math.min(1.45, cam.phi - dy * 0.005 * sens));
    }
    lastInteract = performance.now();
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = getS().settings;
    const k = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.1 * s.cameraSensitivity * (s.invertZoom ? -1 : 1));
    cam.radius = Math.max(25, Math.min(500, cam.radius * k));
    lastInteract = performance.now();
  }, { passive: false });

  // ---------- loop ----------
  let raf = 0;
  let last = performance.now();
  let lastLight = 0;
  function loop(t: number) {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (t - lastInteract > 4000 && !getS().settings.reduceMotion) cam.theta += dt * 0.06;
    for (const f of anim.fans) f.rotation.y += dt * 8;
    if (anim.crane) anim.crane.rotation.y = Math.sin(t / 3000) * 1.2;
    if (anim.dust) {
      const p = anim.dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * (3 + (i % 5));
        if (y > 30) y = 0;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    for (const b of anim.beacons) if (b.material.emissiveIntensity !== undefined) b.material.emissiveIntensity = 1 + Math.sin(t / 150) * 1;
    const blink = Math.sin(t / 400) > 0.6;
    for (const b of anim.blinkers) b.visible = blink;
    for (const fm of anim.floods) fm.opacity = L.night * 0.85;
    for (const st of anim.steam) {
      const p = st.pts.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const src = st.sources[Math.floor(i / st.per)];
        let y = p.getY(i) + dt * (2.5 + st.seed[i] * 2);
        if (y > src[1] + 14) y = src[1];
        const rise = y - src[1];
        p.setXYZ(i, src[0] + Math.sin(t / 900 + st.seed[i] * 6) * rise * 0.18 + rise * 0.25, y, src[2] + Math.cos(t / 1100 + st.seed[i] * 6) * rise * 0.15);
      }
      p.needsUpdate = true;
    }
    for (const b of ctxBeacons) b.visible = blink;
    traffic?.update(dt, L.night);
    if (t - lastLight > 1000) { lastLight = t; applyLighting(); }
    if (anim.leds && Math.random() < 0.5) {
      const L = anim.leds;
      const C = new THREE.Color();
      for (let k = 0; k < Math.min(40, L.colors.length); k++) {
        const i = Math.floor(Math.random() * L.colors.length);
        C.set(Math.random() < 0.3 ? 0x0a0a0a : L.colors[i]);
        L.mesh.setColorAt(i, C);
      }
      if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
    }
    for (const fn of anim.progressObjs) fn();
    placeCamera();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  function resize() {
    const r = container.getBoundingClientRect();
    const q = quality();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 0.8));
    renderer.shadowMap.enabled = q !== 'low';
    sun.castShadow = q !== 'low';
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(0.1, r.width / Math.max(1, r.height));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function computeSignature(): string {
    if (!parcel) return '';
    const s = getS();
    const st = parcelState(s, parcel.id);
    let sig = `${parcel.id}|${st.status}|${st.owner}|${xray}`;
    if (st.facilityId && s.facilities[st.facilityId]) {
      const f = s.facilities[st.facilityId];
      const warn = getD().fac[f.id]?.warnings.length ?? 0;
      sig += `|${f.name}|${f.floors}|${f.style}|${f.color}|${JSON.stringify(f.equipment)}|${warn > 0}`;
    }
    return sig;
  }

  const view: PropertyViewLike = {
    kind: 'three',
    show(parcelId: string) {
      parcel = getParcel(parcelId) ?? null;
      if (!parcel) return;
      center = { x: (parcel.rect.x0 + parcel.rect.x1) / 2, y: (parcel.rect.y0 + parcel.rect.y1) / 2 };
      const diag = Math.hypot(parcel.rect.x1 - parcel.rect.x0, parcel.rect.y1 - parcel.rect.y0);
      cam.radius = Math.max(60, diag * 1.25);
      cam.target.set(0, 6, 0);
      cam.phi = 0.95;
      visible = true;
      container.classList.add('visible');
      resize();
      buildContext();
      signature = computeSignature();
      buildSubject();
    },
    hide() {
      visible = false;
      container.classList.remove('visible');
    },
    setXray(v: boolean) {
      xray = v;
      signature = '';
      view.update();
    },
    update() {
      if (!visible || !parcel) return;
      const sig = computeSignature();
      if (sig !== signature) {
        const statusChanged = sig.split('|')[1] !== signature.split('|')[1];
        signature = sig;
        if (statusChanged) buildContext();
        buildSubject();
      }
    },
    resize,
  };
  return view;
}
