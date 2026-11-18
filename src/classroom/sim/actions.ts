// More things to do from your chair (and a few near other people): fake cough chains, drumming,
// humming, leaning back, napping, silly questions, funny faces, seat swaps and flicking the lights.
// All harmless and cheeky: they use the existing senses (the teacher sees fidgeting, hears noises
// and blames whoever he can see), and classmates react by trait. Pure TS.
import { TICK_DT } from './clock';
import { clamp, dist2, type V2 } from './geom';
import { teacherCanSee } from './perception-system';
import { queueReact } from './reactions';
import type { ActId } from './types';
import type { World } from './world';

export interface FunState {
  act: { id: ActId; t: number; dur: number; n: number } | null;
  /** Chair tilt 0..1 (1 = it goes over). */
  lean: number;
  /** Seconds since a chair slam (camera shake). */
  slamT: number;
  sleepT: number;
  binStreak: number;
  binBest: number;
  /** Visible fidgeting 0..1.5 (decays); becomes 'mischief' evidence. */
  heat: number;
  lastActText: string;
  cooldowns: Record<string, number>;
  swap: { friend: string; origSeat: string; friendSeat: string; until: number } | null;
  coughCount: number;
  chain: number;
  chainT: number;
  chainDone: boolean;
  drummers: string[];
  wokeT: number;
}

export function newFunState(): FunState {
  return {
    act: null,
    lean: 0,
    slamT: 0,
    sleepT: 0,
    binStreak: 0,
    binBest: 0,
    heat: 0,
    lastActText: '',
    cooldowns: {},
    swap: null,
    coughCount: 0,
    chain: 0,
    chainT: -99,
    chainDone: false,
    drummers: [],
    wokeT: -99,
  };
}

/** Acts that need you to be sitting. */
const SEATED: ActId[] = ['drum', 'lean-back', 'nap'];
const DURATION: Record<ActId, number> = {
  cough: 0.6,
  drum: 6,
  hum: 7,
  'lean-back': 12,
  nap: 600,
  'silly-question': 0.1,
};

function hint(w: World, text: string): void {
  w.ps.hint = text;
  w.ps.hintT = w.t;
  w.emit({ type: 'hint', text });
}

function addHeat(w: World, amount: number, text: string): void {
  const f = w.ps.fun;
  f.heat = Math.min(1.5, f.heat + amount);
  f.lastActText = text;
}

function count(w: World, id: string): void {
  w.stats.acts[id] = (w.stats.acts[id] ?? 0) + 1;
}

function cd(w: World, key: string, secs: number): boolean {
  const f = w.ps.fun;
  if ((f.cooldowns[key] ?? -99) > w.t) return false;
  f.cooldowns[key] = w.t + secs;
  return true;
}

function spotPos(w: World, name: string, fb: [number, number]): V2 {
  const s = w.layout.spots?.[name] ?? fb;
  return { x: s[0], z: s[1] };
}

// ---------------------------------------------------------------------------------------------

export function stopAct(w: World, why?: string): void {
  const f = w.ps.fun;
  const a = f.act;
  if (!a) return;
  if (a.id === 'lean-back' && f.lean > 0.05) {
    if (f.lean >= 0.35) {
      w.emit({ type: 'lean-save', value: f.lean });
      w.stats.leanBest = Math.max(w.stats.leanBest, f.lean);
    }
    f.lean = 0;
  }
  if (a.id === 'nap' && f.sleepT > 0) w.emit({ type: 'wake', value: f.sleepT });
  f.act = null;
  f.sleepT = 0;
  w.emit({ type: 'act-end', kind: a.id, text: why });
}

