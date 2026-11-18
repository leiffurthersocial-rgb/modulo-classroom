import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Bot, runLesson } from '../../src/classroom/sim/bots';
import {
  CAST,
  CHALLENGES,
  FEATURES,
  LAYOUT,
  PRANKS,
  validateContent,
} from '../../src/classroom/sim/data';
import { interactables, playerEvidence } from '../../src/classroom/sim/player';
import {
  canStartPrank,
  completePrank,
  opinionOf,
  projectorInUse,
  resolvePrank,
  snitchChance,
} from '../../src/classroom/sim/pranks';
import { Rng } from '../../src/classroom/sim/rng';
import { sendNote } from '../../src/classroom/sim/social';
import { idleCommand, type SimEvent } from '../../src/classroom/sim/types';
import { World, type WorldOptions } from '../../src/classroom/sim/world';
import { buildGreybox } from '../../src/classroom/render/greybox';
import { createPrankProps } from '../../src/classroom/render/prank-props';

const ALL = CAST.students.map((s) => s.id);
const GENERIC = PRANKS.filter((p) => p.trigger);

/** A world with nobody else in the room: no witnesses, so attribution is deterministic. */
function empty(opts: Partial<WorldOptions> = {}): World {
  return new World({ seed: 9, lessonType: 'lecture', teacher: 'lazy', absent: ALL, ...opts });
}

function seated(w: World): void {
  const seat = w.seat(w.player.seat)!;
  w.player.pos = { x: seat.pos[0], z: seat.pos[1] };
  w.player.sittingIn = seat.id;
  w.player.stance = 'sit';
}

/** Steps with an idle seated player; returns events. */
function stepFor(w: World, seconds: number, until?: () => boolean): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    w.step(idleCommand(0, -0.2));
    out.push(...w.drainEvents());
    if (until?.()) break;
  }
  return out;
}

const FLAG: Record<string, (w: World) => boolean> = {
  'rubber-duck': (w) => w.objects.duckOnDocCam,
  'dry-marker': (w) => w.objects.markerDry,
  'out-of-order': (w) => w.objects.outOfOrderSign,
  'sticky-mosaic': (w) => w.objects.stickyMosaic,
  'chairs-back': (w) => w.objects.turnedSeats.length > 0,
  'remote-in-plant': (w) => w.objects.remoteHidden,
  'bird-alarm': (w) => w.objects.birdAlarm,
  'cup-pyramid': (w) => w.objects.cupPyramid,
  'clock-holiday': (w) => w.objects.clockSilly,
  'posters-upside-down': (w) => w.objects.postersFlipped,
  'ghost-smiley': (w) => w.objects.ghostSmiley !== 'none',
};
/** Effects that only become visible when they surface (timer pranks). */
const LATE_VISIBLE = new Set(['bird-alarm', 'clock-holiday']);

describe('content', () => {
  it('has at least 8 new data-driven pranks and validates cleanly', () => {
    expect(GENERIC.length).toBeGreaterThanOrEqual(8);
    expect(validateContent()).toEqual([]);
    expect(new Set(PRANKS.map((p) => p.id)).size).toBe(PRANKS.length);
    for (const p of GENERIC) expect(FLAG[p.id], p.id).toBeDefined();
  });

  it('hard rules: nobody’s body, belongings, private information or safety is involved', () => {
    const people = new Set([...ALL, 'player', 'teacher', 'student']);
    const banned =
      /\b(fire|smoke|alarm bell|trip|slip|fall|spill|bag|backpack|diary|password|private|pocket|hair|shoe|glasses|water|glue)\b/i;
    for (const p of PRANKS) {
      expect(people.has(p.target), `${p.id} targets a person`).toBe(false);
      expect(`${p.name} ${p.verb ?? ''}`, p.id).not.toMatch(banned);
    }
  });

  it('every generic prank names a risk window, opinions and a teacher distraction', () => {
    for (const p of GENERIC) {
      expect(p.distraction, p.id).toBeGreaterThan(5);
      expect(p.setup, p.id).toBeGreaterThan(0.5);
      expect(p.opinions, p.id).toBeDefined();
      expect(p.verb, p.id).toBeTruthy();
    }
    expect(GENERIC.filter((p) => p.followUp).length).toBeGreaterThanOrEqual(2);
    expect(GENERIC.filter((p) => p.combo).length).toBeGreaterThanOrEqual(3);
  });
});

