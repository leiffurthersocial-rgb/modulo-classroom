// PBR library: swaps tagged greybox materials (material.userData.pbr = '<slot>') for world-space
// triplanar PBR materials once the pack is loaded, adds the overcast HDRI for reflections and
// places decor models. The greybox colours stay as the fallback: with ?pbr=0, without a pack, or
// while textures stream in, the room renders exactly as before.
import * as THREE from 'three';
import config from '../../config/materials.json';
import {
  AssetLoader,
  assetUrl,
  EMPTY_MANIFEST,
  loadPackManifest,
  type PackManifest,
  type Tier,
} from './AssetLoader';
import { removeDecor } from '../render/decor';
import { createTriplanarMaterial, type TriplanarOptions } from './triplanar';

export interface SlotConfig {
  source: string;
  id: string;
  label?: string;
  scale: number;
  tint?: string;
  brightness?: number;
  roughness?: number;
  metalness?: number;
  metalBias?: number;
  normalScale?: number;
}
export interface MaterialsConfig {
  materials: Record<string, SlotConfig>;
  hdris: Record<string, { source: string; id: string; intensity?: number }>;
  models: Record<string, { source: string; id: string; maxTriangles?: number; label?: string }>;
}
export const MATERIALS_CONFIG = config as unknown as MaterialsConfig;

/** Lab picks stored by /lab in localStorage, tried in the classroom with ?lab=1. */
export const LAB_PICKS_KEY = 'modulo-classroom:lab-picks:v1';
export interface LabPicks {
  materials: Record<string, { source: string; id: string }>;
  hdris: Record<string, { source: string; id: string }>;
}
export interface LabManifest {
  materials: Record<
    string,
    {
      candidates: {
        source: string;
        id: string;
        maps: { color: string; normal: string; arm: string };
      }[];
    }
  >;
}

export function readLabPicks(): LabPicks | null {
  try {
    const raw = localStorage.getItem(LAB_PICKS_KEY);
    return raw ? (JSON.parse(raw) as LabPicks) : null;
  } catch {
    return null;
  }
}

const GREYBOX = 'greyboxMaterial';