/** Start (or stop, for toggles) a self-action. */
export function startAct(w: World, id: ActId): void {
  const f = w.ps.fun;
  const p = w.player;
  if (f.act && f.act.id === id && id !== 'cough') return stopAct(w, 'stopped');
  if (SEATED.includes(id) && !p.sittingIn) return hint(w, 'Sit down first.');
  if (w.ps.action) return hint(w, 'Busy right now.');
  switch (id) {
    case 'cough':
      if (!cd(w, 'cough', 4)) return hint(w, 'Give it a moment, or it gets obvious.');
      return doCough(w);
    case 'silly-question': {
      if (!w.teacher.present) return hint(w, 'There is nobody to ask.');
      if (w.ps.handRaised) return hint(w, 'Your hand is already up.');
      if (!cd(w, 'silly', 45)) return hint(w, 'One silly question per lesson stretch.');
      if (w.rules().test) return hint(w, 'Not during a test.');
      stopAct(w);
      w.ps.handRaised = true;
      w.brain.requests.push({ kind: 'question', target: 'player', pop: false, silly: true });
      w.emit({ type: 'raise-hand', who: 'player' });
      count(w, id);
      return;
    }
    case 'hum':
      if (!cd(w, 'hum', 8)) return hint(w, 'Take a breath first.');
      break;
    case 'drum':
      if (!cd(w, 'drum', 6)) return hint(w, 'Wait a little between drum solos.');
      break;
    case 'nap':
      if (w.rules().test) return hint(w, 'You can’t nap during a test.');
      break;
    case 'lean-back':
      break;
  }
  stopAct(w);
  f.act = { id, t: 0, dur: DURATION[id], n: 0 };
  f.lean = 0;
  f.sleepT = 0;
  count(w, id);
  w.emit({ type: 'act', who: 'player', kind: id });
}

function doCough(w: World): void {
  const f = w.ps.fun;
  const p = w.player;
  const sneeze = f.coughCount % 3 === 2;
  f.coughCount++;
  w.emit({
    type: 'bark',
    who: 'player',
    text: sneeze ? '*achoo*' : '*cough cough*',
    kind: sneeze ? 'sneeze' : 'cough',
  });
  w.noise(p.pos, sneeze ? 4 : 2.8, sneeze ? 'sneeze' : 'cough', 'player');
  addHeat(w, 0.45, 'a suspiciously healthy cough');
  count(w, 'cough');
  if (w.t - f.chainT > 12 || f.chainDone) {
    f.chain = 0;
    f.chainDone = false;
  }
  let joined = 0;
  for (const s of w.students) {
    if (!s.agent.present || joined >= 5 || dist2(s.agent.pos, p.pos) > 5.5) continue;
    if (s.agent.stance !== 'sit') continue;
    const t = s.def.traits;
    const aff = w.relations.toPlayer(s.def.id);
    let chance = 0.12 + 0.45 * t.rebellious + 0.2 * t.nosy + 0.15 * clamp(aff / 60, 0, 1);
    if (t.goody > 0.7) chance *= 0.4;
    if (!w.rngSocial.chance(chance)) continue;
    joined++;
    queueReact(w, s, sneeze && joined === 1 ? 'sneeze' : 'cough', 0.45 + 0.35 * joined);
  }
  f.chain += 1 + joined;
  f.chainT = w.t + 0.45 + 0.35 * joined;
}

// ---------------------------------------------------------------------------------------------
// Per-tick

function teacherNear(w: World, r: number): boolean {
  return w.teacher.present && dist2(w.teacher.pos, w.player.pos) < r;
}