describe.each(GENERIC.map((p) => p.id))('prank %s', (id) => {
  const def = PRANKS.find((p) => p.id === id)!;
  const world = () => {
    if (def.requires !== 'break') return empty({ seed: 9 });
    const w = empty({ startPhase: 4, seed: 3 });
    w.step(idleCommand());
    return w;
  };

  it('is offered as a verb with its own setup time and visible evidence', () => {
    const w = world();
    // The chair prank hangs on any empty chair; the rest on a named interactable.
    w.player.sittingIn = null;
    const it = interactables(w).find((i) =>
      def.target === 'seat' ? i.verbs.some((v) => v.verb === `prank:${id}`) : i.id === def.target,
    );
    expect(it, `interactable ${def.target}`).toBeDefined();
    const verb = it!.verbs.find((v) => v.verb === `prank:${id}`);
    expect(verb?.label).toBe(def.verb);
    expect(canStartPrank(w, id, def.target)).toBeNull();
    // Stand at it and start: the action lasts exactly `setup` and shows evidence while it runs.
    w.player.sittingIn = null;
    w.player.stance = 'stand';
    w.player.pos = { ...it!.pos };
    w.step({ ...idleCommand(0, -0.2), interact: { target: it!.id, verb: `prank:${id}` } });
    expect(w.ps.action?.kind).toBe('prank');
    expect(w.ps.action?.dur).toBe(def.setup);
    const ev = playerEvidence(w).find((e) => e.kind === 'prank');
    expect(ev?.weight).toBeCloseTo(0.6 + 0.6 * def.heat, 5);
    stepFor(w, def.setup + 0.3);
    expect(w.pranks.map((p) => p.id)).toContain(id);
  });

  it('setup → effect → teacher distraction → resolution (clean when nobody saw)', () => {
    const w = world();
    completePrank(w, id, def.target);
    seated(w);
    const run = w.pranks.find((p) => p.id === id)!;
    expect(run.witnesses).toEqual([]);
    if (LATE_VISIBLE.has(id)) expect(FLAG[id]!(w)).toBe(false);
    else expect(FLAG[id]!(w)).toBe(true);
    // Effect surfaces; the teacher gets a task with the data-driven duration.
    let taskSeconds = 0;
    let taskKind = '';
    const ev: SimEvent[] = [];
    for (let i = 0; i < 20 * 400 && !run.resolved; i++) {
      w.step(idleCommand(0, -0.2));
      ev.push(...w.drainEvents());
      const b = w.brain;
      if (b.state === 'task' && b.task && b.arrived && b.task.kind === def.effect.kind) {
        taskSeconds += 0.05;
        taskKind = b.task.kind;
      }
    }
    expect(run.effectDone, 'effect surfaced').toBe(true);
    expect(run.resolved, 'teacher dealt with it').toBe(true);
    expect(ev.some((e) => e.type === 'prank-surfaced' || e.type === 'noise')).toBe(true);
    expect(taskKind).toBe(def.effect.kind);
    expect(taskSeconds).toBeGreaterThanOrEqual(def.distraction * 0.95 - 0.1);
    expect(taskSeconds).toBeLessThanOrEqual(
      def.distraction * (def.combo?.distractionMul ?? 1) + 0.2,
    );
    // Cleared again, attributed to nobody, counted as clean.
    expect(FLAG[id]!(w)).toBe(false);
    expect(w.stats.pranks).toContainEqual({ id, clean: true });
    expect(w.record.counters.pranksClean).toBe(1);
    expect(ev.some((e) => e.type === 'prank-resolved' && e.kind === id && e.value === 1)).toBe(
      true,
    );
    expect(w.brain.pendingPunish).toEqual([]);
  });
});

