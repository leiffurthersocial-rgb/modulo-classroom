// Lighting rig + moods (presentation only; the sim keeps its own `lightsDim`).
// A mood is chosen once per lesson (URL ?mood=overcast|noon|dim, else from the lesson seed/type)
// and drives: hemisphere/sun/fill intensities and colours, tone-mapping exposure, environment
// strength, ceiling fixtures, the procedural sky behind the windows and the sun shafts.
import * as THREE from 'three';
import type { RoomLayout } from '../sim/layout';
import type { QualitySettings } from '../quality';

export type MoodId = 'overcast' | 'noon' | 'dim';

export interface SkyParams {
  zenith: number;
  horizon: number;
  /** 0 clear .. 1 overcast. */
  cloud: number;
  cloudTint: number;
  /** Strength of the glow around the sun direction. */
  sunGlow: number;
  tree: number;
  building: number;
  ground: number;
  haze: number;
  /** Radiance multiplier of the whole outdoor view (> 1 lets bloom pick it up). */
  brightness: number;
}

export interface Mood {
  id: MoodId;
  label: string;
  exposure: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sunColor: number;
  sun: number;
  /** Sun elevation / azimuth in degrees. Azimuth 0 = straight in through the window wall. */
  sunElev: number;
  sunAz: number;
  fillColor: number;
  fill: number;
  /** Emissive intensity of the ceiling fixtures. */
  lamp: number;
  env: number;
  shafts: number;
  dust: number;
  sky: SkyParams;
}

export const MOODS: Record<MoodId, Mood> = {
  overcast: {
    id: 'overcast',
    label: 'Overcast morning',
    exposure: 1.12,
    hemiSky: 0xe2ebf5,
    hemiGround: 0x4a4036,
    hemi: 1.65,
    sunColor: 0xdfe9f7,
    sun: 0.9,
    sunElev: 42,
    sunAz: -10,
    fillColor: 0xfff4e6,
    fill: 6.5,
    lamp: 1.6,
    env: 0.55,
    shafts: 0,
    dust: 0.12,
    sky: {
      zenith: 0xb8c4d0,
      horizon: 0xe4e9ee,
      cloud: 1,
      cloudTint: 0x9aa5b1,
      sunGlow: 0.15,
      tree: 0x55655a,
      building: 0x9ba7b3,
      ground: 0x6f7d66,
      haze: 0xd6dde4,
      brightness: 1.5,
    },
  },
  noon: {
    id: 'noon',
    label: 'Bright noon',
    exposure: 1.0,
    hemiSky: 0xd6e6fa,
    hemiGround: 0x5a4636,
    hemi: 0.85,
    sunColor: 0xffe0b0,
    sun: 3.8,
    sunElev: 31,
    sunAz: -24,
    fillColor: 0xfff0dc,
    fill: 3.6,
    lamp: 0.9,
    env: 0.4,
    shafts: 1,
    dust: 1,
    sky: {
      zenith: 0x3a74c2,
      horizon: 0x9cc4ec,
      cloud: 0.3,
      cloudTint: 0xffffff,
      sunGlow: 1,
      tree: 0x2c5428,
      building: 0x8fa2b6,
      ground: 0x4a7436,
      haze: 0xcfe0ee,
      brightness: 2.0,
    },
  },
  dim: {
    id: 'dim',
    label: 'Dim afternoon',
    exposure: 1.25,
    hemiSky: 0xb9c3d6,
    hemiGround: 0x4a3a2c,
    hemi: 0.62,
    sunColor: 0xffa468,
    sun: 1.7,
    sunElev: 14,
    sunAz: -32,
    fillColor: 0xffd7a8,
    fill: 3.0,
    lamp: 0.55,
    env: 0.3,
    shafts: 0,
    dust: 0.45,
    sky: {
      zenith: 0x6d7690,
      horizon: 0xe2b58f,
      cloud: 0.75,
      cloudTint: 0xb98f7a,
      sunGlow: 0.8,
      tree: 0x2c3b32,
      building: 0x7a7280,
      ground: 0x4b5240,
      haze: 0xd9b595,
      brightness: 0.85,
    },
  },
};

function hash(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** ?mood= wins; otherwise projector/film lessons get the dim afternoon, the rest hash the seed. */
export function pickMood(lessonType: string, seed: number, search = ''): MoodId {
  try {
    const q = new URLSearchParams(search).get('mood');
    if (q === 'overcast' || q === 'noon' || q === 'dim') return q;
  } catch {
    /* ignore */
  }
  if (lessonType === 'film' || lessonType === 'presentation') return 'dim';
  const r = hash(seed ^ 0x9e3779b1);
  return r < 0.45 ? 'overcast' : r < 0.85 ? 'noon' : 'dim';
}

export function sunDirection(mood: Mood): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(mood.sunElev);
  const a = THREE.MathUtils.degToRad(mood.sunAz);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
}

export interface LightRigParts {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.PointLight;
}

