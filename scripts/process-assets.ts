// Process fetched picks (src/config/materials.json) into shippable, content-hashed files under
// public/pack/ (committed; served with long-cache headers).
//
//   npm run assets:process [-- --only materials|models|hdris] [--force]
//
// Materials: KTX2 tiers 512/1024/2048 per slot. colour = ETC1S sRGB, ORM (AO/rough/metal) =
//            ETC1S linear, normal = UASTC + zstd (ETC1S ruins normals). The 2k tier ships a 1k
//            normal map (size/quality trade-off carried over from Places, D-027 there).
// Models:    glTF → dedup/weld/prune → simplify to maxTriangles → textures ≤ 1k KTX2 → meshopt.
//            Props are small, so one LOD is enough.
// HDRIs:     1k .hdr (reflections only; never shown as a backdrop).
// Writes public/pack/manifest.json, src/classroom/data/asset-credits.json, reports/asset-sizes.md.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getBounds, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld, simplify } from '@gltf-transform/functions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { packOrm } from './lib/orm';
import { ambientcgTexture, polyhavenHdri, polyhavenModel, polyhavenTexture } from './lib/sources';

const ROOT = process.cwd();
const PACK = join(ROOT, 'public', 'pack');
const argv = process.argv;
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
const force = argv.includes('--force');

type Tier = 512 | 1024 | 2048;
const TIERS: Tier[] = [512, 1024, 2048];
interface Manifest {
  version: 1;
  materials: Record<
    string,
    {
      source: string;
      id: string;
      tiers: Partial<Record<Tier, { color: string; normal: string; arm: string; bytes: number }>>;
    }
  >;
  models: Record<
    string,
    { source: string; id: string; file: string; bytes: number; triangles: number; height: number }
  >;
  hdris: Record<string, { source: string; id: string; file: string; bytes: number }>;
}
interface Picks {
  materials: Record<string, { source: 'polyhaven' | 'ambientcg'; id: string }>;
  models: Record<string, { source: 'polyhaven'; id: string; maxTriangles?: number }>;
  hdris: Record<string, { source: 'polyhaven'; id: string }>;
}

const manifestPath = join(PACK, 'manifest.json');
const manifest: Manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
  : { version: 1, materials: {}, models: {}, hdris: {} };
const saveManifest = () => {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
};

/** Write bytes as <dir>/<name>.<hash8><ext>; returns the site-relative URL. */
function writeHashed(dir: string, name: string, ext: string, data: Uint8Array): string {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
  const abs = join(PACK, dir);
  mkdirSync(abs, { recursive: true });
  const file = `${name}.${hash}${ext}`;
  if (!existsSync(join(abs, file))) writeFileSync(join(abs, file), data);
  return `/pack/${dir}/${file}`;
}

