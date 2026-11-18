// Headless balance runner: `npx tsx scripts/classroom-balance.ts [runs=500]`.
// Runs bot-driven lessons across styles/lesson types/teachers and writes reports/classroom-balance.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  Bot,
  BOT_STYLES,
  type BotStyle,
  runLesson,
  type RunResult,
} from '../src/classroom/sim/bots';
import { FEATURES, PLAYABLE_LESSON_TYPES, PRANKS } from '../src/classroom/sim/data';
import { endLesson, newRecord } from '../src/classroom/sim/record';
import { Rng } from '../src/classroom/sim/rng';
import { World } from '../src/classroom/sim/world';

const runs = Math.max(1, Number(process.argv[2] ?? 500) || 500);
const TEACHERS = ['strict', 'lazy', 'distracted', 'hawk', 'substitute'];
const PENALTIES = ['letoff', 'warning', 'written', 'detention', 'callhome'];

// The postman only exists while note passing is on (data/features.json).
const NEW_STYLES: BotStyle[] = ['sniper', 'jester'];
const STYLES = BOT_STYLES.filter(
  (s) => !NEW_STYLES.includes(s) && (s !== 'postman' || FEATURES.notes),
);
const ALL_STYLES: BotStyle[] = [...STYLES, ...NEW_STYLES];
const funTotals = {
  hits: 0,
  clean: 0,
  classPenalties: 0,
  identified: 0,
  studentThrows: 0,
  binMade: 0,
  acts: {} as Record<string, number>,
};

const t0 = performance.now();
const results: RunResult[] = [];
const prankTally = new Map<string, { clean: number; dirty: number }>();
for (let i = 0; i < runs; i++) {
  const style = STYLES[i % STYLES.length]!;
  const seed = 1000 + i;
  const lessonType = PLAYABLE_LESSON_TYPES[seed % PLAYABLE_LESSON_TYPES.length]!;
  const teacher = TEACHERS[Math.floor(i / STYLES.length) % TEACHERS.length]!;
  const world = new World({ seed, lessonType, teacher });
  results.push(runLesson(world, new Bot(style, new Rng(seed ^ 0x9e3779b9))));
  if (style === 'prankster')
    for (const p of world.stats.pranks) {
      const t = prankTally.get(p.id) ?? { clean: 0, dirty: 0 };
      if (p.clean) t.clean++;
      else t.dirty++;
      prankTally.set(p.id, t);
    }
}

// The new-action bots (paper-ball sniper, jester using the new self-actions) run as extra lessons
// so the original styles keep their seeds and numbers comparable.
const extraRuns = Math.max(20, Math.round(runs / 6));
for (let i = 0; i < extraRuns * NEW_STYLES.length; i++) {
  const style = NEW_STYLES[i % NEW_STYLES.length]!;
  const seed = 2000 + i;
  const lessonType = PLAYABLE_LESSON_TYPES[seed % PLAYABLE_LESSON_TYPES.length]!;
  const teacher = TEACHERS[Math.floor(i / NEW_STYLES.length) % TEACHERS.length]!;
  const world = new World({ seed, lessonType, teacher });
  results.push(runLesson(world, new Bot(style, new Rng(seed ^ 0x9e3779b9))));
  funTotals.hits += world.stats.hits.teacher;
  funTotals.clean += world.stats.cleanHits;
  funTotals.classPenalties += world.stats.classPenalties;
  funTotals.identified += world.stats.offenses.filter((o) => o.kind === 'throw').length;
  funTotals.studentThrows += world.stats.studentThrows;
  funTotals.binMade += world.stats.binMade;
  for (const [k, n] of Object.entries(world.stats.acts))
    funTotals.acts[k] = (funTotals.acts[k] ?? 0) + n;
}

