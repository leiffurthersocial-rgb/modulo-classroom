// Classmate reactions: what they do when a paper ball hits someone (laugh, gasp, glare, throw it
// back, tell), how a ball fight escalates, and the scheduled "react in 0.4 s" queue that the
// player's actions (cough chains, drumming, humming) also use. Pure TS.
import { TICK_DT } from './clock';
import { clamp, dist2, type V2, wrapAngle, yawTo } from './geom';
import { EYE_HEIGHT, lineOfSight, personBox, samplePoint } from './perception';
import { launchItem, type HitInfo } from './throwing';
import type { Agent } from './types';
import type { StudentState } from './students';
import type { World } from './world';

export type ReactKind =
  | 'laugh'
  | 'gasp'
  | 'glare'
  | 'sigh'
  | 'cough'
  | 'sneeze'
  | 'drum'
  | 'hum'
  | 'point'
  | 'throwback'
  | 'tell';

export interface Reaction {
  at: number;
  kind: ReactKind;
  /** Free argument (target id, …). */
  arg?: string;
}

/** Hard cap on classmate throws per lesson (keeps a runaway fight from flooding the room). */
export const MAX_STUDENT_THROWS = 14;

export function setAnim(a: Agent, now: number, clip: string, secs: number, once = true): void {
  a.anim = { clip, until: now + secs, once };
}

export function queueReact(w: World, s: StudentState, kind: ReactKind, delay: number, arg?: string): void {
  s.react.push({ at: w.t + delay, kind, arg });
}

/** Classmates who can see `target` right now (line of sight + roughly facing it). */
export function whoSees(w: World, target: Agent, maxDist = 8): string[] {
  const pt = samplePoint(target, 'torso');
  const out: string[] = [];
  for (const s of w.students) {
    const a = s.agent;
    if (!a.present || a.id === target.id) continue;
    if (dist2(a.pos, target.pos) > maxDist) continue;
    if (Math.abs(wrapAngle(yawTo(a.pos, target.pos) - a.headYaw)) > 1.9) continue;
    const eye = { x: a.pos.x, y: EYE_HEIGHT[a.stance], z: a.pos.z };
    const occ = [
      ...w.geo.occluders,
      ...w.students.filter((o) => o !== s).map((o) => personBox(o.agent)),
    ];
    if (lineOfSight(eye, pt, occ, [a.id, target.id], false)) out.push(a.id);
  }
  return out;
}

function sitting(a: Agent): boolean {
  return a.stance === 'sit';
}

function playAnim(w: World, s: StudentState, clip: string, secs: number): void {
  // Seated clips only make sense when seated.
  if (sitting(s.agent)) setAnim(s.agent, w.t, clip, secs);
}

function performReaction(w: World, s: StudentState, r: Reaction): void {
  const a = s.agent;
  switch (r.kind) {
    case 'laugh':
      w.say(a.id, 'student', 'laugh');
      w.noise(a.pos, 1.1, 'laugh', a.id);
      playAnim(w, s, 'sit_laugh', 2.0);
      s.lastLaughT = w.t;
      s.laughAt = r.arg ?? null;
      break;
    case 'gasp':
      w.say(a.id, 'student', 'gasp');
      playAnim(w, s, 'sit_gasp', 1.3);
      break;
    case 'glare':
      w.say(a.id, 'student', r.arg === 'quiet' ? 'sigh' : 'hey');
      playAnim(w, s, 'sit_glare', 3.0);
      break;
    case 'sigh':
      w.say(a.id, 'student', 'sigh');
      break;
    case 'cough':
    case 'sneeze':
      w.say(a.id, 'student', r.kind);
      w.noise(a.pos, r.kind === 'cough' ? 2.5 : 3.5, r.kind, a.id);
      playAnim(w, s, 'cough', 1.3);
      break;
    case 'drum':
      w.say(a.id, 'student', 'drumJoin');
      playAnim(w, s, 'sit_drum', 3.2);
      s.drumUntil = w.t + 3.2;
      break;
    case 'hum':
      w.say(a.id, 'student', 'humJoin');
      playAnim(w, s, 'sit_hum', 3.2);
      s.humUntil = w.t + 3.2;
      break;
    case 'point':
      playAnim(w, s, 'sit_point', 2.2);
      break;
    case 'throwback':
      studentThrow(w, s, r.arg ?? 'player');
      break;
    case 'tell': {
      if (!w.teacher.present) break;
      const who = w.agent(r.arg ?? '');
      if (!who || r.arg !== 'player') break;
      w.say(a.id, 'student', 'snitch', {
        teacher: w.profile.name,
        target: w.profile.knowsNames ? who.name : 'the one in the back',
      });
      const st = w.susp('player');
      st.s = Math.max(st.s, 0.9);
      st.lastEvidence = { kind: 'reported', point: 'head', zone: 'report', dist: 0 };
      st.lastEvidenceT = w.t;
      w.brain.pendingPunish.push({
        target: 'player',
        kind: 'throw',
        severity: 0.45,
        summary: 'Threw a paper ball at a classmate (they told)',
      });
      w.relations.change(a.id, -2, 'told on you for the paper ball', w);
      break;
    }
  }
}

