// Render-only props for the harmless pranks (rubber duck, sticky-note mosaic, cup pyramid, OUT OF
// ORDER sign, dried-out marker, turned chairs, silly clock, upside-down posters, hidden smiley,
// remote in the plant, birds in the bin). Everything is driven by `world.objects`; nothing here
// touches the sim. Simple rounded primitives, shared materials, no downloaded assets.
//
//   const props = createPrankProps(layout, { room: greybox.root });
//   scene.add(props.group);
//   // every frame:  props.update(world, world.t);
//   // on teardown:  props.dispose();
//
// `room` is optional: with the greybox root it can turn the real chair backrests around;
// without it a small ghost backrest is added instead.
import * as THREE from 'three';
import { type RoomLayout, wallFrame, facingDir } from '../sim/layout';
import { projectorInUse } from '../sim/pranks';
import type { World } from '../sim/world';

export interface PrankProps {
  group: THREE.Group;
  update(world: World, t: number): void;
  dispose(): void;
}

export interface PrankPropsOptions {
  /** The greybox room root (to flip the real chair backrests). */
  room?: THREE.Object3D;
}

const POSTER_COLORS = [0xc75b4a, 0x5b8fc7, 0x6fb06a, 0xd9a441];

type Part = { obj: THREE.Object3D; update?: (w: World, t: number) => void };

