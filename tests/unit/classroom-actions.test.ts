import { describe, expect, it } from 'vitest';
import { Bot, runLesson } from '../../src/classroom/sim/bots';
import { dist2, yawDir, yawTo } from '../../src/classroom/sim/geom';
import { teacherCanSee } from '../../src/classroom/sim/perception-system';
import { Rng } from '../../src/classroom/sim/rng';
import { binPos, flightAt } from '../../src/classroom/sim/throwing';
import { idleCommand, type PlayerCommand, type SimEvent } from '../../src/classroom/sim/types';
import { World } from '../../src/classroom/sim/world';

function run(
  w: World,
  secs: number,
  cmd: (t: number) => PlayerCommand,
  until?: (e: SimEvent[]) => boolean,
) {
  const out: SimEvent[] = [];
  const n = Math.round(secs * 20);
  for (let i = 0; i < n && !w.over; i++) {
    w.step(cmd(i));
    const ev = w.drainEvents();
    out.push(...ev);
    if (until?.(ev)) break;
  }
  return out;
}

const seatedIdle = (w: World): PlayerCommand => idleCommand(w.player.yaw, 0);

/** Teacher frozen in place ('facing', arrived) at distance d from the seated player along the look direction. */
function stage(opts: { seed?: number; teacher?: string; d: number; away: boolean }) {
  const w = new World({
    seed: opts.seed ?? 3,
    lessonType: 'lecture',
    teacher: opts.teacher ?? 'strict',
  });
  run(w, 1, () => idleCommand(0, 0));
  const p = w.player;
  const dir = yawDir(p.yaw);
  const T = w.teacher;
  T.pos = { x: p.pos.x + dir.x * opts.d, z: p.pos.z + dir.z * opts.d };
  freeze(w, opts.away ? p.yaw : yawTo(T.pos, p.pos));
  return w;
}

function freeze(w: World, faceYaw: number) {
  const b = w.brain;
  const T = w.teacher;
  b.state = 'facing';
  b.stateT = 0;
  b.dur = 9999;
  b.arrived = true;
  b.goal = null;
  b.faceYaw = faceYaw;
  b.lookAt = null;
  b.stops = [];
  T.moving = false;
  T.path = null;
  T.yaw = faceYaw;
  T.headYaw = faceYaw;
  b.nextGlance = 9999;
  for (const s of w.suspicion.values()) s.s = 0;
}

function throwBall(w: World, power: number): void {
  const it = w.addItem('paper-ball', w.player.pos, 1, 'player');
  w.player.holding = it.id;
  w.step({ ...idleCommand(w.player.yaw, 0), throwPower: power });
}

describe('paper ball hits', () => {
  it('a ball thrown at the teacher hits her (deterministic, with a hit event)', () => {
    const w = stage({ d: 3, away: true });
    throwBall(w, 0.9);
    const ev = run(w, 2, () => seatedIdle(w));
    const hit = ev.find((e) => e.type === 'hit' && e.who === 'teacher');
    expect(hit).toBeTruthy();
    expect(hit!.text).toBe('back');
    expect(w.stats.hits.teacher).toBe(1);
    // Same thing again gives the same event hash.
    const w2 = stage({ d: 3, away: true });
    throwBall(w2, 0.9);
    run(w2, 2, () => seatedIdle(w2));
    expect(w2.eventHash).toBe(w.eventHash);
  });

  it('a ball thrown the other way misses her', () => {
    const w = stage({ d: 3, away: true });
    const it = w.addItem('paper-ball', w.player.pos, 1, 'player');
    w.player.holding = it.id;
    w.step({ ...idleCommand(w.player.yaw + 2.4, 0), throwPower: 0.9 });
    const ev = run(w, 2, () => seatedIdle(w));
    expect(ev.some((e) => e.type === 'hit' && e.who === 'teacher')).toBe(false);
  });

  it('a hit does nothing while the teacher is out of the room', () => {
    const w = stage({ d: 3, away: true });
    w.teacher.present = false;
    throwBall(w, 0.9);
    const ev = run(w, 2, () => seatedIdle(w));
    expect(ev.some((e) => e.type === 'teacher-hit')).toBe(false);
  });

  it('hits land on a classmate in the path and they react by trait', () => {
    const w = new World({ seed: 5, lessonType: 'lecture', teacher: 'lazy' });
    run(w, 1, () => idleCommand(0, 0));
    const s = w.students[0]!;
    const aim = yawTo(w.player.pos, s.agent.pos);
    const it = w.addItem('paper-ball', w.player.pos, 1, 'player');
    w.player.holding = it.id;
    const d = dist2(w.player.pos, s.agent.pos);
    w.step({ ...idleCommand(aim, 0), throwPower: Math.min(1, ((d * 1.6) / 0.8 - 1.5) / 6.5) });
    const ev = run(w, 4, () => idleCommand(aim, 0));
    const hit = ev.find((e) => e.type === 'hit' && e.who !== 'player');
    expect(hit, 'some classmate on the line gets hit').toBeTruthy();
    expect(w.stats.hits.students).toBeGreaterThan(0);
    expect(
      ev.some((e) => e.type === 'bark' && ['laugh', 'gasp', 'hey', 'sigh'].includes(e.kind ?? '')),
    ).toBe(true);
  });
});

