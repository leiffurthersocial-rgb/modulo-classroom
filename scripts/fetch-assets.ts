// Fetch third-party assets for Classroom (polite, cached in .asset-cache/, licences recorded in
// assets/LICENSES.json).
//
//   npm run assets:fetch -- --lab      lab candidates (src/config/lab-candidates.json) → public/lab/
//   npm run assets:fetch -- --picks    picks (src/config/materials.json) → .asset-cache/
//   npm run assets:fetch -- --manual   print manual-download instructions (Kenney, Quaternius …)
//
// Poly Haven lab candidates load live from their CDN (CORS *, credited on /lab). ambientCG only
// ships zips, so their candidates become small WebP previews committed under public/lab/acg/.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { packOrm } from './lib/orm';
import { loadLicenses, saveLicenses, upsertLicense } from './lib/licenses';
import {
  ambientcgInfo,
  ambientcgTexture,
  MANUAL_SOURCES,
  polyhavenHdri,
  polyhavenInfo,
  polyhavenModel,
  polyhavenTexture,
  polyhavenTextureUrls,
} from './lib/sources';

interface Candidate {
  source: 'polyhaven' | 'ambientcg';
  id: string;
  name?: string;
  why?: string;
}
interface Candidates {
  materials: Record<
    string,
    { label: string; use?: string; scale: number; candidates: Candidate[] }
  >;
  models: Record<string, Candidate[]>;
  hdris: Record<string, Candidate[]>;
}
export interface LabCandidate {
  source: string;
  id: string;
  name: string;
  authors: string[];
  url: string;
  why?: string;
  maps: { color: string; normal: string; arm: string };
  /** Bytes of committed preview maps (0 for live Poly Haven URLs). */
  previewBytes: number;
}
export interface LabManifest {
  generatedAt: string;
  materials: Record<
    string,
    { label: string; use?: string; scale: number; candidates: LabCandidate[] }
  >;
  hdris: Record<string, { id: string; name: string; url: string; preview: string }[]>;
}

const ROOT = process.cwd();
const LAB_DIR = join(ROOT, 'public', 'lab');
const args = new Set(process.argv.slice(2));

async function labAmbientcg(
  id: string,
  size: number,
): Promise<{ maps: LabCandidate['maps']; bytes: number }> {
  const files = await ambientcgTexture(id, '1k');
  const dir = join(LAB_DIR, 'acg', id);
  mkdirSync(dir, { recursive: true });
  const color = join(dir, 'color.webp');
  const normal = join(dir, 'normal.webp');
  const arm = join(dir, 'arm.webp');
  if (!existsSync(color))
    await sharp(files.color).resize(size, size).webp({ quality: 80 }).toFile(color);
  if (!existsSync(normal))
    await sharp(files.normal).resize(size, size).webp({ quality: 88 }).toFile(normal);
  if (!existsSync(arm))
    await sharp(await packOrm(files, size))
      .webp({ quality: 85 })
      .toFile(arm);
  const rel = (p: string) => '/' + p.slice(join(ROOT, 'public').length + 1).replaceAll('\\', '/');
  const bytes = [color, normal, arm].reduce((s, p) => s + statSync(p).size, 0);
  return { maps: { color: rel(color), normal: rel(normal), arm: rel(arm) }, bytes };
}

const info = (c: { source: string; id: string }) =>
  c.source === 'polyhaven' ? polyhavenInfo(c.id) : ambientcgInfo(c.id);

async function lab(): Promise<void> {
  const cand = JSON.parse(
    readFileSync(join(ROOT, 'src/config/lab-candidates.json'), 'utf8'),
  ) as Candidates;
  const lic = loadLicenses();
  const out: LabManifest = { generatedAt: new Date().toISOString(), materials: {}, hdris: {} };
  for (const [slot, group] of Object.entries(cand.materials)) {
    const list: LabCandidate[] = [];
    for (const c of group.candidates) {
      try {
        const i = await info(c);
        let maps: LabCandidate['maps'];
        let bytes = 0;
        if (c.source === 'polyhaven') {
          const urls = await polyhavenTextureUrls(c.id, '1k');
          if (!urls.color || !urls.normal || !urls.arm) throw new Error('missing color/normal/arm');
          maps = { color: urls.color, normal: urls.normal, arm: urls.arm };
        } else ({ maps, bytes } = await labAmbientcg(c.id, 512));
        upsertLicense(lic, i);
        list.push({
          source: c.source,
          id: c.id,
          name: i.name,
          authors: i.authors,
          url: i.url,
          why: c.why,
          maps,
          previewBytes: bytes,
        });
        console.log(`  ✓ ${slot}: ${c.source}:${c.id}`);
      } catch (e) {
        console.warn(`  ✗ ${slot}: ${c.source}:${c.id} — ${(e as Error).message}`);
      }
    }
    out.materials[slot] = {
      label: group.label,
      use: group.use,
      scale: group.scale,
      candidates: list,
    };
    saveLicenses(lic);
  }
  for (const [mood, list] of Object.entries(cand.hdris ?? {})) {
    out.hdris[mood] = [];
    for (const c of list) {
      try {
        const i = await polyhavenInfo(c.id);
        upsertLicense(lic, i);
        out.hdris[mood].push({
          id: c.id,
          name: i.name,
          url: i.url,
          preview: `https://cdn.polyhaven.com/asset_img/thumbs/${c.id}.png?width=256`,
        });
      } catch (e) {
        console.warn(`  ✗ hdri ${c.id} — ${(e as Error).message}`);
      }
    }
  }
  saveLicenses(lic);
  mkdirSync(LAB_DIR, { recursive: true });
  writeFileSync(join(LAB_DIR, 'manifest.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote public/lab/manifest.json');
}

interface Picks {
  materials: Record<string, { source: 'polyhaven' | 'ambientcg'; id: string }>;
  models: Record<string, { source: 'polyhaven'; id: string }>;
  hdris: Record<string, { source: 'polyhaven'; id: string }>;
}

async function picks(): Promise<void> {
  const p = JSON.parse(readFileSync(join(ROOT, 'src/config/materials.json'), 'utf8')) as Picks;
  const lic = loadLicenses();
  for (const [key, m] of Object.entries(p.materials)) {
    upsertLicense(lic, await info(m));
    if (m.source === 'polyhaven') await polyhavenTexture(m.id, '2k');
    else await ambientcgTexture(m.id, '2k');
    console.log(`  ✓ material ${key} ← ${m.source}:${m.id}`);
  }
  for (const [key, m] of Object.entries(p.models ?? {})) {
    upsertLicense(lic, await polyhavenInfo(m.id));
    await polyhavenModel(m.id, '1k');
    console.log(`  ✓ model ${key} ← ${m.id}`);
  }
  for (const [key, h] of Object.entries(p.hdris ?? {})) {
    upsertLicense(lic, await polyhavenInfo(h.id));
    await polyhavenHdri(h.id, '1k');
    console.log(`  ✓ hdri ${key} ← ${h.id}`);
  }
  saveLicenses(lic);
}

if (args.has('--lab')) await lab();
else if (args.has('--picks')) await picks();
else console.log(MANUAL_SOURCES);
