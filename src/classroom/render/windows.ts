// Outdoor view for the window glass: a procedural sky + two silhouette layers (a skyline and a
// tree line) plus a lawn, all ray-marched analytically per pixel from the camera through the glass
// so the layers shift against each other as the player moves (true parallax). Needs no textures,
// so it works before (or without) the HDRI. Plus slim aluminium frames.
import * as THREE from 'three';
import type { RoomLayout } from '../sim/layout';
import { MOODS, sunDirection, type Mood } from './lighting';

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
varying vec3 vWorld;
uniform float uTime;
uniform vec3 uZenith, uHorizon, uCloudTint, uTree, uBuilding, uGround, uHaze, uSunCol;
uniform vec3 uSunDir;
uniform float uCloud, uSunGlow, uBright;

float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

vec3 sky(vec3 d) {
  float e = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(e, 0.38));
  // Clouds: project the view ray onto a high layer.
  vec2 cp = d.zx / (d.y + 0.22) * 1.6 + vec2(uTime * 0.004, 0.0);
  float n = fbm(cp);
  float cov = mix(smoothstep(0.52, 0.8, n), smoothstep(0.2, 0.72, n), uCloud);
  vec3 cloudC = mix(vec3(1.0), uCloudTint, uCloud * (0.35 + 0.65 * (1.0 - n)));
  c = mix(c, cloudC * mix(1.0, 0.92, uCloud), cov * (0.35 + 0.65 * uCloud));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 90.0) * 1.8) * uSunGlow;
  return c;
}

void main() {
  vec3 ro = vWorld;
  vec3 d = normalize(vWorld - cameraPosition);
  float dx = max(d.x, 0.04);
  vec3 col;
  bool hit = false;

  // Lawn / pavement ground at y = -0.15 (just below the room floor).
  float tG = d.y < -0.002 ? (ro.y + 0.15) / -d.y : 1e9;
  // Tree line plane at x = ro.x + 20, skyline plane at x = ro.x + 90.
  float tT = 34.0 / dx;
  float tB = 90.0 / dx;

  if (tT < tG) {
    vec3 p = ro + d * tT;
    float ty = p.y + 0.15;
    float z = p.z;
    // Crown outline: low-frequency sway of the canopy + leafy high-frequency edge.
    float top = 3.2 + 4.5 * fbm(vec2(z * 0.12, 3.0)) + 1.0 * vnoise(vec2(z * 1.1, 9.0));
    top += 1.3 * (vnoise(vec2(p.y * 1.8, z * 1.9)) - 0.5);
    if (ty > 0.0 && ty < top) {
      float shade = 0.55 + 0.6 * vnoise(vec2(z * 2.4, ty * 2.2)) + 0.35 * (ty / top);
      vec3 t = uTree * shade;
      float fog = 1.0 - exp(-tT * 0.012);
      col = mix(t, uHaze, fog * 0.5);
      hit = true;
    }
  }
  if (!hit && tG < tB && tG < 1e8) {
    vec3 p = ro + d * tG;
    float n = fbm(p.xz * 0.9);
    vec3 g = uGround * (0.7 + 0.6 * n);
    // A paved path running parallel to the wall.
    float path = smoothstep(0.0, 0.15, abs(p.x - (ro.x + 4.2)) - 1.1);
    g = mix(uHaze * 0.55 * (0.9 + 0.2 * n), g, path);
    float fog = 1.0 - exp(-tG * 0.012);
    col = mix(g * 0.7, uHaze, fog * 0.8);
    hit = true;
  }
  if (!hit && tB < tG) {
    vec3 p = ro + d * tB;
    float by = p.y + 0.15;
    float cell = floor(p.z / 9.0);
    float bh = 9.0 + 26.0 * h11(cell + 3.0);
    if (h11(cell + 7.0) < 0.3) bh = 4.0;
    if (by > 0.0 && by < bh) {
      float win = step(0.5, fract(p.z * 0.9)) * step(0.5, fract(by * 0.45));
      vec3 b = uBuilding * (0.85 + 0.15 * h11(cell)) * (1.0 - 0.08 * win);
      col = mix(b, uHaze, 0.55);
      hit = true;
    }
  }
  if (!hit) col = sky(d);
  col *= uBright;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const c = (hex: number) => new THREE.Color(hex);

export function createWindowGlassMaterial(): THREE.ShaderMaterial {
  const m = MOODS.overcast;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: c(m.sky.zenith) },
      uHorizon: { value: c(m.sky.horizon) },
      uCloudTint: { value: c(m.sky.cloudTint) },
      uTree: { value: c(m.sky.tree) },
      uBuilding: { value: c(m.sky.building) },
      uGround: { value: c(m.sky.ground) },
      uHaze: { value: c(m.sky.haze) },
      uSunCol: { value: c(m.sunColor) },
      uSunDir: { value: sunDirection(m) },
      uCloud: { value: m.sky.cloud },
      uSunGlow: { value: m.sky.sunGlow },
      uBright: { value: m.sky.brightness },
    },
  });
  mat.userData.windowGlass = true;
  return mat;
}