// Repeat-offender campaigns: the same record over 6 consecutive lessons (strikes persist, a
// quiet lesson heals). Measures how steep the ladder is for someone who keeps misbehaving.
const CAMPAIGN_STYLES: BotStyle[] = ['gamer', 'prankster', 'chaos'];
const CAMPAIGN_LESSONS = 6;
const campaigns = CAMPAIGN_STYLES.map((style) => {
  const n = Math.max(8, Math.round(runs / 20));
  let callhomes = 0;
  let detentions = 0;
  let writtens = 0;
  let offenses = 0;
  let cleanLessons = 0;
  for (let c = 0; c < n; c++) {
    const record = newRecord();
    for (let l = 0; l < CAMPAIGN_LESSONS; l++) {
      const seed = 5000 + c * 17 + l;
      const teacher = TEACHERS[(c + l) % TEACHERS.length]!;
      const lessonType = PLAYABLE_LESSON_TYPES[(seed + l) % PLAYABLE_LESSON_TYPES.length]!;
      const world = new World({ seed, lessonType, teacher, record });
      const r = runLesson(world, new Bot(style, new Rng(seed ^ 0x51ed270b)));
      offenses += r.offenses;
      callhomes += r.penalties.filter((p) => p === 'callhome').length;
      detentions += r.penalties.filter((p) => p === 'detention').length;
      writtens += r.penalties.filter((p) => p === 'written').length;
      if (r.offenses === 0) cleanLessons++;
      endLesson(record, r.offenses === 0, teacher);
    }
  }
  const L = n * CAMPAIGN_LESSONS;
  return {
    style,
    n,
    offenses: offenses / L,
    callhomes: callhomes / n,
    detentions: detentions / n,
    writtens: writtens / n,
    clean: (100 * cleanLessons) / L,
  };
});
const runtimeS = (performance.now() - t0) / 1000;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const f = (n: number, d = 2) => n.toFixed(d);

interface StyleAgg {
  style: BotStyle;
  runs: number;
  offensesMean: number;
  caughtPct: number;
  penalties: Record<string, number>;
  leadMin: number | null;
  leadMean: number | null;
  violations: number;
  deviceSec: number;
  pranksClean: number;
  pranksTotal: number;
  notes: number;
  test: number | null;
}

const aggs: StyleAgg[] = ALL_STYLES.map((style) => {
  const rs = results.filter((r) => r.style === style);
  const leads = rs.flatMap((r) => r.telegraphLeads);
  const penalties: Record<string, number> = {};
  for (const p of PENALTIES) penalties[p] = 0;
  for (const r of rs) for (const p of r.penalties) penalties[p] = (penalties[p] ?? 0) + 1;
  const tests = rs.map((r) => r.testScore).filter((x): x is number => x !== null);
  return {
    style,
    runs: rs.length,
    offensesMean: mean(rs.map((r) => r.offenses)),
    caughtPct: pct(rs.filter((r) => r.offenses > 0).length, rs.length),
    penalties,
    leadMin: leads.length ? Math.min(...leads) : null,
    leadMean: leads.length ? mean(leads) : null,
    violations: leads.filter((l) => l < 1.0).length,
    deviceSec: mean(rs.map((r) => r.deviceSeconds)),
    pranksClean: rs.reduce((a, r) => a + r.pranksClean, 0),
    pranksTotal: rs.reduce((a, r) => a + r.pranks, 0),
    notes: mean(rs.map((r) => r.notesDelivered)),
    test: tests.length ? mean(tests) : null,
  };
});

const lines: string[] = [];
lines.push('# Classroom balance report', '');
lines.push(
  `Runs: ${runs} lessons (seeds 1000..${1000 + runs - 1}), runtime ${f(runtimeS, 1)} s. Notes feature: ${FEATURES.notes ? 'on' : 'off (postman bot omitted)'}.`,
  '',
);
// Numbers from the previous report (before the gameplay retune: same seeds, old sim and old bots).
const BEFORE = {
  gamer: { off: 0.71, caught: 57.1 },
  sneaky: { off: 0.81, caught: 12.0 },
  prankster: { off: 3.58, caught: 73.5, clean: 18, total: 27, callhomes: 80, lessons: 83 },
  chaos: { off: 6.63, caught: 86.7 },
  campaign: {
    gamer: { off: 1.59, clean: 29, written: 0.8, det: 3.64, call: 3.2 },
    prankster: { off: 1.73, clean: 57, written: 1.72, det: 3.68, call: 2.88 },
    chaos: { off: 9.06, clean: 1, written: 1.0, det: 26.16, call: 25.72 },
  },
};
const pk = aggs.find((a) => a.style === 'prankster')!;
const callhomesPer = (st: BotStyle) =>
  (aggs.find((a) => a.style === st)?.penalties.callhome ?? 0) /
  Math.max(1, aggs.find((a) => a.style === st)?.runs ?? 1);
