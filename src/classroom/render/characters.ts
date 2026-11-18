// Rigged stylised characters (teacher + students): one shared skeleton/GLB (built by
// tools/blender/characters.py), cloned per agent with its own AnimationMixer, recoloured
// materials and a procedural head/neck look-at overlay on top of the clips (gaze telegraph).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const CHARACTERS_URL = `${import.meta.env.BASE_URL}models/characters/characters.glb`;

export interface CharacterSpec {
  body: string;
  hair: string;
  glasses?: boolean;
  /** Uniform height scale around the 1.70 m reference. */
  scale: number;
  skin: number;
  hairColor: number;
  top: number;
  top2: number;
  bottom: number;
  shoes: number;
}

// ---------------------------------------------------------------------------------------------
// Appearance (deterministic per agent id)

const SKIN = [0xf0cdb0, 0xe0b090, 0xc68e6b, 0xa8693f, 0x7d4a2e, 0x5a3825];
const HAIR = [0x1c1410, 0x2e1d12, 0x4a3020, 0x6b4a2a, 0x9a7440, 0xc9a35a, 0x7a3b22, 0x8d8d8f];
const BOTTOM = [0x23283a, 0x30384d, 0x5b5242, 0x2a2a2d, 0x41485c, 0x6a6f7a];
const SHOES = [0x1b1b1d, 0xe8e8e6, 0x3a3f4a, 0x7a2f2a, 0x2c3e5a];

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function lighten(hex: number, k: number): number {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), k);
  return c.getHex();
}

type Look = Pick<CharacterSpec, 'body' | 'hair' | 'glasses' | 'scale' | 'skin' | 'hairColor'> & {
  bottom?: number;
  shoes?: number;
  top?: number;
};

const STUDENTS: Record<string, Look> = {
  mara: { body: 'stu_f_avg_long', hair: 'ponytail', scale: 0.98, skin: 1, hairColor: 3 },
  jonas: { body: 'stu_broad_hoodie', hair: 'cap', scale: 1.03, skin: 0, hairColor: 1 },
  aylin: {
    body: 'stu_f_slim_tee',
    hair: 'long',
    scale: 0.96,
    skin: 2,
    hairColor: 0,
    glasses: true,
  },
  theo: { body: 'stu_broad_tee', hair: 'curly', scale: 1.04, skin: 4, hairColor: 0, shoes: 1 },
  noor: { body: 'stu_f_avg_hoodie', hair: 'bun', scale: 0.97, skin: 3, hairColor: 1 },
  luca: { body: 'stu_slim_tee', hair: 'short', scale: 1.01, skin: 1, hairColor: 6 },
  ines: { body: 'stu_f_avg_long', hair: 'bob', scale: 0.99, skin: 0, hairColor: 5 },
  kofi: { body: 'stu_broad_hoodie', hair: 'buzz', scale: 1.05, skin: 5, hairColor: 0 },
  selin: { body: 'stu_f_slim_tee', hair: 'ponytail', scale: 0.97, skin: 2, hairColor: 2 },
  pim: { body: 'stu_avg_long', hair: 'short', scale: 1.0, skin: 1, hairColor: 4, glasses: true },
};

const TEACHERS: Record<string, Look & { top: number }> = {
  strict: {
    body: 'tch_f_blazer',
    hair: 'bun',
    scale: 1.0,
    skin: 1,
    hairColor: 7,
    glasses: true,
    top: 0x39424f,
  },
  lazy: {
    body: 'tch_m_cardigan',
    hair: 'curly',
    scale: 1.04,
    skin: 4,
    hairColor: 0,
    top: 0x6b5a45,
  },
  distracted: {
    body: 'tch_m_cardigan',
    hair: 'wild',
    scale: 1.0,
    skin: 0,
    hairColor: 7,
    glasses: true,
    top: 0x5a6b4e,
  },
  hawk: { body: 'tch_m_blazer', hair: 'short', scale: 1.08, skin: 2, hairColor: 7, top: 0x2b2f3a },
  substitute: {
    body: 'tch_u_hoodie',
    hair: 'bob',
    scale: 1.02,
    skin: 3,
    hairColor: 6,
    top: 0x6c4f8a,
  },
};

const STUDENT_BODIES = [
  'stu_slim_tee',
  'stu_avg_long',
  'stu_broad_hoodie',
  'stu_f_slim_tee',
  'stu_f_avg_hoodie',
  'stu_f_avg_long',
];
const HAIR_STYLES = ['short', 'buzz', 'long', 'bob', 'ponytail', 'bun', 'curly', 'cap'];

