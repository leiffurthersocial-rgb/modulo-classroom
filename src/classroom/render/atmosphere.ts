// Atmosphere: cheap volumetric sun shafts (additive prisms extruded from each window along the sun
// direction, soft-edged and noise-modulated) and floating dust motes that glow only where they
// cross the sunlight coming through the windows. No render targets, no ray marching.
import * as THREE from 'three';
import type { RoomLayout } from '../sim/layout';
import type { QualitySettings } from '../quality';
import type { Mood } from './lighting';

const SHAFT_VERT = /* glsl */ `
attribute float aT;
varying vec3 vWorld;
varying float vT;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHAFT_FRAG = /* glsl */ `
varying vec3 vWorld;
varying float vT;
uniform float uTime, uStrength;
uniform vec3 uColor;
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(n, v));
  float soft = pow(facing, 0.75);
  float along = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
  float floorFade = smoothstep(0.0, 0.9, vWorld.y);
  vec3 q = vWorld * vec3(0.6, 0.5, 0.6) + vec3(uTime * 0.03, uTime * 0.02, 0.0);
  float noise = 0.55 + 0.9 * (n3(q) * 0.65 + n3(q * 2.3) * 0.35);
  float a = soft * along * floorFade * noise * uStrength;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute vec4 aRnd;
uniform float uTime, uViewH, uLitBase, uLitGain;
uniform vec3 uSunDir;
uniform vec4 uWin[4];
uniform float uWinX;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime;
  p += vec3(sin(t * 0.21 + aRnd.x * 40.0), sin(t * 0.17 + aRnd.y * 40.0) * 0.6, cos(t * 0.19 + aRnd.z * 40.0)) * 0.22;
  // Is this point inside the sun's window light? Trace toward the sun to the window plane.
  float lit = 0.0;
  float k = (uWinX - p.x) / max(uSunDir.x, 0.05);
  vec3 h = p + uSunDir * k;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWin[i]; // zmin zmax ymin ymax
    float inz = smoothstep(w.x - 0.12, w.x + 0.12, h.z) * (1.0 - smoothstep(w.y - 0.12, w.y + 0.12, h.z));
    float iny = smoothstep(w.z - 0.12, w.z + 0.12, h.y) * (1.0 - smoothstep(w.w - 0.12, w.w + 0.12, h.y));
    lit = max(lit, inz * iny);
  }
  vA = (uLitBase + uLitGain * lit) * (0.5 + 0.5 * sin(t * (0.6 + aRnd.w) + aRnd.x * 30.0));
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.011 + 0.008 * aRnd.w) * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1), 1.0, 6.0);
}`;

const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8), a);
}`;

function windowsOf(layout: RoomLayout) {
  return layout.openings
    .filter((o) => o.kind === 'window' && o.wall === 'right')
    .map((o) => ({
      z0: o.offset,
      z1: o.offset + o.width,
      y0: o.sill ?? 0.9,
      y1: (o.sill ?? 0.9) + o.height,
    }));
}

export class Atmosphere {
  readonly group = new THREE.Group();
  private shafts: THREE.Mesh | null = null;
  private shaftMat: THREE.ShaderMaterial | null = null;
  private dust: THREE.Points | null = null;
  private dustMat: THREE.ShaderMaterial;
  private dustMax = 0;
  private baseStrength = 0;

  constructor(
    layout: RoomLayout,
    private mood: Mood,
    sunDir: THREE.Vector3,
  ) {
    this.group.name = 'atmosphere';
    this.group.userData.noAO = true;
    const [W, H, D] = layout.room.size;
    const wins = windowsOf(layout);
    const x = W + 0.1;
    const toRoom = sunDir.clone().negate(); // direction light travels
    this.baseStrength = mood.shafts;

    // --- Sun shafts: one prism per window, extruded along the light direction ---------------
    if (mood.shafts > 0 && toRoom.x < -0.05 && toRoom.y < -0.05) {
      const pos: number[] = [];
      const aT: number[] = [];
      const idx: number[] = [];
      for (const w of wins) {
        const len = (w.y1 + 0.2) / -toRoom.y;
        const corners: [number, number][] = [
          [w.y0, w.z0],
          [w.y0, w.z1],
          [w.y1, w.z1],
          [w.y1, w.z0],
        ];
        const base = pos.length / 3;
        for (const [y, z] of corners) {
          pos.push(x, y, z);
          aT.push(0);
        }
        for (const [y, z] of corners) {
          pos.push(x + toRoom.x * len, y + toRoom.y * len, z + toRoom.z * len);
          aT.push(1);
        }
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          idx.push(base + i, base + j, base + 4 + j, base + i, base + 4 + j, base + 4 + i);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
      geo.setIndex(idx);
      this.shaftMat = new THREE.ShaderMaterial({
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uStrength: { value: 0.1 * mood.shafts },
          uColor: { value: new THREE.Color(mood.sunColor).multiplyScalar(1.1) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.shafts = new THREE.Mesh(geo, this.shaftMat);
      this.shafts.frustumCulled = false;
      this.shafts.renderOrder = 4;
      this.shafts.userData.noAO = true;
      this.group.add(this.shafts);
    }

    // --- Dust motes ----------------------------------------------------------------------------
    this.dustMax = 500;
    const n = this.dustMax;
    const p = new Float32Array(n * 3);
    const r = new Float32Array(n * 4);
    let s = 12345;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      p[i * 3] = 0.4 + rnd() * (W - 0.8);
      p[i * 3 + 1] = 0.3 + rnd() * (H - 0.6);
      p[i * 3 + 2] = 0.3 + rnd() * (D - 0.6);
      r[i * 4] = rnd();
      r[i * 4 + 1] = rnd();
      r[i * 4 + 2] = rnd();
      r[i * 4 + 3] = rnd();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    dg.setAttribute('aRnd', new THREE.BufferAttribute(r, 4));
    dg.setDrawRange(0, 0);
    const winU = [0, 1, 2, 3].map((i) => {
      const w = wins[i];
      return w ? new THREE.Vector4(w.z0, w.z1, w.y0, w.y1) : new THREE.Vector4(9, 9, 9, 9);
    });
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uViewH: { value: 1080 },
        uLitBase: { value: 0.05 },
        uLitGain: { value: 0.9 * mood.dust },
        uSunDir: { value: sunDir.clone() },
        uWin: { value: winU },
        uWinX: { value: x },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.dust.userData.noAO = true;
    this.dust.onBeforeRender = (renderer) => {
      this.dustMat.uniforms.uViewH!.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    };
    this.group.add(this.dust);
  }

  applyQuality(q: QualitySettings): void {
    if (this.shafts) this.shafts.visible = q.shafts && this.baseStrength > 0;
    const n = Math.min(this.dustMax, q.dust);
    if (this.dust) {
      this.dust.visible = n > 0;
      this.dust.geometry.setDrawRange(0, n);
    }
  }

  /** `daylight` 0..1 (lights-dim fades shafts and the lit motes). */
  update(t: number, daylight: number): void {
    this.dustMat.uniforms.uTime!.value = t;
    this.dustMat.uniforms.uLitGain!.value = 0.9 * this.mood.dust * daylight;
    if (this.shaftMat) {
      this.shaftMat.uniforms.uTime!.value = t;
      this.shaftMat.uniforms.uStrength!.value = 0.1 * this.baseStrength * daylight;
    }
  }
}
