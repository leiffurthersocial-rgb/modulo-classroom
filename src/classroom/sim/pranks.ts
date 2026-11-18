// Data-driven harmless pranks: setup (visible fiddling) → delayed effect → teacher distraction
// (cover for other mischief) → "Who did this?" where witnesses may tell. Pure TS.
// Hard rule: nothing targets a person's body, harms belongings or touches private information.
import { PRANKS, type PhaseRules, type PrankDef, type Traits } from './data';
import { type V2 } from './geom';
import { EYE_HEIGHT, lineOfSight, personBox, samplePoint } from './perception';
import type { World } from './world';
import { yawTo, wrapAngle } from './geom';

export interface PrankRun {
  id: string;
  def: PrankDef;
  target: string;
  t0: number;
  effectAt: number;
  effectDone: boolean;
  resolved: boolean;
  witnesses: string[];
  /** Teacher confronted the player during setup, or caught them lingering in the risk window. */
  seen: boolean;
  /** Distance from each witness to the player at setup (snitch chance falls with distance). */
  witnessDist: Record<string, number>;
  /** Witnesses who liked it (they keep quiet) / disapproved (more likely to tell). */
  fans: string[];
  haters: string[];
  /** A witness told the teacher (set on resolution). */
  told?: boolean;
  knockUntil?: number;
  nextKnock?: number;
}

export function canStartPrank(w: World, id: string, target: string): string | null {
  const def = PRANKS.find((p) => p.id === id);
  if (!def) return 'Unknown prank.';
  if (w.pranks.some((p) => p.id === id)) return 'Once per lesson is plenty.';
  const clash = prankConflict(w, def);
  if (clash) return clash;
  if (def.requires === 'break' && !w.rules().break)
    return 'Only during the break, when the seats are empty.';
  if (def.requires === 'plane') {
    const held = w.items.find((i) => i.id === w.player.holding);
    if (held?.kind !== 'paper-plane') return 'Fold a paper plane first.';
  }
  if (def.requires === 'carry-free' && w.player.holding) return 'Hands full.';
  if (id === 'swap-chair' && !w.seat(target)) return 'Pick a classmate’s chair.';
  return null;
}

/** Why a prank can't be set up alongside the ones already running (null = fine). */
export function prankConflict(w: World, def: PrankDef): string | null {
  for (const run of w.pranks) {
    if (run.resolved) continue;
    if (def.conflicts?.includes(run.id) || run.def.conflicts?.includes(def.id))
      return 'Something else is already messing with that.';
  }
  return null;
}

/** Whether a prank may still be offered as a verb (not done this lesson, no conflict). */
export function prankOffered(w: World, def: PrankDef): boolean {
  return !w.pranks.some((p) => p.id === def.id) && !prankConflict(w, def);
}

/** Verbs for the generic (data-driven) pranks that target an interactable. */
export function prankVerbsFor(
  w: World,
  targetId: string,
): { verb: string; label: string; risk?: 'loud' | 'risky' }[] {
  const out: { verb: string; label: string; risk?: 'loud' | 'risky' }[] = [];
  for (const def of PRANKS) {
    if (!def.verb || def.target !== targetId || !prankOffered(w, def)) continue;
    if (def.requires === 'break' && !w.rules().break) continue;
    out.push({ verb: `prank:${def.id}`, label: def.verb, risk: def.risk });
  }
  return out;
}

/** Is the projector (or document camera) in use right now? Projector pranks only bite then. */
export function projectorInUse(w: World): boolean {
  return !!w.rules().dim || w.brain.state === 'laptop';
}

function spotPos(w: World, name: string | undefined): V2 {
  const s = w.layout.spots?.[name ?? 'desk'] ?? w.layout.spots?.desk ?? [1.2, 0.35];
  return { x: s[0], z: s[1] };
}

function comboOn(w: World, def: PrankDef): boolean {
  const r = w.rules();
  return !!def.combo?.rules.some((k: keyof PhaseRules) => r[k]);
}