/** The window glass materials under `root` (collect once; per-frame updates must not traverse). */
export function collectWindowMaterials(root: THREE.Object3D): THREE.ShaderMaterial[] {
  const out: THREE.ShaderMaterial[] = [];
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat?.userData?.windowGlass && !out.includes(mat as THREE.ShaderMaterial))
      out.push(mat as THREE.ShaderMaterial);
  });
  return out;
}

/** Point window glass materials at a mood's sky (time drives the slow cloud drift). */
export function applyWindowMood(mats: THREE.ShaderMaterial[], mood: Mood, time = 0): void {
  for (const mat of mats) {
    const u = mat.uniforms;
    const s = mood.sky;
    u.uTime!.value = time;
    (u.uZenith!.value as THREE.Color).setHex(s.zenith);
    (u.uHorizon!.value as THREE.Color).setHex(s.horizon);
    (u.uCloudTint!.value as THREE.Color).setHex(s.cloudTint);
    (u.uTree!.value as THREE.Color).setHex(s.tree);
    (u.uBuilding!.value as THREE.Color).setHex(s.building);
    (u.uGround!.value as THREE.Color).setHex(s.ground);
    (u.uHaze!.value as THREE.Color).setHex(s.haze);
    (u.uSunCol!.value as THREE.Color).setHex(mood.sunColor);
    (u.uSunDir!.value as THREE.Vector3).copy(sunDirection(mood));
    u.uCloud!.value = s.cloud;
    u.uSunGlow!.value = s.sunGlow;
    u.uBright!.value = s.brightness;
  }
}

/** Slim aluminium window frames + a transom, set into the deep concrete reveal. */
export function buildWindowFrames(layout: RoomLayout): THREE.Group {
  const g = new THREE.Group();
  g.name = 'window-frames';
  const [W] = layout.room.size;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9dcdf,
    metalness: 0.7,
    roughness: 0.38,
  });
  const x = W + 0.1;
  const bar = (w: number, h: number, d: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mat);
    m.position.set(x, y, z);
    m.castShadow = false;
    m.receiveShadow = true;
    g.add(m);
  };
  const t = 0.05;
  for (const win of layout.openings) {
    if (win.kind !== 'window' || win.wall !== 'right') continue;
    const sill = win.sill ?? 0.9;
    const z0 = win.offset;
    const z1 = win.offset + win.width;
    const zc = (z0 + z1) / 2;
    const y1 = sill + win.height;
    bar(win.width, t, 0.07, sill + t / 2, zc); // bottom
    bar(win.width, t, 0.07, y1 - t / 2, zc); // top
    bar(t, win.height, 0.07, sill + win.height / 2, z0 + t / 2); // sides
    bar(t, win.height, 0.07, sill + win.height / 2, z1 - t / 2);
    bar(win.width, 0.035, 0.05, sill + win.height * 0.72, zc); // transom
    bar(0.035, win.height * 0.72, 0.05, sill + win.height * 0.36, zc); // centre mullion
  }
  return g;
}
