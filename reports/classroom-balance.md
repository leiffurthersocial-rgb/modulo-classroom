# Classroom balance report

Runs: 300 lessons (seeds 1000..1299), runtime 141.8 s. Notes feature: off (postman bot omitted).

## Before / after the retune

Before = report of the previous build (same seeds). After = this run. Changes: witnesses who like you, love the prank or sit far away keep quiet (snitch chance = trait x affinity x distance), a told-on prank is now actually punished (reports used to be lost during the telegraph), at most 2 strikes can be added per lesson (then only reprimands), call home resets to 1 strike, two calm lessons heal a strike. The prankster bot also got smarter (gives up when watched, lies low after a penalty, uses covered moments for fiddly pranks, no longer wedges itself into seated classmates).

| metric | before | after |
|---|---|---|
| prankster: pranks clean | 18/27 (67%) | 80/94 (85%) |
| prankster: offenses / lesson | 3.58 | 0.65 |
| prankster: % lessons caught | 73.5% | 45.0% |
| prankster: call homes / lesson | 0.96 | 0.00 |
| gamer: % lessons caught | 57.1% | 73.3% |
| sneaky: % lessons caught | 12% | 15.0% |
| chaos: offenses / lesson | 6.63 | 6.43 |

Repeat offenders (6 lessons in a row, one record), before:

| style | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |
|---|---|---|---|---|---|
| gamer | 1.59 | 29% | 0.80 | 3.64 | 3.20 |
| prankster | 1.73 | 57% | 1.72 | 3.68 | 2.88 |
| chaos | 9.06 | 1% | 1.00 | 26.16 | 25.72 |

After: see "Repeat offenders" below.

## Per bot style

| style | runs | offenses/lesson | % lessons caught | letoff | warning | written | detention | callhome | lead min (s) | lead mean (s) | lead < 1 s | device s | pranks clean/total | notes delivered | test score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| angel | 60 | 0.00 | 0.0% | 0 | 0 | 0 | 0 | 0 | - | - | 0 | 0.0 | 0/0 | 0.00 | 64.0 |
| gamer | 60 | 0.73 | 73.3% | 6 | 38 | 0 | 0 | 0 | 2.65 | 3.17 | 0 | 277.4 | 0/0 | 0.00 | 0.0 |
| sneaky | 60 | 0.45 | 15.0% | 2 | 19 | 6 | 0 | 0 | 4.25 | 10.87 | 0 | 231.2 | 0/0 | 0.00 | 58.8 |
| prankster | 60 | 0.65 | 45.0% | 8 | 26 | 5 | 0 | 0 | 2.65 | 6.17 | 0 | 0.0 | 80/94 | 0.00 | 64.8 |
| chaos | 60 | 6.43 | 90.0% | 21 | 320 | 45 | 0 | 0 | 2.60 | 7.78 | 0 | 100.3 | 66/80 | 0.00 | 0.0 |
| sniper | 50 | 0.04 | 4.0% | 0 | 2 | 0 | 0 | 0 | 2.65 | 2.65 | 0 | 0.0 | 0/0 | 0.00 | 65.8 |
| jester | 50 | 0.02 | 2.0% | 0 | 1 | 0 | 0 | 0 | 3.85 | 3.85 | 0 | 0.0 | 0/0 | 0.00 | 50.2 |

## Paper-ball hits and new actions (sniper + jester bots)

Over 50 lessons each: 14 hits on the teacher, 12 never traced to the thrower (class got the collective consequence 12x), 2 pinned on the thrower (all telegraphed >= 1 s). Classmate throw-backs: 0. Bin shots made: 0.

Self-actions used by the jester: cough x181, face x98, drum x146, hum x144, lean-back x82, nap x56, silly-question x41.

## Prankster bot: clean rate per prank

| prank | clean | caught | clean % |
|---|---|---|---|
| hide-marker | 3 | 0 | 100% |
| projector-input | 2 | 1 | 67% |
| open-window | 6 | 3 | 67% |
| reorder-posters | 8 | 2 | 80% |
| board-sticker | 5 | 0 | 100% |
| radiator-knock | 1 | 0 | 100% |
| doc-cam-flip | 6 | 0 | 100% |
| rubber-duck | 5 | 0 | 100% |
| dry-marker | 4 | 2 | 67% |
| sticky-mosaic | 5 | 0 | 100% |
| remote-in-plant | 13 | 0 | 100% |
| bird-alarm | 4 | 2 | 67% |
| cup-pyramid | 6 | 0 | 100% |
| clock-holiday | 5 | 1 | 83% |
| posters-upside-down | 4 | 2 | 67% |
| ghost-smiley | 3 | 1 | 75% |
| **all** | 80 | 14 | 85% |

## Repeat offenders (6 lessons in a row, one persistent record)

| style | campaigns | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |
|---|---|---|---|---|---|---|
| gamer | 15 | 0.77 | 23% | 2.13 | 0.53 | 0.00 |
| prankster | 15 | 0.67 | 61% | 0.87 | 0.40 | 0.00 |
| chaos | 15 | 7.94 | 4% | 3.80 | 3.40 | 2.87 |

## Per teacher profile

| teacher | runs | % lessons with a catch | offenses/lesson |
|---|---|---|---|
| strict | 80 | 35.0% | 1.84 |
| lazy | 80 | 25.0% | 0.59 |
| distracted | 80 | 26.3% | 0.53 |
| hawk | 80 | 40.0% | 1.75 |
| substitute | 80 | 45.0% | 1.54 |

## Per teacher profile, excluding the angel bot (offending styles only)

| teacher | runs | % lessons with a catch |
|---|---|---|
| strict | 68 | 41.2% |
| lazy | 68 | 29.4% |
| distracted | 68 | 30.9% |
| hawk | 68 | 47.1% |
| substitute | 68 | 52.9% |

## Balance flags

- none: all thresholds met, no fairness violations