const TASK_POS: Record<string, V2> = {
  'marker-missing': { x: 1.2, z: 0.35 },
  'no-signal': { x: 1.2, z: 0.35 },
  gust: { x: 1.2, z: 0.35 },
  'posters-swapped': { x: 6.6, z: 8.2 },
  'plane-on-desk': { x: 1.2, z: 0.35 },
  sticker: { x: 5.6, z: 0.6 },
  'radiator-knock': { x: 10.3, z: 4.9 },
  'doccam-flipped': { x: 1.2, z: 0.35 },
};

const TASK_BARK: Record<string, string> = {
  'marker-missing': 'markerMissing',
  'no-signal': 'noSignal',
  gust: 'gust',
  'posters-swapped': 'posters',
  'plane-on-desk': 'plane',
  sticker: 'sticker',
  'radiator-knock': 'radiator',
  'doccam-flipped': 'doccam',
};

/** Who can see the player right now (classmates only). */
function witnesses(w: World): string[] {
  const p = w.player;
  const pt = samplePoint(p, 'torso');
  const out: string[] = [];
  for (const s of w.students) {
    const a = s.agent;
    if (!a.present) continue;
    const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
    if (d > 7.5) continue;
    if (Math.abs(wrapAngle(yawTo(a.pos, p.pos) - a.headYaw)) > 1.9) continue;
    const eye = { x: a.pos.x, y: EYE_HEIGHT[a.stance], z: a.pos.z };
    const occ = [
      ...w.geo.occluders,
      ...w.students.filter((o) => o !== s).map((o) => personBox(o.agent)),
    ];
    if (lineOfSight(eye, pt, occ, [a.id, 'player'], false)) out.push(a.id);
  }
  return out;
}

/** Generic (data-driven) effects that become visible as soon as the setup is done. */
function applyGeneric(w: World, def: PrankDef): void {
  const o = w.objects;
  switch (def.effect.kind) {
    case 'duck-on-doccam':
      o.duckOnDocCam = true;
      break;
    case 'marker-dry':
      o.markerDry = true;
      break;
    case 'oo-sign':
      o.outOfOrderSign = true;
      break;
    case 'sticky-mosaic':
      o.stickyMosaic = true;
      break;
    case 'chairs-back':
      o.turnedSeats = w.layout.seats
        .filter((s) => !w.allAgents().some((a) => a.sittingIn === s.id))
        .map((s) => s.id);
      break;
    case 'remote-hidden':
      o.remoteHidden = true;
      break;
    case 'cup-pyramid':
      o.cupPyramid = true;
      break;
    case 'posters-flipped':
      o.postersFlipped = true;
      break;
    case 'ghost-smiley':
      o.ghostSmiley = 'hidden';
      break;
    // bird-alarm / clock-silly surface later (see trigger()).
  }
}

function clearGeneric(w: World, kind: string): void {
  const o = w.objects;
  switch (kind) {
    case 'duck-on-doccam':
      o.duckOnDocCam = false;
      break;
    case 'marker-dry':
      o.markerDry = false;
      break;
    case 'oo-sign':
      o.outOfOrderSign = false;
      break;
    case 'sticky-mosaic':
      o.stickyMosaic = false;
      break;
    case 'chairs-back':
      o.turnedSeats = [];
      break;
    case 'remote-hidden':
      o.remoteHidden = false;
      break;
    case 'cup-pyramid':
      o.cupPyramid = false;
      break;
    case 'clock-silly':
      o.clockSilly = false;
      break;
    case 'posters-flipped':
      o.postersFlipped = false;
      break;
    case 'ghost-smiley':
      o.ghostSmiley = 'none';
      break;
    case 'bird-alarm':
      o.birdAlarm = false;
      break;
  }
}

/** Sum of a prank's opinion deltas that apply to a classmate with these traits. */
export function opinionOf(def: PrankDef, t: Traits): number {
  let v = 0;
  for (const [k, d] of Object.entries(def.opinions ?? {})) if (t[k as keyof Traits] >= 0.5) v += d;
  return v;
}

