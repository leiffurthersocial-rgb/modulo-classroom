// Furniture library: loads the Blender-made models (tools/blender/furniture.py) from ONE GLB with a
// top-level node per item and hands out clones / instanced parts to the greybox builder.
// Original models made for this project. Materials named `pbr:<slot>[:label]` are tagged
// (material.userData.pbr = slot) so PbrLibrary swaps them for triplanar PBR materials, exactly like
// the primitive greybox materials. Everything else keeps its own colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const FURNITURE_URL = `${import.meta.env.BASE_URL}models/furniture/classroom-furniture.glb`;

/** Item node names in the GLB (see the header of tools/blender/furniture.py). */
export type FurnitureItem =
  | 'chair'
  | 'table'
  | 'desk'
  | 'doccam'
  | 'laptop'
  | 'projector'
  | 'whiteboard'
  | 'clock'
  | 'door'
  | 'window'
  | 'radiator'
  | 'sink'
  | 'bin'
  | 'pinboard'
  | 'poster'
  | 'sharpener'
  | 'backpack';

/** One renderable part of an item: geometry + material + transform relative to the item origin. */
export interface FurniturePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

export class FurnitureLib {
  private items = new Map<string, THREE.Object3D>();
  private variants = new Map<string, THREE.Material>();

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    for (const child of root.children) this.items.set(child.name, child);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        // 'pbr:metal:chrome' -> slot 'metal'
        if (m.name.startsWith('pbr:')) m.userData.pbr = m.name.split(':')[1];
      }
    });
  }

  has(name: FurnitureItem): boolean {
    return this.items.has(name);
  }

  /**
   * A fresh clone of an item node tree (geometry shared, materials shared unless `recolor` maps a
   * material name to a colour: those get a cached variant). Meshes cast and receive shadows.
   */
  clone(name: FurnitureItem, recolor?: Record<string, number>): THREE.Object3D {
    const src = this.items.get(name);
    if (!src) throw new Error(`furniture item missing: ${name}`);
    const out = src.clone(true);
    out.position.set(0, 0, 0);
    out.rotation.set(0, 0, 0);
    out.scale.set(1, 1, 1);
    out.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      const m = mesh.material as THREE.Material;
      const col = recolor?.[m.name];
      if (col !== undefined) mesh.material = this.variant(m, col);
    });
    return out;
  }

  /** The parts of an item for instancing (item root transform removed). */
  parts(name: FurnitureItem): FurniturePart[] {
    const src = this.items.get(name);
    if (!src) throw new Error(`furniture item missing: ${name}`);
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const out: FurniturePart[] = [];
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      out.push({
        geometry: mesh.geometry,
        material: mesh.material as THREE.Material,
        matrix: new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld),
      });
    });
    return out;
  }

  /** Instanced copy of an item: one InstancedMesh per part, one instance per transform. */
  instanced(name: FurnitureItem, transforms: THREE.Matrix4[]): THREE.InstancedMesh[] {
    const m = new THREE.Matrix4();
    return this.parts(name).map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, transforms.length);
      transforms.forEach((t, i) => im.setMatrixAt(i, m.multiplyMatrices(t, p.matrix)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im.receiveShadow = true;
      im.name = `${name}:${p.material.name}`;
      return im;
    });
  }

  private variant(m: THREE.Material, color: number): THREE.Material {
    const key = `${m.uuid}:${color}`;
    let v = this.variants.get(key);
    if (!v) {
      v = m.clone();
      (v as THREE.MeshStandardMaterial).color.setHex(color);
      this.variants.set(key, v);
    }
    return v;
  }
}

let current: FurnitureLib | null = null;

/** Set once by main.ts before the app boots; `buildGreybox` reads it when not passed a library. */
export function setFurniture(lib: FurnitureLib | null): void {
  current = lib;
}
export function getFurniture(): FurnitureLib | null {
  return current;
}

/** Loads the furniture GLB. Null (-> box primitives) on ?models=0 or any failure. */
export async function loadFurniture(): Promise<FurnitureLib | null> {
  try {
    if (new URLSearchParams(location.search).get('models') === '0') return null;
    const gltf = await new GLTFLoader().loadAsync(FURNITURE_URL);
    const lib = new FurnitureLib(gltf.scene);
    return lib.has('chair') && lib.has('table') ? lib : null;
  } catch (e) {
    console.warn('furniture models unavailable, using primitives', e);
    return null;
  }
}