export function specFor(
  id: string,
  kind: 'teacher' | 'student',
  color: string,
  profileId?: string,
): CharacterSpec {
  const h = hashId(id);
  let look: Look;
  if (kind === 'teacher') look = TEACHERS[profileId ?? id] ?? TEACHERS.strict!;
  else
    look = STUDENTS[id] ?? {
      body: STUDENT_BODIES[h % STUDENT_BODIES.length]!,
      hair: HAIR_STYLES[(h >> 3) % HAIR_STYLES.length]!,
      scale: 0.96 + ((h >> 7) % 9) * 0.01,
      skin: (h >> 11) % SKIN.length,
      hairColor: (h >> 15) % HAIR.length,
    };
  const top = look.top ?? new THREE.Color(color).getHex();
  return {
    body: look.body,
    hair: look.hair,
    glasses: look.glasses,
    scale: look.scale,
    skin: SKIN[look.skin % SKIN.length]!,
    hairColor: HAIR[look.hairColor % HAIR.length]!,
    top,
    top2: kind === 'teacher' ? 0xe9ecef : lighten(top, 0.55),
    bottom: look.bottom ?? BOTTOM[(h >> 5) % BOTTOM.length]!,
    shoes: look.shoes !== undefined ? SHOES[look.shoes]! : SHOES[(h >> 9) % SHOES.length]!,
  };
}

// ---------------------------------------------------------------------------------------------
// Loading (kicked off at module import; RoomView swaps capsules for characters when ready)

export interface CharacterLibrary {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'failed' | 'disabled';
let state: LoadState = 'idle';
let library: CharacterLibrary | null = null;
let loadPromise: Promise<CharacterLibrary | null> | null = null;

export function charactersEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('chars') !== '0';
}

export function startCharacterLoad(): Promise<CharacterLibrary | null> {
  if (loadPromise) return loadPromise;
  if (!charactersEnabled()) {
    state = 'disabled';
    return (loadPromise = Promise.resolve(null));
  }
  state = 'loading';
  loadPromise = new GLTFLoader()
    .loadAsync(CHARACTERS_URL)
    .then((gltf) => {
      const clips = new Map<string, THREE.AnimationClip>();
      for (const c of gltf.animations) clips.set(c.name, c);
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) m.frustumCulled = false;
      });
      library = { scene: gltf.scene, clips };
      state = 'ready';
      return library;
    })
    .catch((e: unknown) => {
      console.warn('[characters] load failed, using capsules', e);
      state = 'failed';
      return null;
    });
  return loadPromise;
}

export const getCharacterLibrary = (): CharacterLibrary | null => library;
/** True once loading has finished one way or the other (screenshot mode waits for this). */
export const charactersSettled = (): boolean =>
  state === 'ready' || state === 'failed' || state === 'disabled';

if (typeof window !== 'undefined' && typeof document !== 'undefined') void startCharacterLoad();

// ---------------------------------------------------------------------------------------------
// Sim state -> clip

export interface ClipRequest {
  clip: string;
  once?: boolean;
  timeScale?: number;
}

export interface StateInput {
  kind: 'teacher' | 'student';
  id: string;
  moving: boolean;
  sitting: boolean;
  speed: number;
  t: number;
  /** Student action (StudentAction) or teacher state (TeacherState). */
  action: string;
  /** Which side a whispering student leans to. */
  whisperSide: 'L' | 'R';
}

const WALK_REF_SPEED = 1.18;

export function pickClip(s: StateInput): ClipRequest {
  if (s.moving)
    return { clip: 'walk', timeScale: Math.max(0.4, Math.min(1.8, s.speed / WALK_REF_SPEED)) };
  if (s.kind === 'teacher') {
    switch (s.action) {
      case 'board':
        return { clip: 'teacher_write_board' };
      case 'facing':
      case 'answer':
      case 'handout':
        return {
          clip: Math.floor(s.t / 9 + (hashId(s.id) % 3)) % 3 === 2 ? 'teacher_point' : 'talk',
        };
      case 'laptop':
        return { clip: 'teacher_type' };
      case 'confront':
      case 'penalty':
        return { clip: 'teacher_hands_on_hips' };
      case 'check':
        return { clip: 'teacher_point' };
      default:
        return { clip: 'idle_stand' };
    }
  }
  if (!s.sitting) return { clip: s.action === 'break' ? 'talk' : 'idle_stand' };
  switch (s.action) {
    case 'notes':
      return { clip: hashId(s.id) % 3 === 0 ? 'sit_type' : 'sit_write' };
    case 'doodle':
    case 'pass-note':
      return { clip: 'sit_write' };
    case 'phone':
      return { clip: 'sit_phone' };
    case 'yawn':
      return { clip: 'yawn', once: true };
    case 'cough':
    case 'sneeze':
      return { clip: 'cough', once: true };
    case 'glance':
      return { clip: 'look_around' };
    case 'stretch':
      return { clip: 'stretch', once: true };
    case 'whisper':
      return { clip: s.whisperSide === 'L' ? 'whisper_L' : 'whisper_R' };
    case 'raise-hand':
      return { clip: 'raise_hand_sit' };
    default:
      return { clip: 'sit_idle' };
  }
}

// ---------------------------------------------------------------------------------------------
// Character instance