export function completePrank(w: World, id: string, target: string, itemId?: string): void {
  const def = PRANKS.find((p) => p.id === id);
  if (!def || w.pranks.some((p) => p.id === id)) return;
  const o = w.objects;
  switch (def.effect.kind) {
    case 'marker-missing':
      o.markerHidden = true;
      break;
    case 'no-signal':
      o.projectorInput = 2;
      break;
    case 'gust':
      o.windowOpen = true;
      break;
    case 'wobbly-chair':
      o.wobblySeat = target;
      break;
    case 'clock-fast':
      o.clockOffsetMin = def.effect.minutes ?? 5;
      break;
    case 'posters-swapped':
      o.posterOrder = [1, 0, 3, 2];
      break;
    case 'plane-on-desk':
      o.planeOnDesk = true;
      if (itemId) w.removeItem(itemId);
      else if (w.player.holding) {
        w.removeItem(w.player.holding);
        w.player.holding = null;
      }
      break;
    case 'sticker':
      o.sticker = true;
      break;
    case 'doccam-flipped':
      o.docCamFlipped = true;
      break;
    default:
      applyGeneric(w, def);
  }
  const wit = witnesses(w);
  const run: PrankRun = {
    id,
    def,
    target,
    t0: w.t,
    effectAt: w.t + def.delay,
    effectDone: false,
    resolved: false,
    witnesses: wit,
    witnessDist: {},
    fans: [],
    haters: [],
    seen:
      w.brain.target === 'player' && (w.brain.state === 'confront' || w.brain.state === 'penalty'),
  };
  w.pranks.push(run);
  w.emit({ type: 'prank', kind: id, text: def.name });
  // Classmates' opinions: rebels love it, goody-goodies don't (per prank, by trait).
  for (const sid of wit) {
    const s = w.student(sid)!;
    run.witnessDist[sid] = Math.hypot(
      s.agent.pos.x - w.player.pos.x,
      s.agent.pos.z - w.player.pos.z,
    );
    const t = s.def.traits;
    let op = opinionOf(def, t);
    if (!def.opinions) op = t.rebellious > 0.5 ? 3 : t.goody > 0.6 ? -3 : 0;
    if (op > 0) {
      run.fans.push(sid);
      w.relations.change(sid, op, `saw your prank (${def.name.toLowerCase()})`, w);
      if (w.rngSocial.chance(0.5)) w.say(sid, 'student', 'prankLove');
    } else if (op < 0) {
      run.haters.push(sid);
      w.relations.change(sid, op, `disapproved of your prank (${def.name.toLowerCase()})`, w);
      if (w.rngSocial.chance(0.4)) w.say(sid, 'student', 'prankHate');
    }
  }
}

/** Spots a few classmates grin when the prank surfaces (relationships shift on admiration). */
function classLaughs(w: World, run: PrankRun, everyone: boolean): void {
  let n = 0;
  for (const s of w.students) {
    if (!s.agent.present) continue;
    const t = s.def.traits;
    if (!everyone && t.rebellious < 0.4 && t.nosy < 0.6) continue;
    if (n >= (everyone ? 4 : 2)) break;
    n++;
    w.say(s.agent.id, 'student', 'laugh');
    if (t.rebellious >= 0.5 && !run.witnesses.includes(s.agent.id) && w.rngSocial.chance(0.5))
      w.relations.change(s.agent.id, 1, `grinned at the ${run.def.name.toLowerCase()}`, w);
  }
}

