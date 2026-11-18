// Visual-only decor from CC0 models (plants, books, backpacks, bin). No sim effect: nothing here
// blocks sight, sound or paths. Placement is fixed per layout (deterministic, no RNG).
// Models are optional: a missing model leaves the greybox as it is.
import * as THREE from 'three';
import { facingDir, type RoomLayout } from '../sim/layout';

export interface DecorSource {
  model(key: string): THREE.Object3D | null;
}

interface Spot {
  key: string;
  pos: [number, number, number];
  rotY: number;
  /** Target height in metres; the model is rescaled only if it is far off (bad source units). */
  height: number;
  /** Greybox object this replaces (hidden while the model is shown). */
  replaces?: string;
}

/** Decor spots for a layout. Pure (unit-tested). */
export function decorSpots(layout: RoomLayout): Spot[] {
  const [W, , D] = layout.room.size;
  const spots: Spot[] = [];
  // Plants: back-right corner on the floor, and one on the window sill box near the front.
  spots.push({ key: 'plant', pos: [W - 0.45, 0, D - 0.45], rotY: 0.6, height: 1.0 });
  spots.push({ key: 'plant-small', pos: [W - 0.3, 0.86, 0.75], rotY: 1.2, height: 0.35 });
  // Books: a stack on the teacher's desk and on a few student tables.
  const desk = layout.props.find((p) => p.kind === 'standing-desk');
  if (desk) {
    const h = desk.size?.[1] ?? 1.05;
    spots.push({
      key: 'books',
      pos: [desk.pos[0] - 0.05, h + 0.015, desk.pos[1] + 0.2],
      rotY: 0.3,
      height: 0.25,
    });
    spots.push({
      key: 'stationery',
      pos: [desk.pos[0] + 0.38, h + 0.015, desk.pos[1] - 0.18],
      rotY: -0.5,
      height: 0.15,
    });
  }
  const seats = layout.seats.filter((s) => s.id !== layout.playerSeat && !s.id.includes('front'));
  seats.forEach((s, i) => {
    const f = facingDir(s.facing);
    // Facing points from the chair toward its table; side = facing rotated by 90°.
    const side: [number, number] = [-f[1], f[0]];
    if (i % 4 === 1)
      spots.push({
        key: 'notebook',
        pos: [
          s.pos[0] + f[0] * 0.55 + side[0] * 0.25,
          0.735,
          s.pos[1] + f[1] * 0.55 + side[1] * 0.25,
        ],
        rotY: (s.facing * Math.PI) / 180 + 0.4 * (i % 2 ? 1 : -1),
        height: 0.04,
      });
    if (i % 2 === 0)
      spots.push({
        key: 'backpack',
        pos: [s.pos[0] - f[0] * 0.15 + side[0] * 0.42, 0, s.pos[1] - f[1] * 0.15 + side[1] * 0.42],
        rotY: (s.facing * Math.PI) / 180 + Math.PI / 2,
        height: 0.45,
      });
  });
  const bin = layout.props.find((p) => p.kind === 'bin');
  if (bin)
    spots.push({
      key: 'bin',
      pos: [bin.pos[0], 0, bin.pos[1]],
      rotY: 0,
      height: 0.42,
      replaces: bin.id,
    });
  return spots;
}

const box = new THREE.Box3();
const size = new THREE.Vector3();

/** Adds a 'decor' group to `root`. Returns it (detach removes it and re-shows replaced objects). */
export function placeDecor(
  root: THREE.Object3D,
  layout: RoomLayout,
  src: DecorSource,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'decor';
  const hidden: THREE.Object3D[] = [];
  for (const s of decorSpots(layout)) {
    // 'plant-small' falls back to the main plant model.
    const m = src.model(s.key) ?? (s.key === 'plant-small' ? src.model('plant') : null);
    if (!m) continue;
    box.setFromObject(m).getSize(size);
    if (size.y > 0) {
      const k = s.height / size.y;
      if (s.key === 'plant-small' || k < 0.5 || k > 2) m.scale.multiplyScalar(k);
    }
    box.setFromObject(m);
    m.position.set(s.pos[0], s.pos[1] - box.min.y, s.pos[2]);
    m.rotation.y = s.rotY;
    m.name = `decor:${s.key}`;
    g.add(m);
    if (s.replaces) {
      const o = root.getObjectByName(s.replaces);
      if (o) {
        o.visible = false;
        hidden.push(o);
      }
    }
  }
  g.userData.hidden = hidden;
  root.add(g);
  return g;
}

export function removeDecor(root: THREE.Object3D): void {
  const g = root.getObjectByName('decor');
  if (!g) return;
  for (const o of (g.userData.hidden as THREE.Object3D[] | undefined) ?? []) o.visible = true;
  root.remove(g);
}
