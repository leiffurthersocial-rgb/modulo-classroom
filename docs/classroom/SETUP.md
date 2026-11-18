# SETUP.md: Modulo: Classroom

Classroom has its own repo (`modulo-classroom`, moved from `modulo-places`, see DECISIONS C-027). Prerequisites: Node ≥ 22, npm. The game is the root page (`index.html` → `src/classroom/main.ts`).

## Run it

```bash
git clone https://github.com/leiffurthersocial-rgb/modulo-classroom.git
```

```bash
cd modulo-classroom && git checkout claude/sharp-curie-jy40c9 && npm ci
```

```bash
npm run dev
```

Then open http://localhost:5173/. Useful URL parameters:

| Parameter                                              | Meaning                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `?seed=42` or `?seed=monday`                           | Simulation seed (integers are used as-is, words are hashed)                                   |
| `?shot=3`                                              | Screenshot mode: fixed 1/20 s step, renders 3 frames, sets `window.__shotReady = true`, stops |
| `?cam=seat` / `overview` / `front` / `teacher` / `top` | Camera for screenshot mode                                                                    |
| `?t=60&bot=sneaky&lesson=film`                         | Sim time to fast-forward, bot style, lesson type                                              |
| `?hud=1` / `?debug=1` / `?device=phone`                | Show HUD / debug gizmos / start with the phone out                                            |

## Tests

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npx vitest run tests/unit/classroom-core.test.ts
```

```bash
npx playwright test tests/e2e/classroom.spec.ts --trace off
```

Screenshots go to `screenshots/latest/classroom-<cam>-<profile>.png` (gitignored). On your own machine, install the Playwright browser once:

```bash
npx playwright install chromium
```

## Benchmark (Phase 3)

`?bench=SECONDS` starts a lesson directly (no menus, a `sneaky` bot plays), flies the camera along a fixed loop through the room, and runs in real time at the preset's FPS cap. Optional: `&preset=`, `&lesson=`, `&teacher=`, `&seed=`. When done it fills `window.__bench` (frame-time avg/p50/p95/p99/max, FPS, draw calls, triangles, textures, geometries, estimated GPU MB, average sim tick ms, user agent) and shows a results panel with a "Copy JSON" button. The F3 overlay also shows the GPU estimate.

Open on desktop (dev server or deployed build) and on the iPad, one after the other, and paste the JSON back:

```
/?bench=30&preset=medium
```

```
/?bench=30&preset=battery
```

SwiftShader (headless CI) numbers are not meaningful for performance; the e2e test only checks that the route completes.

## Architecture guard

`eslint.config.js` forbids imports of three/render/ui/audio/input and the use of `window`, `document`, `performance`, `Math.random` and `Date.now` inside `src/classroom/sim/**`. If lint fails there, move the code to `render/` or `ui/`, or use `sim/rng.ts` and `sim/clock.ts`.

## Room layout

Edit `src/classroom/data/layouts/classroom-a.json`. Its coordinate conventions are documented in its `$comment` and in `DECISIONS.md` C-015. The unit test `classroom layout › validates` catches duplicate ids, objects outside the room, openings wider than their wall and broken seat→table references.

## Deploy

Vercel Git integration (no token in the session). Every push to a branch builds a Preview deployment; the game is at `/` (old `/classroom` and `/classroom.html` links redirect to `/`). Production follows the repo's default branch. See PLAN.md §7 for the one-time project setup.

## Asset keys (Phase 4, not needed yet)

```bash
export PEXELS_API_KEY=...      # https://www.pexels.com/api/
```

```bash
export FREESOUND_API_KEY=...   # https://freesound.org/apiv2/apply
```

```bash
export PIXABAY_API_KEY=...     # https://pixabay.com/api/docs/
```

Kenney's website refuses scripted downloads from the cloud container (HTTP 403 from the site). Phase 4 will include a manual download list, or a command for your machine.

## Reference photos

Put your photos in `reference/`. They are gitignored because the repo is public (see `reference/README.md`).