/** Queue the teacher's reaction task for a prank (once). */
function trigger(w: World, run: PrankRun): void {
  if (run.effectDone) return;
  run.effectDone = true;
  const def = run.def;
  const kind = def.effect.kind;
  if (kind === 'gust') {
    const win = w.layout.spots?.window ?? [8.55, 1.4];
    w.noise({ x: win[0], z: win[1] }, 5, 'gust', null);
    w.emit({ type: 'gust' });
  }
  if (kind === 'radiator-knock') {
    run.knockUntil = w.t + (def.effect.duration ?? 30);
    run.nextKnock = w.t;
    return;
  }
  if (kind === 'wobbly-chair' || kind === 'clock-fast') return; // handled elsewhere
  if (def.trigger) {
    // Generic pranks: the teacher's task is described by the data.
    const combo = comboOn(w, def);
    const mul = combo ? (def.combo?.distractionMul ?? 1) : 1;
    if (kind === 'clock-silly') w.objects.clockSilly = true;
    if (kind === 'ghost-smiley') w.objects.ghostSmiley = 'shown';
    w.emit({ type: 'prank-surfaced', kind: def.id, value: combo ? 1 : 0 });
    classLaughs(w, run, combo || kind === 'ghost-smiley');
    const pos = spotPos(w, def.at);
    w.brain.tasks.push({
      kind,
      dur: def.distraction * mul,
      pos,
      bark: def.bark ?? 'investigate',
      prank: def.followUp ? undefined : run.id,
    });
    if (def.followUp)
      w.brain.tasks.push({
        kind: def.followUp.kind,
        dur: def.followUp.dur,
        pos: spotPos(w, def.followUp.at),
        bark: def.followUp.bark,
        prank: run.id,
      });
    return;
  }
  w.brain.tasks.push({
    kind,
    dur: def.distraction,
    pos: TASK_POS[kind] ?? { x: 1.2, z: 0.35 },
    bark: TASK_BARK[kind] ?? 'investigate',
    prank: run.id,
  });
}

/** Is the teacher in a position to notice/need the prank right now? (generic pranks) */
function triggerReady(w: World, run: PrankRun): boolean {
  const def = run.def;
  // Eventually the teacher gets round to the projector / desk / back wall anyway.
  const patient = w.t - run.effectAt > (def.patience ?? 120);
  const T = w.teacher;
  const b = w.brain;
  if (!T.present || b.state === 'away' || b.state === 'leave' || b.state === 'task') return false;
  if (b.state === 'watch' || b.state === 'confront' || b.state === 'penalty') return false;
  if (patient && def.trigger !== 'class') return true;
  switch (def.trigger) {
    case 'projector':
      return comboOn(w, def) || projectorInUse(w);
    case 'board':
      return b.state === 'board';
    case 'laptop':
      return b.state === 'laptop';
    case 'near':
      return Math.hypot(T.pos.x - spotPos(w, def.at).x, T.pos.z - spotPos(w, def.at).z) < 2.2;
    case 'class':
      return true; // the teacher is in the room and about to see it
    case 'timer':
      return true;
  }
  return false;
}

