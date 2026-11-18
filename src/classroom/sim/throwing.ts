// Thrown paper: launching, in-flight hit detection (swept ball vs. agent capsules, deterministic),
// landing and the bin "basketball" shot. Used by the player and by classmates (ball fights). Pure TS.
import { TICK_DT } from './clock';
import { clamp, dist2, resolveCircleBox, type V2, wrapAngle, yawDir, yawTo } from './geom';
import { completePrank } from './pranks';
import { classmateHit, playerHit } from './reactions';
import { teacherHit } from './incident';
import type { Agent, Item } from './types';
import type { World } from './world';

/** Where on the body a ball landed. */
export type HitRegion = 'head' | 'torso' | 'legs';
/** Which side of the victim it came from, relative to where their head points. */
export type HitSide = 'back' | 'side' | 'front';

export interface HitInfo {
  victim: string;
  thrower: string;
  region: HitRegion;
  side: HitSide;
  /** Floor position the ball was thrown from. */
  origin: V2;
  pos: V2;
  y: number;
  kind: Item['kind'];
  /** The victim could see the thrower at the moment of impact (before reacting). */
  seen: boolean;
}

const HIT_RADIUS = 0.24;
export const BIN_RADIUS = 0.5;

/** Vertical extent of an agent for hit tests (metres). */
export function bodyRange(a: Agent): [number, number] {
  switch (a.stance) {
    case 'sit':
      return [0.5, 1.3];
    case 'crouch':
      return [0.05, 1.15];
    default:
      return [0.05, a.kind === 'teacher' ? 1.82 : 1.72];
  }
}

export function binPos(w: World): V2 {
  const s = w.layout.spots?.bin;
  if (s) return { x: s[0], z: s[1] };
  const p = w.layout.props.find((x) => x.id === 'bin');
  return p ? { x: p.pos[0], z: p.pos[1] } : { x: 0, z: 0 };
}

/** Ball position at time t along its (straight in plan, arced in height) flight. */
export function flightAt(it: Item, t: number): { x: number; y: number; z: number } | null {
  const f = it.flight;
  if (!f) return null;
  const u = clamp((t - f.t0) / Math.max(1e-6, f.t1 - f.t0), 0, 1);
  return {
    x: f.from.x + (f.to.x - f.from.x) * u,
    // The ball stays at throwing height for most of the flight and drops near the end.
    y: f.y0 + (f.y1 - f.y0) * u * u * u + Math.sin(u * Math.PI) * f.arc,
    z: f.from.z + (f.to.z - f.from.z) * u,
  };
}

/**
 * Launch `item` from `thrower` along `yaw`. Power 0..1 sets the landing distance. The landing
 * point is the end of the throw (or the last free spot before a wall/column).
 */
export function launchItem(
  w: World,
  thrower: Agent,
  item: Item,
  yaw: number,
  power: number,
): { clipped: boolean } {
  const plane = item.kind === 'paper-plane';
  const sitting = thrower.stance === 'sit';
  const maxD = (plane ? 1.5 + power * 5 : 1.5 + power * 6.5) * (sitting ? 0.8 : 1);
  const dir = yawDir(yaw);
  const from = { x: thrower.pos.x + dir.x * 0.3, z: thrower.pos.z + dir.z * 0.3 };
  let to = { ...from };
  let clipped = false;
  for (let d = 0.3; d <= maxD; d += 0.1) {
    const q = { x: thrower.pos.x + dir.x * d, z: thrower.pos.z + dir.z * d };
    const hitWall =
      q.x < 0.1 ||
      q.z < 0.1 ||
      q.x > w.layout.room.size[0] - 0.1 ||
      q.z > w.layout.room.size[2] - 0.1;
    const col = w.geo.colliders.find(
      (b) => (b.kind === 'column' || b.kind === 'wall') && resolveCircleBox(q, 0.05, b) !== q,
    );
    if (hitWall || col) {
      clipped = true;
      break;
    }
    to = q;
  }
  // Land on a table/desk if the end point is above one.
  let onTable = false;
  for (const b of w.geo.colliders) {
    if ((b.kind === 'table' || b.kind === 'desk') && resolveCircleBox(to, 0.01, b) !== to) {
      onTable = true;
      break;
    }
  }
  const dur = Math.max(0.25, dist2(from, to) / (plane ? 3.2 : 7));
  item.heldBy = null;
  item.thrower = thrower.id;
  item.hit = false;
  item.pos = to;
  item.y = onTable ? 0.76 : 0.03;
  item.onTable = onTable;
  item.flight = {
    from,
    to,
    y0: sitting ? 0.9 : 1.3,
    y1: item.y,
    t0: w.t,
    t1: w.t + dur,
    arc: plane ? 0.35 : 0.8,
  };
  w.emit({ type: 'throw', who: thrower.id, target: item.id, value: dur });
  return { clipped };
}

