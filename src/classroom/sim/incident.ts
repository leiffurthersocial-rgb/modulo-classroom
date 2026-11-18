// "Who threw that?!": the teacher's reaction to being hit by a paper ball (or plane).
// flinch (head snap, rub) -> hunt (scan from the impact direction, nerves spike near the origin)
// -> interrogate ("Was it you?", classmates may point, cover or shrug) -> identified (the normal
// watch -> confront -> penalty path, so it is always telegraphed) or a collective consequence
// (questions for everyone, a stricter teacher). Anger persists as a mood and calms over time.
// Pure TS.
import { TICK_DT } from './clock';
import { clamp, dist2, turnToward, type V2, yawTo } from './geom';
import { teacherCanSee } from './perception-system';
import { classReactsToTeacherHit, queueReact, setAnim } from './reactions';
import type { HitInfo, HitRegion, HitSide } from './throwing';
import { approachSpot, moveToward, pickRoutine, punish, setState, spot } from './teacher';
import type { World } from './world';

export interface Incident {
  thrower: string;
  origin: V2;
  region: HitRegion;
  side: HitSide;
  kind: string;
  /** The teacher saw who threw it (in view at the moment of impact). */
  seen: boolean;
  /** Classmates who saw the thrower. */
  witnesses: string[];
  suspects: string[];
  idx: number;
  asked: boolean;
  askT: number;
  spiked: boolean;
  handsChecked: boolean;
  rubbed: boolean;
  covers: number;
  reasons: string[];
  hits: number;
  t0: number;
  outcome: 'open' | 'identified' | 'collective';
}

/** Mood decay per second (about 80 s from furious to calm). */
export const ANGER_DECAY = 0.012;
const SUSPECT_RADIUS = 3.4;
const HUNT_TIME = 3.4;
const ANSWER_DELAY = 1.7;
const MAX_INTERROGATION = 18;

export const HIT_TEXT: Record<HitRegion, Record<HitSide, string>> = {
  head: {
    back: 'It hit the back of the head',
    side: 'It hit the side of the head',
    front: 'It hit the teacher in the face',
  },
  torso: {
    back: 'It hit the teacher in the back',
    side: 'It hit the teacher’s side',
    front: 'It hit the teacher in the chest',
  },
  legs: {
    back: 'It bounced off the teacher’s legs',
    side: 'It bounced off the teacher’s legs',
    front: 'It bounced off the teacher’s legs',
  },
};

export function newIncident(info: HitInfo, t: number): Incident {
  return {
    thrower: info.thrower,
    origin: { ...info.origin },
    region: info.region,
    side: info.side,
    kind: info.kind,
    seen: info.seen,
    witnesses: [],
    suspects: [],
    idx: 0,
    asked: false,
    askT: 0,
    spiked: false,
    handsChecked: false,
    rubbed: false,
    covers: 0,
    reasons: [],
    hits: 1,
    t0: t,
    outcome: 'open',
  };
}

/** How angry a hit makes the teacher (before the profile's strictness scaling). */
export function angerFor(info: HitInfo, strictness: number): number {
  const base = info.region === 'head' ? 0.85 : info.region === 'torso' ? 0.7 : 0.45;
  const side = info.side === 'front' ? 0.1 : info.side === 'back' ? -0.04 : 0;
  const plane = info.kind === 'paper-plane' ? 0.65 : 1;
  return clamp((base + side) * plane * (0.75 + 0.25 * strictness), 0.2, 1);
}

/** Called by the throw code the moment a ball touches the teacher. */
export function teacherHit(w: World, info: HitInfo): void {
  const T = w.teacher;
  const b = w.brain;
  if (!T.present || b.state === 'away' || b.state === 'leave') return;
  const thrower = w.agent(info.thrower);
  // What the teacher could see before turning their head.
  info.seen = !!thrower && teacherCanSee(w, thrower, 'torso');
  if (info.thrower === 'player') w.stats.hits.teacher++;
  b.anger = Math.max(b.anger, angerFor(info, w.profile.strictness));
  b.angerPeak = Math.max(b.angerPeak, b.anger);
  const prev = b.incident;
  if (prev && prev.outcome === 'open') {
    prev.hits++;
    prev.origin = { ...info.origin };
    prev.thrower = info.thrower;
    prev.seen = prev.seen || info.seen;
    prev.region = info.region;
    prev.side = info.side;
    prev.spiked = false;
    prev.handsChecked = false;
    prev.suspects = [];
    prev.idx = 0;
    prev.asked = false;
  } else b.incident = newIncident(info, w.t);
  const inc = b.incident!;
  w.emit({
    type: 'teacher-hit',
    who: info.thrower,
    kind: info.region,
    text: info.side,
    value: info.seen ? 1 : 0,
  });
  setState(w, 'flinch', 1.05);
  b.target = null;
  T.moving = false;
  T.path = null;
  b.lookAt = { ...info.origin };
  // The head snaps toward where it came from.
  T.headYaw = turnToward(T.headYaw, yawTo(T.pos, info.origin), 1.1);
  setAnim(T, w.t, 'teacher_flinch', 1.0);
  w.say(
    'teacher',
    'teacher',
    info.kind === 'paper-plane' ? 'hitPlane' : info.side === 'back' ? 'hitBack' : 'hit',
  );
  inc.witnesses = classReactsToTeacherHit(w, info);
  if (inc.seen) inc.reasons.push('You were in plain view when it hit.');
}

