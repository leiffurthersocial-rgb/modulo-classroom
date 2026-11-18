// Turns what the teacher can see and hear into per-agent suspicion (0..1+), with decay to a heat
// baseline. The teacher brain reads `world.suspicion` and `world.brain.heard`. Pure TS.
import { TICK_DT } from './clock';
import { type Box, yawDir } from './geom';
import {
  EYE_HEIGHT,
  heardLoudness,
  inHorizontalView,
  lineOfSight,
  NEAR_OVER_TABLE,
  personBox,
  samplePoint,
  visionZone,
} from './perception';
import { playerEvidence } from './player';
import { studentEvidence } from './students';
import type { Agent, Evidence, EvidenceKind, SamplePoint } from './types';
import type { World } from './world';

/** Base suspicion fill rate per second for weight-1 evidence in the inner cone at close range. */
export const BASE_RATE = 0.55;

/** How strongly a heard noise of each kind implicates its (visible) source. */
const NOISE_BLAME: Record<string, number> = {
  step: 0.08,
  'step-run': 0.3,
  whisper: 0.45,
  'device-audio': 0.6,
  'game-beep': 0.35,
  chair: 0.08,
  laugh: 0.25,
  buzz: 0.6,
  paper: 0.15,
  wobble: 0.1,
  cough: 0.12,
  sneeze: 0.2,
  drum: 0.35,
  hum: 0.3,
  snore: 0.3,
  crash: 0.5,
  click: 0.35,
};

/** What a heard (and attributed) noise counts as when the teacher pins it on someone. */
const NOISE_EVIDENCE: Record<string, EvidenceKind> = {
  whisper: 'talking',
  laugh: 'talking',
  'step-run': 'sprinting',
  drum: 'racket',
  hum: 'racket',
  cough: 'racket',
  sneeze: 'racket',
  crash: 'racket',
  snore: 'sleeping',
  click: 'mischief',
};

/** Can the teacher see `a` (at a sample point) right now, with their current gaze and the lights? */
export function teacherCanSee(w: World, a: Agent, point: SamplePoint = 'torso'): boolean {
  const T = w.teacher;
  if (!T.present) return false;
  const occ: Box[] = [...w.geo.occluders];
  for (const o of w.allAgents()) if (o.present && o.id !== 'teacher') occ.push(personBox(o));
  const eye = { x: T.pos.x, y: EYE_HEIGHT[T.stance] + 0.05, z: T.pos.z };
  const pt = samplePoint(a, point);
  const dim = w.objects.lightsOff > 0 ? 0.45 : w.objects.lightsDim ? 0.85 : 1;
  const zone = visionZone(w.profile.vision, T.pos, T.headYaw, { x: pt.x, z: pt.z }, dim);
  if (!zone) return false;
  return lineOfSight(eye, pt, occ, ['teacher', a.id], zone.dist < NEAR_OVER_TABLE);
}