/** Hit zone + side for a ball at height y reaching `victim` from `origin`. */
export function classifyHit(
  victim: Agent,
  origin: V2,
  y: number,
): { region: HitRegion; side: HitSide } {
  const [lo, hi] = bodyRange(victim);
  const h = hi - lo;
  const rel = (y - lo) / Math.max(0.1, h);
  const region: HitRegion = rel >= 0.72 ? 'head' : rel >= 0.4 ? 'torso' : 'legs';
  // Compare where the victim's head points with where the ball came from.
  const toOrigin = yawTo(victim.pos, origin);
  const diff = Math.abs(wrapAngle(toOrigin - victim.headYaw));
  const side: HitSide = diff > 2.2 ? 'back' : diff < 0.95 ? 'front' : 'side';
  return { region, side };
}

/** Closest agent the ball touches during this tick's slice of its flight, if any. */
function sweep(w: World, it: Item): { agent: Agent; x: number; y: number; z: number } | null {
  const f = it.flight!;
  const t1 = Math.min(w.t, f.t1);
  const t0 = Math.max(f.t0, w.t - TICK_DT);
  const STEPS = 4;
  for (let i = 1; i <= STEPS; i++) {
    const p = flightAt(it, t0 + ((t1 - t0) * i) / STEPS)!;
    let best: Agent | null = null;
    let bestD = Infinity;
    for (const a of w.allAgents()) {
      if (!a.present || a.id === it.thrower) continue;
      const [lo, hi] = bodyRange(a);
      if (p.y < lo || p.y > hi) continue;
      const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
      if (d <= HIT_RADIUS && d < bestD) {
        best = a;
        bestD = d;
      }
    }
    if (best) return { agent: best, x: p.x, y: p.y, z: p.z };
  }
  return null;
}

function registerHit(w: World, it: Item, hit: NonNullable<ReturnType<typeof sweep>>): void {
  const f = it.flight!;
  const victim = hit.agent;
  const thrower = w.agent(it.thrower ?? '');
  const origin = { ...f.from };
  // Classify before the victim reacts (reaction code turns their head).
  const { region, side } = classifyHit(victim, thrower?.pos ?? origin, hit.y);
  const info: HitInfo = {
    victim: victim.id,
    thrower: it.thrower ?? '',
    region,
    side,
    origin: thrower ? { ...thrower.pos } : origin,
    pos: { x: hit.x, z: hit.z },
    y: hit.y,
    kind: it.kind,
    seen: false,
  };
  // The ball drops at the victim's feet (a small bounce back toward the thrower).
  const back = yawTo({ x: hit.x, z: hit.z }, origin);
  const bd = yawDir(back);
  const to = {
    x: clamp(hit.x + bd.x * 0.45, 0.15, w.layout.room.size[0] - 0.15),
    z: clamp(hit.z + bd.z * 0.45, 0.15, w.layout.room.size[2] - 0.15),
  };
  it.hit = true;
  it.pos = to;
  it.y = 0.03;
  it.onTable = false;
  it.flight = {
    from: { x: hit.x, z: hit.z },
    to,
    y0: hit.y,
    y1: 0.03,
    t0: w.t,
    t1: w.t + 0.4,
    arc: 0.12,
  };
  w.emit({
    type: 'hit',
    who: victim.id,
    target: info.thrower,
    kind: region,
    text: side,
    pos: { x: hit.x, z: hit.z },
    value: it.kind === 'paper-plane' ? 0 : 1,
  });
  if (victim.kind === 'teacher') teacherHit(w, info);
  else if (victim.kind === 'player') playerHit(w, info);
  else classmateHit(w, info);
}