describe('prank behaviour', () => {
  it('timer pranks only become visible after their delay', () => {
    const w = empty();
    completePrank(w, 'clock-holiday', 'clock');
    seated(w);
    stepFor(w, 40);
    expect(w.objects.clockSilly).toBe(false);
    stepFor(w, 20, () => w.objects.clockSilly);
    expect(w.objects.clockSilly).toBe(true);
    // The lesson timer itself is untouched (display only).
    expect(w.clockMinutes()).toBe(w.lesson.gameMinutes);
  });

  it('bird alarm chirps unattributably, then the teacher hunts it', () => {
    const w = empty();
    completePrank(w, 'bird-alarm', 'bin');
    seated(w);
    const ev = stepFor(w, 120);
    const chirps = ev.filter((e) => e.type === 'noise' && e.kind === 'birdsong');
    expect(chirps.length).toBeGreaterThanOrEqual(2);
    expect(chirps.every((c) => c.who === undefined)).toBe(true);
    expect(w.pranks[0]!.resolved).toBe(true);
    expect(w.objects.birdAlarm).toBe(false);
  });

  it('film day combo: projector pranks surface at once with a longer distraction', () => {
    for (const id of ['rubber-duck', 'out-of-order', 'remote-in-plant', 'ghost-smiley']) {
      const def = PRANKS.find((p) => p.id === id)!;
      const film = empty({ lessonType: 'film', startPhase: 1 });
      film.step(idleCommand());
      expect(film.rules().dim).toBe(true);
      expect(projectorInUse(film)).toBe(true);
      completePrank(film, id, def.target);
      seated(film);
      const run = film.pranks[0]!;
      stepFor(film, 10, () => run.effectDone);
      expect(run.effectDone, `${id} on film day`).toBe(true);
      const first = [film.brain.task, ...film.brain.tasks].find((t) => t?.kind === def.effect.kind);
      expect(first?.dur).toBeCloseTo(def.distraction * def.combo!.distractionMul, 5);
      // On a plain lecture the same prank waits for the teacher to need the projector.
      const plain = empty({ lessonType: 'lecture' });
      plain.teacher.pos = { x: 4.5, z: 1.1 }; // away from the desk (no early discovery)
      completePrank(plain, id, def.target);
      seated(plain);
      expect(projectorInUse(plain)).toBe(false);
      stepFor(plain, 0.1);
      expect(plain.pranks[0]!.effectDone, `${id} on a plain lecture`).toBe(false);
    }
  });

  it('dry marker: scribbling at the board, then the teacher fetches another (two tasks)', () => {
    const w = empty();
    completePrank(w, 'dry-marker', 'marker');
    seated(w);
    const kinds: string[] = [];
    for (let i = 0; i < 20 * 400 && !w.pranks[0]!.resolved; i++) {
      w.step(idleCommand(0, -0.2));
      const k = w.brain.task?.kind;
      if (k && kinds[kinds.length - 1] !== k) kinds.push(k);
    }
    expect(kinds).toEqual(['marker-dry', 'fetch-marker']);
  });

  it('remote in the plant: teacher checks the desk, then finds it at the plant', () => {
    const w = empty();
    completePrank(w, 'remote-in-plant', 'plant');
    seated(w);
    // The remote is gone from the desk: nothing to switch the input with.
    expect(interactables(w).find((i) => i.id === 'projector-remote')).toBeUndefined();
    const kinds: string[] = [];
    for (let i = 0; i < 20 * 400 && !w.pranks[0]!.resolved; i++) {
      w.step(idleCommand(0, -0.2));
      const k = w.brain.task?.kind;
      if (k && kinds[kinds.length - 1] !== k) kinds.push(k);
    }
    expect(kinds).toEqual(['remote-hidden', 'plant-search']);
  });

  it('chairs: only empty chairs turn, and a chair straightens when someone sits', () => {
    const w = new World({ seed: 3, lessonType: 'lecture', teacher: 'lazy', startPhase: 4 });
    for (let i = 0; i < 5; i++) w.step(idleCommand());
    expect(w.rules().break).toBe(true);
    const occupied = w.layout.seats.filter((s) => w.allAgents().some((a) => a.sittingIn === s.id));
    completePrank(w, 'chairs-back', 'seat');
    const turned = w.objects.turnedSeats;
    for (const s of occupied) expect(turned).not.toContain(s.id);
    expect(turned.length).toBeGreaterThan(0);
    const mine = turned[0]!;
    w.player.sittingIn = mine;
    w.step(idleCommand());
    expect(w.objects.turnedSeats).not.toContain(mine);
  });

  it('conflicting pranks cannot run together; each runs once per lesson', () => {
    const w = empty();
    completePrank(w, 'sticky-mosaic', 'teacher-desk');
    expect(canStartPrank(w, 'cup-pyramid', 'teacher-desk')).not.toBeNull();
    completePrank(w, 'remote-in-plant', 'plant');
    expect(canStartPrank(w, 'projector-input', 'projector-remote')).not.toBeNull();
    expect(canStartPrank(w, 'sticky-mosaic', 'teacher-desk')).not.toBeNull();
    const verbs = interactables(w)
      .find((i) => i.id === 'teacher-desk')!
      .verbs.map((v) => v.verb);
    expect(verbs).not.toContain('prank:cup-pyramid');
    expect(verbs).not.toContain('prank:sticky-mosaic');
  });

  it('lingering at the prank during the risk window counts against you', () => {
    const w = empty({ seed: 9 });
    completePrank(w, 'sticky-mosaic', 'teacher-desk');
    const run = w.pranks[0]!;
    // The teacher walks to the desk while the player is still standing there.
    w.player.sittingIn = null;
    w.player.pos = { x: 1.2, z: 1.0 };
    w.teacher.pos = { x: 1.2, z: 0.35 };
    w.step(idleCommand());
    expect(run.seen).toBe(true);
    resolvePrank(w, run);
    expect(w.stats.pranks[0]).toEqual({ id: 'sticky-mosaic', clean: false });
  });

  it('every interactable for the new pranks is reachable from the player seat', () => {
    const w = new World({ seed: 3, lessonType: 'lecture', teacher: 'lazy', startPhase: 4 });
    for (let i = 0; i < 5; i++) w.step(idleCommand());
    w.player.sittingIn = null;
    const seat = w.seat(w.player.seat)!;
    for (const def of GENERIC) {
      const it = interactables(w).find(
        (i) => i.id === def.target || (def.target === 'seat' && i.kind === 'seat'),
      );
      expect(it, def.target).toBeDefined();
      const goal = w.nav.nearestWalkable(it!.pos)!;
      const path = w.nav.findPath({ x: seat.pos[0], z: seat.pos[1] }, goal);
      expect(path, `path to ${def.target}`).not.toBeNull();
      const end = path![path!.length - 1]!;
      expect(Math.hypot(end.x - it!.pos.x, end.z - it!.pos.z)).toBeLessThanOrEqual(it!.reach + 0.2);
    }
  });
});

