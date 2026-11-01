// Visual environment helpers for the Three.js property view:
// sky dome, procedural textures, instanced trees, traffic, street lamps and glow sprites.

import type { Lighting } from '../core/timeOfDay';

type T = any;

// ---------- procedural textures ----------
function canvasTex(THREE: T, size: number, draw: (x: CanvasRenderingContext2D, s: number) => void, repeat = 1): T {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

function noise(x: CanvasRenderingContext2D, s: number, base: string, spots: string[], count: number, maxR: number) {
  x.fillStyle = base;
  x.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    x.fillStyle = spots[i % spots.length];
    x.globalAlpha = 0.15 + Math.random() * 0.35;
    const r = Math.random() * maxR + 0.4;
    x.beginPath();
    x.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
}

export function makeTextures(THREE: T) {
  return {
    asphalt: canvasTex(THREE, 256, (x, s) => noise(x, s, '#2a2e36', ['#1d2028', '#3a3f4a', '#23262e', '#4a4f5a'], 2600, 1.6)),
    grass: canvasTex(THREE, 256, (x, s) => {
      noise(x, s, '#2f4a2c', ['#3d5e35', '#253d24', '#4a6b3c', '#1f3320'], 3200, 2.4);
    }),
    concrete: canvasTex(THREE, 256, (x, s) => {
      noise(x, s, '#8a8f97', ['#7c818a', '#9aa0a8', '#6f747c'], 1600, 1.2);
      x.strokeStyle = 'rgba(40,44,52,0.55)';
      x.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        x.beginPath(); x.moveTo((i * s) / 4, 0); x.lineTo((i * s) / 4, s); x.stroke();
        x.beginPath(); x.moveTo(0, (i * s) / 4); x.lineTo(s, (i * s) / 4); x.stroke();
      }
    }),
    dirt: canvasTex(THREE, 256, (x, s) => {
      noise(x, s, '#5b4a35', ['#6b5840', '#4a3c2a', '#7a6548', '#3e3223'], 3000, 2.2);
      x.strokeStyle = 'rgba(40,30,20,0.35)';
      x.lineWidth = 5;
      for (let i = 0; i < 6; i++) {
        x.beginPath(); x.moveTo(Math.random() * s, 0); x.bezierCurveTo(Math.random() * s, s / 3, Math.random() * s, (2 * s) / 3, Math.random() * s, s); x.stroke();
      }
    }),
    parking: canvasTex(THREE, 256, (x, s) => {
      noise(x, s, '#32363e', ['#2a2d34', '#3c4049'], 1400, 1.2);
      x.strokeStyle = 'rgba(235,238,245,0.85)';
      x.lineWidth = 3;
      for (let i = 0; i <= 8; i++) {
        x.beginPath(); x.moveTo((i * s) / 8, 0); x.lineTo((i * s) / 8, s * 0.42); x.stroke();
        x.beginPath(); x.moveTo((i * s) / 8, s * 0.58); x.lineTo((i * s) / 8, s); x.stroke();
      }
    }),
    gravel: canvasTex(THREE, 256, (x, s) => noise(x, s, '#6d6a64', ['#57544f', '#86827b', '#4a4844'], 4000, 1.4)),
  };
}

export function glowTexture(THREE: T, color = 'rgba(255,220,160,1)'): T {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- sky ----------
export function createSky(THREE: T) {
  const uniforms = {
    topColor: { value: new THREE.Color('#1f63d6') },
    horizonColor: { value: new THREE.Color('#b8dcff') },
    groundColor: { value: new THREE.Color('#3d4554') },
    sunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() },
    sunColor: { value: new THREE.Color('#ffffff') },
    night: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizonColor, groundColor, clamp(-h*4.0,0.0,1.0));
        float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += sunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 18.0) * 0.35) * (1.0 - night*0.85);
        // stars at night
        if (h > 0.05) { vec3 q = floor(vDir*420.0); float s = step(0.9975, hash(q)); col += vec3(s) * night * 0.9 * smoothstep(0.05,0.3,h); }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), mat);
  mesh.renderOrder = -10;
  return {
    mesh,
    update(L: Lighting) {
      uniforms.topColor.value.set(L.sky.top);
      uniforms.horizonColor.value.set(L.sky.horizon);
      uniforms.groundColor.value.set(L.sky.ground);
      uniforms.sunColor.value.set(L.sunColor);
      uniforms.night.value = L.night;
      const el = Math.asin(Math.max(-1, Math.min(1, L.sunElevation)));
      uniforms.sunDir.value.set(Math.cos(L.sunAzimuth) * Math.cos(el), Math.sin(el), Math.sin(L.sunAzimuth) * Math.cos(el)).normalize();
    },
    sunVector(L: Lighting, dist = 300) {
      const el = Math.asin(Math.max(0.12, Math.min(1, L.sunElevation)));
      return new THREE.Vector3(Math.cos(L.sunAzimuth) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(L.sunAzimuth) * Math.cos(el) * dist);
    },
  };
}

