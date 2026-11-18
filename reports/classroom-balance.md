# Classroom balance report

Runs: 500 lessons (seeds 1000..1499), runtime 74.5 s.

## Per bot style

| style     | runs | offenses/lesson | % lessons caught | letoff | warning | written | detention | callhome | lead min (s) | lead mean (s) | lead < 1 s | device s | pranks clean/total | notes delivered | test score |
| --------- | ---- | --------------- | ---------------- | ------ | ------- | ------- | --------- | -------- | ------------ | ------------- | ---------- | -------- | ------------------ | --------------- | ---------- |
| angel     | 84   | 0.00            | 0.0%             | 0      | 0       | 0       | 0         | 0        | -            | -             | 0          | 0.0      | 0/0                | 0.00            | 64.2       |
| gamer     | 84   | 0.71            | 57.1%            | 6      | 42      | 1       | 6         | 5        | 2.65         | 4.78          | 0          | 342.1    | 0/0                | 0.00            | 0.0        |
| sneaky    | 83   | 0.81            | 12.0%            | 2      | 9       | 9       | 25        | 22       | 1.45         | 10.27         | 0          | 108.5    | 0/0                | 0.00            | 59.7       |
| prankster | 83   | 3.58            | 73.5%            | 15     | 55      | 48      | 99        | 80       | 2.65         | 5.41          | 0          | 0.0      | 18/27              | 0.00            | 33.5       |
| postman   | 83   | 0.01            | 1.2%             | 0      | 1       | 0       | 0         | 0        | 4.90         | 4.90          | 0          | 0.0      | 0/0                | 3.92            | 62.8       |
| chaos     | 83   | 6.63            | 86.7%            | 22     | 70      | 66      | 212       | 180      | 2.65         | 8.64          | 0          | 118.7    | 14/23              | 0.00            | 0.0        |

## Per teacher profile

| teacher    | runs | % lessons with a catch | offenses/lesson |
| ---------- | ---- | ---------------------- | --------------- |
| strict     | 100  | 50.0%                  | 3.10            |
| lazy       | 100  | 30.0%                  | 1.09            |
| distracted | 100  | 28.0%                  | 1.48            |
| hawk       | 100  | 43.0%                  | 2.15            |
| substitute | 100  | 41.0%                  | 1.93            |

## Per teacher profile, excluding the angel bot (offending styles only)

| teacher    | runs | % lessons with a catch |
| ---------- | ---- | ---------------------- |
| strict     | 83   | 60.2%                  |
| lazy       | 83   | 36.1%                  |
| distracted | 83   | 33.7%                  |
| hawk       | 83   | 51.8%                  |
| substitute | 84   | 48.8%                  |

## Balance flags

- none: all thresholds met, no fairness violations