export function updatePranks(w: World): void {
  const b = w.brain;
  const o = w.objects;
  // Turned chairs straighten themselves as soon as somebody sits in them.
  if (o.turnedSeats.length)
    o.turnedSeats = o.turnedSeats.filter((id) => !w.allAgents().some((a) => a.sittingIn === id));
  for (const run of w.pranks) {
    if (run.resolved) continue;
    const def = run.def;
    const k = def.effect.kind;
    if (def.trigger) {
      updateGeneric(w, run);
      continue;
    }
    if (!run.effectDone && w.t >= run.effectAt) {
      // Some effects only fire when the teacher needs the object.
      const needsUse =
        (k === 'marker-missing' && b.state === 'board') ||
        ((k === 'no-signal' || k === 'doccam-flipped') && b.state === 'laptop') ||
        (k === 'sticker' && b.state === 'board') ||
        (k === 'plane-on-desk' &&
          w.teacher.present &&
          Math.hypot(w.teacher.pos.x - 1.2, w.teacher.pos.z - 0.6) < 1.6) ||
        (k === 'posters-swapped' &&
          w.teacher.present &&
          w.teacher.pos.z > 3.2 &&
          w.rngSocial.chance(0.01)) ||
        k === 'gust' ||
        k === 'radiator-knock';
      if (needsUse) trigger(w, run);
    }
    if (run.knockUntil !== undefined) {
      if (w.t < run.knockUntil) {
        if (w.t >= (run.nextKnock ?? 0)) {
          const rad = w.layout.spots?.radiator ?? [8.55, 2.6];
          w.noise({ x: rad[0], z: rad[1] }, 6, 'knock', null);
          run.nextKnock = w.t + 3 + w.rngSocial.next() * 3;
          if (
            !b.tasks.some((t) => t.prank === run.id) &&
            !run.resolved &&
            w.t - run.effectAt > 6 &&
            !b.taskDone.includes(run.id)
          )
            b.tasks.push({
              kind: 'radiator-knock',
              dur: def.distraction,
              pos: TASK_POS['radiator-knock']!,
              bark: 'radiator',
              prank: run.id,
            });
        }
      } else if (b.taskDone.includes(run.id)) resolvePrank(w, run);
    }
    if (k === 'wobbly-chair' && run.effectDone === false && b.taskDone.includes(run.id)) {
      run.effectDone = true;
    }
    if (b.taskDone.includes(run.id) && run.knockUntil === undefined) resolvePrank(w, run);
    // Pranks that never get noticed still count as clean at lesson end (see summary).
  }
}

/** Data-driven pranks: armed → (risk window) → surfaces → teacher task(s) → resolved. */
function updateGeneric(w: World, run: PrankRun): void {
  const b = w.brain;
  const def = run.def;
  const k = def.effect.kind;
  const T = w.teacher;
  if (run.effectDone) {
    if (k === 'bird-alarm') chirp(w, run);
    if (b.taskDone.includes(run.id)) resolvePrank(w, run);
    return;
  }
  if (w.t < run.effectAt) return;
  // Risk window: while the prank is fresh, a teacher walking past the spot finds it early, and
  // being caught lingering there counts against you.
  const inWindow = def.riskWindow !== undefined && w.t < run.t0 + def.riskWindow;
  const spot = spotPos(w, def.at);
  const passing =
    inWindow &&
    T.present &&
    b.state !== 'away' &&
    Math.hypot(T.pos.x - spot.x, T.pos.z - spot.z) < 1.6;
  if (passing && Math.hypot(w.player.pos.x - spot.x, w.player.pos.z - spot.z) < 2.0)
    run.seen = true;
  if (k === 'chairs-back' && !w.objects.turnedSeats.length) {
    // Everyone sat in them already: nothing to find. Fizzles silently.
    run.resolved = true;
    clearGeneric(w, k);
    return;
  }
  if (passing || triggerReady(w, run)) {
    if (k === 'bird-alarm') {
      run.effectDone = true;
      run.knockUntil = w.t + (def.effect.duration ?? 30);
      run.nextKnock = w.t;
      w.objects.birdAlarm = true;
      w.emit({ type: 'prank-surfaced', kind: def.id, value: 0 });
      classLaughs(w, run, false);
      return;
    }
    trigger(w, run);
  }
}

/** The hidden alarm chirps until the teacher hunts it down. */
function chirp(w: World, run: PrankRun): void {
  const def = run.def;
  const b = w.brain;
  const n = def.effect.noise;
  if (!n || run.knockUntil === undefined) return;
  if (w.t >= run.knockUntil) {
    // Battery ran out: it just stops (the teacher may never have found it).
    if (!b.tasks.some((t) => t.prank === run.id) && b.task?.prank !== run.id) resolvePrank(w, run);
    return;
  }
  if (w.t >= (run.nextKnock ?? 0)) {
    const p = spotPos(w, n.at);
    w.noise(p, n.radius, n.kind, null);
    run.nextKnock = w.t + n.every[0] + w.rngSocial.next() * (n.every[1] - n.every[0]);
    if (
      !b.tasks.some((t) => t.prank === run.id) &&
      b.task?.prank !== run.id &&
      !b.taskDone.includes(run.id) &&
      w.t - run.effectAt > 4
    )
      b.tasks.push({
        kind: def.effect.kind,
        dur: def.distraction,
        pos: p,
        bark: def.bark ?? 'investigate',
        prank: run.id,
      });
  }
}