lines.push('## Before / after the retune', '');
lines.push(
  'Before = report of the previous build (same seeds). After = this run. Changes: witnesses who like you, love the prank or sit far away keep quiet (snitch chance = trait x affinity x distance), a told-on prank is now actually punished (reports used to be lost during the telegraph), at most 2 strikes can be added per lesson (then only reprimands), call home resets to 1 strike, two calm lessons heal a strike. The prankster bot also got smarter (gives up when watched, lies low after a penalty, uses covered moments for fiddly pranks, no longer wedges itself into seated classmates).',
  '',
);
lines.push('| metric | before | after |', '|---|---|---|');
lines.push(
  `| prankster: pranks clean | ${BEFORE.prankster.clean}/${BEFORE.prankster.total} (${f(pct(BEFORE.prankster.clean, BEFORE.prankster.total), 0)}%) | ${pk.pranksClean}/${pk.pranksTotal} (${f(pct(pk.pranksClean, pk.pranksTotal), 0)}%) |`,
  `| prankster: offenses / lesson | ${BEFORE.prankster.off} | ${f(pk.offensesMean)} |`,
  `| prankster: % lessons caught | ${BEFORE.prankster.caught}% | ${f(pk.caughtPct, 1)}% |`,
  `| prankster: call homes / lesson | ${f(BEFORE.prankster.callhomes / BEFORE.prankster.lessons)} | ${f(callhomesPer('prankster'))} |`,
  `| gamer: % lessons caught | ${BEFORE.gamer.caught}% | ${f(aggs.find((a) => a.style === 'gamer')!.caughtPct, 1)}% |`,
  `| sneaky: % lessons caught | ${BEFORE.sneaky.caught}% | ${f(aggs.find((a) => a.style === 'sneaky')!.caughtPct, 1)}% |`,
  `| chaos: offenses / lesson | ${BEFORE.chaos.off} | ${f(aggs.find((a) => a.style === 'chaos')!.offensesMean)} |`,
);
lines.push('', 'Repeat offenders (6 lessons in a row, one record), before:', '');
lines.push(
  '| style | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |',
  '|---|---|---|---|---|---|',
);
for (const st of CAMPAIGN_STYLES) {
  const b = BEFORE.campaign[st as 'gamer' | 'prankster' | 'chaos'];
  lines.push(
    `| ${st} | ${f(b.off)} | ${b.clean}% | ${f(b.written)} | ${f(b.det)} | ${f(b.call)} |`,
  );
}
lines.push('', 'After: see "Repeat offenders" below.', '');
lines.push('## Per bot style', '');
lines.push(
  `| style | runs | offenses/lesson | % lessons caught | ${PENALTIES.join(' | ')} | lead min (s) | lead mean (s) | lead < 1 s | device s | pranks clean/total | notes delivered | test score |`,
);
lines.push(`|${'---|'.repeat(4 + PENALTIES.length + 7)}`);
for (const a of aggs) {
  lines.push(
    `| ${a.style} | ${a.runs} | ${f(a.offensesMean)} | ${f(a.caughtPct, 1)}% | ${PENALTIES.map((p) => a.penalties[p]).join(' | ')} | ${a.leadMin === null ? '-' : f(a.leadMin)} | ${a.leadMean === null ? '-' : f(a.leadMean)} | ${a.violations} | ${f(a.deviceSec, 1)} | ${a.pranksClean}/${a.pranksTotal} | ${f(a.notes)} | ${a.test === null ? '-' : f(a.test, 1)} |`,
  );
}
lines.push('', '## Paper-ball hits and new actions (sniper + jester bots)', '');
lines.push(
  `Over ${extraRuns} lessons each: ${funTotals.hits} hits on the teacher, ${funTotals.clean} never traced to the thrower (class got the collective consequence ${funTotals.classPenalties}x), ${funTotals.identified} pinned on the thrower (all telegraphed >= 1 s). Classmate throw-backs: ${funTotals.studentThrows}. Bin shots made: ${funTotals.binMade}.`,
  '',
  `Self-actions used by the jester: ${Object.entries(funTotals.acts)
    .map(([k, n]) => `${k} x${n}`)
    .join(', ')}.`,
);
lines.push('', '## Prankster bot: clean rate per prank', '');
lines.push('| prank | clean | caught | clean % |', '|---|---|---|---|');
const totalClean = [...prankTally.values()].reduce((a, t) => a + t.clean, 0);
const totalDirty = [...prankTally.values()].reduce((a, t) => a + t.dirty, 0);
for (const def of PRANKS) {
  const t = prankTally.get(def.id);
  if (t)
    lines.push(
      `| ${def.id} | ${t.clean} | ${t.dirty} | ${f(pct(t.clean, t.clean + t.dirty), 0)}% |`,
    );
}
lines.push(
  `| **all** | ${totalClean} | ${totalDirty} | ${f(pct(totalClean, totalClean + totalDirty), 0)}% |`,
);
lines.push(
  '',
  `## Repeat offenders (${CAMPAIGN_LESSONS} lessons in a row, one persistent record)`,
  '',
);
lines.push(
  '| style | campaigns | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |',
  '|---|---|---|---|---|---|---|',
);
for (const c of campaigns)
  lines.push(
    `| ${c.style} | ${c.n} | ${f(c.offenses)} | ${f(c.clean, 0)}% | ${f(c.writtens)} | ${f(c.detentions)} | ${f(c.callhomes)} |`,
  );