export class PbrLibrary {
  private loader: AssetLoader | null = null;
  private manifest: PackManifest = EMPTY_MANIFEST;
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private env: THREE.Texture | null = null;
  private envIntensity = 0.45;
  private models = new Map<string, THREE.Object3D>();
  private roots = new Map<
    THREE.Object3D,
    { scene: THREE.Scene; decorate?: (root: THREE.Object3D) => void }
  >();
  private tier: Tier | null = null;
  private loading: Promise<void> = Promise.resolve();
  /** True once the current tier finished loading (or failed): screenshot mode waits for it. */
  settled = true;
  /** Slots that got a PBR material (for __info and tests). */
  readonly loaded = new Set<string>();
  bytes = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly enabled: boolean,
    private lab: boolean,
  ) {}

  get ready(): Promise<void> {
    return this.loading;
  }

  /** Load (or reload) everything at a texture tier. Safe to call repeatedly. */
  setTier(tier: Tier): Promise<void> {
    if (!this.enabled || tier === this.tier) return this.loading;
    this.tier = tier;
    this.settled = false;
    this.loading = this.load(tier)
      .catch((e: unknown) => console.warn('PBR assets unavailable, keeping greybox:', e))
      .finally(() => {
        if (this.tier === tier) this.settled = true;
      });
    return this.loading;
  }

  private async load(tier: Tier): Promise<void> {
    const manifest = (await loadPackManifest()) ?? EMPTY_MANIFEST;
    this.manifest = manifest;
    this.loader ??= new AssetLoader(this.renderer, manifest);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const labPicks = this.lab ? readLabPicks() : null;
    const labManifest = labPicks
      ? ((await fetch(assetUrl('lab/manifest.json'))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)) as LabManifest | null)
      : null;
    const next = new Map<string, THREE.MeshStandardMaterial>();
    await Promise.all(
      Object.entries(MATERIALS_CONFIG.materials).map(async ([slot, cfg]) => {
        let maps = null;
        const lp = labPicks?.materials[slot];
        const cand = lp
          ? labManifest?.materials[slot]?.candidates.find(
              (c) => c.source === lp.source && c.id === lp.id,
            )
          : undefined;
        if (cand) maps = await this.loader!.maps(cand.maps, aniso);
        else maps = await this.loader!.material(slot, tier, aniso);
        if (!maps) return;
        const opts: TriplanarOptions = { scale: cfg.scale };
        if (cfg.tint) opts.tint = cfg.tint;
        if (cfg.brightness !== undefined) opts.brightness = cfg.brightness;
        if (cfg.roughness !== undefined) opts.roughness = cfg.roughness;
        if (cfg.metalness !== undefined) opts.metalness = cfg.metalness;
        if (cfg.metalBias !== undefined) opts.metalBias = cfg.metalBias;
        if (cfg.normalScale !== undefined) opts.normalScale = cfg.normalScale;
        next.set(slot, this.loader!.own(createTriplanarMaterial(slot, maps, opts)));
      }),
    );
    if (this.tier !== tier) return; // superseded by a newer tier request
    for (const m of this.mats.values()) m.dispose();
    this.mats = next;
    this.loaded.clear();
    for (const k of next.keys()) this.loaded.add(k);
    if (!this.env) {
      const key = Object.keys(manifest.hdris)[0];
      const hdr = key ? await this.loader.hdri(key) : null;
      if (hdr) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.env = this.loader.own(pmrem.fromEquirectangular(hdr).texture);
        pmrem.dispose();
        hdr.dispose();
        this.envIntensity = MATERIALS_CONFIG.hdris[key!]?.intensity ?? this.envIntensity;
      }
    }
    if (this.models.size === 0) {
      for (const key of Object.keys(manifest.models)) {
        try {
          const g = await this.loader.model(key);
          if (g) {
            g.scene.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
            });
            this.models.set(key, g.scene);
          }
        } catch (e) {
          console.warn(`model ${key} failed`, e);
        }
      }
    }
    this.bytes = this.loader.bytesLoaded;
    for (const [r, a] of this.roots) this.refresh(r, a.scene, a.decorate);
  }

  /** A clone of a decor model (shares geometry/materials; do not dispose), or null. */
  model(key: string): THREE.Object3D | null {
    return this.models.get(key)?.clone(true) ?? null;
  }

  /** Swap tagged materials under `root` now and whenever a new tier finishes loading. */
  attach(
    root: THREE.Object3D,
    scene: THREE.Scene,
    decorate?: (root: THREE.Object3D) => void,
  ): void {
    this.roots.set(root, { scene, decorate });
    this.refresh(root, scene, decorate);
  }

  private refresh(
    root: THREE.Object3D,
    scene: THREE.Scene,
    decorate?: (root: THREE.Object3D) => void,
  ): void {
    this.swap(root);
    this.applyEnv(scene);
    if (decorate && this.models.size > 0 && !root.getObjectByName('decor')) decorate(root);
  }

  /** Put the greybox materials back (call before disposing the room). */
  detach(root: THREE.Object3D, scene: THREE.Scene): void {
    this.roots.delete(root);
    removeDecor(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const orig = mesh.userData?.[GREYBOX] as THREE.Material | undefined;
      if (orig) {
        mesh.material = orig;
        delete mesh.userData[GREYBOX];
      }
    });
    scene.environment = null;
  }

  private swap(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const orig = (mesh.userData[GREYBOX] as THREE.Material | undefined) ?? mesh.material;
      const slot = orig.userData?.pbr as string | undefined;
      const pbr = slot ? this.mats.get(slot) : undefined;
      if (!pbr) return;
      mesh.userData[GREYBOX] = orig;
      mesh.material = pbr;
    });
  }

  private applyEnv(scene: THREE.Scene): void {
    if (!this.env) return;
    scene.environment = this.env;
    scene.environmentIntensity = this.envIntensity;
  }

  dispose(): void {
    for (const [r, a] of [...this.roots]) this.detach(r, a.scene);
    this.loader?.dispose();
    this.mats.clear();
    this.models.clear();
  }
}
