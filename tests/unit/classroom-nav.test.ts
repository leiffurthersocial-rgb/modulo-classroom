import { describe, expect, it } from 'vitest';
import { type Box, resolveCircleBox, type V2 } from '../../src/classroom/sim/geom';
import { PLAYER_RADIUS } from '../../src/classroom/sim/player';
import { World } from '../../src/classroom/sim/world';

const w = new World({ seed: 1, lessonType: 'lecture', teacher: 'strict' });
const nav = w.nav;
const spots = Object.entries(w.layout.spots ?? {}).map(
  ([k, v]) => [k, { x: v[0], z: v[1] }] as [string, V2],
);

function polylineWalkable(a: V2, path: V2[]): boolean {
  let prev = a;
  for (const p of path) {
    const n = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.05);
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 1;
      if (!nav.walkable({ x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t }))
        return false;
    }
    prev = p;
  }
  return true;
}

describe('NavGrid on the real classroom', () => {
  it('has spots to test', () => {
    expect(spots.length).toBeGreaterThan(5);
  });
  it('finds paths between all layout spots and seat positions that never cross blocked cells', () => {
    const points: [string, V2][] = [
      ...spots,
      ...w.layout.seats.map((s) => [s.id, { x: s.pos[0], z: s.pos[1] }] as [string, V2]),
    ];
    for (const [na, a] of points) {
      for (const [nb, b] of points) {
        if (na === nb) continue;
        const path = nav.findPath(a, b);
        expect(path, `${na} -> ${nb}`).not.toBeNull();
        const start = nav.nearestWalkable(a)!;
        expect(polylineWalkable(start, path!), `${na} -> ${nb} crosses a blocked cell`).toBe(true);
      }
    }
  });
  it('tables are blocked, open floor is walkable', () => {
    expect(nav.walkable({ x: 5.425, z: 6.925 })).toBe(false); // table t-b4
    expect(nav.walkable({ x: 5.5, z: 4.2 })).toBe(true);
    expect(nav.walkable({ x: -1, z: 3 })).toBe(false);
  });
});

describe('NavGrid dynamic obstacles', () => {
  it('setDynamic blocks cells and bumps version; removing restores', () => {
    const g = new World({ seed: 2, lessonType: 'lecture', teacher: 'strict' }).nav;
    const probe = { x: 4.5, z: 3.6 };
    expect(g.walkable(probe)).toBe(true);
    const v0 = g.version;
    const box: Box = {
      id: 'dyn',
      kind: 'prop',
      cx: 4.5,
      cz: 3.6,
      hx: 0.5,
      hz: 0.5,
      yaw: 0,
      y0: 0,
      y1: 1,
    };
    g.setDynamic('dyn', box);
    expect(g.version).toBe(v0 + 1);
    expect(g.walkable(probe)).toBe(false);
    g.setDynamic('dyn', null);
    expect(g.version).toBe(v0 + 2);
    expect(g.walkable(probe)).toBe(true);
  });
  it('a full-width wall across the middle aisle forces a longer or no path; removal restores the direct one', () => {
    const g = new World({ seed: 3, lessonType: 'lecture', teacher: 'strict' }).nav;
    const a = { x: 4.5, z: 2.6 };
    const b = { x: 4.5, z: 4.4 };
    const len = (p: V2[] | null) => {
      if (!p) return Infinity;
      let s = 0;
      let prev = a;
      for (const q of p) {
        s += Math.hypot(q.x - prev.x, q.z - prev.z);
        prev = q;
      }
      return s;
    };
    const base = len(g.findPath(a, b));
    expect(base).toBeLessThan(2.5);
    g.setDynamic('block', {
      id: 'block',
      kind: 'prop',
      cx: 4.5,
      cz: 3.5,
      hx: 1.5,
      hz: 0.2,
      yaw: 0,
      y0: 0,
      y1: 1,
    });
    expect(len(g.findPath(a, b))).toBeGreaterThan(base + 0.5);
    g.setDynamic('block', null);
    expect(len(g.findPath(a, b))).toBeCloseTo(base, 3);
  });
});

describe('aisle behind the right row', () => {
  const L = w.layout;
  const [W, , D] = L.room.size;
  const LEDGE_DEPTH = 0.28; // sill ledge (tools/blender/furniture.py make_radiator)
  const CHAIR_BACK = 0.25; // chair centre -> backrest, pushed out
  const rightSeats = L.seats.filter((s) => s.id.startsWith('s-r'));

  it('the room is the bigger classroom with 16 student seats plus the player and the hot seat', () => {
    expect(W).toBeGreaterThanOrEqual(10.5);
    expect(D).toBeGreaterThanOrEqual(8);
    const normal = L.seats.filter((s) => !s.hot);
    expect(normal.length).toBe(17); // 16 classmates + the player's seat
    expect(L.seats.filter((s) => s.hot).length).toBe(1);
    expect(rightSeats.length).toBe(5);
  });

  it('keeps at least 0.9 m between the right-row chair backs and the sill ledge', () => {
    for (const s of rightSeats) {
      const gap = W - LEDGE_DEPTH - (s.pos[0] + CHAIR_BACK);
      expect(gap, s.id).toBeGreaterThanOrEqual(0.9);
    }
    // Nothing else sticks out of the window wall into the aisle further than the ledge.
    for (const c of L.columns)
      expect(W - (c.center[0] - c.size[0] / 2)).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('has a nav path along the aisle from the front-right to the back-right corner', () => {
    const a = { x: L.spots!.aisleFront![0], z: L.spots!.aisleFront![1] };
    const b = { x: L.spots!.aisleBack![0], z: L.spots!.aisleBack![1] };
    expect(b.z).toBeGreaterThan(rightSeats.at(-1)!.pos[1] + 1.5);
    const path = nav.findPath(a, b);
    expect(path).not.toBeNull();
    // The whole route stays behind the right row (past the chair backs) and in the corridor.
    const minX = Math.min(...rightSeats.map((s) => s.pos[0])) + CHAIR_BACK;
    let prev = a;
    for (const q of path!) {
      const n = Math.ceil(Math.hypot(q.x - prev.x, q.z - prev.z) / 0.05);
      for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 1;
        const x = prev.x + (q.x - prev.x) * t;
        const z = prev.z + (q.z - prev.z) * t;
        expect(nav.walkable({ x, z })).toBe(true);
        if (z > rightSeats[0]!.pos[1] && z < rightSeats.at(-1)!.pos[1])
          expect(x).toBeGreaterThan(minX);
      }
      prev = q;
    }
  });

  it('the player collision circle fits along the whole aisle without being pushed', () => {
    for (let z = 0.9; z <= D - 0.6; z += 0.05) {
      const p = { x: 9.95, z };
      for (const bx of w.geo.colliders) {
        const r = resolveCircleBox(p, PLAYER_RADIUS, bx);
        expect(Math.hypot(r.x - p.x, r.z - p.z), `${bx.id} at z=${z.toFixed(2)}`).toBeLessThan(
          1e-6,
        );
      }
    }
  });
});