// -------------------------------------------------------------------------------------------------

/** Chance the teacher pins it on the player when they ask "Was it you?" (and why). */
export function playerGuilt(w: World, inc: Incident): { p: number; reasons: string[] } {
  if (inc.thrower !== 'player') return { p: 0, reasons: [] };
  const reasons: string[] = [];
  let p = 0.32;
  const held = w.items.find((i) => i.id === w.player.holding);
  if (held && (held.kind === 'paper-ball' || held.kind === 'paper-plane')) {
    p += 0.5;
    reasons.push('You were holding more paper.');
  }
  if (!w.player.sittingIn && !w.rules().break) {
    p += 0.25;
    reasons.push('You were out of your seat.');
  }
  if (w.ps.working) p *= 0.6;
  p += 0.3 * Math.min(1, w.susp('player').s);
  p -= 0.25 * inc.covers;
  if ((w.record.trust[w.profile.id] ?? 0) < -20) p += 0.1;
  return { p: clamp(p, 0.03, 0.95), reasons };
}

function nameOf(w: World, id: string): string {
  return w.agent(id)?.name ?? 'someone';
}

/** The teacher pins it on `id`. The player goes through the normal telegraphed penalty path. */
function identify(w: World, id: string, reasons: string[]): void {
  const b = w.brain;
  const inc = b.incident!;
  inc.outcome = 'identified';
  w.emit({ type: 'incident-identified', target: id });
  if (id === 'player') {
    const plane = inc.kind === 'paper-plane';
    const redHanded = inc.seen && inc.side === 'front';
    const lines = [HIT_TEXT[inc.region][inc.side] + '.', ...inc.reasons, ...reasons];
    if (redHanded)
      lines.push('A hit in the face, with you in view: that skips a step on the ladder.');
    b.pendingPunish = b.pendingPunish.filter((x) => x.target !== 'player');
    b.pendingPunish.push({
      target: 'player',
      kind: 'throw',
      severity: redHanded ? 0.9 : 0.75,
      summary: plane ? 'Hit the teacher with a paper plane' : 'Hit the teacher with a paper ball',
      extra: [...new Set(lines)],
    });
    const st = w.susp('player');
    st.s = Math.max(st.s, 1.05);
    st.lastEvidence = {
      kind: 'throw',
      point: 'handR',
      zone: inc.seen ? 'inner' : 'report',
      dist: dist2(w.teacher.pos, w.player.pos),
    };
    st.lastEvidenceT = w.t;
    setState(w, 'watch');
    b.target = 'player';
    b.watchStartT = w.t;
    b.watchLowT = 0;
    b.speaking = false;
    const named = w.profile.knowsNames;
    w.say('teacher', 'teacher', named ? 'identified' : 'identifiedAnon', { name: w.player.name });
    w.emit({ type: 'telegraph', target: 'player', value: 1 });
    b.incident = null;
    return;
  }
  // A classmate threw it: they get the normal warning.
  b.target = id;
  w.say('teacher', 'teacher', 'identified', { name: nameOf(w, id) });
  punish(w, id);
  setState(w, 'penalty', 2.5);
  b.target = id;
  b.lookAt = w.agent(id)?.pos ?? null;
  b.incident = null;
}

