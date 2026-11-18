# Classroom balance report

Runs: 500 lessons (seeds 1000..1499), runtime 190.7 s. Notes feature: off (postman bot omitted).

## Before / after the retune

Before = report of the previous build (same seeds). After = this run. Changes: witnesses who like you, love the prank or sit far away keep quiet (snitch chance = trait x affinity x distance), a told-on prank is now actually punished (reports used to be lost during the telegraph), at most 2 strikes can be added per lesson (then only reprimands), call home resets to 1 strike, two calm lessons heal a strike. The prankster bot also got smarter (gives up when watched, lies low after a penalty, uses covered moments for fiddly pranks, no longer wedges itself into seated classmates).

| metric                         | before      | after        |
| ------------------------------ | ----------- | ------------ |
| prankster: pranks clean        | 18/27 (67%) | 99/120 (83%) |
| prankster: offenses / lesson   | 3.58        | 0.55         |
| prankster: % lessons caught    | 73.5%       | 39.0%        |
| prankster: call homes / lesson | 0.96        | 0.00         |
| gamer: % lessons caught        | 57.1%       | 61.0%        |
| sneaky: % lessons caught       | 12%         | 11.0%        |
| chaos: offenses / lesson       | 6.63        | 8.38         |

Repeat offenders (6 lessons in a row, one record), before:

| style     | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |
| --------- | --------------- | ------------- | ------------------ | --------------------- | --------------------- |
| gamer     | 1.59            | 29%           | 0.80               | 3.64                  | 3.20                  |
| prankster | 1.73            | 57%           | 1.72               | 3.68                  | 2.88                  |
| chaos     | 9.06            | 1%            | 1.00               | 26.16                 | 25.72                 |

After: see "Repeat offenders" below.

## Per bot style

| style     | runs | offenses/lesson | % lessons caught | letoff | warning | written | detention | callhome | lead min (s) | lead mean (s) | lead < 1 s | device s | pranks clean/total | notes delivered | test score |
| --------- | ---- | --------------- | ---------------- | ------ | ------- | ------- | --------- | -------- | ------------ | ------------- | ---------- | -------- | ------------------ | --------------- | ---------- |
| angel     | 100  | 0.00            | 0.0%             | 0      | 0       | 0       | 0         | 0        | -            | -             | 0          | 0.0      | 0/0                | 0.00            | 64.3       |
| gamer     | 100  | 0.61            | 61.0%            | 11     | 50      | 0       | 0         | 0        | 2.65         | 3.73          | 0          | 305.1    | 0/0                | 0.00            | 0.0        |
| sneaky    | 100  | 0.52            | 11.0%            | 0      | 44      | 8       | 0         | 0        | 5.75         | 13.31         | 0          | 116.0    | 0/0                | 0.00            | 63.9       |
| prankster | 100  | 0.55            | 39.0%            | 9      | 40      | 6       | 0         | 0        | 2.65         | 5.94          | 0          | 0.0      | 99/120             | 0.00            | 65.6       |
| chaos     | 100  | 8.38            | 100.0%           | 34     | 711     | 93      | 0         | 0        | 2.65         | 7.13          | 0          | 60.4     | 92/133             | 0.00            | 0.0        |

## Prankster bot: clean rate per prank

| prank               | clean | caught | clean % |
| ------------------- | ----- | ------ | ------- |
| hide-marker         | 4     | 0      | 100%    |
| projector-input     | 8     | 5      | 62%     |
| open-window         | 2     | 0      | 100%    |
| reorder-posters     | 10    | 5      | 67%     |
| board-sticker       | 2     | 2      | 50%     |
| doc-cam-flip        | 9     | 0      | 100%    |
| rubber-duck         | 6     | 0      | 100%    |
| dry-marker          | 3     | 2      | 60%     |
| out-of-order        | 5     | 2      | 71%     |
| sticky-mosaic       | 4     | 1      | 80%     |
| remote-in-plant     | 11    | 0      | 100%    |
| bird-alarm          | 1     | 1      | 50%     |
| cup-pyramid         | 12    | 0      | 100%    |
| clock-holiday       | 9     | 0      | 100%    |
| posters-upside-down | 7     | 3      | 70%     |
| ghost-smiley        | 6     | 0      | 100%    |
| **all**             | 99    | 21     | 83%     |

## Repeat offenders (6 lessons in a row, one persistent record)

| style     | campaigns | offenses/lesson | clean lessons | written / campaign | detentions / campaign | call homes / campaign |
| --------- | --------- | --------------- | ------------- | ------------------ | --------------------- | --------------------- |
| gamer     | 25        | 0.75            | 28%           | 1.64               | 0.60                  | 0.20                  |
| prankster | 25        | 0.43            | 70%           | 0.48               | 0.24                  | 0.12                  |
| chaos     | 25        | 9.05            | 0%            | 3.96               | 3.80                  | 3.00                  |

## Per teacher profile

| teacher    | runs | % lessons with a catch | offenses/lesson |
| ---------- | ---- | ---------------------- | --------------- |
| strict     | 100  | 47.0%                  | 2.59            |
| lazy       | 100  | 35.0%                  | 1.11            |
| distracted | 100  | 39.0%                  | 1.62            |
| hawk       | 100  | 46.0%                  | 2.87            |
| substitute | 100  | 44.0%                  | 1.87            |

## Per teacher profile, excluding the angel bot (offending styles only)

| teacher    | runs | % lessons with a catch |
| ---------- | ---- | ---------------------- |
| strict     | 80   | 58.8%                  |
| lazy       | 80   | 43.8%                  |
| distracted | 80   | 48.8%                  |
| hawk       | 80   | 57.5%                  |
| substitute | 80   | 55.0%                  |

## Balance flags

- none: all thresholds met, no fairness violations