/** Snitch probability for one witness (exported for tests and the balance notes). */
export function snitchChance(w: World, run: PrankRun, sid: string): number {
  const s = w.student(sid);
  if (!s?.agent.present) return 0;
  const aff = w.relations.toPlayer(sid);
  const t = s.def.traits;
  // Friends and fans of the prank keep quiet; goody-goodies and grudges tell.
  if ((run.fans.includes(sid) && aff >= 0) || aff >= 40) return 0;
  const affF = Math.min(1.5, Math.max(0.08, 1 - aff / 60));
  const opF = run.haters.includes(sid) ? 1.3 : run.fans.includes(sid) ? 0.3 : 1;
  const dist = run.witnessDist[sid] ?? 4;
  const distF = Math.min(1, Math.max(0.35, 1.15 - dist / 9));
  return Math.min(0.95, t.snitch * SNITCH_BASE * affF * opF * distF * (run.def.snitchMul ?? 1));
}

/** Overall willingness to tell (tuned with the balance runner). */
export const SNITCH_BASE = 0.18;

/** After the teacher dealt with a prank: "Who did this?" Witnesses may tell. */
export function resolvePrank(w: World, run: PrankRun): void {
  if (run.resolved) return;
  run.resolved = true;
  const o = w.objects;
  switch (run.def.effect.kind) {
    case 'marker-missing':
      o.markerHidden = false;
      break;
    case 'no-signal':
      o.projectorInput = 1;
      break;
    case 'gust':
      o.windowOpen = false;
      break;
    case 'wobbly-chair':
      o.wobblySeat = null;
      break;
    case 'posters-swapped':
      o.posterOrder = [0, 1, 2, 3];
      break;
    case 'plane-on-desk':
      o.planeOnDesk = false;
      break;
    case 'sticker':
      o.sticker = false;
      break;
    case 'doccam-flipped':
      o.docCamFlipped = false;
      break;
    default:
      clearGeneric(w, run.def.effect.kind);
  }
  let told = false;
  for (const sid of run.witnesses) {
    const p = snitchChance(w, run, sid);
    if (p > 0 && w.rngSocial.next() < p) {
      told = true;
      w.say(sid, 'student', 'snitch', {
        teacher: w.profile.name,
        target: w.profile.knowsNames ? w.player.name : 'that one',
      });
      const st = w.susp('player');
      st.s = Math.max(st.s, 1.05);
      st.lastEvidence = { kind: 'reported', point: 'head', zone: 'report', dist: 0 };
      st.lastEvidenceT = w.t;
      w.brain.pendingPunish.push({
        target: 'player',
        kind: 'prank',
        severity: 0.6,
        summary: `Prank: ${run.def.name.toLowerCase()} (a classmate told)`,
      });
      w.relations.change(sid, -2, 'told on your prank', w);
      break;
    }
    const s = w.student(sid);
    const aff = w.relations.toPlayer(sid);
    if (s?.agent.present && (aff > 30 || run.fans.includes(sid)) && w.rngSocial.chance(0.3))
      w.say(sid, 'student', 'deny');
  }
  run.told = told;
  const clean = !told && !run.seen;
  if (clean) {
    // Fans who kept quiet think a little better of you.
    for (const sid of run.fans)
      if (w.rngSocial.chance(0.5)) w.relations.change(sid, 1, 'kept quiet about your prank', w);
  }
  w.stats.pranks.push({ id: run.id, clean });
  if (clean) w.record.counters.pranksClean = (w.record.counters.pranksClean ?? 0) + 1;
  w.emit({ type: 'prank-resolved', kind: run.id, value: clean ? 1 : 0 });
}
