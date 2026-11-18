// ORM packing: R = ambient occlusion, G = roughness, B = metalness (the glTF / Poly Haven "arm" layout).
import sharp from 'sharp';
import type { MaterialFiles } from './sources';

export async function packOrm(files: MaterialFiles, size: number): Promise<Buffer> {
  if (files.arm) return sharp(files.arm).resize(size, size).png().toBuffer();
  const grey = async (p: string | undefined, fallback: number) =>
    p
      ? await sharp(p).resize(size, size).greyscale().raw().toBuffer()
      : Buffer.alloc(size * size, fallback);
  const ao = await grey(files.ao, 255);
  const rough = await grey(files.rough, 200);
  const metal = await grey(files.metal, 0);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = ao[i]!;
    rgb[i * 3 + 1] = rough[i]!;
    rgb[i * 3 + 2] = metal[i]!;
  }
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}