const YAW_AXIS = new THREE.Vector3(0, 1, 0);
const SEAT_HIP_Z = 0.555;
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Character {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  private requested = '';
  private fallback = 'idle_stand';
  private onceDone = false;
  private neck: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private chest: THREE.Object3D | null = null;
  private handR: THREE.Object3D | null = null;
  private laptop: THREE.Object3D | null = null;
  private mats: THREE.Material[] = [];
  private scale: number;
  private lib: CharacterLibrary;
  private smoothYaw = 0;
  /** Deterministic loop phase so a room of identical clips does not move in lockstep. */
  private phase: number;

  constructor(lib: CharacterLibrary, spec: CharacterSpec) {
    this.lib = lib;
    this.scale = spec.scale;
    this.phase = (hashId(spec.body + spec.hair + spec.skin) % 1000) / 1000;
    this.model = cloneSkinned(lib.scene);
    const want = new Set([spec.body, 'hair_' + spec.hair, 'laptop']);
    if (spec.glasses) want.add('glasses');
    const drop: THREE.Object3D[] = [];
    for (const c of this.model.children) {
      if ((c as THREE.Bone).isBone) continue;
      if (!want.has(c.name)) drop.push(c);
    }
    for (const c of drop) c.removeFromParent();
    const colors: Record<string, number> = {
      skin: spec.skin,
      top: spec.top,
      top2: spec.top2,
      bottom: spec.bottom,
      shoes: spec.shoes,
      hair: spec.hairColor,
      face: new THREE.Color(spec.hairColor).multiplyScalar(0.55).getHex(),
    };
    const cache = new Map<string, THREE.Material>();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const swap = (mat: THREE.Material): THREE.Material => {
        let c = cache.get(mat.name);
        if (!c) {
          c = mat.clone();
          const hex = colors[mat.name];
          if (hex !== undefined) (c as THREE.MeshStandardMaterial).color.setHex(hex);
          cache.set(mat.name, c);
          this.mats.push(c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    this.laptop = this.model.getObjectByName('laptop') ?? null;
    if (this.laptop) this.laptop.visible = false;
    this.neck = this.model.getObjectByName('Neck') ?? null;
    this.head = this.model.getObjectByName('Head') ?? null;
    this.chest = this.model.getObjectByName('Chest') ?? null;
    this.handR = this.model.getObjectByName('Hand_R') ?? null;
    this.model.scale.setScalar(spec.scale);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
  }

  /** Request a clip; repeated calls with the same name are free. */
  setClip(req: ClipRequest, sitting: boolean, fade = 0.25): void {
    this.fallback = sitting ? 'sit_idle' : 'idle_stand';
    const key = req.clip + (req.once ? '!' : '');
    if (key === this.requested) {
      if (this.action && req.timeScale) this.action.timeScale = req.timeScale;
      return;
    }
    const first = this.action === null;
    this.requested = key;
    this.onceDone = false;
    this.start(
      req.clip,
      !!req.once,
      req.timeScale ?? 1,
      first ? 0 : fade,
      first && req.clip === 'walk',
    );
  }

  private start(
    name: string,
    once: boolean,
    timeScale: number,
    fade: number,
    randomPhase: boolean,
  ): void {
    const clip = this.lib.clips.get(name) ?? this.lib.clips.get(this.fallback);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.timeScale = timeScale;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (randomPhase) next.time = this.phase * clip.duration;
    next.play();
    if (this.action && this.action !== next) {
      if (fade > 0) next.crossFadeFrom(this.action, fade, false);
      else this.action.stop();
    }
    this.action = next;
    if (this.laptop) this.laptop.visible = name === 'sit_type';
  }

  /**
   * Advance animation and apply the gaze overlay. relYaw = headYaw - bodyYaw (sim radians,
   * positive = turn toward -x like three.js rotation.y).
   */
  update(dt: number, bodyYaw: number, relYaw: number, sitting: boolean): void {
    this.model.rotation.y = bodyYaw + Math.PI;
    this.model.position.y = sitting ? SEAT_HIP_Z * (1 - this.scale) : 0;
    if (this.action && this.requested.endsWith('!') && !this.onceDone) {
      const clip = this.action.getClip();
      if (this.action.time >= clip.duration - 1e-3) {
        this.onceDone = true;
        this.start(this.fallback, false, 1, 0.3, false);
      }
    }
    this.mixer.update(dt);
    const a = THREE.MathUtils.clamp(relYaw, -1.6, 1.6);
    this.smoothYaw = a;
    if (Math.abs(a) > 1e-3) {
      this.twist(this.chest, a * 0.12);
      this.twist(this.neck, a * 0.38);
      this.twist(this.head, a * 0.5);
    }
    this.root.updateMatrixWorld(true);
  }

  private twist(bone: THREE.Object3D | null, ang: number): void {
    if (!bone) return;
    bone.quaternion.multiply(_q.setFromAxisAngle(YAW_AXIS, ang));
  }

  /** World position + orientation of the right palm (phone / note anchor). */
  handAnchor(pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    if (!this.handR) return false;
    pos.copy(this.handR.localToWorld(_v.set(0.02, -0.09, 0)));
    this.handR.getWorldQuaternion(quat);
    return true;
  }

  get headYawApplied(): number {
    return this.smoothYaw;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}

/** Build a character if the library is ready; null otherwise (caller keeps the capsule). */
export function createCharacter(spec: CharacterSpec): Character | null {
  return library ? new Character(library, spec) : null;
}
