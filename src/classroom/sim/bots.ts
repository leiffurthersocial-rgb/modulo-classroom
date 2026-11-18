// Scripted bot players for the headless balance runner and tests. Bots only use cues a human
// could perceive: where the teacher is and looks, what they're doing, barks/telegraph events.
import { clamp, dist2, type V2, wrapAngle, yawDir, yawTo } from './geom';
import { NOTES, PRANKS } from './data';
import { NavGrid } from './nav';
import { personBox } from './perception';
import { interactables } from './player';
import type { Rng } from './rng';
import { type ActId, idleCommand, type PlayerCommand, type SimEvent } from './types';
import type { World } from './world';

export type BotStyle =
  'angel' | 'gamer' | 'sneaky' | 'prankster' | 'postman' | 'chaos' | 'sniper' | 'jester';
export const BOT_STYLES: BotStyle[] = [
  'angel',
  'gamer',
  'sneaky',
  'prankster',
  'postman',
  'chaos',
  'sniper',
  'jester',
];

export class Bot {
  readonly style: BotStyle;
  private rng: Rng;
  private yaw = 0;
  private alarmT = -99;
  private safeSince = 0;
  private trip: {
    target: string;
    verb: string;
    pos: V2;
    phase: 'go' | 'act' | 'back';
    t: number;
  } | null = null;
  private path: V2[] | null = null;
  private nextNote = 30;
  private nextPrank = 0;
  private lieLowUntil = -1;
  private nextChaos = 0;
  private holdThrow = 0;
  private nextThrow = 25;
  private holdT = 0;
  private binAt = 0;
  private nextAct = 20;
  private actUntil = 0;
  private activeAct: ActId | null = null;
  private lastPos: V2 = { x: 0, z: 0 };
  private stuck = 0;

  constructor(style: BotStyle, rng: Rng) {
    this.style = style;
    this.rng = rng;
  }

  observe(events: SimEvent[]): void {
    for (const e of events) {
      if (
        (e.type === 'telegraph' && e.target === 'player') ||
        e.type === 'warned-by-friend' ||
        e.type === 'glance-soon'
      )
        this.alarmT = e.t;
      // Told off? A sensible prankster lies low for a while.
      if (e.type === 'penalty') this.lieLowUntil = e.t + 150;
      // A sniper lies low after a hit, however it ended.
      if (e.type === 'teacher-hit' && e.who === 'player') this.nextThrow = e.t + 90;
    }
  }

  /** Would a careful human feel watched right now? */
  private danger(w: World): boolean {
    const T = w.teacher;
    if (!T.present) return false;
    const p = w.player.pos;
    const d = dist2(T.pos, p);
    const looking = Math.abs(wrapAngle(yawTo(T.pos, p) - T.headYaw)) < 1.2;
    return w.t - this.alarmT < 3 || d < 3.2 || (looking && d < 7.5) || (T.moving && d < 4.5);
  }