describe('attribution and relationships', () => {
  const witnessWorld = () => {
    const w = new World({ seed: 9, lessonType: 'lecture', teacher: 'lazy' });
    completePrank(w, 'rubber-duck', 'doc-camera');
    const run = w.pranks[0]!;
    return { w, run };
  };

  it('opinions follow traits (rebels like it, goody-goodies do not)', () => {
    const def = PRANKS.find((p) => p.id === 'rubber-duck')!;
    const jonas = CAST.students.find((s) => s.id === 'jonas')!;
    const aylin = CAST.students.find((s) => s.id === 'aylin')!;
    expect(opinionOf(def, jonas.traits)).toBeGreaterThan(0);
    expect(opinionOf(def, aylin.traits)).toBeLessThan(0);
    const w = new World({ seed: 9, lessonType: 'lecture', teacher: 'lazy' });
    const before = w.relations.toPlayer('jonas');
    // Put both in plain view of the player and re-run the witness bookkeeping.
    completePrank(w, 'rubber-duck', 'doc-camera');
    const run = w.pranks[0]!;
    for (const id of run.witnesses) {
      const after = w.relations.toPlayer(id);
      const o = opinionOf(def, CAST.students.find((s) => s.id === id)!.traits);
      if (o > 0) expect(run.fans).toContain(id);
      if (o < 0) expect(run.haters).toContain(id);
      expect(after - CAST.students.find((s) => s.id === id)!.affinity).toBe(o);
    }
    expect(before).toBeDefined();
  });

  it('friends and fans keep quiet; goody-goodies with a grudge tell more, far witnesses less', () => {
    const { w, run } = witnessWorld();
    run.witnesses = ['jonas', 'aylin', 'luca'];
    run.witnessDist = { jonas: 3, aylin: 3, luca: 3 };
    run.fans = ['jonas'];
    run.haters = ['aylin'];
    w.relations.change('jonas', 0, '', w);
    expect(snitchChance(w, run, 'jonas')).toBe(0); // fan with affinity >= 0
    const base = snitchChance(w, run, 'aylin');
    expect(base).toBeGreaterThan(0);
    w.relations.change('aylin', -60, 'test', w);
    expect(snitchChance(w, run, 'aylin')).toBeGreaterThan(base);
    w.relations.change('aylin', 140, 'test', w); // now a close friend (>= 40)
    expect(snitchChance(w, run, 'aylin')).toBe(0);
    const near = snitchChance(w, run, 'luca');
    run.witnessDist.luca = 8;
    expect(snitchChance(w, run, 'luca')).toBeLessThan(near);
    for (const id of ALL) expect(snitchChance(w, run, id)).toBeLessThanOrEqual(0.95);
  });

  it('a snitch turns the prank into an offense with a telegraph of at least 1 s', () => {
    const { w, run } = witnessWorld();
    seated(w);
    run.witnesses = ['aylin'];
    run.haters = ['aylin'];
    run.witnessDist = { aylin: 2 };
    w.relations.change('aylin', -80, 'test', w);
    w.rngSocial.next = () => 0; // the witness always tells
    resolvePrank(w, run);
    expect(run.told).toBe(true);
    expect(w.stats.pranks).toContainEqual({ id: 'rubber-duck', clean: false });
    expect(w.brain.pendingPunish.map((p) => p.kind)).toEqual(['prank']);
    const ev = stepFor(w, 30, () => w.stats.offenses.length > 0);
    const caught = ev.find((e) => e.type === 'caught' && e.who === 'player');
    expect(caught?.kind).toBe('prank');
    expect(caught!.value!).toBeGreaterThanOrEqual(1.0);
    expect(w.stats.offenses).toHaveLength(1);
  });

  it('fans think better of you when you keep quiet about a clean prank', () => {
    const { w, run } = witnessWorld();
    run.witnesses = ['jonas'];
    run.fans = ['jonas'];
    run.witnessDist = { jonas: 3 };
    w.rngSocial.chance = () => true;
    const before = w.relations.toPlayer('jonas');
    resolvePrank(w, run);
    expect(run.told).toBe(false);
    expect(w.relations.toPlayer('jonas')).toBe(before + 1);
    expect(w.stats.pranks).toContainEqual({ id: 'rubber-duck', clean: true });
  });
});

