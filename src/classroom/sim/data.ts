// Typed access to the JSON content + validation. Pure TS.
import barksJson from '../data/barks.json';
import featuresJson from '../data/features.json';
import layoutJson from '../data/layouts/classroom-a.json';
import lessonsJson from '../data/lessons.json';
import notesJson from '../data/notes.json';
import pranksJson from '../data/pranks.json';
import studentsJson from '../data/students.json';
import teachersJson from '../data/teachers.json';
import wishlistJson from '../data/wishlist.json';
import type { RoomLayout } from './layout';

export type RoutineKey = 'board' | 'facing' | 'patrol' | 'behind' | 'check' | 'laptop' | 'leave';

export interface TeacherProfile {
  id: string;
  name: string;
  label: string;
  vision: {
    innerAngle: number;
    innerRange: number;
    midAngle: number;
    midRange: number;
    periphAngle: number;
    periphRange: number;
  };
  visionRate: number;
  hearing: number;
  decay: number;
  reaction: number;
  walkSpeed: number;
  turnSpeed: number;
  strictness: number;
  knowsNames: boolean;
  variance: number;
  weights: Record<RoutineKey, number>;
  durations: Record<'board' | 'facing' | 'laptop', [number, number]>;
}

export interface Traits {
  helpful: number;
  nosy: number;
  anxious: number;
  rebellious: number;
  goody: number;
  snitch: number;
}

export interface StudentDef {
  id: string;
  name: string;
  seat: string;
  color: string;
  affinity: number;
  knowledge: number;
  traits: Traits;
}

export interface PhaseRules {
  talkOk?: boolean;
  seatFree?: boolean;
  quiet?: number;
  dim?: boolean;
  test?: boolean;
  group?: boolean;
  break?: boolean;
  detention?: boolean;
}

export interface PhaseDef {
  id: string;
  label: string;
  minutes: number;
  bias?: Partial<Record<RoutineKey, number>>;
  rules?: PhaseRules;
}

export interface LessonType {
  label: string;
  phases: PhaseDef[];
  events: [string, number][];
}

export type PrankTrigger = 'projector' | 'board' | 'laptop' | 'near' | 'class' | 'timer';

export interface PrankTask {
  kind: string;
  dur: number;
  /** Spot name (layout.spots) where the teacher deals with it. */
  at: string;
  bark: string;
}

export interface PrankDef {
  id: string;
  name: string;
  target: string;
  /** Seconds of visible fiddling (evidence while doing it). */
  setup: number;
  /** Seconds until the effect can happen. */
  delay: number;
  effect: {
    kind: string;
    minutes?: number;
    duration?: number;
    /** Recurring noise (e.g. birdsong): kind, radius, spot it comes from. */
    noise?: { kind: string; radius: number; at: string; every: [number, number] };
  };
  /** Seconds the teacher is busy once it triggers (cover for other mischief). */
  distraction: number;
  /** How conspicuous the fiddling is (scales the setup evidence). */
  heat: number;
  requires?: 'break' | 'plane' | 'carry-free';
  /** Interactable verb label shown to the player (generic pranks). */
  verb?: string;
  risk?: 'loud' | 'risky';
  /** What makes the delayed effect surface (generic pranks). */
  trigger?: PrankTrigger;
  /** Spot where the teacher's task happens (also the 'near' trigger spot). */
  at?: string;
  bark?: string;
  /** Second task after the first (e.g. fetching a new marker). */
  followUp?: PrankTask;
  /** Seconds after which the teacher surfaces it regardless of the trigger (default 120). */
  patience?: number;
  /** Seconds after setup in which lingering at the spot, or the teacher passing it, matters. */
  riskWindow?: number;
  /** Witness opinions: trait (>= 0.5) → affinity change. Positive fans keep quiet. */
  opinions?: Partial<Record<keyof Traits, number>>;
  /** Multiplies witnesses' snitch chance (1 = default). */
  snitchMul?: number;
  /** Combo with the lesson: when a phase rule is active the effect surfaces at once and the
   *  teacher's distraction is longer. */
  combo?: { rules: (keyof PhaseRules)[]; distractionMul: number; text: string };
  /** Pranks that cannot coexist with this one. */
  conflicts?: string[];
}

export interface Features {
  notes: boolean;
}

export interface NoteTemplate {
  id: string;
  text: string;
  affinity: number;
  severity: number;
  answers?: boolean;
}

export interface Challenge {
  id: string;
  text: string;
  counter: string;
  goal: number;
  /** Hidden while this feature flag is off. */
  feature?: keyof Features;
}