export function updateReactions(w: World): void {
  w.fight.heat = Math.max(0, w.fight.heat - TICK_DT / 15);
  for (const s of w.students) {
    s.throwFlash = Math.max(0, s.throwFlash - TICK_DT);
    if (!s.react.length || !s.agent.present) continue;
    const due = s.react.filter((r) => w.t >= r.at);
    if (!due.length) continue;
    s.react = s.react.filter((r) => w.t < r.at);
    for (const r of due) performReaction(w, s, r);
  }
}

/** A classmate hurls a paper ball at `targetId` (a throw-back or a ball-fight volley). */
export function studentThrow(w: World, s: StudentState, targetId: string): boolean {
  const a = s.agent;
  const tgt = w.agent(targetId);
  if (!tgt || !tgt.present || w.stats.studentThrows >= MAX_STUDENT_THROWS) return false;
  if (!a.sittingIn && a.stance !== 'stand') return false;
  const d = dist2(a.pos, tgt.pos);
  if (d < 0.6) return false;
  const item = w.addItem('paper-ball', a.pos, 0.9, null);
  // Aim for the head with a little human error (seeded).
  const err = (w.rngStudents.next() - 0.5) * 0.2;
  const yaw = yawTo(a.pos, tgt.pos) + err;
  const reach = 6.5 * (a.stance === 'sit' ? 0.8 : 1);
  const power = clamp((d + 0.6 - 1.5) / reach, 0.12, 1);
  a.yaw = yaw;
  a.headYaw = yaw;
  setAnim(a, w.t, a.stance === 'sit' ? 'sit_throw' : 'throw', 1.2);
  s.throwFlash = 0.35;
  s.lastThrowT = w.t;
  w.stats.studentThrows++;
  w.say(a.id, 'student', 'throwBack');
  launchItem(w, a, item, yaw, power);
  return true;
}

// ---------------------------------------------------------------------------------------------
// A ball hits a classmate

export function classmateHit(w: World, info: HitInfo): void {
  const s = w.student(info.victim);
  const thrower = w.agent(info.thrower);
  if (!s || !thrower) return;
  const t = s.def.traits;
  const byPlayer = info.thrower === 'player';
  const aff = byPlayer ? w.relations.toPlayer(s.def.id) : w.relations.between(s.def.id, info.thrower);
  const face = info.region === 'head' && info.side === 'front';
  w.fight.heat += 1;
  w.fight.lastT = w.t;
  if (byPlayer) w.stats.hits.students++;
  w.noise(info.pos, 2.4, 'pap', null);
  const takesJoke = aff >= -20 && ((t.rebellious >= 0.45 && t.goody < 0.65) || (aff >= 20 && t.goody < 0.75));
  if (takesJoke) {
    queueReact(w, s, 'laugh', 0.25, info.thrower);
    if (byPlayer && aff >= 0) w.relations.change(s.def.id, 1.5, 'laughed when your paper ball hit them', w);
    const canThrow = t.rebellious >= 0.5 && (s.cooldowns.throwback ?? -99) <= w.t;
    if (canThrow && w.stats.studentThrows < MAX_STUDENT_THROWS) {
      s.cooldowns.throwback = w.t + 12;
      queueReact(w, s, 'throwback', 1.0 + w.rngStudents.next() * 1.2, info.thrower);
    }
  } else {
    queueReact(w, s, t.anxious >= 0.55 || face ? 'gasp' : 'glare', 0.1, info.thrower);
    if (face || t.goody >= 0.6) queueReact(w, s, 'glare', 0.9, info.thrower);
    if (byPlayer) {
      w.relations.change(s.def.id, face ? -5 : -3, 'was hit by your paper ball', w);
      if (t.snitch >= 0.5 && aff < 15 && w.teacher.present && w.rngSocial.chance(0.6))
        queueReact(w, s, 'tell', 1.8 + w.rngSocial.next(), 'player');
    }
  }
  // Neighbours enjoy it.
  let n = 0;
  for (const o of w.students) {
    if (o === s || !o.agent.present || n >= 2 || dist2(o.agent.pos, s.agent.pos) > 2.4) continue;
    if (o.def.traits.rebellious >= 0.4 && w.rngSocial.chance(0.5)) {
      n++;
      queueReact(w, o, 'laugh', 0.5 + 0.3 * n);
    }
  }
  fightEscalation(w, info.thrower);
}