describe('notes feature flag', () => {
  it('is off by default and the UI can read it', () => {
    expect(FEATURES.notes).toBe(false);
    expect(new World({ seed: 1, lessonType: 'study', teacher: 'lazy' }).features.notes).toBe(false);
    expect(
      new World({ seed: 1, lessonType: 'study', teacher: 'lazy', features: { notes: true } })
        .features.notes,
    ).toBe(true);
  });

  it('player note commands are ignored and sendNote refuses', () => {
    const w = new World({ seed: 4, lessonType: 'study', teacher: 'lazy' });
    expect(sendNote(w, 'player', 'mara', 'bored')).toBe(false);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 100; i++) {
      w.step({ ...idleCommand(), note: { template: 'bored', to: 'mara' } });
      ev.push(...w.drainEvents());
    }
    expect(ev.filter((e) => e.type.startsWith('note'))).toEqual([]);
    expect(w.notes).toEqual([]);
    expect(w.items.some((i) => i.kind === 'note')).toBe(false);
    expect(w.ps.passingNote).toBe(false);
  });

  it('classmates never start, pass or answer notes (whole lessons, several seeds)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const w = new World({
        seed,
        lessonType: seed % 2 ? 'study' : 'group',
        teacher: 'distracted',
      });
      const ev: SimEvent[] = [];
      for (let i = 0; i < 12000 && !w.over; i++) {
        w.step(idleCommand(0, -0.2));
        ev.push(...w.drainEvents());
      }
      expect(
        ev.filter((e) => e.type.startsWith('note')),
        `seed ${seed}`,
      ).toEqual([]);
      expect(w.studentReplies).toEqual([]);
    }
  }, 60_000);

  it('with the flag on, the player can pass notes again', () => {
    const w = new World({
      seed: 4,
      lessonType: 'study',
      teacher: 'lazy',
      features: { notes: true },
    });
    const ev: SimEvent[] = [];
    w.step({ ...idleCommand(), note: { template: 'bored', to: 'mara' } });
    ev.push(...w.drainEvents());
    expect(ev.some((e) => e.type === 'note-sent')).toBe(true);
  });

  it('hides note challenges and the postman bot just works', () => {
    expect(CHALLENGES.map((c) => c.id)).not.toContain('postman');
    const w = new World({ seed: 5, lessonType: 'lecture', teacher: 'lazy' });
    const r = runLesson(w, new Bot('postman', new Rng(5)));
    expect(r.notesDelivered).toBe(0);
    expect(r.offenses).toBe(0);
  });
});