  command(w: World): PlayerCommand {
    const p = w.player;
    const cmd = idleCommand(this.yaw, -0.2);
    const seat = w.seat(p.sittingIn ?? p.seat);
    if (seat && p.sittingIn) this.yaw = (seat.facing * Math.PI) / 180;
    cmd.yaw = this.yaw;
    const r = w.rules();
    const dev = w.ps.device;
    const danger = this.danger(w);
    if (!danger) this.safeSince += 0.05;
    else this.safeSince = 0;

    // Get back to your (possibly reassigned) seat first.
    if (!this.trip && !r.break && (!p.sittingIn || p.sittingIn !== p.seat)) {
      if (p.sittingIn && p.sittingIn !== p.seat)
        cmd.interact = { target: p.sittingIn, verb: 'stand' };
      else this.walkTo(w, cmd, w.seat(p.seat)!.pos, p.seat!, 'sit');
      return cmd;
    }
    // Without note passing the postman has nothing to deliver: he just does his work.
    const style = this.style === 'postman' && !w.features.notes ? 'angel' : this.style;
    switch (style) {
      case 'angel':
        cmd.work = true;
        if (this.rng.chance(0.0006)) cmd.raiseHand = true;
        break;
      case 'gamer':
        if (dev.kind !== 'phone' && !w.ps.phoneConfiscated) cmd.device = 'phone';
        else if (dev.mode === 'decoy') cmd.device = 'switch';
        break;
      case 'sneaky':
      case 'postman': {
        const wantsDevice = style === 'sneaky';
        if (wantsDevice && !w.ps.phoneConfiscated) {
          if (!dev.kind && this.safeSince > 2.5) cmd.device = 'phone';
          else if (dev.kind && dev.mode !== 'decoy' && danger) cmd.device = 'switch';
          else if (dev.kind && dev.mode === 'decoy' && this.safeSince > 4) cmd.device = 'switch';
          if (dev.mode === 'decoy' || !dev.kind) cmd.work = true;
        } else cmd.work = true;
        if (style === 'postman' && w.t > this.nextNote && !danger && p.sittingIn) {
          const seated = w.students.filter((s) => s.agent.sittingIn);
          if (seated.length) {
            const to = this.rng.pick(seated).agent.id;
            cmd.note = { template: this.rng.pick(NOTES.filter((n) => !n.answers)).id, to };
          }
          this.nextNote = w.t + 35 + this.rng.next() * 30;
        }
        if (r.test && style === 'sneaky' && !danger) cmd.peek = true;
        break;
      }
      case 'prankster': {
        cmd.work = true;
        // Cover: the teacher is busy with a task far from here (an earlier prank, perhaps).
        const T = w.teacher;
        const covered = w.brain.state === 'task' && T.present && dist2(T.pos, p.pos) > 3.5;
        const calm =
          w.brain.state === 'board' ||
          w.brain.state === 'laptop' ||
          w.brain.state === 'away' ||
          r.break;
        if (
          !this.trip &&
          w.t >= this.nextPrank &&
          w.t >= this.lieLowUntil &&
          (covered || (!danger && this.safeSince > 3 && calm))
        ) {
          const opts = interactables(w).flatMap((i) =>
            i.verbs
              .filter((v) => v.verb.startsWith('prank:') && (covered || v.risk !== 'loud'))
              .map((v) => ({ i, v })),
          );
          if (opts.length && this.rng.chance(0.05)) {
            // Quick pranks when exposed; the fiddly ones (long setup) only under cover.
            const weights = opts.map((o) => {
              const setup = PRANKS.find((x) => `prank:${x.id}` === o.v.verb)?.setup ?? 2;
              return covered ? setup : 1 / setup;
            });
            let roll = this.rng.next() * weights.reduce((a, b) => a + b, 0);
            let pick = opts[opts.length - 1]!;
            for (let k = 0; k < opts.length; k++) {
              roll -= weights[k]!;
              if (roll <= 0) {
                pick = opts[k]!;
                break;
              }
            }
            this.trip = {
              target: pick.i.id,
              verb: pick.v.verb,
              pos: pick.i.pos,
              phase: 'go',
              t: 0,
            };
            this.nextPrank = w.t + 40 + this.rng.next() * 50;
          }
        }
        break;
      }
      case 'sniper': {
        // Paper ball at the teacher's back while she writes (the "funny and safe" shot). The
        // ball is folded only when the shot is on, and dumped if the chance passes.
        cmd.work = !p.holding;
        const T = w.teacher;
        const b = w.brain;
        const d = dist2(T.pos, p.pos);
        const away = Math.abs(wrapAngle(yawTo(p.pos, T.pos) + Math.PI - T.headYaw)) > 2.3;
        const lane = w.students.every(
          (s) =>
            !s.agent.present ||
            Math.abs(wrapAngle(yawTo(p.pos, s.agent.pos) - yawTo(p.pos, T.pos))) > 0.12 ||
            dist2(p.pos, s.agent.pos) > d,
        );
        const on =
          p.sittingIn &&
          T.present &&
          b.state === 'board' &&
          b.glancing <= 0 &&
          d < 8 &&
          away &&
          lane &&
          w.t - this.alarmT > 3;
        if (!p.holding && on && w.t >= this.nextThrow) cmd.make = 'paper-ball';
        if (p.holding) {
          this.holdT += 0.05;
          if (on) {
            cmd.yaw = yawTo(p.pos, T.pos);
            cmd.throwPower = clamp((d / 0.7 / 0.8 - 1.5) / 6.5, 0.1, 1);
            this.holdT = 0;
            this.nextThrow = w.t + 60 + this.rng.next() * 60;
          } else if (this.holdT > 2.5) {
            // The chance passed: toss it under the desk.
            cmd.yaw = this.yaw;
            cmd.throwPower = 0.02;
            this.holdT = 0;
          }
        } else this.holdT = 0;
        break;
      }
      case 'jester': {
        cmd.work = !this.activeAct;
        const T = w.teacher;
        if (p.holding && this.binAt > 0 && w.t >= this.binAt) {
          const bin = w.layout.spots?.bin;
          this.binAt = 0;
          if (bin) {
            const d = Math.hypot(bin[0] - p.pos.x, bin[1] - p.pos.z);
            cmd.yaw = yawTo(p.pos, { x: bin[0], z: bin[1] });
            cmd.throwPower = clamp(((d - 0.3) / 0.8 - 1.5) / 6.5, 0.05, 1);
          }
        }
        // Stop whatever it is as soon as it feels risky or the time is up.
        if (this.activeAct && (danger || w.t > this.actUntil || !p.sittingIn)) {
          cmd.act = this.activeAct;
          if (this.activeAct === 'cough') this.activeAct = null;
          this.activeAct = null;
          this.nextAct = w.t + 12 + this.rng.next() * 25;
        } else if (
          !this.activeAct &&
          w.t >= this.nextAct &&
          p.sittingIn &&
          !danger &&
          this.safeSince > 3
        ) {
          const options: [ActId | 'face' | 'bin', number][] = [
            ['cough', 3],
            ['drum', 2],
            ['hum', 2],
            ['lean-back', 1.5],
            ['nap', 1],
            ['silly-question', 1],
            ['face', 2],
            ['bin', 2],
          ];
          const sum = options.reduce((a, o) => a + o[1], 0);
          let roll = this.rng.next() * sum;
          let pick = options[0]![0];
          for (const [k, v] of options) {
            roll -= v;
            if (roll <= 0) {
              pick = k;
              break;
            }
          }
          this.nextAct = w.t + 10 + this.rng.next() * 25;
          if (pick === 'face') {
            const nb = w.students
              .filter((s) => s.agent.present && dist2(s.agent.pos, p.pos) < 1.6)
              .sort((a, b2) => dist2(a.agent.pos, p.pos) - dist2(b2.agent.pos, p.pos))[0];
            if (nb) cmd.interact = { target: nb.agent.id, verb: 'face' };
          } else if (pick === 'bin') {
            if (!p.holding) {
              cmd.make = 'paper-ball';
              this.binAt = w.t + 0.4;
            }
          } else {
            cmd.act = pick;
            if (pick !== 'cough' && pick !== 'silly-question') {
              this.activeAct = pick;
              this.actUntil = w.t + (pick === 'nap' ? 18 : pick === 'lean-back' ? 3 : 6);
            }
          }
          void T;
        }
        break;
      }
      case 'chaos':
        if (w.t > this.nextChaos) {
          this.nextChaos = w.t + 5 + this.rng.next() * 15;
          const roll = this.rng.next();
          if (roll < 0.3) cmd.device = 'phone';
          else if (roll < 0.5) cmd.make = 'paper-ball';
          else if (roll < 0.7 && p.holding) this.holdThrow = 1;
          else if (roll < 0.85) {
            const any = interactables(w).filter((i) => i.kind !== 'seat');
            if (any.length) {
              const o = this.rng.pick(any);
              this.trip = { target: o.id, verb: o.verbs[0]!.verb, pos: o.pos, phase: 'go', t: 0 };
            }
          } else cmd.device = 'switch';
        }
        if (this.holdThrow > 0) {
          this.holdThrow = 0;
          cmd.yaw = this.rng.next() * Math.PI * 2;
          cmd.throwPower = this.rng.next();
        }
        break;
    }
    if (this.trip) this.runTrip(w, cmd);
    return cmd;
  }

