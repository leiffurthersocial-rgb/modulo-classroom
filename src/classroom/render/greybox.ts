// Greybox room builder: turns a RoomLayout into flat-coloured primitives. No downloaded assets.
// Instanced where things repeat (tables, chair parts, ceiling slats) so draw calls stay low.
// When a FurnitureLib is available (render/furniture.ts: Blender-made models) the furniture, wall
// fixtures, door and window frames come from it instead of boxes; the box path below stays as the
// fallback (?models=0 or a failed load). Names the scene looks up are identical on both paths.
import * as THREE from 'three';
import {
  facingDir,
  type Fixture,
  type Prop,
  type RoomLayout,
  type Vec2,
  wallFrame,
} from '../sim/layout';
import { type FurnitureItem, type FurnitureLib, getFurniture } from './furniture';
import { createPoster } from './posters';
import { createWindowGlassMaterial } from './windows';

export const GREYBOX_COLORS = {
  carpet: 0x4a3a2e,
  concrete: 0xa9a6a0,
  plaster: 0xd9d6cf,
  ceiling: 0xb48a5a,
  ceilingGap: 0x2b2622,
  table: 0xe9e7e2,
  chrome: 0x8c9196,
  plywood: 0xc89a5c,
  board: 0xf4f6f6,
  boardFrame: 0x9aa0a6,
  pinboard: 0xe8d77a,
  poster: [0xc75b4a, 0x5b8fc7, 0x6fb06a, 0xd9a441],
  door: 0x8e3b2a,
  window: 0xcfe3f2,
  radiator: 0xd8d8d4,
  desk: 0x2b2d30,
  device: 0x3a3d42,
  tile: 0xd9c9a3,
} as const;

/** PBR slots (src/config/materials.json). A tagged material is swapped for a triplanar PBR one. */
export type PbrSlot =
  'concrete' | 'plaster' | 'carpet' | 'ceiling' | 'table' | 'plywood' | 'metal' | 'tile' | 'door';

function mat(
  color: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
  pbr?: PbrSlot,
) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
  if (pbr) m.userData.pbr = pbr;
  return m;
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** World position of a wall-mounted thing: along-wall coordinate + height + inset from the wall. */
function onWall(
  layout: RoomLayout,
  wall: Parameters<typeof wallFrame>[0],
  along: number,
  y: number,
  inset: number,
) {
  const f = wallFrame(wall, layout.room.size);
  const x = f.origin[0] + f.dir[0] * along + f.normal[0] * inset;
  const z = f.origin[1] + f.dir[1] * along + f.normal[1] * inset;
  const rotY = Math.atan2(f.normal[0], f.normal[1]); // face into the room
  return { pos: new THREE.Vector3(x, y, z), rotY };
}

export interface GreyboxRoom {
  root: THREE.Group;
  /** Meshes that block sight (for debug and, later, mirrored as sim occluders). */
  occluders: THREE.Object3D[];
  dispose(): void;
}

/** A positioned wall fixture from the model library, or null to use the primitive. */
function fixtureModel(
  fl: FurnitureLib,
  fx: Fixture,
): { obj: THREE.Object3D; floor?: boolean } | null {
  const [fw, fh] = fx.size;
  let obj: THREE.Object3D;
  switch (fx.kind) {
    case 'whiteboard':
      obj = fl.clone('whiteboard');
      obj.scale.set(fw / 3.6, fh / 1.2, 1);
      break;
    case 'clock':
      obj = fl.clone('clock');
      obj.scale.setScalar(fw / 0.32);
      break;
    case 'radiator':
      obj = fl.clone('radiator'); // origin on the floor, centred along the wall
      return { obj, floor: true };
    case 'sink':
      obj = fl.clone('sink');
      break;
    case 'sharpener':
      obj = fl.clone('sharpener');
      obj.scale.setScalar(fw / 0.12);
      break;
    case 'pinboard':
      obj = fl.clone('pinboard');
      obj.scale.set(fw / 2.2, fh / 1.2, 1);
      break;
    case 'poster':
      return null; // framed procedural art (render/posters.ts) beats the blank frame model
    default:
      return null;
  }
  return { obj };
}

