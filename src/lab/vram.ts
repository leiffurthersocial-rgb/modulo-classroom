// GPU memory estimate for one triplanar material tier: colour + ORM at the tier size, normal at
// half size for the 2k tier (process-assets.ts), all transcoded to a 1-byte/texel block format
// (BC7 / ASTC 4x4 / ETC2 RGBA), plus a full mip chain (×4/3).
export function vramMB(tier: 512 | 1024 | 2048): number {
  const n = tier >= 2048 ? tier / 2 : tier;
  return ((2 * tier * tier + n * n) * 4) / 3 / 1048576;
}