export function updateActs(w: World): void {
  const f = w.ps.fun;
  const p = w.player;
  const dt = TICK_DT;
  f.heat = Math.max(0, f.heat - 0.25 * dt);
  f.slamT = Math.max(0, f.slamT - dt);

  // Cough chain payoff: a few coughs in a row make the teacher open a window.
  if (f.chain >= 1 && !f.chainDone && w.t >= f.chainT + 1.2) {
    f.chainDone = true;
    w.stats.coughChainBest = Math.max(w.stats.coughChainBest, f.chain);
    w.record.counters.coughChain = Math.max(w.record.counters.coughChain ?? 0, f.chain);
    if (f.chain >= 3) {
      w.emit({ type: 'cough-chain', value: f.chain });
      const b = w.brain;
      const free = ![
        'watch',
        'confront',
        'penalty',
        'flinch',
        'hunt',
        'interrogate',
        'away',
        'leave',
        'task',
      ].includes(b.state);
      if (f.chain >= 4 && w.teacher.present && free && b.anger < 0.4)
        b.tasks.push({
          kind: 'sick',
          dur: 6,
          pos: spotPos(w, 'window', [8.55, 1.4]),
          bark: 'sick',
        });
    }
    f.chain = 0;
  }

  // Classmates drumming / humming along keep going for a few seconds, and stop when the teacher is near.
  for (const s of w.students) {
    if (!s.agent.present) continue;
    const T = w.teacher;
    const close = T.present && dist2(T.pos, s.agent.pos) < 2.8;
    if (s.drumUntil > w.t) {
      if (close) s.drumUntil = 0;
      else if (Math.floor(w.t * 4) !== Math.floor((w.t - dt) * 4) && Math.floor(w.t * 4) % 4 !== 2)
        w.noise(s.agent.pos, 2.3, 'drum', s.agent.id);
    }
    if (s.humUntil > w.t) {
      if (close) s.humUntil = 0;
      else if (Math.floor(w.t) !== Math.floor(w.t - dt))
        w.noise(s.agent.pos, 2.0, 'hum', s.agent.id);
    }
  }

  // The seat swap lasts until the break, the end of the lesson or a couple of minutes.
  if (f.swap && (w.rules().break || w.t > f.swap.until)) revertSwap(w);

  const a = f.act;
  if (!a) return;
  a.t += dt;
  if (SEATED.includes(a.id) && !p.sittingIn) return stopAct(w, 'stood up');
  switch (a.id) {
    case 'drum': {
      // 4-beat bar: taps at 0, 0.25, 0.5, 0.875 s.
      const phase = a.t % 1;
      const prev = (a.t - dt) % 1;
      for (const b of [0, 0.25, 0.5, 0.875]) {
        if ((prev < b && phase >= b) || (a.t - dt < 0 && b === 0)) {
          w.noise(p.pos, 3.4, 'drum', 'player');
          w.emit({ type: 'drum', who: 'player', value: b });
        }
      }
      addHeat(w, 0.4 * dt, 'drumming on the table');
      // Rhythm spreads.
      if (Math.floor(a.t / 1.5) !== Math.floor((a.t - dt) / 1.5) && a.t >= 1.4) {
        let joined = 0;
        for (const s of w.students) {
          if (!s.agent.present || s.agent.stance !== 'sit' || s.drumUntil > w.t) continue;
          if (dist2(s.agent.pos, p.pos) > 3.6 || joined >= 2) continue;
          const t = s.def.traits;
          if (t.rebellious < 0.4 && w.relations.toPlayer(s.def.id) < 30) continue;
          if (!w.rngSocial.chance(0.5)) continue;
          joined++;
          queueReact(w, s, 'drum', 0.1);
          if (!f.drummers.includes(s.def.id)) f.drummers.push(s.def.id);
        }
        w.stats.drummersBest = Math.max(w.stats.drummersBest, f.drummers.length);
        w.record.counters.drumJoined = Math.max(
          w.record.counters.drumJoined ?? 0,
          f.drummers.length,
        );
      }
      if (teacherNear(w, 2.2) && teacherCanSee(w, p, 'head')) {
        // Hands off the table: it is over.
        return stopAct(w, 'teacher close');
      }
      if (a.t >= a.dur) stopAct(w, 'done');
      return;
    }
    case 'hum': {
      if (Math.floor(a.t) !== Math.floor(a.t - dt)) {
        w.noise(p.pos, 2.2, 'hum', 'player');
        w.emit({ type: 'hum', who: 'player' });
      }
      if (Math.floor(a.t / 2) !== Math.floor((a.t - dt) / 2) && a.t >= 1.9) {
        let joined = 0;
        for (const s of w.students) {
          if (
            !s.agent.present ||
            s.humUntil > w.t ||
            dist2(s.agent.pos, p.pos) > 3.8 ||
            joined >= 2
          )
            continue;
          if (s.def.traits.rebellious < 0.4 || !w.rngSocial.chance(0.4)) continue;
          joined++;
          queueReact(w, s, 'hum', 0.2);
        }
      }
      if (a.t >= a.dur) stopAct(w, 'done');
      return;
    }
    case 'lean-back': {
      f.lean = Math.min(1, f.lean + 0.3 * dt);
      addHeat(w, 0.3 * f.lean * dt, 'rocking on the back legs of the chair');
      if (Math.floor(a.t / 1.1) !== Math.floor((a.t - dt) / 1.1) && f.lean > 0.2) {
        w.noise(p.pos, 1.2, 'chair', 'player');
      }
      const risk = f.lean > 0.55 ? (f.lean - 0.55) * 0.03 : 0;
      if (f.lean >= 1 || (risk > 0 && w.rngSocial.next() < risk)) return slam(w);
      if (a.t >= a.dur) stopAct(w, 'done');
      return;
    }
    case 'nap': {
      f.sleepT += dt;
      if (f.sleepT > 5 && Math.floor(f.sleepT / 3.4) !== Math.floor((f.sleepT - dt) / 3.4)) {
        w.noise(p.pos, 2.6, 'snore', 'player');
        w.emit({ type: 'snore', who: 'player' });
        for (const s of w.students) {
          if (
            !s.agent.present ||
            dist2(s.agent.pos, p.pos) > 2.6 ||
            !cd(w, `snore:${s.def.id}`, 25)
          )
            continue;
          if (w.relations.toPlayer(s.def.id) >= 10 && w.rngSocial.chance(0.6)) {
            w.say(s.def.id, 'student', 'snoreGiggle');
            break;
          }
        }
      }
      if (w.susp('player').s < 0.3) {
        w.stats.napSeconds += dt;
        w.record.counters.napSeconds = (w.record.counters.napSeconds ?? 0) + dt;
      }
      // The teacher stops by your desk and wakes you.
      if (teacherNear(w, 1.4) && w.t - f.wokeT > 15) {
        f.wokeT = w.t;
        const st = w.susp('player');
        st.s = Math.max(st.s, 0.55);
        st.lastEvidence = {
          kind: 'sleeping',
          point: 'head',
          zone: 'near',
          dist: dist2(w.teacher.pos, p.pos),
        };
        st.lastEvidenceT = w.t;
        w.say('teacher', 'teacher', w.profile.knowsNames ? 'rise' : 'riseAnon', { name: p.name });
        stopAct(w, 'woken');
      }
      return;
    }
    case 'cough':
    case 'silly-question':
      f.act = null;
  }
}