/** Nobody owns up: questions for everyone and a stricter teacher for the rest of the lesson. */
function collective(w: World): void {
  const b = w.brain;
  const inc = b.incident!;
  inc.outcome = 'collective';
  b.anger = Math.max(b.anger, 0.55);
  b.strictBonus = Math.min(0.3, b.strictBonus + 0.1);
  w.say('teacher', 'teacher', 'collective');
  w.emit({ type: 'collective' });
  const present = w.students.filter((s) => s.agent.present);
  const picks: string[] = [];
  for (let i = 0; i < 2 && present.length; i++) {
    const s = w.rngTeacher.pick(present);
    if (!picks.includes(s.agent.id)) picks.push(s.agent.id);
  }
  if (w.rngTeacher.chance(0.5)) picks.push('player');
  for (const id of picks) b.requests.push({ kind: 'question', target: id, pop: true });
  w.stats.classPenalties++;
  if (inc.thrower === 'player') {
    w.stats.cleanHits++;
    w.record.counters.cleanHits = (w.record.counters.cleanHits ?? 0) + 1;
  }
  b.incident = null;
  pickRoutine(w);
}

function startInterrogation(w: World): void {
  const b = w.brain;
  const inc = b.incident!;
  const cands: { id: string; score: number }[] = [];
  for (const s of w.students) {
    if (!s.agent.present) continue;
    const d = dist2(s.agent.pos, inc.origin);
    if (d > SUSPECT_RADIUS) continue;
    const laughing = w.t - s.lastLaughT < 4 ? 1.2 : 0;
    cands.push({ id: s.agent.id, score: d - laughing });
  }
  const pd = dist2(w.player.pos, inc.origin);
  if (pd <= SUSPECT_RADIUS) cands.push({ id: 'player', score: pd });
  cands.sort((x, y) => x.score - y.score);
  inc.suspects = cands.slice(0, 3).map((c) => c.id);
  inc.idx = 0;
  inc.asked = false;
  if (!inc.suspects.length) return collective(w);
  setState(w, 'interrogate', MAX_INTERROGATION);
  b.target = inc.suspects[0]!;
}

/** Nerves: everyone near the origin and in view gets a little suspicion (capped for classmates). */
function spike(w: World, inc: Incident): void {
  inc.spiked = true;
  for (const s of w.students) {
    if (!s.agent.present || dist2(s.agent.pos, inc.origin) > SUSPECT_RADIUS) continue;
    if (!teacherCanSee(w, s.agent, 'torso')) continue;
    const st = w.susp(s.agent.id);
    const laughing = w.t - s.lastLaughT < 3 ? 0.15 : 0;
    st.s = Math.min(0.45, Math.max(st.s, st.heat) + 0.25 + laughing);
    st.lastEvidence = {
      kind: 'throw',
      point: 'torso',
      zone: 'near',
      dist: dist2(w.teacher.pos, s.agent.pos),
    };
    st.lastEvidenceT = w.t;
  }
  if (inc.thrower === 'player' && dist2(w.player.pos, inc.origin) <= SUSPECT_RADIUS) {
    const st = w.susp('player');
    st.s = Math.min(0.6, st.s + 0.25);
    st.lastEvidence = {
      kind: 'throw',
      point: 'torso',
      zone: 'near',
      dist: dist2(w.teacher.pos, w.player.pos),
    };
    st.lastEvidenceT = w.t;
  }
}

/** Resolve one answer to "Was it you?". Returns true when somebody has been pinned. */
function resolveAnswer(w: World, id: string): boolean {
  const b = w.brain;
  const inc = b.incident!;
  const T = w.teacher;
  if (id === 'player') {
    const g = playerGuilt(w, inc);
    if (inc.thrower === 'player' && w.rngTeacher.next() < g.p) {
      identify(
        w,
        'player',
        g.reasons.length ? g.reasons : ['Asked point blank, you looked guilty.'],
      );
      return true;
    }
    return false;
  }
  const s = w.student(id);
  if (!s) return false;
  const t = s.def.traits;
  const witnessed = inc.witnesses.includes(id);
  if (inc.thrower === id) {
    // The thrower is a classmate: nerves decide.
    const p = 0.45 + 0.3 * t.anxious + 0.2 * (1 - t.rebellious);
    if (w.rngTeacher.next() < p) {
      identify(w, id, []);
      return true;
    }
    w.say(id, 'student', 'honest', { teacher: w.profile.name });
    return false;
  }
  if (inc.thrower === 'player') {
    const aff = w.relations.toPlayer(id);
    if (witnessed && t.snitch >= 0.4 && aff < 20) {
      w.say(id, 'student', 'pointAt', {
        target: w.profile.knowsNames ? w.player.name : 'that one',
      });
      queueReact(w, s, 'point', 0.05);
      w.relations.change(id, -3, 'pointed you out as the thrower', w);
      identify(w, 'player', ['A classmate pointed you out.']);
      return true;
    }
    if (witnessed && aff >= 30 && (t.helpful >= 0.3 || t.rebellious >= 0.3)) {
      w.say(id, 'student', 'coverFor');
      inc.covers++;
      w.relations.change(id, 2, 'covered for you ("it came from the window!")', w);
      w.emit({ type: 'covered', who: id });
      // The teacher glances toward the window.
      b.lookAt = spot(w, 'window', [8.55, 1.4]);
      T.moving = false;
      return false;
    }
    w.say(id, 'student', 'honest', { teacher: w.profile.name });
    return false;
  }
  // A classmate threw it: friends of the thrower keep quiet, snitches point.
  const thrower = w.student(inc.thrower);
  if (thrower && witnessed && t.snitch >= 0.4 && w.relations.between(id, inc.thrower) < 10) {
    w.say(id, 'student', 'pointAt', { target: thrower.def.name });
    queueReact(w, s, 'point', 0.05);
    identify(w, inc.thrower, []);
    return true;
  }
  w.say(id, 'student', 'honest', { teacher: w.profile.name });
  return false;
}