export function createPrankProps(layout: RoomLayout, opts: PrankPropsOptions = {}): PrankProps {
  const group = new THREE.Group();
  group.name = 'prank-props';
  const parts: Part[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const [W, , D] = layout.room.size;

  const geom = <G extends THREE.BufferGeometry>(g: G): G => (geoms.push(g), g);
  const mat = (color: number, rough = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
    mats.push(m);
    return m;
  };
  const basic = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...extra });
    mats.push(m);
    return m;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = shadow;
    return x;
  };
  const add = (obj: THREE.Object3D, name: string, update?: Part['update']): THREE.Object3D => {
    obj.name = name;
    obj.visible = false;
    group.add(obj);
    parts.push({ obj, update });
    return obj;
  };
  /** Canvas texture, or null where there is no DOM (unit tests). */
  const canvasTex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    if (!c) return null;
    draw(c);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    texs.push(t);
    return t;
  };

  // Layout anchors ----------------------------------------------------------------------------
  const desk = layout.props.find((p) => p.kind === 'standing-desk');
  const deskPos = desk ? { x: desk.pos[0], z: desk.pos[1] } : { x: 1.2, z: 1.0 };
  const deskSize = desk?.size ?? [1.0, 1.05, 0.6];
  const deskTop = deskSize[1] + 0.015;
  const doccam = layout.props.find((p) => p.kind === 'document-camera');
  const projector = layout.props.find((p) => p.kind === 'ceiling-projector');
  const bin = layout.props.find((p) => p.id === 'bin');
  const board = layout.fixtures.find((f) => f.id === 'board');
  const boardX = board?.center[0] ?? 4.5;
  const boardY = board?.center[1] ?? 1.45;
  const boardW = board?.size[0] ?? 3.6;
  const boardH = board?.size[1] ?? 1.2;
  const plant = { x: W - 0.45, z: D - 0.45 };

  // 1. Remote (on the desk; in the plant while hidden) ---------------------------------------
  {
    const g = new THREE.Group();
    const body = mesh(geom(new THREE.BoxGeometry(0.05, 0.016, 0.17)), mat(0x2b2d30, 0.5));
    g.add(body);
    for (let i = 0; i < 6; i++) {
      const b = mesh(
        geom(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 8)),
        mat(i === 0 ? 0xc23b30 : 0x9aa0a6, 0.4),
        false,
      );
      b.position.set(i % 2 ? 0.011 : -0.011, 0.01, -0.06 + Math.floor(i / 2) * 0.04);
      g.add(b);
    }
    add(g, 'prank-remote', (w) => {
      g.visible = true;
      if (w.objects.remoteHidden) {
        g.position.set(plant.x - 0.04, 0.78, plant.z - 0.02);
        g.rotation.set(-0.55, 0.5, 0.25);
      } else {
        g.position.set(deskPos.x + 0.4, deskTop + 0.009, deskPos.z + 0.12);
        g.rotation.set(0, 0.35, 0);
      }
    });
  }

  // 2. Rubber duck under the document camera, and its projection ----------------------------
  const duckMat = mat(0xffd23a, 0.45);
  const beakMat = mat(0xff8a1f, 0.5);
  const eyeMat = mat(0x1b1b1b, 0.3);
  const makeDuck = (): THREE.Group => {
    const g = new THREE.Group();
    const body = mesh(geom(new THREE.SphereGeometry(0.045, 20, 14)), duckMat);
    body.scale.set(1, 0.82, 1.2);
    const head = mesh(geom(new THREE.SphereGeometry(0.03, 18, 12)), duckMat);
    head.position.set(0, 0.05, 0.035);
    const beak = mesh(geom(new THREE.BoxGeometry(0.03, 0.01, 0.026)), beakMat, false);
    beak.position.set(0, 0.045, 0.068);
    const tail = mesh(geom(new THREE.ConeGeometry(0.015, 0.035, 10)), duckMat, false);
    tail.rotation.x = -1.2;
    tail.position.set(0, 0.018, -0.056);
    for (const sx of [-1, 1]) {
      const eye = mesh(geom(new THREE.SphereGeometry(0.005, 8, 6)), eyeMat, false);
      eye.position.set(sx * 0.014, 0.058, 0.058);
      g.add(eye);
    }
    g.add(body, head, beak, tail);
    return g;
  };
  {
    const duck = makeDuck();
    const cx = doccam?.pos[0] ?? 0.95;
    const cz = doccam?.pos[1] ?? 1.0;
    add(duck, 'prank-duck', (w) => {
      duck.visible = w.objects.duckOnDocCam;
      duck.position.set(cx, deskTop + 0.06, cz + 0.14);
      duck.rotation.y = Math.PI * 0.08;
    });
    // The projected image: a giant duck filling the screen while the projector is on.
    const tex = canvasTex(256, 256, (c) => {
      c.fillStyle = 'rgba(255,255,255,0)';
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#ffd23a';
      c.beginPath();
      c.ellipse(120, 170, 88, 62, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(166, 92, 46, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(34, 150);
      c.lineTo(8, 120);
      c.lineTo(52, 128);
      c.fill();
      c.fillStyle = '#ff8a1f';
      c.beginPath();
      c.moveTo(204, 86);
      c.lineTo(250, 98);
      c.lineTo(206, 112);
      c.fill();
      c.fillStyle = '#1b1b1b';
      c.beginPath();
      c.arc(176, 80, 6, 0, Math.PI * 2);
      c.fill();
    });
    const m = basic(0xffd23a, {
      map: tex ?? null,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const plane = new THREE.Mesh(geom(new THREE.PlaneGeometry(1.1, 1.1)), m);
    plane.renderOrder = 5;
    plane.position.set(boardX, boardY, 0.05);
    add(plane, 'prank-duck-projected', (w) => {
      plane.visible = w.objects.duckOnDocCam && projectorInUse(w);
    });
  }

  // 3. Dried-out marker on the board tray ---------------------------------------------------
  {
    const g = new THREE.Group();
    const body = mesh(geom(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 10)), mat(0x9a9fa5, 0.7));
    body.rotation.z = Math.PI / 2;
    const cap = mesh(
      geom(new THREE.CylinderGeometry(0.0105, 0.0105, 0.04, 10)),
      mat(0xd6c9a8, 0.8),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.x = 0.075;
    g.add(body, cap);
    g.position.set(boardX + 0.62, boardY - boardH / 2 - 0.02, 0.07);
    g.rotation.y = 0.35;
    add(g, 'prank-dry-marker', (w) => (g.visible = w.objects.markerDry));
  }

  // 4. OUT OF ORDER sign under the projector ---------------------------------------------------
  {
    const px = projector?.pos[0] ?? 4.5;
    const pz = projector?.pos[1] ?? 3.2;
    const py = (projector?.height ?? 2.55) - 0.1;
    const tex = canvasTex(256, 180, (c) => {
      c.fillStyle = '#fbfbf6';
      c.fillRect(0, 0, 256, 180);
      c.strokeStyle = '#c4322a';
      c.lineWidth = 10;
      c.strokeRect(8, 8, 240, 164);
      c.fillStyle = '#c4322a';
      c.textAlign = 'center';
      c.font = 'bold 54px sans-serif';
      c.fillText('OUT OF', 128, 80);
      c.fillText('ORDER', 128, 138);
    });
    const paper = mesh(
      geom(new THREE.PlaneGeometry(0.34, 0.24)),
      mat(0xfbfbf6, 0.9, { map: tex ?? null, side: THREE.DoubleSide }),
      false,
    );
    paper.position.y = -0.12;
    const tape = mesh(geom(new THREE.BoxGeometry(0.1, 0.02, 0.004)), mat(0xe9dca0, 0.5), false);
    tape.position.y = -0.005;
    const pivot = new THREE.Group();
    pivot.add(paper, tape);
    pivot.position.set(px, py, pz + 0.17);
    add(pivot, 'prank-oo-sign', (w, t) => {
      pivot.visible = w.objects.outOfOrderSign;
      pivot.rotation.x = Math.sin(t * 0.9) * 0.05;
    });
  }

  // 5. Sticky-note mosaic on the front of the teacher's desk --------------------------------
  {
    const art = [
      '..............',
      '..............',
      '....##..##....',
      '....##..##....',
      '..............',
      '.##........##.',
      '..##########..',
      '....######....',
    ];
    const cols = 14;
    const rows = art.length;
    const size = 0.066;
    const im = new THREE.InstancedMesh(
      geom(new THREE.PlaneGeometry(size * 0.94, size * 0.94)),
      mat(0xffffff, 0.8, { side: THREE.DoubleSide }),
      cols * rows,
    );
    const palette = [0xffe96b, 0xffd24d, 0xffb3c7, 0xb9f0a3, 0xffc78a];
    const ink = [0x4aa3e8, 0xe8508f];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    let n = 0;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const hsh = ((r * 31 + k * 17) * 2654435761) >>> 0;
        const jitter = ((hsh % 100) / 100 - 0.5) * 0.08;
        e.set(0, 0, jitter);
        q.setFromEuler(e);
        m4.compose(
          new THREE.Vector3(
            (k - (cols - 1) / 2) * size + ((hsh >> 8) % 7) * 0.0006,
            (rows - 1 - r) * size,
            0,
          ),
          q,
          new THREE.Vector3(1, 1, 1),
        );
        im.setMatrixAt(n, m4);
        const pixel = art[r]![k] === '#';
        c.setHex(pixel ? ink[(r + k) % 2 === 0 ? 0 : 1]! : palette[hsh % palette.length]!);
        im.setColorAt(n, c);
        n++;
      }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    const g = new THREE.Group();
    g.add(im);
    g.position.set(deskPos.x, 0.5, deskPos.z + deskSize[2] / 2 + 0.006);
    add(g, 'prank-sticky-mosaic', (w) => (g.visible = w.objects.stickyMosaic));
  }

  // 6. Paper-cup pyramid on the desk ---------------------------------------------------------
  {
    const g = new THREE.Group();
    const cupH = 0.09;
    const cupGeo = geom(new THREE.CylinderGeometry(0.036, 0.026, cupH, 16));
    const bandGeo = geom(new THREE.CylinderGeometry(0.0372, 0.0345, 0.025, 16, 1, true));
    const cupMat = mat(0xf6f4ee, 0.7);
    const bandMat = mat(0xd0443a, 0.6, { side: THREE.DoubleSide });
    const rowsDef = [[-0.075, 0, 0.075], [-0.0375, 0.0375], [0]];
    rowsDef.forEach((xs, row) =>
      xs.forEach((x) => {
        const cup = new THREE.Group();
        cup.add(mesh(cupGeo, cupMat), mesh(bandGeo, bandMat, false));
        cup.rotation.x = Math.PI; // upside down: wide end on the desk
        cup.position.set(x, cupH / 2 + row * (cupH + 0.002), 0);
        g.add(cup);
      }),
    );
    g.position.set(deskPos.x - 0.02, deskTop, deskPos.z + 0.2);
    add(g, 'prank-cup-pyramid', (w) => (g.visible = w.objects.cupPyramid));
  }

  // 7. Wall clock "on holiday": hands spin, then settle on a silly time -----------------------
  {
    const fx = layout.fixtures.find((f) => f.kind === 'clock');
    if (fx) {
      const fw = fx.size[0];
      const fr = wallFrame(fx.wall, layout.room.size);
      const along = fx.center[0];
      const g = new THREE.Group();
      g.position.set(
        fr.origin[0] + fr.dir[0] * along + fr.normal[0] * 0.02,
        fx.center[1],
        fr.origin[1] + fr.dir[1] * along + fr.normal[1] * 0.02,
      );
      g.rotation.y = Math.atan2(fr.normal[0], fr.normal[1]);
      const face = mesh(
        geom(new THREE.CircleGeometry(fw / 2 - 0.02, 32)),
        mat(0xfffdf2, 0.5),
        false,
      );
      face.position.z = 0.045;
      const sun = mesh(geom(new THREE.CircleGeometry(fw * 0.07, 16)), basic(0xffc21f), false);
      sun.position.set(0, fw * 0.3, 0.047);
      const hm = mat(0xc4322a, 0.4);
      const hourPivot = new THREE.Group();
      const hour = mesh(geom(new THREE.BoxGeometry(0.014, fw * 0.24, 0.006)), hm, false);
      hour.position.y = fw * 0.12;
      hourPivot.add(hour);
      const minPivot = new THREE.Group();
      const minute = mesh(geom(new THREE.BoxGeometry(0.009, fw * 0.37, 0.006)), hm, false);
      minute.position.y = fw * 0.185;
      minPivot.add(minute);
      hourPivot.position.z = minPivot.position.z = 0.052;
      g.add(face, sun, hourPivot, minPivot);
      let since = -1;
      add(g, 'prank-clock-silly', (w, t) => {
        g.visible = w.objects.clockSilly;
        if (!g.visible) {
          since = -1;
          return;
        }
        if (since < 0) since = t;
        const k = Math.max(0, 1 - (t - since) / 3); // spinning for the first 3 s
        // Settles on 3:47 (hands turn clockwise, i.e. negative rotation about +z).
        hourPivot.rotation.z = -((3 + 47 / 60) / 12) * Math.PI * 2 - k * k * 40;
        minPivot.rotation.z = -(47 / 60) * Math.PI * 2 - k * k * 480;
      });
    }
  }

  // 8. Upside-down posters ------------------------------------------------------------------
  {
    const posters = layout.fixtures.filter((f) => f.kind === 'poster');
    const sunMat = basic(0xfff3c4);
    const hillMat = mat(0x2d3b4a, 0.8);
    const flips: THREE.Group[] = [];
    posters.forEach((fx, i) => {
      const [fw, fh] = fx.size;
      const fr = wallFrame(fx.wall, layout.room.size);
      const along = fx.center[0];
      const g = new THREE.Group();
      g.position.set(
        fr.origin[0] + fr.dir[0] * along + fr.normal[0] * 0.034,
        fx.center[1],
        fr.origin[1] + fr.dir[1] * along + fr.normal[1] * 0.034,
      );
      g.rotation.y = Math.atan2(fr.normal[0], fr.normal[1]);
      const inner = new THREE.Group();
      inner.rotation.z = Math.PI; // upside down
      inner.add(
        mesh(geom(new THREE.PlaneGeometry(fw, fh)), mat(POSTER_COLORS[i % 4]!, 0.8), false),
      );
      const sun = mesh(geom(new THREE.CircleGeometry(fw * 0.2, 20)), sunMat, false);
      sun.position.set(fw * 0.12, fh * 0.22, 0.002);
      const tri = new THREE.Shape();
      tri.moveTo(-fw * 0.4, 0);
      tri.lineTo(fw * 0.4, 0);
      tri.lineTo(-fw * 0.05, fh * 0.34);
      tri.closePath();
      const hill = mesh(geom(new THREE.ShapeGeometry(tri)), hillMat, false);
      hill.position.set(0, -fh * 0.46, 0.004);
      inner.add(sun, hill);
      g.add(inner);
      flips.push(g);
      group.add(g);
      g.visible = false;
      g.name = `prank-poster-flipped-${i}`;
    });
    parts.push({
      obj: new THREE.Group(),
      update: (w) => flips.forEach((g) => (g.visible = w.objects.postersFlipped)),
    });
  }

  // 9. Faint smiley in the board corner (shows under the projector) --------------------------
  {
    const g = new THREE.Group();
    const ink = basic(0x1b3fa0, { transparent: true, opacity: 1, depthWrite: false });
    const ring = mesh(geom(new THREE.TorusGeometry(0.07, 0.0045, 6, 28)), ink, false);
    const mouth = mesh(geom(new THREE.TorusGeometry(0.04, 0.0045, 6, 14, Math.PI)), ink, false);
    mouth.rotation.z = Math.PI;
    mouth.position.y = -0.008;
    for (const sx of [-1, 1]) {
      const eye = mesh(geom(new THREE.CircleGeometry(0.0075, 8)), ink, false);
      eye.position.set(sx * 0.026, 0.022, 0);
      g.add(eye);
    }
    g.add(ring, mouth);
    g.position.set(boardX + boardW / 2 - 0.16, boardY - boardH / 2 + 0.14, 0.048);
    add(g, 'prank-ghost-smiley', (w) => {
      const st = w.objects.ghostSmiley;
      g.visible = st !== 'none';
      const lit = st === 'shown' || (st === 'hidden' && projectorInUse(w));
      ink.opacity = lit ? 0.85 : 0.035;
    });
  }

  // 10. Birds hopping on the bin while the hidden alarm chirps -------------------------------
  {
    const bx = bin?.pos[0] ?? W - 0.4;
    const bz = bin?.pos[1] ?? 0.4;
    const root = new THREE.Group();
    const makeBird = (blue: number): THREE.Group => {
      const b = new THREE.Group();
      const body = mesh(geom(new THREE.SphereGeometry(0.03, 14, 10)), mat(blue, 0.6));
      body.scale.set(0.85, 0.9, 1.15);
      const belly = mesh(geom(new THREE.SphereGeometry(0.024, 12, 8)), mat(0xf4d84a, 0.6), false);
      belly.position.set(0, -0.008, 0.012);
      const head = mesh(geom(new THREE.SphereGeometry(0.02, 12, 8)), mat(blue, 0.6));
      head.position.set(0, 0.03, 0.022);
      const beak = mesh(geom(new THREE.ConeGeometry(0.006, 0.02, 8)), beakMat, false);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.028, 0.048);
      const tail = mesh(geom(new THREE.BoxGeometry(0.014, 0.004, 0.04)), mat(blue, 0.6), false);
      tail.position.set(0, 0.004, -0.045);
      b.add(body, belly, head, beak, tail);
      return b;
    };
    const birds = [makeBird(0x4a86c9), makeBird(0x5aa86a)];
    birds.forEach((b) => root.add(b));
    // The old phone peeking out of the bin, screen glowing.
    const phone = mesh(geom(new THREE.BoxGeometry(0.07, 0.012, 0.13)), mat(0x1c1d20, 0.4), false);
    const screen = mesh(
      geom(new THREE.PlaneGeometry(0.06, 0.11)),
      basic(0x9be8a8, { side: THREE.DoubleSide }),
      false,
    );
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = 0.0065;
    phone.add(screen);
    phone.position.set(bx - 0.03, 0.43, bz + 0.02);
    phone.rotation.set(-0.7, 0.2, 0.1);
    root.add(phone);
    add(root, 'prank-birds', (w, t) => {
      root.visible = w.objects.birdAlarm;
      birds.forEach((b, i) => {
        const hop = Math.abs(Math.sin(t * 7 + i * 2.1)) * 0.03;
        b.position.set(bx + (i ? 0.17 : -0.17), 0.47 + hop, bz + (i ? 0.1 : -0.04));
        b.rotation.y = i ? -1.1 : 1.1 + Math.sin(t * 3 + i) * 0.4;
      });
    });
  }

  // 11. Turned chairs ---------------------------------------------------------------------
  {
    const seats = layout.seats;
    let back = null as THREE.InstancedMesh | null;
    opts.room?.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.geometry instanceof THREE.BoxGeometry) {
        const p = im.geometry.parameters;
        if (Math.abs(p.height - 0.3) < 1e-6 && Math.abs(p.depth - 0.025) < 1e-6) back = im;
      }
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const setBack = (im: THREE.InstancedMesh, i: number, turned: boolean) => {
      const s = seats[i]!;
      const f = facingDir(s.facing);
      const k = turned ? 0.2 : -0.2;
      q.setFromAxisAngle(up, (s.facing * Math.PI) / 180 + (turned ? Math.PI : 0));
      im.setMatrixAt(i, m4.compose(v.set(s.pos[0] + f[0] * k, 0.72, s.pos[1] + f[1] * k), q, one));
    };
    let applied = '';
    // Fallback (no greybox handle): an extra backrest on the front side.
    const ghostGeo = geom(new THREE.BoxGeometry(0.4, 0.3, 0.025));
    const ghostMat = mat(0xc89a5c, 0.6);
    const ghosts = seats.map((s) => {
      const f = facingDir(s.facing);
      const gm = mesh(ghostGeo, ghostMat);
      gm.position.set(s.pos[0] + f[0] * 0.2, 0.72, s.pos[1] + f[1] * 0.2);
      gm.rotation.y = (s.facing * Math.PI) / 180;
      gm.visible = false;
      group.add(gm);
      return gm;
    });
    parts.push({
      obj: new THREE.Group(),
      update: (w) => {
        const turned = new Set(w.objects.turnedSeats);
        const key = [...turned].sort().join(',');
        if (key === applied) return;
        applied = key;
        const im = back;
        if (im) {
          seats.forEach((s, i) => setBack(im, i, turned.has(s.id)));
          im.instanceMatrix.needsUpdate = true;
        } else seats.forEach((s, i) => (ghosts[i]!.visible = turned.has(s.id)));
      },
    });
  }

  return {
    group,
    update(world, t) {
      for (const p of parts) p.update?.(world, t);
    },
    dispose() {
      group.removeFromParent();
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      for (const x of texs) x.dispose();
    },
  };
}