/** Fit the sun's orthographic shadow camera to the room box (denser texels, no wasted far plane). */
export function fitSunShadow(
  sun: THREE.DirectionalLight,
  layout: Pick<RoomLayout, 'room'>,
  dir: THREE.Vector3,
): void {
  const [W, H, D] = layout.room.size;
  const target = new THREE.Vector3(W * 0.5, H * 0.35, D * 0.5);
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(dir, 24);
  const f = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, f).normalize();
  let l = Infinity,
    r = -Infinity,
    b = Infinity,
    t = -Infinity,
    n = Infinity,
    far = -Infinity;
  const c = new THREE.Vector3();
  for (const x of [-0.3, W + 0.3])
    for (const y of [0, H + 0.1])
      for (const z of [-0.3, D + 0.3]) {
        c.set(x, y, z).sub(sun.position);
        const px = c.dot(right),
          py = c.dot(up),
          pz = c.dot(f);
        l = Math.min(l, px);
        r = Math.max(r, px);
        b = Math.min(b, py);
        t = Math.max(t, py);
        n = Math.min(n, pz);
        far = Math.max(far, pz);
      }
  // The frustum is centred on the light's look direction; make it symmetric around the target.
  const ct = new THREE.Vector3().copy(target).sub(sun.position);
  const cx = ct.dot(right),
    cy = ct.dot(up);
  const hx = Math.max(Math.abs(l - cx), Math.abs(r - cx)) + 0.2;
  const hy = Math.max(Math.abs(b - cy), Math.abs(t - cy)) + 0.2;
  const sc = sun.shadow.camera;
  sc.left = -hx;
  sc.right = hx;
  sc.top = hy;
  sc.bottom = -hy;
  sc.near = Math.max(0.5, n - 1);
  sc.far = far + 1;
  sc.updateProjectionMatrix();
  // Texel ~ 12 m / 2048 = 6 mm: a small constant bias plus normal offset avoids acne on tables.
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
}

/** The room's light rig (shared with /lab so materials are judged under game lighting). */
export function createLightRig(layout: Pick<RoomLayout, 'room'>, moodId: MoodId = 'overcast') {
  const [W, H, D] = layout.room.size;
  const m = MOODS[moodId];
  const hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, m.hemi);
  const sun = new THREE.DirectionalLight(m.sunColor, m.sun);
  sun.castShadow = true;
  fitSunShadow(sun, layout, sunDirection(m));
  const fill = new THREE.PointLight(m.fillColor, m.fill, 13, 2);
  fill.position.set(W / 2, H - 0.25, D * 0.62);
  return { hemi, sun, fill } satisfies LightRigParts;
}

/** Drives the light rig from a mood + the sim's lightsDim flag, owns ceiling fixtures. */
export class LightController {
  readonly group = new THREE.Group();
  readonly mood: Mood;
  readonly sunDir: THREE.Vector3;
  private lampMat: THREE.MeshStandardMaterial;
  private screenLight: THREE.PointLight;
  private dimK = -1;
  private screenK = 0;

  constructor(
    private layout: Pick<RoomLayout, 'room'>,
    private rig: LightRigParts,
    moodId: MoodId,
  ) {
    this.mood = MOODS[moodId];
    this.sunDir = sunDirection(this.mood);
    const m = this.mood;
    rig.hemi.color.setHex(m.hemiSky);
    rig.hemi.groundColor.setHex(m.hemiGround);
    rig.sun.color.setHex(m.sunColor);
    rig.fill.color.setHex(m.fillColor);
    fitSunShadow(rig.sun, layout, this.sunDir);
    this.group.name = 'lighting';
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      emissive: 0xfff1d8,
      emissiveIntensity: m.lamp,
      roughness: 0.5,
    });
    const [W, H, D] = layout.room.size;
    // Two rows of slim surface-mounted LED bars either side of the concrete beam.
    const bar = new THREE.BoxGeometry(1.6, 0.045, 0.09);
    const housing = new THREE.BoxGeometry(1.64, 0.02, 0.13);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.6 });
    for (const z of [D * 0.2, D * 0.68]) {
      for (const x of [W * 0.28, W * 0.72]) {
        const lamp = new THREE.Mesh(bar, this.lampMat);
        lamp.position.set(x, H - 0.045, z);
        const h = new THREE.Mesh(housing, housingMat);
        h.position.set(x, H - 0.015, z);
        this.group.add(h, lamp);
      }
    }
    // Projector-screen spill: cool light thrown back into the room when the screen is up.
    this.screenLight = new THREE.PointLight(0xdbe6ff, 0, 9, 2);
    this.screenLight.position.set(W * 0.5, 1.5, 1.3);
    this.group.add(this.screenLight);
  }

  applyQuality(q: QualitySettings): void {
    this.screenLight.visible = q.glowLights > 0;
  }

  /** Call every frame: `dim` is the sim's lightsDim, `screenOn` whether the screen is showing. */
  update(dim: boolean, screenOn: boolean): void {
    const m = this.mood;
    const target = dim ? 1 : 0;
    this.dimK = this.dimK < 0 ? target : this.dimK + (target - this.dimK) * 0.12;
    if (Math.abs(this.dimK - target) < 0.004) this.dimK = target;
    const d = this.dimK;
    const lerp = THREE.MathUtils.lerp;
    this.rig.hemi.intensity = m.hemi * lerp(1, 0.3, d);
    this.rig.sun.intensity = m.sun * lerp(1, 0.25, d);
    this.rig.fill.intensity = m.fill * lerp(1, 0.22, d);
    this.lampMat.emissiveIntensity = m.lamp * lerp(1, 0.08, d);
    const sTarget = screenOn ? lerp(0.5, 5.5, d) : 0;
    this.screenK += (sTarget - this.screenK) * 0.2;
    this.screenLight.intensity = this.screenK;
  }

  /** Fraction (0..1) of the window light currently on (for shafts/dust). */
  daylight(): number {
    return 1 - Math.max(0, this.dimK) * 0.75;
  }
}