// ---------- trees ----------
export function createTrees(THREE: T, positions: { x: number; z: number; s: number }[]) {
  const g = new THREE.Group();
  if (!positions.length) return g;
  const n = positions.length;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6);
  trunkGeo.translate(0, 1.3, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.1, 1);
  crownGeo.translate(0, 4.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }), n);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), n);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  positions.forEach((p, i) => {
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    S.set(p.s, p.s * (0.85 + Math.random() * 0.4), p.s);
    P.set(p.x, 0, p.z);
    M.compose(P, Q, S);
    trunks.setMatrixAt(i, M);
    crowns.setMatrixAt(i, M);
    C.setHSL(0.26 + Math.random() * 0.08, 0.45 + Math.random() * 0.2, 0.22 + Math.random() * 0.12);
    crowns.setColorAt(i, C);
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  g.add(trunks, crowns);
  return g;
}

// ---------- traffic ----------
export interface Lane { ax: number; az: number; bx: number; bz: number }

export function createTraffic(THREE: T, lanes: Lane[], perLane = 3) {
  const g = new THREE.Group();
  const cars: { lane: Lane; t: number; speed: number; len: number }[] = [];
  for (const lane of lanes) {
    const len = Math.hypot(lane.bx - lane.ax, lane.bz - lane.az);
    for (let i = 0; i < perLane; i++) cars.push({ lane, t: Math.random(), speed: (9 + Math.random() * 7) / Math.max(1, len), len });
  }
  const n = Math.max(1, cars.length);
  const bodyGeo = new THREE.BoxGeometry(4.3, 1.1, 1.9);
  bodyGeo.translate(0, 0.75, 0);
  const cabGeo = new THREE.BoxGeometry(2.3, 0.75, 1.7);
  cabGeo.translate(-0.25, 1.65, 0);
  const lightGeo = new THREE.BoxGeometry(0.12, 0.25, 1.5);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.35 }), n);
  const cabs = new THREE.InstancedMesh(cabGeo, new THREE.MeshStandardMaterial({ color: 0x1b2433, metalness: 0.9, roughness: 0.1 }), n);
  const heads = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d6 }), n);
  const tails = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xff3030 }), n);
  const palette = [0xe5e7eb, 0x111827, 0x9ca3af, 0x1d4ed8, 0xb91c1c, 0xf59e0b, 0x065f46, 0xf3f4f6, 0x374151];
  const C = new THREE.Color();
  cars.forEach((_, i) => bodies.setColorAt(i, C.set(palette[i % palette.length])));
  bodies.castShadow = true;
  g.add(bodies, cabs, heads, tails);
  // headlight glow sprites
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,240,200,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glows: any[] = cars.map(() => {
    const sp = new THREE.Sprite(glowMat);
    sp.scale.set(5, 5, 1);
    g.add(sp);
    return sp;
  });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), O = new THREE.Vector3();
  const update = (dt: number, night: number) => {
    cars.forEach((c, i) => {
      c.t = (c.t + c.speed * dt) % 1;
      const { ax, az, bx, bz } = c.lane;
      const x = ax + (bx - ax) * c.t, z = az + (bz - az) * c.t;
      const ang = -Math.atan2(bz - az, bx - ax);
      Q.setFromAxisAngle(up, ang);
      P.set(x, 0, z);
      M.compose(P, Q, S);
      bodies.setMatrixAt(i, M);
      cabs.setMatrixAt(i, M);
      O.set(2.17, 0.75, 0).applyQuaternion(Q).add(P);
      M.compose(O, Q, S);
      heads.setMatrixAt(i, M);
      glows[i].position.set(O.x + Math.cos(-ang) * 2, 0.9, O.z + Math.sin(-ang) * 2);
      glows[i].material.opacity = night * 0.9;
      O.set(-2.17, 0.75, 0).applyQuaternion(Q).add(P);
      M.compose(O, Q, S);
      tails.setMatrixAt(i, M);
    });
    bodies.instanceMatrix.needsUpdate = cabs.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = tails.instanceMatrix.needsUpdate = true;
    glowMat.opacity = night * 0.9;
  };
  update(0, 0);
  return { group: g, update };
}

// ---------- street lamps ----------
export function createLamps(THREE: T, positions: { x: number; z: number; dx: number; dz: number }[]) {
  const g = new THREE.Group();
  if (!positions.length) return { group: g, update: (_n: number) => {} };
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.7, roughness: 0.4 }), positions.length);
  const headGeo = new THREE.BoxGeometry(1.4, 0.25, 0.5);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222831, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, positions.length);
  const M = new THREE.Matrix4();
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,214,150,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(THREE, 'rgba(255,200,130,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  positions.forEach((p, i) => {
    M.makeTranslation(p.x, 0, p.z);
    poles.setMatrixAt(i, M);
    M.makeTranslation(p.x + p.dx * 0.7, 7, p.z + p.dz * 0.7);
    heads.setMatrixAt(i, M);
    const sp = new THREE.Sprite(glowMat);
    sp.position.set(p.x + p.dx * 0.7, 6.8, p.z + p.dz * 0.7);
    sp.scale.set(7, 7, 1);
    g.add(sp);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(p.x + p.dx * 2, 0.12, p.z + p.dz * 2);
    g.add(pool);
  });
  poles.castShadow = true;
  g.add(poles, heads);
  return {
    group: g,
    update(night: number) {
      headMat.emissiveIntensity = night * 3;
      glowMat.opacity = night;
      poolMat.opacity = night * 0.55;
    },
  };
}