export type BarkTiers = string[][];

export const LAYOUT = layoutJson as unknown as RoomLayout;
export const TEACHERS = (teachersJson as unknown as { profiles: TeacherProfile[] }).profiles;
export const CAST = studentsJson as unknown as {
  player: { id: string; name: string; seat: string };
  students: StudentDef[];
};
export const LESSONS = lessonsJson as unknown as {
  gameMinutesPerRealSecond: number;
  types: Record<string, LessonType>;
};
export const PRANKS = (pranksJson as unknown as { pranks: PrankDef[] }).pranks;
export const NOTES = (notesJson as unknown as { templates: NoteTemplate[] }).templates;
export const BARKS = barksJson as unknown as {
  teacher: Record<string, BarkTiers>;
  student: Record<string, BarkTiers>;
};
/** Feature flags (features.json). The UI can read `FEATURES.notes`. */
export const FEATURES: Readonly<Features> = featuresJson as Features;
export const CHALLENGES = (
  wishlistJson as unknown as { challenges: Challenge[] }
).challenges.filter((c) => !c.feature || FEATURES[c.feature]);

export const LESSON_TYPES = Object.keys(LESSONS.types);
export const PLAYABLE_LESSON_TYPES = LESSON_TYPES.filter((t) => t !== 'detention');

export function teacherProfile(id: string): TeacherProfile {
  return TEACHERS.find((t) => t.id === id) ?? TEACHERS[0]!;
}

/** Cross-file validation. Returns problems (empty = ok). */
export function validateContent(): string[] {
  const errs: string[] = [];
  const seats = new Set(LAYOUT.seats.map((s) => s.id));
  const used = new Set<string>([CAST.player.seat]);
  for (const s of CAST.students) {
    if (!seats.has(s.seat)) errs.push(`student ${s.id}: unknown seat ${s.seat}`);
    if (used.has(s.seat)) errs.push(`student ${s.id}: seat ${s.seat} taken twice`);
    used.add(s.seat);
    for (const v of Object.values(s.traits))
      if (v < 0 || v > 1) errs.push(`student ${s.id}: trait out of range`);
  }
  if (!seats.has(CAST.player.seat)) errs.push('player seat unknown');
  for (const [id, l] of Object.entries(LESSONS.types)) {
    const total = l.phases.reduce((a, p) => a + p.minutes, 0);
    if (total < 10 || total > 60) errs.push(`lesson ${id}: ${total} minutes`);
  }
  const ids = new Set([
    'marker',
    'projector-remote',
    'window-a',
    'window-b',
    'seat',
    'clock',
    'poster-1',
    'teacher-desk',
    'board',
    'radiator',
    'doc-camera',
    'plant',
    'bin',
  ]);
  const spots = LAYOUT.spots ?? {};
  const prankIds = new Set(PRANKS.map((p) => p.id));
  for (const p of PRANKS) {
    if (!ids.has(p.target)) errs.push(`prank ${p.id}: unknown target ${p.target}`);
    if (p.trigger || p.at) {
      if (!p.trigger) errs.push(`prank ${p.id}: 'at' without trigger`);
      if (!p.at || !spots[p.at]) errs.push(`prank ${p.id}: unknown spot ${p.at}`);
      if (p.followUp && !spots[p.followUp.at])
        errs.push(`prank ${p.id}: unknown follow-up spot ${p.followUp.at}`);
      if (!p.bark || !BARKS.teacher[p.bark]) errs.push(`prank ${p.id}: missing teacher bark`);
      if (p.followUp && !BARKS.teacher[p.followUp.bark])
        errs.push(`prank ${p.id}: missing follow-up bark`);
      if (!p.verb) errs.push(`prank ${p.id}: generic prank without a verb`);
    }
    if (p.effect.noise && !spots[p.effect.noise.at])
      errs.push(`prank ${p.id}: unknown noise spot ${p.effect.noise.at}`);
    for (const c of p.conflicts ?? [])
      if (!prankIds.has(c)) errs.push(`prank ${p.id}: unknown conflict ${c}`);
    if (p.setup <= 0 || p.distraction <= 0) errs.push(`prank ${p.id}: non-positive timing`);
  }
  for (const t of TEACHERS) {
    if (t.vision.innerRange > t.vision.midRange) errs.push(`teacher ${t.id}: inner > mid range`);
    for (const k of ['board', 'facing', 'laptop'] as const) {
      const d = t.durations[k];
      if (!d || d[0] > d[1]) errs.push(`teacher ${t.id}: bad duration ${k}`);
    }
  }
  return errs;
}