export function updatePerception(w: World): void {
  const T = w.teacher;
  const b = w.brain;
  const occluders: Box[] = [...w.geo.occluders];
  for (const a of w.allAgents()) if (a.present && a.id !== 'teacher') occluders.push(personBox(a));
  const eye = { x: T.pos.x, y: EYE_HEIGHT[T.stance] + 0.05, z: T.pos.z };
  const rules = w.rules();
  const dimScale = w.objects.lightsOff > 0 ? 0.45 : w.objects.lightsDim ? 0.85 : 1;
  // An angry teacher (or one the class has been collectively punished by) is sharper.
  const sharp = 1 + 0.35 * b.anger + b.strictBonus;
  const distracted = b.distracted && b.glancing <= 0 ? 0.35 : 1;
  b.seen = [];

  const targets: Agent[] = [w.player, ...w.students.map((s) => s.agent)];
  for (const a of targets) {
    const st = w.susp(a.id);
    if (!a.present) continue;
    if ((st.graceUntil ?? -1) > w.t) {
      st.s = Math.max(st.heat, st.s - w.profile.decay * TICK_DT);
      continue;
    }
    let ev: Evidence[] =
      a.id === 'player' ? playerEvidence(w) : studentEvidence(w, w.student(a.id)!);
    let hit: { e: Evidence; zone: ReturnType<typeof visionZone> } | null = null;
    if (T.present && ev.length) {
      ev = ev.slice().sort((x, y) => y.weight - x.weight);
      const laptop = w.laptopSpot(a);
      for (const e of ev) {
        const pt = samplePoint(
          a,
          e.point,
          e.screenYaw !== undefined && laptop ? { laptopAt: laptop } : {},
        );
        const zone = visionZone(w.profile.vision, T.pos, T.headYaw, { x: pt.x, z: pt.z }, dimScale);
        if (!zone) continue;
        const near = zone.dist < NEAR_OVER_TABLE;
        if (!lineOfSight(eye, pt, occluders, ['teacher', a.id], near)) continue;
        let use = e;
        if (e.screenYaw !== undefined) {
          // Laptop content is only readable from the screen side (behind the student).
          const f = yawDir(e.screenYaw);
          const behind = (T.pos.x - pt.x) * -f.x + (T.pos.z - pt.z) * -f.z > 0.1;
          if (!behind) use = { kind: 'absorbed', weight: 0.25, point: 'head' };
        }
        hit = { e: use, zone };
        break;
      }
    }
    if (hit && hit.zone) {
      const light =
        w.objects.lightsDim && hit.e.point !== 'device' && hit.e.kind !== 'device-glow' ? 0.55 : 1;
      const focus = b.state === 'watch' && b.target === a.id ? 1.3 : 1;
      const d =
        BASE_RATE *
        w.profile.visionRate *
        sharp *
        hit.zone.factor *
        light *
        hit.e.weight *
        distracted *
        focus *
        TICK_DT;
      st.s += d;
      st.lastEvidence = {
        kind: hit.e.kind,
        point: hit.e.point,
        zone: hit.zone.zone,
        dist: hit.zone.dist,
      };
      st.lastEvidenceT = w.t;
      st.exposure += TICK_DT;
      b.seen.push(a.id);
    } else {
      const working = a.id === 'player' && w.ps.working;
      st.s = Math.max(st.heat, st.s - w.profile.decay * (working ? 3 : 1) * TICK_DT);
      st.exposure = Math.max(0, st.exposure - TICK_DT * 0.5);
    }
    st.s = Math.min(st.s, 1.6);
  }

  // Hearing ---------------------------------------------------------------------------------
  const quiet = rules.quiet ?? 1;
  for (const n of w.noises) {
    if (n.source === 'teacher') continue;
    let r = n.radius * w.profile.hearing * quiet * (T.present ? 1 : 0.25) * (1 + 0.45 * b.anger);
    // Fairness: an off-screen teacher far away hears the player at half range (Splinter Cell).
    if (n.source === 'player') {
      const d = Math.hypot(T.pos.x - n.pos.x, T.pos.z - n.pos.z);
      if (!inHorizontalView(w.player.pos, w.player.yaw, T.pos) && d > 3) r *= 0.5;
    }
    const loud = heardLoudness(n.pos, T.pos, r);
    if (loud <= 0) continue;
    const blame = NOISE_BLAME[n.kind];
    const src = n.source ? w.agent(n.source) : undefined;
    if (src && blame !== undefined) {
      if ((n.kind === 'whisper' || n.kind === 'laugh') && rules.talkOk) continue;
      // Attributable if the teacher can roughly see where it came from.
      const z = visionZone(w.profile.vision, T.pos, T.headYaw, src.pos, 1.15);
      if (z || Math.hypot(T.pos.x - src.pos.x, T.pos.z - src.pos.z) < 2.5) {
        const st = w.susp(src.id);
        if ((st.graceUntil ?? -1) > w.t) continue;
        st.s = Math.min(1.6, st.s + loud * blame * (rules.detention ? 2 : 1));
        st.lastEvidence = {
          kind: NOISE_EVIDENCE[n.kind] ?? 'device',
          point: 'head',
          zone: 'heard',
          dist: Math.hypot(T.pos.x - src.pos.x, T.pos.z - src.pos.z),
        };
        st.lastEvidenceT = w.t;
        continue;
      }
      if (loud * blame > 0.08)
        b.heard.push({ pos: { ...n.pos }, loud: loud * blame * 2, kind: n.kind });
      continue;
    }
    // Unattributed noises (a thrown paper ball, a door, the radiator): investigate the spot.
    b.heard.push({ pos: { ...n.pos }, loud, kind: n.kind });
  }
}