/** The chair goes over: loud, funny, and everyone looks. */
function slam(w: World): void {
  const f = w.ps.fun;
  const p = w.player;
  f.slamT = 0.7;
  f.lean = 0;
  f.act = null;
  w.stats.crashes++;
  addHeat(w, 0.9, 'a chair crashing over');
  w.noise(p.pos, 7, 'crash', 'player');
  w.emit({ type: 'crash', who: 'player' });
  w.emit({ type: 'act-end', kind: 'lean-back', text: 'crash' });
  let k = 0;
  for (const s of w.students) {
    if (!s.agent.present || dist2(s.agent.pos, p.pos) > 6) continue;
    k++;
    const t = s.def.traits;
    if (t.rebellious >= 0.4 || w.relations.toPlayer(s.def.id) >= 20)
      queueReact(w, s, 'laugh', 0.3 + 0.1 * k, 'player');
    else queueReact(w, s, 'gasp', 0.2 + 0.1 * k);
    if (k >= 6) break;
  }
}

// ---------------------------------------------------------------------------------------------
// Verbs on other things: funny face, swap seats, flick the lights (started from interact())

export type FunVerb = 'face' | 'swap-seat' | 'flick-lights';

/** Gate for the interact verbs. Returns an error text, or null if it can start. */
export function canStartFunVerb(w: World, verb: FunVerb, target: string): string | null {
  const r = w.rules();
  switch (verb) {
    case 'face': {
      const s = w.student(target);
      if (!s || !s.agent.present) return 'They are not here.';
      if ((w.ps.fun.cooldowns[`face:${target}`] ?? -99) > w.t)
        return 'They have seen that one already.';
      return null;
    }
    case 'swap-seat': {
      const s = w.student(target);
      if (!s || !s.agent.sittingIn) return 'They are not at a seat.';
      if (!w.player.sittingIn) return 'Sit down first.';
      if (w.ps.fun.swap) return 'Once per lesson is enough.';
      if (r.break) return 'Everyone is up already.';
      if (r.test) return 'Not during a test.';
      if (w.relations.toPlayer(target) < 15) return `${s.def.name} is not that kind of friend yet.`;
      return null;
    }
    case 'flick-lights':
      if ((w.ps.fun.cooldowns.lights ?? -99) > w.t) return 'Give it a minute.';
      return null;
  }
}

export function funVerbDuration(verb: FunVerb): number {
  return verb === 'face' ? 1.2 : verb === 'swap-seat' ? 2.0 : 0.7;
}

export function beginFunVerb(w: World, verb: FunVerb, target: string): void {
  addHeat(
    w,
    verb === 'face' ? 0.45 : 0.6,
    verb === 'face'
      ? 'pulling faces'
      : verb === 'swap-seat'
        ? 'swapping seats'
        : 'playing with the lights',
  );
  if (verb === 'swap-seat') w.say(target, 'student', 'swapYes');
  count(w, verb);
  stopAct(w);
}

export function completeFunVerb(w: World, verb: FunVerb, target: string): void {
  switch (verb) {
    case 'face':
      return resolveFace(w, target);
    case 'swap-seat':
      return doSwap(w, target);
    case 'flick-lights':
      return flickLights(w);
  }
}