const imageDecoder = async (buffer: Uint8Array) => {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

async function processMaterials(p: Picks): Promise<void> {
  for (const [key, m] of Object.entries(p.materials)) {
    if (manifest.materials[key]?.id === m.id && !force) {
      console.log(`  · material ${key} already processed`);
      continue;
    }
    const files =
      m.source === 'polyhaven'
        ? await polyhavenTexture(m.id, '2k')
        : await ambientcgTexture(m.id, '2k');
    const entry: Manifest['materials'][string] = { source: m.source, id: m.id, tiers: {} };
    for (const t of TIERS) {
      const dir = `materials/${key}/${t}`;
      const color = await sharp(files.color).resize(t, t).png().toBuffer();
      const nSize = t >= 2048 ? t / 2 : t;
      const normal = await sharp(files.normal).resize(nSize, nSize).png().toBuffer();
      const arm = await packOrm(files, t);
      const kColor = await encodeToKTX2(new Uint8Array(color), {
        isUASTC: false,
        qualityLevel: 230,
        compressionLevel: 2,
        generateMipmap: true,
        isPerceptual: true,
        isSetKTX2SRGBTransferFunc: true,
        imageDecoder,
      });
      const kArm = await encodeToKTX2(new Uint8Array(arm), {
        isUASTC: false,
        qualityLevel: 200,
        compressionLevel: 2,
        generateMipmap: true,
        isPerceptual: false,
        imageDecoder,
      });
      const kNormal = await encodeToKTX2(new Uint8Array(normal), {
        isUASTC: true,
        isNormalMap: true,
        needSupercompression: true,
        generateMipmap: true,
        isPerceptual: false,
        imageDecoder,
      });
      entry.tiers[t] = {
        color: writeHashed(dir, 'color', '.ktx2', kColor),
        normal: writeHashed(dir, 'normal', '.ktx2', kNormal),
        arm: writeHashed(dir, 'arm', '.ktx2', kArm),
        bytes: kColor.byteLength + kNormal.byteLength + kArm.byteLength,
      };
      console.log(`  ✓ ${key} @${t}: ${(entry.tiers[t]!.bytes / 1024).toFixed(0)} KB`);
    }
    manifest.materials[key] = entry;
    saveManifest();
  }
}

const countTris = (d: Document) =>
  d
    .getRoot()
    .listMeshes()
    .reduce(
      (s, mesh) =>
        s + mesh.listPrimitives().reduce((a, pr) => a + (pr.getIndices()?.getCount() ?? 0) / 3, 0),
      0,
    );

async function processModels(p: Picks): Promise<void> {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const { ktx2 } = await import('ktx2-encoder/gltf-transform');
  for (const [key, m] of Object.entries(p.models ?? {})) {
    if (manifest.models[key]?.id === m.id && !force) {
      console.log(`  · model ${key} already processed`);
      continue;
    }
    try {
      const doc = await io.read(await polyhavenModel(m.id, '1k'));
      await doc.transform(dedup(), prune(), weld());
      const src = countTris(doc);
      const max = m.maxTriangles ?? 8000;
      // Simplify in steps of growing error until the budget is met (decor props: shape > detail).
      for (const error of [0.01, 0.03, 0.08, 0.2]) {
        const now = countTris(doc);
        if (now <= max) break;
        await doc.transform(
          simplify({ simplifier: MeshoptSimplifier, ratio: max / now, error }),
          weld(),
        );
      }
      const bounds = getBounds(doc.getRoot().listScenes()[0]!);
      const height = bounds.max[1] - bounds.min[1];
      await doc.transform(
        textureCompress({ encoder: sharp, resize: [1024, 1024], targetFormat: 'png' }),
      );
      await doc.transform(
        ktx2({ isUASTC: false, qualityLevel: 220, generateMipmap: true, imageDecoder }) as never,
      );
      await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const glb = await io.writeBinary(doc);
      manifest.models[key] = {
        source: m.source,
        id: m.id,
        file: writeHashed('models', key, '.glb', glb),
        bytes: glb.byteLength,
        triangles: countTris(doc),
        height: Number.isFinite(height) ? Math.round(height * 1000) / 1000 : 0,
      };
      console.log(
        `  ✓ model ${key}: ${(glb.byteLength / 1024).toFixed(0)} KB, ${manifest.models[key].triangles} tris (src ${src})`,
      );
    } catch (e) {
      console.error(`  ✗ model ${key} (${m.id}): ${(e as Error).message}`);
    }
    saveManifest();
  }
}

async function processHdris(p: Picks): Promise<void> {
  for (const [key, h] of Object.entries(p.hdris ?? {})) {
    if (manifest.hdris[key]?.id === h.id && !force) continue;
    const data = readFileSync(await polyhavenHdri(h.id, '1k'));
    manifest.hdris[key] = {
      source: h.source,
      id: h.id,
      file: writeHashed('hdris', `${key}-1k`, '.hdr', data),
      bytes: data.byteLength,
    };
    console.log(`  ✓ hdri ${key}`);
  }
}

/** Drop manifest entries that are no longer picked. */
function prunePicks(p: Picks): void {
  for (const k of Object.keys(manifest.materials))
    if (!p.materials[k]) delete manifest.materials[k];
  for (const k of Object.keys(manifest.models)) if (!p.models?.[k]) delete manifest.models[k];
  for (const k of Object.keys(manifest.hdris)) if (!p.hdris?.[k]) delete manifest.hdris[k];
}

/** In-game CREDITS lines for every shipped asset (tests check coverage). */
function writeCredits(): void {
  const lic = JSON.parse(readFileSync(join(ROOT, 'assets', 'LICENSES.json'), 'utf8')) as Record<
    string,
    { name: string; authors: string[]; license: string; url: string; source: string }
  >;
  const uses = new Map<string, string[]>();
  const add = (k: string, use: string) => uses.set(k, [...(uses.get(k) ?? []), use]);
  for (const [slot, m] of Object.entries(manifest.materials))
    add(`${m.source}:${m.id}`, `${slot} material`);
  for (const [key, m] of Object.entries(manifest.models))
    add(`${m.source}:${m.id}`, `${key} model`);
  for (const [key, h] of Object.entries(manifest.hdris))
    add(`${h.source}:${h.id}`, `${key} sky reflections`);
  const out = [...uses.keys()].sort().map((k) => {
    const e = lic[k];
    if (!e) throw new Error(`No license entry for shipped asset ${k}`);
    const site =
      e.source === 'polyhaven' ? 'Poly Haven' : e.source === 'ambientcg' ? 'ambientCG' : e.source;
    return {
      key: k,
      name: e.name,
      by: `${e.authors.join(', ')} · ${site}`,
      license: e.license,
      url: e.url,
      use: uses.get(k)!.join(', '),
    };
  });
  writeFileSync(
    join(ROOT, 'src/classroom/data/asset-credits.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
}

function sizeReport(): void {
  const kb = (n?: number) => (n ? `${(n / 1024).toFixed(0)} KB` : '—');
  const lines = [
    '# Asset size report',
    '',
    'Written by `npm run assets:process`.',
    '',
    '## Materials (download per slot: colour + normal + ORM)',
    '',
    '| Slot | Source | 512 | 1k | 2k |',
    '|---|---|---|---|---|',
  ];
  const tot: Record<Tier, number> = { 512: 0, 1024: 0, 2048: 0 };
  for (const [k, m] of Object.entries(manifest.materials)) {
    lines.push(
      `| ${k} | ${m.source}:${m.id} | ${kb(m.tiers[512]?.bytes)} | ${kb(m.tiers[1024]?.bytes)} | ${kb(m.tiers[2048]?.bytes)} |`,
    );
    for (const t of TIERS) tot[t] += m.tiers[t]?.bytes ?? 0;
  }
  lines.push(
    `| **total** | | ${kb(tot[512])} | ${kb(tot[1024])} | ${kb(tot[2048])} |`,
    '',
    'Per preset: Battery Saver loads the 512 column, Low/Medium the 1k column, High/Ultra the 2k column.',
    '',
    '## Models',
    '',
    '| Key | Source | GLB | Triangles | Height (m) |',
    '|---|---|---|---|---|',
  );
  let models = 0;
  for (const [k, m] of Object.entries(manifest.models)) {
    lines.push(`| ${k} | ${m.source}:${m.id} | ${kb(m.bytes)} | ${m.triangles} | ${m.height} |`);
    models += m.bytes;
  }
  lines.push(
    `| **total** | | ${kb(models)} | | |`,
    '',
    '## HDRIs',
    '',
    '| Key | Source | 1k |',
    '|---|---|---|',
  );
  for (const [k, h] of Object.entries(manifest.hdris))
    lines.push(`| ${k} | ${h.source}:${h.id} | ${kb(h.bytes)} |`);
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports', 'asset-sizes.md'), lines.join('\n') + '\n');
}

/** Delete pack files the manifest no longer references (old content hashes). */
function removeOrphans(): void {
  const keep = new Set<string>([manifestPath]);
  for (const m of Object.values(manifest.materials))
    for (const t of Object.values(m.tiers))
      for (const u of [t.color, t.normal, t.arm]) keep.add(join(ROOT, 'public', u));
  for (const m of Object.values(manifest.models)) keep.add(join(ROOT, 'public', m.file));
  for (const h of Object.values(manifest.hdris)) keep.add(join(ROOT, 'public', h.file));
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (!keep.has(p)) {
        rmSync(p);
        console.log(`  - removed stale ${p.slice(ROOT.length + 1)}`);
      }
    }
  };
  if (existsSync(PACK)) walk(PACK);
}

function packBytes(): number {
  let n = 0;
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else n += statSync(p).size;
    }
  };
  if (existsSync(PACK)) walk(PACK);
  return n;
}

const picks = JSON.parse(readFileSync(join(ROOT, 'src/config/materials.json'), 'utf8')) as Picks;
prunePicks(picks);
if (!only || only === 'materials') await processMaterials(picks);
if (!only || only === 'models') await processModels(picks);
if (!only || only === 'hdris') await processHdris(picks);
saveManifest();
removeOrphans();
writeCredits();
sizeReport();
console.log(`pack total: ${(packBytes() / 1048576).toFixed(1)} MB`);
