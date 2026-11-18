// Source adapters. Each returns local file paths in .asset-cache/ plus a license entry.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LicenseEntry } from './licenses';
import { CACHE, download, getJson } from './net';

export type Res = '1k' | '2k' | '4k';
export interface MaterialFiles {
  color: string;
  normal: string; // OpenGL convention (+Y)
  /** Either a packed AO/Rough/Metal map or separate maps. */
  arm?: string;
  ao?: string;
  rough?: string;
  metal?: string;
  height?: string;
}
type Lic = Omit<LicenseEntry, 'key' | 'fetchedAt'>;

// ---- Poly Haven (CC0; API terms ask for credit when used live) ---------------------------------

interface PhFile {
  url: string;
  md5: string;
  size: number;
}
type PhFiles = Record<string, Record<string, Record<string, PhFile | Record<string, unknown>>>>;
interface PhInfo {
  name: string;
  authors: Record<string, string>;
}

export async function polyhavenInfo(id: string): Promise<Lic> {
  const info = await getJson<PhInfo>(`https://api.polyhaven.com/info/${id}`, `ph-info-${id}`);
  return {
    source: 'polyhaven',
    id,
    name: info.name,
    authors: Object.keys(info.authors ?? {}),
    license: 'CC0-1.0',
    url: `https://polyhaven.com/a/${id}`,
  };
}

export async function polyhavenFiles(id: string): Promise<PhFiles> {
  return getJson<PhFiles>(`https://api.polyhaven.com/files/${id}`, `ph-files-${id}`);
}

/** Public CDN URLs for a texture's maps (used live by /lab; Poly Haven sends CORS *). */
export async function polyhavenTextureUrls(
  id: string,
  res: Res = '1k',
): Promise<Record<string, string>> {
  const f = await polyhavenFiles(id);
  const pick = (map: string, fmt = 'jpg') => (f[map]?.[res]?.[fmt] as PhFile | undefined)?.url;
  const out: Record<string, string> = {};
  const color = pick('Diffuse');
  const normal = pick('nor_gl');
  const arm = pick('arm');
  const height = pick('Displacement') ?? pick('Displacement', 'png');
  if (color) out.color = color;
  if (normal) out.normal = normal;
  if (arm) out.arm = arm;
  if (height) out.height = height;
  return out;
}

export async function polyhavenTexture(id: string, res: Res): Promise<MaterialFiles> {
  const f = await polyhavenFiles(id);
  const get = async (map: string, fmt = 'jpg') => {
    const file = f[map]?.[res]?.[fmt] as PhFile | undefined;
    if (!file) return undefined;
    return download(
      file.url,
      `polyhaven/textures/${id}/${res}/${file.url.split('/').pop()}`,
      file.md5,
    );
  };
  const color = await get('Diffuse');
  const normal = await get('nor_gl');
  if (!color || !normal) throw new Error(`polyhaven ${id}: missing diffuse/normal at ${res}`);
  const arm = await get('arm');
  const out: MaterialFiles = { color, normal };
  if (arm) out.arm = arm;
  const height = (await get('Displacement')) ?? (await get('Displacement', 'png'));
  if (height) out.height = height;
  return out;
}

export async function polyhavenModel(id: string, res: Res): Promise<string> {
  const f = await polyhavenFiles(id);
  const g = f.gltf?.[res]?.gltf as (PhFile & { include?: Record<string, PhFile> }) | undefined;
  if (!g) throw new Error(`polyhaven ${id}: no gltf at ${res}`);
  const dir = `polyhaven/models/${id}/${res}`;
  const main = await download(g.url, `${dir}/${g.url.split('/').pop()}`, g.md5);
  for (const [rel, file] of Object.entries(g.include ?? {}))
    await download(file.url, `${dir}/${rel}`, file.md5);
  return main;
}

export async function polyhavenHdri(id: string, res: Res): Promise<string> {
  const f = await polyhavenFiles(id);
  const file = f.hdri?.[res]?.hdr as PhFile | undefined;
  if (!file) throw new Error(`polyhaven ${id}: no hdr at ${res}`);
  return download(file.url, `polyhaven/hdris/${id}/${file.url.split('/').pop()}`, file.md5);
}

// ---- ambientCG (CC0) ---------------------------------------------------------------------------

interface AcgV2 {
  foundAssets: { assetId: string; displayName: string }[];
}

export async function ambientcgInfo(id: string): Promise<Lic> {
  const d = await getJson<AcgV2>(
    `https://ambientcg.com/api/v2/full_json?id=${id}`,
    `acg-info-${id}`,
  );
  const a = d.foundAssets[0];
  if (!a) throw new Error(`ambientCG ${id} not found`);
  return {
    source: 'ambientcg',
    id,
    name: a.displayName,
    authors: ['ambientCG (Lennart Demes)'],
    license: 'CC0-1.0',
    url: `https://ambientcg.com/view?id=${id}`,
  };
}

export async function ambientcgTexture(id: string, res: Res): Promise<MaterialFiles> {
  const attr = `${res.toUpperCase()}-JPG`;
  const zip = await download(
    `https://ambientcg.com/get?file=${id}_${attr}.zip`,
    `ambientcg/${id}/${id}_${attr}.zip`,
  );
  const dir = join(CACHE, 'ambientcg', id, attr);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  }
  const files = readdirSync(dir);
  const find = (suffix: string) => {
    const f = files.find((x) => x.toLowerCase().endsWith(`_${suffix.toLowerCase()}.jpg`));
    return f ? join(dir, f) : undefined;
  };
  const color = find('Color');
  const normal = find('NormalGL');
  if (!color || !normal) throw new Error(`ambientCG ${id}: missing Color/NormalGL in ${dir}`);
  const out: MaterialFiles = { color, normal };
  const ao = find('AmbientOcclusion');
  const rough = find('Roughness');
  const height = find('Displacement');
  const metal = find('Metalness');
  if (ao) out.ao = ao;
  if (rough) out.rough = rough;
  if (metal) out.metal = metal;
  if (height) out.height = height;
  return out;
}

// ---- Sources that need keys or manual steps -----------------------------------------------------

export const MANUAL_SOURCES = `
Manual sources (no scripted download from the cloud session):
- Kenney (CC0, https://kenney.nl/assets): kenney.nl refuses scripted downloads. Download packs in a
  browser into .asset-cache/manual/kenney/<pack>/ — see docs/classroom/ASSETS.md for the list.
- Quaternius (CC0, https://quaternius.com): same, into .asset-cache/manual/quaternius/<pack>/.
- Sketchfab: needs SKETCHFAB_API_TOKEN; only CC0 / CC-BY models, author + licence recorded.
- Freesound: needs FREESOUND_API_KEY (token auth: search + HQ previews). CC0 / CC-BY only.
- Pixabay: PIXABAY_API_KEY covers images and videos; the API serves no audio.
- Pexels: PEXELS_API_KEY for videos.
`;