function resolveFace(w: World, id: string): void {
  const s = w.student(id);
  if (!s) return;
  w.ps.fun.cooldowns[`face:${id}`] = w.t + 40;
  const t = s.def.traits;
  const aff = w.relations.toPlayer(id);
  const score = 0.55 * (1 - t.goody) + 0.25 * t.rebellious + 0.2 * clamp((aff + 20) / 80, 0, 1);
  if (w.rngSocial.next() < score) {
    queueReact(w, s, 'laugh', 0.2, 'player');
    w.say(id, 'student', 'faceLaugh');
    w.relations.change(id, aff < 0 ? 1.5 : 2.5, 'laughed at your funny face', w);
    w.stats.facesLaughed++;
    w.record.counters.facesLaughed = (w.record.counters.facesLaughed ?? 0) + 1;
    w.emit({ type: 'face-result', who: id, value: 1 });
  } else {
    queueReact(w, s, 'glare', 0.3, 'quiet');
    w.say(id, 'student', 'faceRoll');
    w.relations.change(id, -1.5, 'rolled their eyes at your funny face', w);
    w.emit({ type: 'face-result', who: id, value: 0 });
  }
}

function doSwap(w: World, id: string): void {
  const s = w.student(id);
  const p = w.player;
  if (!s || !s.agent.sittingIn || !p.sittingIn) return;
  const seatA = p.sittingIn;
  const seatB = s.agent.sittingIn;
  const A = w.seat(seatA)!;
  const B = w.seat(seatB)!;
  p.pos = { x: B.pos[0], z: B.pos[1] };
  p.yaw = (B.facing * Math.PI) / 180;
  p.sittingIn = seatB;
  p.seat = seatB;
  s.agent.pos = { x: A.pos[0], z: A.pos[1] };
  s.agent.yaw = (A.facing * Math.PI) / 180;
  s.agent.sittingIn = seatA;
  s.agent.seat = seatA;
  w.ps.fun.swap = { friend: id, origSeat: seatA, friendSeat: seatB, until: w.t + 150 };
  w.noise(p.pos, 1.6, 'chair', 'player');
  w.stats.swaps++;
  w.emit({ type: 'swap', who: 'player', target: id });
  w.relations.change(id, 1, 'swapped seats with you', w);
}

export function revertSwap(w: World): void {
  const f = w.ps.fun;
  const sw = f.swap;
  if (!sw) return;
  f.swap = null;
  const s = w.student(sw.friend);
  const p = w.player;
  const A = w.seat(sw.origSeat);
  const B = w.seat(sw.friendSeat);
  if (!s || !A || !B) return;
  s.agent.seat = sw.friendSeat;
  p.seat = sw.origSeat;
  // Quietly slide back when both are still seated where they swapped to.
  if (p.sittingIn === sw.friendSeat && s.agent.sittingIn === sw.origSeat) {
    p.pos = { x: A.pos[0], z: A.pos[1] };
    p.yaw = (A.facing * Math.PI) / 180;
    p.sittingIn = sw.origSeat;
    s.agent.pos = { x: B.pos[0], z: B.pos[1] };
    s.agent.yaw = (B.facing * Math.PI) / 180;
    s.agent.sittingIn = sw.friendSeat;
  }
  w.emit({ type: 'swap-back', target: sw.friend });
}

function flickLights(w: World): void {
  w.ps.fun.cooldowns.lights = w.t + 45;
  w.objects.lightsOff = 2.2;
  const door = spotPos(w, 'door', [0.85, 6.75]);
  w.noise(door, 2.2, 'click', 'player');
  w.stats.lightFlicks++;
  w.emit({ type: 'lights-flick' });
  let k = 0;
  for (const s of w.students) {
    if (!s.agent.present) continue;
    const t = s.def.traits;
    k++;
    if (t.rebellious >= 0.4 && w.rngSocial.chance(0.7)) queueReact(w, s, 'laugh', 0.25 + 0.08 * k);
    else if (t.goody >= 0.5 || t.anxious >= 0.5) queueReact(w, s, 'gasp', 0.15 + 0.06 * k);
  }
  const b = w.brain;
  const free = ![
    'watch',
    'confront',
    'penalty',
    'flinch',
    'hunt',
    'interrogate',
    'away',
    'leave',
    'task',
  ].includes(b.state);
  if (w.teacher.present && free)
    b.tasks.push({ kind: 'lights', dur: 4, pos: door, bark: 'lightsFlick' });
}