  private runTrip(w: World, cmd: PlayerCommand): void {
    const t = this.trip!;
    const p = w.player;
    t.t += 0.05;
    if (t.t > 40) {
      this.trip = null;
      return;
    }
    // A watched prankster gives up and goes back to the seat (unless already at the target).
    if (
      this.style === 'prankster' &&
      t.phase === 'go' &&
      !p.sittingIn &&
      (w.t - this.alarmT < 1.5 || w.t < this.lieLowUntil) &&
      dist2(p.pos, t.pos) > 1.6
    ) {
      t.phase = 'back';
      this.path = null;
    }
    if (t.phase === 'go') {
      if (p.sittingIn) {
        cmd.interact = { target: p.sittingIn, verb: 'stand' };
        return;
      }
      if (this.moveTo(w, cmd, t.pos, 1.0)) {
        cmd.interact = { target: t.target, verb: t.verb };
        t.phase = 'act';
        t.t = 0;
      }
    } else if (t.phase === 'act') {
      cmd.move = { x: 0, z: 0 };
      if (!w.ps.action && t.t > 0.2) {
        t.phase = 'back';
        this.path = null;
      }
    } else {
      const seat = w.seat(p.seat)!;
      if (this.walkTo(w, cmd, seat.pos, seat.id, 'sit') || p.sittingIn) this.trip = null;
    }
  }