/** A prop from the model library (origin conventions: tools/blender/furniture.py), or null. */
function propModel(fl: FurnitureLib, layout: RoomLayout, p: Prop): THREE.Object3D | null {
  switch (p.kind) {
    case 'standing-desk': {
      const [w, , d] = p.size ?? [1, 1.05, 0.6];
      const g = fl.clone('desk');
      g.scale.set(w / 1.0, 1, d / 0.6);
      return g;
    }
    case 'document-camera':
    case 'laptop': {
      const g = fl.clone(p.kind === 'laptop' ? 'laptop' : 'doccam');
      // Sits on the desk surface (desk height + half the 3 cm top).
      const desk = layout.props.find((x) => x.id === p.on);
      g.position.y = (desk?.size?.[1] ?? 1.05) + 0.015;
      return g;
    }
    case 'ceiling-projector': {
      const g = fl.clone('projector');
      g.position.y = p.height ?? 2.55;
      return g;
    }
    case 'bin':
      return fl.clone('bin');
    default:
      return null;
  }
}

/** Backpack colours (fabric); the same few repeat around the room. */
const BACKPACK_COLORS = [0x3c6e9e, 0xb04a3c, 0x3f7d57, 0x6a5aa0, 0x2d3237];

export function buildGreybox(layout: RoomLayout, furniture?: FurnitureLib | null): GreyboxRoom {
  const fl = furniture === undefined ? getFurniture() : furniture;
  const root = new THREE.Group();
  root.name = `room:${layout.room.id}`;
  const occluders: THREE.Object3D[] = [];
  const [W, H, D] = layout.room.size;
  const C = GREYBOX_COLORS;

  // --- Shell -------------------------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    mat(C.carpet, { roughness: 1 }, 'carpet'),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, D / 2);
  floor.receiveShadow = true;
  root.add(floor);

  // Painted walls (white plaster in the reference photos); exposed concrete only on the column,
  // the ceiling beam and the window wall with its deep reveals.
  const wallMat = mat(C.plaster, { roughness: 0.95 }, 'plaster');
  const concreteMat = mat(C.concrete, { roughness: 0.95 }, 'concrete');
  const T = 0.2; // wall thickness (outside the room volume)
  // Front, back, left: solid. Right (window) wall: built around the window openings.
  const front = box(W + 2 * T, H, T, wallMat);
  front.position.set(W / 2, H / 2, -T / 2);
  const back = box(W + 2 * T, H, T, wallMat);
  back.position.set(W / 2, H / 2, D + T / 2);
  const left = box(T, H, D, wallMat);
  left.position.set(-T / 2, H / 2, D / 2);
  root.add(front, back, left);
  occluders.push(front, back, left);

  const windows = layout.openings.filter((o) => o.kind === 'window' && o.wall === 'right');
  windows.sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  const rightX = W + T / 2;
  const addRight = (z0: number, z1: number, y0: number, y1: number) => {
    if (z1 - z0 < 1e-3 || y1 - y0 < 1e-3) return;
    const m = box(T, y1 - y0, z1 - z0, concreteMat);
    m.position.set(rightX, (y0 + y1) / 2, (z0 + z1) / 2);
    root.add(m);
    occluders.push(m);
  };
  const glassMat = createWindowGlassMaterial(); // procedural outdoor view (render/windows.ts)
  for (const win of windows) {
    const sill = win.sill ?? 0.9;
    addRight(cursor, win.offset, 0, H);
    addRight(win.offset, win.offset + win.width, 0, sill);
    addRight(win.offset, win.offset + win.width, sill + win.height, H);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.width, win.height), glassMat);
    glass.position.set(W + T * 0.6, sill + win.height / 2, win.offset + win.width / 2);
    glass.rotation.y = -Math.PI / 2;
    root.add(glass);
    if (fl) {
      // Frame, sashes and handles sit in the reveal on the glass plane.
      const wm = fl.clone('window');
      const p = onWall(layout, win.wall, win.offset + win.width / 2, sill + win.height / 2, -0.12);
      wm.position.copy(p.pos);
      wm.rotation.y = p.rotY;
      wm.scale.set(win.width / 2.7, win.height / 1.75, 1);
      wm.name = `${win.id}:frame`;
      root.add(wm);
    }
    cursor = win.offset + win.width;
  }
  addRight(cursor, D, 0, H);

  // Ceiling: dark backing plane + instanced wood slats (the slatted look from the reference).
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(C.ceilingGap));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(W / 2, H + 0.04, D / 2);
  root.add(ceil);
  const slatPitch = 0.1;
  const slatCount = Math.floor(D / slatPitch);
  const slats = new THREE.InstancedMesh(
    new THREE.BoxGeometry(W, 0.03, 0.07),
    mat(C.ceiling, {}, 'ceiling'),
    slatCount,
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < slatCount; i++) {
    slats.setMatrixAt(i, m4.makeTranslation(W / 2, H + 0.01, slatPitch * (i + 0.5)));
  }
  root.add(slats);
  // Exposed concrete beam across the ceiling (as in the reference).
  const beam = box(W, 0.35, 0.4, concreteMat);
  beam.position.set(W / 2, H - 0.175, D * 0.42);
  root.add(beam);

  // --- Columns -----------------------------------------------------------------------------
  for (const c of layout.columns) {
    const col = box(c.size[0], H, c.size[1], concreteMat);
    col.position.set(c.center[0], H / 2, c.center[1]);
    root.add(col);
    occluders.push(col);
  }

  // --- Openings: door ----------------------------------------------------------------------
  for (const o of layout.openings.filter((x) => x.kind === 'door')) {
    if (fl) {
      // Model door: origin = hinge edge on the floor, leaf grows toward local +x. Put the hinge on
      // whichever end of the opening makes +x run along the opening.
      const f = wallFrame(o.wall, layout.room.size);
      const rotY = Math.atan2(f.normal[0], f.normal[1]);
      const hingeAtStart = Math.cos(rotY) * f.dir[0] - Math.sin(rotY) * f.dir[1] > 0;
      const p = onWall(layout, o.wall, hingeAtStart ? o.offset : o.offset + o.width, 0, 0);
      const pivot = fl.clone('door');
      pivot.position.copy(p.pos);
      pivot.rotation.y = p.rotY;
      pivot.scale.set(o.width / 1.0, o.height / 2.1, 1);
      pivot.name = o.id;
      root.add(pivot);
      continue;
    }
    // Door leaf on a hinge pivot (scene code swings it open).
    const p = onWall(layout, o.wall, o.offset, o.height / 2, 0.03);
    const pivot = new THREE.Group();
    pivot.position.copy(p.pos);
    pivot.rotation.y = p.rotY;
    const door = box(o.width, o.height, 0.05, mat(C.door, { roughness: 0.6 }, 'door'));
    door.position.x = o.width / 2;
    const handle = box(
      0.12,
      0.03,
      0.06,
      mat(C.chrome, { metalness: 0.9, roughness: 0.3 }, 'metal'),
    );
    handle.position.set(o.width - 0.12, -0.05, 0.05);
    const leaf = new THREE.Group();
    leaf.name = 'leaf';
    leaf.add(door, handle);
    pivot.add(leaf);
    pivot.name = o.id;
    root.add(pivot);
  }

  // --- Wall fixtures -----------------------------------------------------------------------
  let posterIdx = 0;
  for (const fx of layout.fixtures) {
    const [along, cy] = fx.center;
    const [fw, fh] = fx.size;
    const model = fl ? fixtureModel(fl, fx) : null;
    if (model) {
      if (fx.kind === 'poster') posterIdx++;
      const p = onWall(layout, fx.wall, along, model.floor ? 0 : cy, 0);
      model.obj.position.copy(p.pos);
      model.obj.rotation.y = p.rotY;
      model.obj.name = fx.id;
      root.add(model.obj);
      continue;
    }
    let mesh: THREE.Object3D;
    let inset = 0.02;
    switch (fx.kind) {
      case 'whiteboard': {
        const g = new THREE.Group();
        const frame = box(
          fw + 0.06,
          fh + 0.06,
          0.02,
          mat(C.boardFrame, { metalness: 0.6, roughness: 0.4 }, 'metal'),
        );
        const face = box(fw, fh, 0.025, mat(C.board, { roughness: 0.3 }));
        const tray = box(fw * 0.8, 0.03, 0.08, mat(C.boardFrame));
        tray.position.set(0, -fh / 2 - 0.04, 0.04);
        g.add(frame, face, tray);
        mesh = g;
        break;
      }
      case 'clock': {
        const g = new THREE.Group();
        const rim = new THREE.Mesh(
          new THREE.CylinderGeometry(fw / 2, fw / 2, 0.04, 32),
          mat(0xbfc3c7, { metalness: 0.7, roughness: 0.3 }),
        );
        rim.rotation.x = Math.PI / 2;
        const face = new THREE.Mesh(new THREE.CircleGeometry(fw / 2 - 0.02, 32), mat(0xffffff));
        face.position.z = 0.021;
        const hm = mat(0x222222);
        const hh = box(0.012, fw * 0.24, 0.006, hm);
        hh.geometry.translate(0, fw * 0.12, 0);
        hh.position.z = 0.03;
        hh.name = 'hand-h';
        const mh = box(0.008, fw * 0.36, 0.006, hm);
        mh.geometry.translate(0, fw * 0.18, 0);
        mh.position.z = 0.034;
        mh.name = 'hand-m';
        g.add(rim, face, hh, mh);
        mesh = g;
        break;
      }
      case 'radiator': {
        mesh = box(fw, fh, 0.12, mat(C.radiator, { metalness: 0.4, roughness: 0.5 }, 'metal'));
        inset = 0.07;
        break;
      }
      case 'sink': {
        const g = new THREE.Group();
        const tiles = box(1.4, 1.2, 0.02, mat(C.tile, { roughness: 0.4 }, 'tile'));
        tiles.position.y = 0.45;
        const basin = box(fw, 0.18, fh, mat(0xf2f2f2, { roughness: 0.2 }));
        basin.position.z = fh / 2;
        g.add(tiles, basin);
        mesh = g;
        break;
      }
      case 'sharpener':
        mesh = box(fw, fh, 0.12, mat(0x3a5f9e, { roughness: 0.5 }));
        inset = 0.06;
        break;
      case 'pinboard':
        mesh = box(fw, fh, 0.02, mat(C.pinboard));
        break;
      case 'poster':
        mesh = createPoster(fw, fh, posterIdx++); // framed procedural art (render/posters.ts)
        break;
      default:
        mesh = box(fw, fh, 0.02, mat(0x888888));
    }
    const p = onWall(layout, fx.wall, along, cy, inset);
    mesh.position.copy(p.pos);
    mesh.rotation.y = p.rotY;
    mesh.name = fx.id;
    root.add(mesh);
  }

  const chairs = [
    ...layout.seats.map((x) => ({ pos: x.pos, facing: x.facing })),
    ...layout.spareChairs.map((x) => ({ pos: x.pos, facing: x.facing })),
  ];
  if (fl) {
    // --- Tables and chairs from the models: one InstancedMesh per sub-mesh ----------------------
    const m = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const qy = new THREE.Quaternion();
    const tableXf = layout.tables.map((t) => {
      const [len, ht, dep] = t.size; // the model is 1.3 x 0.72 x 0.65
      qy.setFromAxisAngle(yAxis, (t.rot * Math.PI) / 180);
      return new THREE.Matrix4().compose(
        new THREE.Vector3(t.pos[0], 0, t.pos[1]),
        qy.clone(),
        new THREE.Vector3(len / 1.3, ht / 0.72, dep / 0.65),
      );
    });
    const chairXf = chairs.map((c) => {
      qy.setFromAxisAngle(yAxis, (c.facing * Math.PI) / 180);
      return m
        .compose(new THREE.Vector3(c.pos[0], 0, c.pos[1]), qy, new THREE.Vector3(1, 1, 1))
        .clone();
    });
    root.add(...fl.instanced('table', tableXf), ...fl.instanced('chair', chairXf));
  } else {
    // --- Tables (instanced tops + legs) ------------------------------------------------------
    const tTop = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.03, 1),
      mat(C.table, { roughness: 0.5 }, 'table'),
      layout.tables.length,
    );
    const tLeg = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.03, 1, 0.03),
      mat(C.chrome, { metalness: 0.9, roughness: 0.25 }, 'metal'),
      layout.tables.length * 4,
    );
    tTop.castShadow = tTop.receiveShadow = true;
    tLeg.castShadow = true;
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    layout.tables.forEach((t, i) => {
      const [len, ht, dep] = t.size;
      q.setFromAxisAngle(up, (t.rot * Math.PI) / 180);
      tTop.setMatrixAt(i, m4.compose(v.set(t.pos[0], ht - 0.015, t.pos[1]), q, s.set(len, 1, dep)));
      const corners: Vec2[] = [
        [-len / 2 + 0.04, -dep / 2 + 0.04],
        [len / 2 - 0.04, -dep / 2 + 0.04],
        [-len / 2 + 0.04, dep / 2 - 0.04],
        [len / 2 - 0.04, dep / 2 - 0.04],
      ];
      corners.forEach((c, k) => {
        const off = new THREE.Vector3(c[0], 0, c[1]).applyQuaternion(q);
        tLeg.setMatrixAt(
          i * 4 + k,
          m4.compose(
            v.set(t.pos[0] + off.x, (ht - 0.03) / 2, t.pos[1] + off.z),
            q.clone(),
            s.set(1, ht - 0.03, 1),
          ),
        );
      });
    });
    root.add(tTop, tLeg);

    // --- Chairs (seats + spare): plywood shell + chrome column + 5-star base ----------------
    const n = chairs.length;
    const cSeat = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.03, 0.42),
      mat(C.plywood, { roughness: 0.6 }, 'plywood'),
      n,
    );
    const cBack = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.3, 0.025),
      mat(C.plywood, { roughness: 0.6 }, 'plywood'),
      n,
    );
    const cPost = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.42, 10),
      mat(C.chrome, { metalness: 0.9, roughness: 0.25 }, 'metal'),
      n,
    );
    const cBase = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.03, 5),
      mat(C.chrome, { metalness: 0.9, roughness: 0.25 }, 'metal'),
      n,
    );
    for (const im of [cSeat, cBack, cPost, cBase]) im.castShadow = im.receiveShadow = true;
    chairs.forEach((c, i) => {
      const f = facingDir(c.facing);
      q.setFromAxisAngle(up, (c.facing * Math.PI) / 180);
      cSeat.setMatrixAt(i, m4.compose(v.set(c.pos[0], 0.46, c.pos[1]), q, s.set(1, 1, 1)));
      cBack.setMatrixAt(
        i,
        m4.compose(v.set(c.pos[0] - f[0] * 0.2, 0.72, c.pos[1] - f[1] * 0.2), q, s.set(1, 1, 1)),
      );
      cPost.setMatrixAt(i, m4.compose(v.set(c.pos[0], 0.24, c.pos[1]), q, s.set(1, 1, 1)));
      cBase.setMatrixAt(i, m4.compose(v.set(c.pos[0], 0.03, c.pos[1]), q, s.set(1, 1, 1)));
    });
    root.add(cSeat, cBack, cPost, cBase);
  }

  // --- Props -------------------------------------------------------------------------------
  for (const p of layout.props) {
    let mesh: THREE.Object3D | null = fl ? propModel(fl, layout, p) : null;
    if (!mesh)
      switch (p.kind) {
        case 'standing-desk': {
          const [w, h, d] = p.size ?? [1.4, 1.05, 0.7];
          const g = new THREE.Group();
          const top = box(w, 0.03, d, mat(C.table, { roughness: 0.5 }, 'table'));
          top.position.y = h;
          const legA = box(0.08, h, 0.08, mat(C.desk));
          legA.position.set(-w / 2 + 0.15, h / 2, 0);
          const legB = legA.clone();
          legB.position.x = w / 2 - 0.15;
          const cable = box(0.3, 0.12, 0.25, mat(C.desk));
          cable.position.set(0.2, h - 0.1, 0);
          g.add(top, legA, legB, cable);
          mesh = g;
          break;
        }
        case 'document-camera': {
          const g = new THREE.Group();
          const base = box(0.25, 0.03, 0.3, mat(0xe8e8e8));
          const arm = box(0.03, 0.35, 0.03, mat(0xe8e8e8));
          arm.position.set(0, 0.18, -0.1);
          const head = box(0.08, 0.05, 0.18, mat(0xe8e8e8));
          head.name = 'doccam-head';
          head.position.set(0, 0.36, -0.02);
          g.add(base, arm, head);
          g.position.y = 1.07;
          mesh = g;
          break;
        }
        case 'ceiling-projector': {
          const g = new THREE.Group();
          const body = box(0.4, 0.14, 0.32, mat(0xf0f0f0, { roughness: 0.4 }));
          const rod = box(0.04, 0.2, 0.04, mat(C.chrome, { metalness: 0.8 }));
          rod.position.y = 0.17;
          g.add(body, rod);
          g.position.y = p.height ?? 2.55;
          mesh = g;
          break;
        }
        case 'laptop': {
          const g = new THREE.Group();
          const base = box(0.32, 0.02, 0.22, mat(0x2b2d30, { metalness: 0.5, roughness: 0.4 }));
          const lid = box(0.32, 0.21, 0.012, mat(0x2b2d30, { metalness: 0.5, roughness: 0.4 }));
          lid.position.set(0, 0.105, 0.11);
          lid.rotation.x = -0.25;
          g.add(base, lid);
          g.position.y = 1.07;
          mesh = g;
          break;
        }
        case 'bin': {
          const bin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.14, 0.4, 16),
            mat(0x5c6266),
          );
          bin.position.y = 0.2;
          bin.castShadow = true;
          mesh = bin;
          break;
        }
      }
    if (!mesh) continue;
    mesh.position.x = p.pos[0];
    mesh.position.z = p.pos[1];
    mesh.rotation.y = (p.rot * Math.PI) / 180;
    mesh.name = p.id;
    root.add(mesh);
  }

  // Decorative window-wall dressing from the reference photos (no effect on the sim): a two-drawer
  // unit hung under the sill ledge, a storage box under it, a pedestal fan, a tall white cabinet.
  if (fl && ['drawers', 'storagebox', 'fan', 'cabinet'].every((n) => fl.has(n as FurnitureItem))) {
    const W = layout.room.size[0];
    const rotWindow = -Math.PI / 2; // local +z (into the room) -> world -x (window wall on the right)
    const place = (name: FurnitureItem, x: number, z: number, rotY: number) => {
      const o = fl.clone(name);
      o.position.set(x, 0, z);
      o.rotation.y = rotY;
      o.name = `decor-${name}`;
      root.add(o);
    };
    place('drawers', W, 5.8, rotWindow);
    place('storagebox', W - 0.24, 4.45, Math.PI / 2);
    place('fan', W - 0.42, 5.2, Math.PI / 2);
    place('cabinet', 7.6, 0, 0);
  }

  // Original backpacks beside every second seat (the CC0 decor pack fills the others, see decor.ts).
  if (fl) {
    const seats = layout.seats.filter((x) => x.id !== layout.playerSeat && !x.id.includes('front'));
    seats.forEach((x, i) => {
      if (i % 2 !== 1) return;
      const f = facingDir(x.facing);
      const side: Vec2 = [f[1], -f[0]]; // the side decor.ts does not use
      const bp = fl.clone('backpack', {
        bp_fabric: BACKPACK_COLORS[(i >> 1) % BACKPACK_COLORS.length]!,
      });
      bp.position.set(
        x.pos[0] - f[0] * 0.15 + side[0] * 0.42,
        0,
        x.pos[1] - f[1] * 0.15 + side[1] * 0.42,
      );
      bp.rotation.y = (x.facing * Math.PI) / 180 - Math.PI / 2 + 0.25 * ((i % 3) - 1);
      bp.name = `backpack-${x.id}`;
      root.add(bp);
    });
  }

  return {
    root,
    occluders,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm?.dispose();
      });
    },
  };
}