describe('teacher reaction to a hit', () => {
  it('flinch -> hunt -> interrogate -> consequence, anger rises then calms', () => {
    const w = stage({ d: 3, away: true });
    throwBall(w, 0.9);
    const states: string[] = [];
    let angerPeak = 0;
    for (let i = 0; i < 20 * 120; i++) {
      w.step(seatedIdle(w));
      w.drainEvents();
      if (states[states.length - 1] !== w.brain.state) states.push(w.brain.state);
      angerPeak = Math.max(angerPeak, w.brain.anger);
      if (states.includes('hunt') && w.brain.anger < 0.2) break;
    }
    expect(states.slice(0, 3)).toEqual(['facing', 'flinch', 'hunt']);
    expect(states).toContain('interrogate');
    expect(angerPeak).toBeGreaterThan(0.6);
    expect(w.brain.anger).toBeLessThan(0.25);
  });

  it('back of the head while she faces away is not seen; the head snaps toward the impact', () => {
    const w = stage({ d: 3, away: true });
    const before = w.teacher.headYaw;
    throwBall(w, 0.9);
    const ev = run(w, 1.2, () => seatedIdle(w));
    const th = ev.find((e) => e.type === 'teacher-hit');
    expect(th?.value).toBe(0);
    const toPlayer = yawTo(w.teacher.pos, w.player.pos);
    const diffBefore = Math.abs(
      Math.atan2(Math.sin(before - toPlayer), Math.cos(before - toPlayer)),
    );
    const diffAfter = Math.abs(
      Math.atan2(Math.sin(w.teacher.headYaw - toPlayer), Math.cos(w.teacher.headYaw - toPlayer)),
    );
    expect(diffAfter).toBeLessThan(diffBefore);
  });

  it('nobody owns up -> a collective consequence (questions for everyone, stricter teacher)', () => {
    let collective = 0;
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const w = stage({ seed, d: 3, away: true });
      throwBall(w, 0.9);
      // The player works and keeps hands empty: the least suspicious behaviour.
      const ev = run(w, 60, () => ({ ...seatedIdle(w), work: true }));
      if (ev.some((e) => e.type === 'collective')) {
        collective++;
        expect(w.brain.strictBonus).toBeGreaterThan(0);
        expect(ev.some((e) => e.type === 'pop-question')).toBe(true);
        expect(w.stats.classPenalties).toBe(1);
      }
    }
    expect(collective).toBeGreaterThan(0);
  });

  it('holding more paper when asked is strong evidence', () => {
    const w = stage({ d: 3, away: true });
    throwBall(w, 0.9);
    // Pick up a second ball right away.
    const more = w.addItem('paper-ball', w.player.pos, 1, 'player');
    w.player.holding = more.id;
    const ev = run(
      w,
      30,
      () => seatedIdle(w),
      (e) => e.some((x) => x.type === 'caught'),
    );
    // Either caught outright or a classmate cleared; with a ball in hand the guilt chance is high.
    const caught = ev.find((e) => e.type === 'caught');
    if (caught) {
      const card = w.stats.caughtCards.at(-1)!;
      expect(card.title).toContain('paper');
      expect(card.lines.join(' ')).toMatch(/holding|hit|paper/i);
    }
    expect(ev.some((e) => e.type === 'interrogate' || e.type === 'incident-identified')).toBe(true);
  });

  it('fairness: every hit-related penalty is telegraphed by >= 1 s and always has a summary card', () => {
    let caughtN = 0;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const w = stage({ seed, d: 3, away: seed % 2 === 0 });
      const more = w.addItem('paper-ball', w.player.pos, 1, 'player');
      throwBall(w, 0.9);
      w.player.holding = more.id;
      const ev = run(w, 70, () => seatedIdle(w));
      for (const e of ev.filter((x) => x.type === 'caught')) {
        caughtN++;
        expect(e.value ?? 0, `seed ${seed}`).toBeGreaterThanOrEqual(1.0);
      }
      expect(w.stats.caughtCards.length).toBe(w.stats.offenses.length);
    }
    expect(caughtN).toBeGreaterThan(0);
  });

  it('seen throwing, in the face: identified straight after the flinch', () => {
    // Find an open spot where the teacher sees the standing player.
    const w = new World({ seed: 9, lessonType: 'lecture', teacher: 'hawk' });
    run(w, 1, () => idleCommand(0, 0));
    const c = w.layout.spots?.center ?? [4.5, 3.6];
    const p = w.player;
    p.sittingIn = null;
    p.stance = 'stand';
    let ok = false;
    for (let a = 0; a < 16 && !ok; a++) {
      for (const d of [2.4, 3, 3.6]) {
        const ang = (a / 16) * Math.PI * 2;
        p.pos = { x: c[0], z: c[1] };
        w.teacher.pos = { x: c[0] + Math.cos(ang) * d, z: c[1] + Math.sin(ang) * d };
        p.yaw = yawTo(p.pos, w.teacher.pos);
        freeze(w, yawTo(w.teacher.pos, p.pos));
        if (w.nav.walkable(w.teacher.pos) && teacherCanSee(w, p, 'torso')) {
          ok = true;
          break;
        }
      }
    }
    expect(ok).toBe(true);
    w.ps.cover = { reason: 'test', until: 999, target: p.pos, from: p.pos };
    const it = w.addItem('paper-ball', p.pos, 1, 'player');
    p.holding = it.id;
    const d = dist2(p.pos, w.teacher.pos);
    w.step({ ...idleCommand(p.yaw, 0), throwPower: Math.min(1, (d * 1.4 - 1.5) / 6.5) });
    const ev = run(w, 12, () => idleCommand(p.yaw, 0));
    const th = ev.find((e) => e.type === 'teacher-hit');
    expect(th, 'ball reached her').toBeTruthy();
    expect(th!.value).toBe(1);
    expect(ev.some((e) => e.type === 'incident-identified')).toBe(true);
    const caught = ev.find((e) => e.type === 'caught');
    expect(caught).toBeTruthy();
    expect(caught!.value!).toBeGreaterThanOrEqual(1.0);
    expect(w.stats.caughtCards.at(-1)!.lines.join(' ')).toMatch(/plain view|hit/i);
  });
});