/** Per-tick behaviour of the flinch / hunt / interrogate states. */
export function updateIncident(w: World): void {
  const T = w.teacher;
  const b = w.brain;
  const inc = b.incident;
  if (!inc) return pickRoutine(w);
  switch (b.state) {
    case 'flinch': {
      T.moving = false;
      if (b.stateT >= 1.0 && !inc.rubbed) {
        inc.rubbed = true;
        setAnim(T, w.t, 'teacher_rub_head', 1.8);
      }
      if (b.stateT >= b.dur) {
        if (inc.seen) return identify(w, inc.thrower, []);
        setState(w, 'hunt', HUNT_TIME);
        b.faceYaw = yawTo(T.pos, inc.origin);
        w.say('teacher', 'teacher', 'hunt');
        w.emit({ type: 'hunt', pos: { ...inc.origin } });
      }
      return;
    }
    case 'hunt': {
      T.moving = false;
      b.faceYaw = yawTo(T.pos, inc.origin);
      T.yaw = turnToward(T.yaw, b.faceYaw, 2.4 * TICK_DT);
      if (b.stateT >= 0.9 && !inc.spiked) spike(w, inc);
      if (b.stateT >= 1.6 && !inc.handsChecked) {
        inc.handsChecked = true;
        const held = w.items.find((i) => i.id === w.player.holding);
        if (
          inc.thrower === 'player' &&
          held &&
          (held.kind === 'paper-ball' || held.kind === 'paper-plane') &&
          teacherCanSee(w, w.player, 'handR')
        )
          return identify(w, 'player', ['Caught holding more paper.']);
      }
      if (b.stateT >= b.dur) startInterrogation(w);
      return;
    }
    case 'interrogate': {
      const id = inc.suspects[inc.idx];
      const a = id ? w.agent(id) : undefined;
      if (!id || !a || b.stateT >= MAX_INTERROGATION) return collective(w);
      b.target = id;
      b.lookAt = { ...a.pos };
      const near = dist2(T.pos, a.pos) < 1.5;
      if (!near && !b.arrived) {
        b.arrived = moveToward(w, approachSpot(w, a.pos), 1.2);
        return;
      }
      b.arrived = true;
      T.moving = false;
      if (!inc.asked) {
        inc.asked = true;
        inc.askT = b.stateT;
        setAnim(T, w.t, 'teacher_accuse', ANSWER_DELAY + 0.3, false);
        w.say('teacher', 'teacher', 'interrogate', { name: a.name });
        w.emit({ type: 'interrogate', target: id });
        return;
      }
      if (b.stateT - inc.askT >= ANSWER_DELAY) {
        if (resolveAnswer(w, id)) return;
        inc.idx++;
        inc.asked = false;
        b.arrived = false;
        if (inc.idx >= inc.suspects.length) collective(w);
      }
      return;
    }
  }
}

/** Anger decay and the calm-down line. Called every tick from the teacher update. */
export function updateMood(w: World): void {
  const b = w.brain;
  if (b.anger <= 0) return;
  const before = b.anger;
  b.anger = Math.max(0, b.anger - ANGER_DECAY * TICK_DT);
  if (before >= 0.25 && b.anger < 0.25 && b.angerPeak >= 0.5) {
    b.angerPeak = 0;
    w.emit({ type: 'teacher-calm' });
    if (!['watch', 'confront', 'penalty', 'flinch', 'hunt', 'interrogate'].includes(b.state))
      w.say('teacher', 'teacher', 'calmDown');
  }
}