lines.push('', '## Per teacher profile', '');
lines.push('| teacher | runs | % lessons with a catch | offenses/lesson |', '|---|---|---|---|');
for (const t of TEACHERS) {
  const rs = results.filter((r) => r.teacher === t);
  lines.push(
    `| ${t} | ${rs.length} | ${f(pct(rs.filter((r) => r.offenses > 0).length, rs.length), 1)}% | ${f(mean(rs.map((r) => r.offenses)))} |`,
  );
}
lines.push('', '## Per teacher profile, excluding the angel bot (offending styles only)', '');
lines.push('| teacher | runs | % lessons with a catch |', '|---|---|---|');
for (const t of TEACHERS) {
  const rs = results.filter((r) => r.teacher === t && r.style !== 'angel');
  lines.push(
    `| ${t} | ${rs.length} | ${f(pct(rs.filter((r) => r.offenses > 0).length, rs.length), 1)}% |`,
  );
}

const flags: string[] = [];
const by = (s: BotStyle) => aggs.find((a) => a.style === s)!;
if (by('angel').caughtPct > 5)
  flags.push(`angel caught in ${f(by('angel').caughtPct, 1)}% of lessons (> 5%): too punishing`);
if (by('gamer').caughtPct < 30)
  flags.push(`gamer caught in only ${f(by('gamer').caughtPct, 1)}% of lessons (< 30%): too safe`);
const sn = by('sneaky').caughtPct;
if (sn < 10 || sn > 70)
  flags.push(
    `sneaky catch rate ${f(sn, 1)}% outside 10-70%: ${sn < 10 ? 'too safe' : 'too punishing'}`,
  );
for (const a of aggs)
  if (a.violations > 0)
    flags.push(
      `FAIRNESS VIOLATION: ${a.style} had ${a.violations} catch(es) with telegraph lead < 1.0 s (min ${f(a.leadMin ?? 0)} s)`,
    );
lines.push('', '## Balance flags', '');
if (flags.length) for (const fl of flags) lines.push(`- ${fl}`);
else lines.push('- none: all thresholds met, no fairness violations');
lines.push('');

const md = lines.join('\n');
const out = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'reports',
  'classroom-balance.md',
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md);
console.log(md);
console.log(`written ${out}`);