describe('ball fights', () => {
  it('a rebel hit by the player may throw it back (capped per lesson)', () => {
    let threw = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, lessonType: 'group', teacher: 'lazy' });
      run(w, 1, () => idleCommand(0, 0));
      const s = w.students.find((x) => x.def.traits.rebellious >= 0.5 && x.agent.sittingIn);
      if (!s) continue;
      const aim = yawTo(w.player.pos, s.agent.pos);
      const d = dist2(w.player.pos, s.agent.pos);
      for (let k = 0; k < 3; k++) {
        const it = w.addItem('paper-ball', w.player.pos, 1, 'player');
        w.player.holding = it.id;
        w.step({ ...idleCommand(aim, 0), throwPower: Math.min(1, ((d * 1.6) / 0.8 - 1.5) / 6.5) });
        run(w, 4, () => idleCommand(aim, 0));
      }
      threw += w.stats.studentThrows;
      expect(w.stats.studentThrows).toBeLessThanOrEqual(14);
    }
    expect(threw).toBeGreaterThan(0);
  });
});

describe('new actions', () => {
  const fresh = (seed = 21, teacher = 'lazy') => {
    const w = new World({ seed, lessonType: 'lecture', teacher });
    run(w, 1, () => idleCommand(0, 0));
    freeze(w, Math.PI);
    return w;
  };
  const act = (w: World, a: PlayerCommand['act']) => {
    w.step({ ...idleCommand(w.player.yaw, 0), act: a });
    return w.drainEvents();
  };

  it('cough: noise, classmates may chain along', () => {
    let best = 0;
    for (const seed of [21, 22, 23, 24, 25]) {
      const w = fresh(seed);
      const ev = act(w, 'cough');
      expect(
        ev.some(
          (e) =>
            e.type === 'noise' && (e.kind === 'cough' || e.kind === 'sneeze') && e.who === 'player',
        ),
      ).toBe(true);
      run(w, 5, () => idleCommand(w.player.yaw, 0));
      best = Math.max(best, w.stats.coughChainBest);
    }
    expect(best).toBeGreaterThanOrEqual(2);
  });

  it('drum: rhythmic noise that stops by itself, and spreads to classmates', () => {
    const w = fresh(22);
    act(w, 'drum');
    const ev = run(w, 7, () => idleCommand(w.player.yaw, 0));
    const taps = ev.filter((e) => e.type === 'drum').length;
    expect(taps).toBeGreaterThan(10);
    expect(w.ps.fun.act).toBeNull();
    // toggling off works
    act(w, 'drum');
    w.ps.fun.cooldowns.drum = 0;
    act(w, 'drum');
    expect(w.ps.fun.act).toBeNull();
  });

  it('hum: quiet noise every second', () => {
    const w = fresh(23);
    act(w, 'hum');
    const ev = run(w, 4, () => idleCommand(w.player.yaw, 0));
    expect(ev.filter((e) => e.type === 'hum').length).toBeGreaterThanOrEqual(3);
  });

  it('lean back: balance rises; eventually the chair crashes (loud) unless you stop', () => {
    const w = fresh(24);
    act(w, 'lean-back');
    run(w, 1.5, () => idleCommand(w.player.yaw, 0));
    expect(w.ps.fun.lean).toBeGreaterThan(0.3);
    const ev = act(w, 'lean-back'); // stop safely
    expect(ev.some((e) => e.type === 'lean-save')).toBe(true);
    expect(w.ps.fun.lean).toBe(0);
    const w2 = fresh(24);
    act(w2, 'lean-back');
    const ev2 = run(w2, 12, () => idleCommand(w2.player.yaw, 0));
    expect(ev2.some((e) => e.type === 'crash')).toBe(true);
    expect(ev2.some((e) => e.type === 'noise' && e.kind === 'crash')).toBe(true);
  });

  it('nap: sleeping is evidence, snoring is noise, a teacher next to you wakes you', () => {
    const w = fresh(25);
    act(w, 'nap');
    const ev = run(w, 10, () => idleCommand(w.player.yaw, 0));
    expect(ev.some((e) => e.type === 'snore')).toBe(true);
    expect(w.record.counters.napSeconds ?? 0).toBeGreaterThan(3);
    w.teacher.pos = { x: w.player.pos.x + 0.9, z: w.player.pos.z };
    const ev2 = run(w, 1, () => idleCommand(w.player.yaw, 0));
    expect(ev2.some((e) => e.type === 'wake')).toBe(true);
    expect(w.ps.fun.act).toBeNull();
  });

  it('silly question: the class laughs and the teacher’s trust drops', () => {
    const w = fresh(26, 'strict');
    const before = w.record.trust[w.profile.id] ?? 0;
    w.brain.state = 'laptop';
    w.brain.arrived = false;
    w.brain.dur = 5;
    act(w, 'silly-question');
    const ev = run(w, 30, () => idleCommand(w.player.yaw, 0));
    expect(ev.some((e) => e.type === 'silly-question')).toBe(true);
    expect(ev.some((e) => e.type === 'bark' && e.kind === 'laugh')).toBe(true);
    expect(w.record.trust[w.profile.id] ?? 0).toBeLessThan(before);
  });

  it('funny face: a classmate laughs (affinity up) or rolls their eyes (down)', () => {
    const w = fresh(27);
    const near = w.students.find(
      (s) => s.agent.sittingIn && dist2(s.agent.pos, w.player.pos) < 1.7,
    )!;
    expect(near).toBeTruthy();
    const before = w.relations.toPlayer(near.def.id);
    w.step({ ...idleCommand(w.player.yaw, 0), interact: { target: near.def.id, verb: 'face' } });
    const ev = run(w, 3, () => idleCommand(w.player.yaw, 0));
    const res = ev.find((e) => e.type === 'face-result');
    expect(res).toBeTruthy();
    const after = w.relations.toPlayer(near.def.id);
    expect(res!.value ? after > before : after < before).toBe(true);
  });

  it('swap seats with a friend, and it reverts at the break', () => {
    const w = fresh(28);
    const friend = w.students.find(
      (s) => s.agent.sittingIn && dist2(s.agent.pos, w.player.pos) < 2.5,
    )!;
    w.record.affinity[friend.def.id] = 40;
    const seatA = w.player.sittingIn!;
    const seatB = friend.agent.sittingIn!;
    w.step({
      ...idleCommand(w.player.yaw, 0),
      interact: { target: friend.def.id, verb: 'swap-seat' },
    });
    const ev = run(w, 4, () => idleCommand(w.player.yaw, 0));
    expect(ev.some((e) => e.type === 'swap')).toBe(true);
    expect(w.player.sittingIn).toBe(seatB);
    expect(friend.agent.sittingIn).toBe(seatA);
    // The break (or time) puts everybody back.
    w.ps.fun.swap!.until = w.t;
    run(w, 1, () => idleCommand(w.player.yaw, 0));
    expect(w.player.sittingIn).toBe(seatA);
    expect(friend.agent.sittingIn).toBe(seatB);
    expect(w.player.seat).toBe(seatA);
  });

  it('flick the lights: dark for a moment, class reacts, the teacher comes to look', () => {
    const w = fresh(29);
    const door = w.layout.spots!.door!;
    const p = w.player;
    p.sittingIn = null;
    p.stance = 'stand';
    p.pos = { x: door[0], z: door[1] };
    w.step({
      ...idleCommand(p.yaw, 0),
      interact: { target: 'light-switch', verb: 'flick-lights' },
    });
    run(w, 1, () => idleCommand(p.yaw, 0));
    expect(w.objects.lightsOff).toBeGreaterThan(0);
    expect(w.stats.lightFlicks).toBe(1);
    run(w, 3, () => idleCommand(p.yaw, 0));
    expect(w.objects.lightsOff).toBe(0);
  });

  it('bin shot: a ball that lands in the bin scores a streak', () => {
    const w = fresh(30);
    const bin = binPos(w);
    const p = w.player;
    // Stand at a clear spot a few metres from the bin and throw exactly there.
    let placed = false;
    for (let a = 0; a < 24 && !placed; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const q = { x: bin.x + Math.cos(ang) * 3, z: bin.z + Math.sin(ang) * 3 };
      if (!w.nav.walkable(q)) continue;
      p.pos = q;
      p.sittingIn = null;
      p.stance = 'stand';
      placed = true;
    }
    expect(placed).toBe(true);
    const aim = yawTo(p.pos, bin);
    const d = dist2(p.pos, bin);
    const ev: SimEvent[] = [];
    for (let k = 0; k < 2; k++) {
      const it = w.addItem('paper-ball', p.pos, 1, 'player');
      p.holding = it.id;
      w.step({ ...idleCommand(aim, 0), throwPower: (d - 0.3 - 1.5) / 6.5 });
      ev.push(...run(w, 2, () => idleCommand(aim, 0)));
    }
    expect(ev.filter((e) => e.type === 'bin-shot').length).toBe(2);
    expect(w.ps.fun.binStreak).toBe(2);
    expect(w.record.counters.binStreakBest).toBe(2);
    // A miss resets the streak.
    const it = w.addItem('paper-ball', p.pos, 1, 'player');
    p.holding = it.id;
    w.step({ ...idleCommand(aim, 0), throwPower: (d - 0.3 - 1.5) / 6.5 - 0.2 });
    run(w, 2, () => idleCommand(aim, 0));
    expect(w.ps.fun.binStreak).toBe(0);
  });

  it('flight maths: the ball stays high most of the way and drops at the end', () => {
    const w = fresh(31);
    const it = w.addItem('paper-ball', w.player.pos, 1, 'player');
    w.player.holding = it.id;
    w.step({ ...idleCommand(w.player.yaw, 0), throwPower: 0.8 });
    const f = it.flight!;
    const mid = flightAt(it, (f.t0 + f.t1) / 2)!;
    const end = flightAt(it, f.t1)!;
    expect(mid.y).toBeGreaterThan(end.y);
    expect(end.y).toBeCloseTo(f.y1, 5);
  });
});

describe('bots with the new actions', () => {
  it('sniper and jester runs are reproducible and do something', () => {
    for (const style of ['sniper', 'jester'] as const) {
      const go = () =>
        runLesson(
          new World({ seed: 41, lessonType: 'worksheet', teacher: 'lazy' }),
          new Bot(style, new Rng(7)),
        );
      expect(go()).toEqual(go());
    }
    const w = new World({ seed: 43, lessonType: 'lecture', teacher: 'lazy' });
    runLesson(w, new Bot('jester', new Rng(3)));
    expect(Object.keys(w.stats.acts).length).toBeGreaterThan(0);
  });
});