/** Advance every ball in flight: hit detection first, then landing. Called once per tick. */
export function updateFlights(w: World): void {
  for (const it of w.items) {
    const f = it.flight;
    if (!f || f.done) continue;
    if (!it.hit && it.thrower && w.t > f.t0 + 0.04) {
      const hit = sweep(w, it);
      if (hit) {
        registerHit(w, it, hit);
        continue;
      }
    }
    if (w.t < f.t1) continue;
    f.done = true;
    land(w, it);
  }
  w.items = w.items.filter((i) => !i.removed);
}

function land(w: World, it: Item): void {
  const thrower = it.thrower;
  if (it.hit) {
    w.noise(it.pos, 1.0, 'paper', null);
    w.emit({ type: 'land', target: it.id, pos: { ...it.pos } });
    return;
  }
  if (it.kind === 'paper-plane') {
    w.noise(it.pos, 1.8, 'plane', null);
    const desk = w.geo.colliders.find((b) => b.id === 'teacher-desk');
    if (desk && resolveCircleBox(it.pos, 0.01, desk) !== it.pos)
      completePrank(w, 'paper-plane', 'teacher-desk', it.id);
    w.emit({ type: 'land', target: it.id, pos: { ...it.pos } });
    return;
  }
  // Paper ball: in the bin?
  const bin = binPos(w);
  if (it.kind === 'paper-ball' && !it.onTable && dist2(it.pos, bin) <= BIN_RADIUS && thrower) {
    it.removed = true;
    w.noise(bin, 1.4, 'bin-tok', thrower === 'player' ? 'player' : null);
    w.emit({ type: 'bin-shot', who: thrower, pos: { ...bin }, value: 1 });
    if (thrower === 'player') binShotMade(w);
    return;
  }
  w.noise(it.pos, 5.5, 'thud', null);
  if (thrower === 'player' && dist2(it.pos, bin) < 2.2) binShotMissed(w);
  w.emit({ type: 'land', target: it.id, pos: { ...it.pos } });
}

function binShotMade(w: World): void {
  const fun = w.ps.fun;
  fun.binStreak++;
  fun.binBest = Math.max(fun.binBest, fun.binStreak);
  w.stats.binMade++;
  w.stats.binBest = fun.binBest;
  w.record.counters.binStreakBest = Math.max(w.record.counters.binStreakBest ?? 0, fun.binBest);
  w.emit({ type: 'bin-streak', value: fun.binStreak });
  // The class notices a good shot: a couple of rebels cheer, the teacher does not look up.
  let n = 0;
  for (const s of w.students) {
    if (!s.agent.present || n >= 2) break;
    if (s.def.traits.rebellious < 0.4 && fun.binStreak < 3) continue;
    n++;
    if (w.rngSocial.chance(0.6)) w.say(s.agent.id, 'student', 'cheer');
    if (fun.binStreak >= 3 && s.def.traits.rebellious >= 0.4)
      w.relations.change(s.agent.id, 1, `loved your bin shots (${fun.binStreak} in a row)`, w);
  }
}

function binShotMissed(w: World): void {
  const fun = w.ps.fun;
  if (fun.binStreak > 0) w.emit({ type: 'bin-streak', value: 0 });
  fun.binStreak = 0;
  w.stats.binMissed++;
  let n = 0;
  for (const s of w.students) {
    if (!s.agent.present || n >= 1) break;
    if (s.def.traits.rebellious < 0.4) continue;
    n++;
    if (w.rngSocial.chance(0.35)) w.say(s.agent.id, 'student', 'boo');
  }
}
