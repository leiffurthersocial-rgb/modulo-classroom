// Runtime asset loading (ported from modulo-places, trimmed for Classroom): reads
// /pack/manifest.json (written by scripts/process-assets.ts), loads KTX2 material tiers, meshopt
// GLBs and HDRIs, and disposes everything it created on dispose(). Plain image URLs (lab previews)
// load through TextureLoader so /lab picks can be tried in the classroom before processing.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { PbrMaps } from './triplanar';

export type Tier = 512 | 1024 | 2048;
export const TIERS: readonly Tier[] = [512, 1024, 2048];

export interface MaterialTier {
  color: string;
  normal: string;
  arm: string;
  bytes: number;
}

export interface PackManifest {
  version: 1;
  materials: Record<
    string,
    { source: string; id: string; tiers: Partial<Record<Tier, MaterialTier>> }
  >;
  models: Record<
    string,
    { source: string; id: string; file: string; bytes: number; triangles: number; height: number }
  >;
  hdris: Record<string, { source: string; id: string; file: string; bytes: number }>;
}

/** Resolve a site-absolute path ('/pack/…') against the deploy base (e.g. GitHub Pages sub-path). */
export function assetUrl(path: string): string {
  if (/^[a-z]+:/i.test(path)) return path;
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

export const EMPTY_MANIFEST: PackManifest = { version: 1, materials: {}, models: {}, hdris: {} };

let manifestPromise: Promise<PackManifest | null> | null = null;
export function loadPackManifest(): Promise<PackManifest | null> {
  manifestPromise ??= fetch(assetUrl('pack/manifest.json'))
    .then((r) => (r.ok ? (r.json() as Promise<PackManifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

/** Highest available tier ≤ wanted (falls back to the lowest available). Pure, unit-tested. */
export function pickTier(available: readonly number[], wanted: Tier): Tier | null {
  const tiers = [...available].sort((a, b) => a - b) as Tier[];
  if (tiers.length === 0) return null;
  return [...tiers].reverse().find((t) => t <= wanted) ?? tiers[0]!;
}

export class AssetLoader {
  private ktx2: KTX2Loader;
  private gltf: GLTFLoader;
  private hdr = new HDRLoader();
  private img = new THREE.TextureLoader().setCrossOrigin('anonymous');
  private textures = new Map<string, Promise<THREE.Texture>>();
  private owned = new Set<THREE.Texture | THREE.BufferGeometry | THREE.Material>();
  bytesLoaded = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly manifest: PackManifest,
  ) {
    this.ktx2 = new KTX2Loader()
      .setTranscoderPath(assetUrl('vendor/basis/'))
      .detectSupport(renderer);
    this.ktx2.setWorkerLimit(2);
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  texture(url: string, srgb: boolean, anisotropy: number): Promise<THREE.Texture> {
    const k = `${url}|${srgb}`;
    let p = this.textures.get(k);
    if (!p) {
      const abs = assetUrl(url);
      const load = url.endsWith('.ktx2') ? this.ktx2.loadAsync(abs) : this.img.loadAsync(abs);
      p = load.then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = anisotropy;
        t.needsUpdate = true;
        this.owned.add(t);
        return t;
      });
      this.textures.set(k, p);
    }
    return p;
  }

  async maps(
    m: { color: string; normal: string; arm: string },
    anisotropy: number,
  ): Promise<PbrMaps> {
    const [map, normalMap, armMap] = await Promise.all([
      this.texture(m.color, true, anisotropy),
      this.texture(m.normal, false, anisotropy),
      this.texture(m.arm, false, anisotropy),
    ]);
    return { map, normalMap, armMap };
  }

  async material(key: string, tier: Tier, anisotropy: number): Promise<PbrMaps | null> {
    const entry = this.manifest.materials[key];
    const t = entry ? pickTier(Object.keys(entry.tiers).map(Number), tier) : null;
    const files = t ? entry?.tiers[t] : undefined;
    if (!files) return null;
    const maps = await this.maps(files, anisotropy);
    this.bytesLoaded += files.bytes;
    return maps;
  }

  async model(key: string): Promise<GLTF | null> {
    const m = this.manifest.models[key];
    if (!m) return null;
    const g = await this.gltf.loadAsync(assetUrl(m.file));
    this.bytesLoaded += m.bytes;
    g.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.owned.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        this.owned.add(mat);
        for (const v of Object.values(mat))
          if ((v as THREE.Texture)?.isTexture) this.owned.add(v as THREE.Texture);
      }
    });
    return g;
  }

  async hdri(key: string): Promise<THREE.DataTexture | null> {
    const h = this.manifest.hdris[key];
    if (!h) return null;
    const t = await this.hdr.loadAsync(assetUrl(h.file));
    t.mapping = THREE.EquirectangularReflectionMapping;
    this.owned.add(t);
    this.bytesLoaded += h.bytes;
    return t;
  }

  /** Take ownership of something derived from loaded assets (e.g. created materials). */
  own<T extends THREE.Texture | THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.owned.add(x);
    return x;
  }

  dispose(): void {
    for (const x of this.owned) x.dispose();
    this.owned.clear();
    this.textures.clear();
    this.ktx2.dispose();
  }
}