describe('determinism and fairness with the new pranks', () => {
  const run = (seed: number) => {
    const w = new World({ seed, lessonType: 'lecture', teacher: 'strict' });
    const bot = new Bot('prankster', new Rng(seed ^ 77));
    const r = runLesson(w, bot, 12000);
    return { r, w };
  };

  it('same seed gives the same event hash and the same pranks', () => {
    for (const seed of [1000, 1007, 1013]) {
      const a = run(seed);
      const b = run(seed);
      expect(a.w.eventHash).toBe(b.w.eventHash);
      expect(a.w.pranks.map((p) => p.id)).toEqual(b.w.pranks.map((p) => p.id));
      expect(a.r).toEqual(b.r);
    }
  }, 60_000);

  it('the prankster uses the new pranks', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 14; i++) {
      const { w } = run(1000 + i * 3);
      for (const p of w.pranks) ids.add(p.id);
    }
    expect(GENERIC.filter((g) => ids.has(g.id)).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('every catch (including told-on pranks) has a telegraph of at least 1 s', () => {
    for (let i = 0; i < 20; i++) {
      const { r } = run(1100 + i);
      for (const lead of r.telegraphLeads) expect(lead).toBeGreaterThanOrEqual(1.0);
    }
  }, 60_000);

  it('a lesson cannot snowball: at most 2 strikes are added per lesson', () => {
    const w = new World({ seed: 1, lessonType: 'lecture', teacher: 'strict' });
    const kinds: string[] = [];
    for (let i = 0; i < 6; i++) kinds.push(w.punishPlayer('device', 0.6, 'x'));
    expect(w.lessonStrikes).toBeLessThanOrEqual(2 + 1);
    expect(kinds.slice(2).every((k) => k === 'warning' || k === 'letoff')).toBe(true);
    expect(w.record.strikes).toBeLessThanOrEqual(3);
    expect(w.record.callsHome).toBe(0);
  });
});

describe('prank props (render)', () => {
  it('builds, follows world.objects and disposes', () => {
    const room = buildGreybox(LAYOUT);
    const props = createPrankProps(LAYOUT, { room: room.root });
    const w = new World({ seed: 2, lessonType: 'film', teacher: 'lazy', startPhase: 1 });
    w.step(idleCommand());
    const vis = (name: string) => props.group.getObjectByName(name)?.visible;
    props.update(w, 0);
    for (const n of [
      'prank-duck',
      'prank-oo-sign',
      'prank-sticky-mosaic',
      'prank-cup-pyramid',
      'prank-clock-silly',
      'prank-birds',
      'prank-dry-marker',
      'prank-ghost-smiley',
    ])
      expect(vis(n), n).toBe(false);
    expect(vis('prank-remote')).toBe(true);
    const o = w.objects;
    o.duckOnDocCam = o.outOfOrderSign = o.stickyMosaic = o.cupPyramid = true;
    o.clockSilly = o.birdAlarm = o.markerDry = o.postersFlipped = true;
    o.ghostSmiley = 'shown';
    o.remoteHidden = true;
    props.update(w, 1);
    for (const n of [
      'prank-duck',
      'prank-duck-projected',
      'prank-oo-sign',
      'prank-sticky-mosaic',
      'prank-cup-pyramid',
      'prank-clock-silly',
      'prank-birds',
      'prank-dry-marker',
      'prank-ghost-smiley',
      'prank-poster-flipped-0',
    ])
      expect(vis(n), n).toBe(true);
    // Turned chairs rewrite the real backrest instances.
    let back: THREE.InstancedMesh | undefined;
    room.root.traverse((x) => {
      const im = x as THREE.InstancedMesh;
      if (
        im.isInstancedMesh &&
        im.geometry instanceof THREE.BoxGeometry &&
        im.geometry.parameters.height === 0.3
      )
        back = im;
    });
    expect(back).toBeDefined();
    const m0 = new THREE.Matrix4();
    back!.getMatrixAt(0, m0);
    const before = m0.elements.join(',');
    o.turnedSeats = [LAYOUT.seats[0]!.id];
    props.update(w, 2);
    back!.getMatrixAt(0, m0);
    expect(m0.elements.join(',')).not.toBe(before);
    o.turnedSeats = [];
    props.update(w, 3);
    back!.getMatrixAt(0, m0);
    expect(m0.elements.join(',')).toBe(before);
    props.dispose();
    room.dispose();
    expect(props.group.parent).toBeNull();
  });
});