/** Ball fights spread: more rebels join in, the racket grows, the teacher hears it. */
function fightEscalation(w: World, lastThrower: string): void {
  if (w.fight.heat < 3) return;
  if (w.fight.heat - 1 < 3) w.emit({ type: 'fight', value: w.fight.heat });
  for (const o of w.students) {
    if (!o.agent.present || o.agent.id === lastThrower) continue;
    if (o.def.traits.rebellious < 0.6 || (o.cooldowns.fight ?? -99) > w.t) continue;
    if (!w.rngSocial.chance(0.35)) continue;
    o.cooldowns.fight = w.t + 10;
    const others = w.students.filter((x) => x !== o && x.agent.present);
    const pickFrom = [...others.map((x) => x.agent.id), 'player'];
    queueReact(w, o, 'throwback', 0.8 + w.rngSocial.next() * 1.5, w.rngSocial.pick(pickFrom));
    break;
  }
}

/** A classmate's ball (or a stray one) hits the player. */
export function playerHit(w: World, info: HitInfo): void {
  const thrower = w.agent(info.thrower);
  w.ps.hitFlash = 0.45;
  w.fight.heat += 1;
  w.fight.lastT = w.t;
  w.noise(info.pos, 2.4, 'pap', null);
  w.emit({ type: 'hint', text: `Hit by a paper ball${thrower ? ` from ${thrower.name}` : ''}! Throw it back?` });
  if (info.thrower !== 'player' && thrower && w.student(info.thrower)) {
    const aff = w.relations.toPlayer(info.thrower);
    if (aff >= 0) w.relations.change(info.thrower, 0.5, 'started a paper ball fight with you', w);
  }
  fightEscalation(w, info.thrower);
}

// ---------------------------------------------------------------------------------------------
// The teacher gets hit: how the class reacts

/** Everyone reacts by trait. Returns the classmates who saw who threw. */
export function classReactsToTeacherHit(w: World, info: HitInfo): string[] {
  const thrower = w.agent(info.thrower);
  const witnesses = thrower ? whoSees(w, thrower) : [];
  let k = 0;
  for (const s of w.students) {
    if (!s.agent.present) continue;
    const t = s.def.traits;
    const aff =
      info.thrower === 'player'
        ? w.relations.toPlayer(s.def.id)
        : w.relations.between(s.def.id, info.thrower);
    const fan = aff >= 25 || t.rebellious >= 0.5;
    const laughP = fan ? 0.8 : t.goody < 0.5 ? 0.35 : 0.1;
    k++;
    if (w.rngSocial.chance(laughP)) queueReact(w, s, 'laugh', 0.3 + (k % 5) * 0.14, info.thrower);
    else if (t.goody >= 0.5 || t.anxious >= 0.5) queueReact(w, s, 'gasp', 0.2 + (k % 4) * 0.1);
    else queueReact(w, s, 'sigh', 0.6 + (k % 3) * 0.2);
    // Everyone sits up straight for a while (phones away, no whispering).
    if (s.action !== 'break') {
      s.action = 'listen';
      s.actionT = 0;
      s.actionDur = 8 + (k % 4);
    }
    look(s, w.teacher.pos, 2.5);
  }
  return witnesses;
}

function look(s: StudentState, at: V2, secs: number): void {
  s.lookAt = { ...at };
  s.lookT = secs;
}
