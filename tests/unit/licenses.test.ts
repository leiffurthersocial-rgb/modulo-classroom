// Licence gate: every shipped asset (public/pack/manifest.json), every /lab candidate
// (public/lab/manifest.json) and every picked asset (src/config/materials.json) must have an
// entry in assets/LICENSES.json with an allowed licence, and every shipped asset must have an
// in-game CREDITS line (src/classroom/data/asset-credits.json). Missing entries fail the build.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = <T>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
const ALLOWED = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'OFL-1.1',
  'Pixabay Content License',
]);
const licenses =
  read<
    Record<
      string,
      { license: string; name: string; url: string; authors: string[]; attribution?: string }
    >
  >('assets/LICENSES.json') ?? {};
interface Src {
  source: string;
  id: string;
}
const pack = read<{
  materials: Record<string, Src>;
  models: Record<string, Src>;
  hdris: Record<string, Src>;
}>('public/pack/manifest.json');
const shipped = pack
  ? [...Object.values(pack.materials), ...Object.values(pack.models), ...Object.values(pack.hdris)]
  : [];
const credits = read<{ key: string; license: string; url: string }[]>(
  'src/classroom/data/asset-credits.json',
)!;

describe('asset licences', () => {
  it('every entry uses an allowed licence, names authors and links its source', () => {
    for (const [k, e] of Object.entries(licenses)) {
      expect(ALLOWED.has(e.license), `${k}: ${e.license}`).toBe(true);
      expect(e.url, k).toMatch(/^https:\/\//);
      expect(e.authors.length, `${k} authors`).toBeGreaterThan(0);
      if (e.license.startsWith('CC-BY'))
        expect(e.attribution, `${k} needs attribution`).toBeTruthy();
    }
  });

  it('every shipped asset has a licence entry', () => {
    for (const a of shipped)
      expect(licenses[`${a.source}:${a.id}`], `${a.source}:${a.id}`).toBeDefined();
  });

  it('every shipped asset has an in-game CREDITS line, and credits list nothing unshipped', () => {
    const keys = new Set(shipped.map((a) => `${a.source}:${a.id}`));
    const credited = new Set(credits.map((c) => c.key));
    for (const k of keys) expect(credited.has(k), `credits missing ${k}`).toBe(true);
    for (const k of credited) expect(keys.has(k), `credit for unshipped ${k}`).toBe(true);
    for (const c of credits) expect(c.license).toBe(licenses[c.key]?.license);
  });

  it('every lab candidate has a licence entry', () => {
    const lab = read<{ materials: Record<string, { candidates: Src[] }> }>(
      'public/lab/manifest.json',
    );
    if (!lab) return;
    for (const m of Object.values(lab.materials))
      for (const c of m.candidates)
        expect(licenses[`${c.source}:${c.id}`], `${c.source}:${c.id}`).toBeDefined();
  });

  it('every pick in src/config/materials.json has a licence entry', () => {
    const cfg = read<Record<'materials' | 'models' | 'hdris', Record<string, Src>>>(
      'src/config/materials.json',
    )!;
    for (const group of [cfg.materials, cfg.models, cfg.hdris])
      for (const a of Object.values(group))
        expect(licenses[`${a.source}:${a.id}`], `${a.source}:${a.id}`).toBeDefined();
  });
});
