# ASSETS.md: where Classroom's assets come from and how to add more

Every third-party asset needs an entry in `assets/LICENSES.json`; `tests/unit/licenses.test.ts`
fails otherwise, and shipped assets also need a line in the in-game CREDITS
(`src/classroom/data/asset-credits.json`, written by `npm run assets:process`).
Allowed licences: CC0-1.0, CC-BY-4.0, CC-BY-3.0 (with attribution text), OFL-1.1, Pixabay Content
License. Never NC or ND.

## Scripted (works from the cloud session)

| Source           | What                    | Command                                                          |
| ---------------- | ----------------------- | ---------------------------------------------------------------- |
| Poly Haven (CC0) | textures, models, HDRIs | `npm run assets:fetch -- --lab` (candidates) / `--picks` (picks) |
| ambientCG (CC0)  | textures                | same                                                             |

Workflow: edit candidates in `src/config/lab-candidates.json` → `npm run assets:fetch -- --lab` →
pick in `/lab` (dev server: "Save picks" writes `src/config/materials.json`) →
`npm run assets:fetch -- --picks && npm run assets:process` → commit `public/pack/`,
`assets/LICENSES.json`, `src/classroom/data/asset-credits.json`, `reports/asset-sizes.md`.

## Manual downloads (sites refuse scripts or have no API)

**Quaternius** (quaternius.com, every pack page below states CC0; checked 2026-11-18):

- Furniture — https://quaternius.com/packs/furniture.html (possible furniture swap, see C-029)
- Animated Men / Animated Women — https://quaternius.com/packs/animatedmen.html,
  https://quaternius.com/packs/animatedwomen.html (Phase 5 candidates: shared rig, stylised)

Download the glTF zip in a browser, unzip into `.asset-cache/manual/quaternius/<pack>/`, and tell
me which pack; I'll add a `manual` source adapter and the licence entries.

**Kenney** (kenney.nl, CC0): kenney.nl answers HTTP 403 to requests from the cloud container, so I
could not open or verify any pack page. Please browse https://kenney.nl/assets yourself and look for
furniture / interior / school props and character packs; download the zips into
`.asset-cache/manual/kenney/<pack>/` and tell me the pack names. (I am not naming specific Kenney
packs because I could not verify them.)

## Need API keys (not configured)

The proxy lets these hosts through, but the APIs need keys (Freesound answers 403 without one):

| Source    | Use                                                           | Variable              |
| --------- | ------------------------------------------------------------- | --------------------- |
| Freesound | classroom ambience, chair squeaks, footsteps, door, bell, pen | `FREESOUND_API_KEY`   |
| Pixabay   | video clips (the API has no audio)                            | `PIXABAY_API_KEY`     |
| Pexels    | video clips                                                   | `PEXELS_API_KEY`      |
| Sketchfab | CC0/CC-BY models with author + licence                        | `SKETCHFAB_API_TOKEN` |

Add them as network secrets on the cloud environment (claude.ai → Claude Code → environment
settings), or tell me in a new message and I will open the secure form — never paste keys in chat.
Blender open movies (CC-BY) need no key: download.blender.org is reachable.