  private walkTo(
    w: World,
    cmd: PlayerCommand,
    pos: [number, number],
    seatId: string,
    verb: string,
  ): boolean {
    const goal = { x: pos[0], z: pos[1] };
    if (this.moveTo(w, cmd, goal, 0.9)) {
      cmd.interact = { target: seatId, verb };
      this.path = null;
      return true;
    }
    return false;
  }

  private navGrid: NavGrid | null = null;

  private peopleNav(w: World): NavGrid {
    const [W, , D] = w.layout.room.size;
    this.navGrid ??= new NavGrid(W, D, w.geo.colliders);
    for (const a of w.allAgents())
      if (a.id !== 'player' && a.present) this.navGrid.setDynamic(a.id, personBox(a));
    return this.navGrid;
  }

  private moveTo(w: World, cmd: PlayerCommand, goal: V2, within: number): boolean {
    const p = w.player;
    if (dist2(p.pos, goal) <= within) return true;
    this.stuck = dist2(p.pos, this.lastPos) < 0.01 ? this.stuck + 0.05 : 0;
    this.lastPos = { ...p.pos };
    if (this.stuck > 1.5) {
      this.stuck = 0;
      this.path = null;
    }
    if (!this.path || this.path.length === 0) {
      // Squeezed into a blocked cell (against a chair or a classmate)? Step to open floor first.
      // A private grid that also treats classmates (and the teacher) as obstacles, so the bot
      // does not try to squeeze through a seated student like the NPC grid would allow.
      const nav = this.peopleNav(w);
      const open = nav.walkable(p.pos) ? null : nav.nearestWalkable(p.pos);
      this.path = nav.findPath(open ?? p.pos, goal) ?? w.nav.findPath(p.pos, goal) ?? [goal];
      if (open) this.path.unshift(open);
      for (const a of w.allAgents()) nav.setDynamic(a.id, null);
    }
    let next = this.path[0]!;
    if (dist2(p.pos, next) < 0.2 && this.path.length > 1) {
      this.path.shift();
      next = this.path[0]!;
    }
    const y = yawTo(p.pos, next);
    const d = yawDir(y);
    cmd.move = { x: d.x, z: d.z };
    cmd.yaw = y;
    this.yaw = y;
    cmd.crouch = this.style === 'prankster';
    return false;
  }
}

export interface RunResult {
  style: BotStyle;
  seed: number;
  lessonType: string;
  teacher: string;
  offenses: number;
  penalties: string[];
  telegraphLeads: number[];
  deviceSeconds: number;
  pranks: number;
  pranksClean: number;
  notesDelivered: number;
  testScore: number | null;
  ticks: number;
  hash: number;
}

/** Runs one lesson headless with a bot. */
export function runLesson(world: World, bot: Bot, maxTicks = 20000): RunResult {
  const leads: number[] = [];
  let ticks = 0;
  while (!world.over && ticks < maxTicks) {
    world.step(bot.command(world));
    const ev = world.drainEvents();
    for (const e of ev)
      if (e.type === 'caught' && e.who === 'player' && e.value !== undefined) leads.push(e.value);
    bot.observe(ev);
    ticks++;
  }
  return {
    style: bot.style,
    seed: world.seed,
    lessonType: world.lessonType,
    teacher: world.profile.id,
    offenses: world.stats.offenses.length,
    penalties: world.stats.offenses.map((o) => o.penalty),
    telegraphLeads: leads,
    deviceSeconds: world.stats.gameSeconds + world.stats.videoSeconds,
    pranks: world.stats.pranks.length,
    pranksClean: world.stats.pranks.filter((p) => p.clean).length,
    notesDelivered: world.stats.notesDelivered.length,
    testScore: world.stats.testScore,
    ticks,
    hash: world.eventHash,
  };
}
