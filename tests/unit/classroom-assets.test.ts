// Asset wiring: tier selection, pack ↔ config ↔ greybox slots, decor placement, VRAM estimate.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickTier } from '../../src/classroom/assets/AssetLoader';
import layoutJson from '../../src/classroom/data/layouts/classroom-a.json';
import { decorSpots } from '../../src/classroom/render/decor';
import { PRESETS } from '../../src/classroom/quality';
import type { RoomLayout } from '../../src/classroom/sim/layout';
import { vramMB } from '../../src/lab/vram';
import config from '../../src/config/materials.json';

const layout = layoutJson as unknown as RoomLayout;
const SLOTS = [
  'concrete',
  'plaster',
  'carpet',
  'ceiling',
  'table',
  'plywood',
  'metal',
  'tile',
  'door',
];

describe('classroom assets', () => {
  it('picks the highest tier ≤ wanted, else the lowest', () => {
    expect(pickTier([512, 1024, 2048], 1024)).toBe(1024);
    expect(pickTier([512, 1024], 2048)).toBe(1024);
    expect(pickTier([1024, 2048], 512)).toBe(1024);
    expect(pickTier([], 1024)).toBeNull();
  });

  it('maps presets to texture tiers (Battery 512, Low/Medium 1k, High/Ultra 2k)', () => {
    expect(PRESETS.battery.textureTier).toBe(512);
    expect(PRESETS.low.textureTier).toBe(1024);
    expect(PRESETS.medium.textureTier).toBe(1024);
    expect(PRESETS.high.textureTier).toBe(2048);
    expect(PRESETS.ultra.textureTier).toBe(2048);
  });

  it('has a pick for every greybox slot, and the pack ships all three tiers for each', () => {
    expect(Object.keys(config.materials).sort()).toEqual([...SLOTS].sort());
    const greybox = readFileSync('src/classroom/render/greybox.ts', 'utf8');
    for (const s of SLOTS) expect(greybox, `greybox tags ${s}`).toContain(`'${s}')`);
    const pack = existsSync('public/pack/manifest.json')
      ? (JSON.parse(readFileSync('public/pack/manifest.json', 'utf8')) as {
          materials: Record<string, { id: string; tiers: Record<string, { color: string }> }>;
        })
      : null;
    if (!pack) return;
    for (const s of SLOTS) {
      const m = pack.materials[s];
      expect(m?.id, `pack ${s} matches pick`).toBe(
        (config.materials as Record<string, { id: string }>)[s]!.id,
      );
      expect(Object.keys(m!.tiers).sort()).toEqual(['1024', '2048', '512']);
      for (const t of Object.values(m!.tiers)) expect(existsSync('public' + t.color)).toBe(true);
    }
  });

  it('places decor inside the room, deterministically', () => {
    const a = decorSpots(layout);
    expect(a).toEqual(decorSpots(layout));
    const [W, H, D] = layout.room.size;
    for (const s of a) {
      expect(s.pos[0]).toBeGreaterThan(0);
      expect(s.pos[0]).toBeLessThan(W);
      expect(s.pos[2]).toBeGreaterThan(0);
      expect(s.pos[2]).toBeLessThan(D);
      expect(s.pos[1]).toBeLessThan(H);
    }
    expect(a.some((s) => s.key === 'bin' && s.replaces)).toBe(true);
  });

  it('estimates material VRAM per tier', () => {
    expect(vramMB(512)).toBeCloseTo(1.0, 1);
    expect(vramMB(1024)).toBeCloseTo(4.0, 1);
    expect(vramMB(2048)).toBeCloseTo(12.0, 1);
  });
});
