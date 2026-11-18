// /lab: pick PBR materials for the classroom under the game's own lighting.
// Shows the real greybox room with the game's light rig, one slot at a time, A/B split screen,
// tiling/tint controls and a VRAM estimate. Picks are kept in localStorage (try them in the game
// with /?lab=1) and saved to src/config/materials.json (dev server) or exported as JSON.
import * as THREE from 'three';
import './lab.css';
import layoutJson from '../classroom/data/layouts/classroom-a.json';
import { AssetLoader, EMPTY_MANIFEST, loadPackManifest } from '../classroom/assets/AssetLoader';
import {
  LAB_PICKS_KEY,
  MATERIALS_CONFIG,
  readLabPicks,
  type LabPicks,
  type MaterialsConfig,
  type SlotConfig,
} from '../classroom/assets/pbr';
import { createTriplanarMaterial } from '../classroom/assets/triplanar';
import { buildGreybox } from '../classroom/render/greybox';
import { createRoomLights } from '../classroom/render/scene';
import type { RoomLayout } from '../classroom/sim/layout';
import { vramMB } from './vram';

interface Cand {
  source: string;
  id: string;
  name: string;
  authors: string[];
  url: string;
  why?: string;
  maps: { color: string; normal: string; arm: string };
}
interface LabManifest {
  materials: Record<string, { label: string; use?: string; scale: number; candidates: Cand[] }>;
  hdris: Record<string, { id: string; name: string; url: string; preview: string }[]>;
}

const layout = layoutJson as unknown as RoomLayout;
const VIEWS: Record<string, { pos: [number, number, number]; look: [number, number, number] }> = {
  concrete: { pos: [6.2, 1.6, 5.6], look: [8.7, 1.9, 3.6] },
  plaster: { pos: [5.5, 1.6, 5.2], look: [0, 1.5, 3.2] },
  carpet: { pos: [4.5, 1.7, 5.2], look: [4.5, 0, 2.6] },
  ceiling: { pos: [4.5, 1.4, 5.4], look: [4.5, 2.8, 2.2] },
  table: { pos: [2.4, 1.45, 4.3], look: [1.4, 0.72, 3.2] },
  plywood: { pos: [2.5, 1.25, 4.6], look: [1.0, 0.5, 3.4] },
  metal: { pos: [6.6, 1.1, 4.6], look: [8.9, 0.45, 3.6] },
  tile: { pos: [7.0, 1.45, 5.0], look: [9.0, 0.9, 6.45] },
  door: { pos: [4.2, 1.5, 3.2], look: [0.9, 1.1, 7.0] },
};

const app = document.getElementById('lab')!;
app.innerHTML = `
  <header>
    <h1>Material Lab</h1>
    <div class="slots" id="slots"></div>
    <span class="spacer"></span>
    <label>Sky <select id="hdri"></select></label>
    <button id="split" class="on">Split A|B</button>
    <button id="save">Save picks</button>
    <button id="copy">Copy JSON</button>
    <a href="/?lab=1" target="_blank"><button>Try in classroom ↗</button></a>
  </header>
  <aside id="list"></aside>
  <main id="view">
    <span class="tag a" id="tagA"></span><span class="tag b" id="tagB"></span><div class="split" id="divider"></div>
    <div class="ctl">
      <label>Tiling (m) <input id="scale" type="range" min="0.2" max="4" step="0.05"><span id="scaleV"></span></label>
      <label>Brightness <input id="bright" type="range" min="0.4" max="1.8" step="0.02"><span id="brightV"></span></label>
      <label>Roughness × <input id="rough" type="range" min="0.3" max="1.6" step="0.02"><span id="roughV"></span></label>
      <label>Tint <input id="tint" type="color"></label>
      <span class="vram" id="vram"></span>
    </div>
  </main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- State ----------------------------------------------------------------------------------
const config: MaterialsConfig = structuredClone(MATERIALS_CONFIG);
const picks: LabPicks = readLabPicks() ?? { materials: {}, hdris: {} };
for (const [slot, c] of Object.entries(config.materials))
  picks.materials[slot] ??= { source: c.source, id: c.id };
for (const [mood, h] of Object.entries(config.hdris))
  picks.hdris[mood] ??= { source: h.source, id: h.id };
let lab: LabManifest = { materials: {}, hdris: {} };
let slot = 'concrete';
let candA: Cand | null = null;
let candB: Cand | null = null;
let split = true;

const persist = () => {
  try {
    localStorage.setItem(LAB_PICKS_KEY, JSON.stringify(picks));
  } catch {
    /* storage unavailable */
  }
};
const opts = (s: string): SlotConfig => {
  const scale = lab.materials[s]?.scale ?? 1;
  config.materials[s] ??= { source: '', id: '', scale };
  return config.materials[s]!;
};

// --- Three ----------------------------------------------------------------------------------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d21);
const room = buildGreybox(layout);
scene.add(room.root);
const lights = createRoomLights(layout);
lights.sun.shadow.mapSize.set(2048, 2048);
scene.add(lights.hemi, lights.sun, lights.sun.target, lights.fill);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 50);
const loader = new AssetLoader(renderer, EMPTY_MANIFEST);
const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const slotMeshes = new Map<string, { mesh: THREE.Mesh; orig: THREE.Material }[]>();
room.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || Array.isArray(m.material)) return;
  const s = m.material.userData.pbr as string | undefined;
  if (!s) return;
  if (!slotMeshes.has(s)) slotMeshes.set(s, []);
  slotMeshes.get(s)!.push({ mesh: m, orig: m.material });
});

const mats = new Map<string, Promise<THREE.MeshStandardMaterial>>();
const ready = new Map<string, THREE.MeshStandardMaterial>();
function material(s: string, c: Cand): THREE.MeshStandardMaterial | null {
  const k = `${s}|${c.source}:${c.id}`;
  if (!mats.has(k)) {
    mats.set(
      k,
      loader.maps(c.maps, aniso).then((maps) => {
        const o = opts(s);
        const m = createTriplanarMaterial(s, maps, {
          scale: o.scale,
          tint: o.tint,
          brightness: o.brightness,
          roughness: o.roughness,
          metalness: o.metalness,
          metalBias: o.metalBias,
          normalScale: o.normalScale,
        });
        ready.set(k, m);
        requestRender();
        return m;
      }),
    );
    // A candidate whose maps cannot load (offline CDN) just stays on the greybox colour.
    mats.get(k)!.catch((e: unknown) => console.warn(`lab: ${k} failed to load`, e));
  }
  return ready.get(k) ?? null;
}
function updateUniforms(s: string): void {
  const o = opts(s);
  for (const [k, m] of ready) {
    if (!k.startsWith(`${s}|`)) continue;
    const u = m.userData.triUniforms as Record<string, { value: unknown }>;
    u.uTriScale!.value = 1 / o.scale;
    (u.uTriTint!.value as THREE.Color).set(o.tint ?? '#ffffff').multiplyScalar(o.brightness ?? 1);
    u.uTriRough!.value = o.roughness ?? 1;
  }
  requestRender();
}
const pickedCand = (s: string) => {
  const p = picks.materials[s];
  return lab.materials[s]?.candidates.find((c) => c.source === p?.source && c.id === p?.id) ?? null;
};
function assign(active: Cand | null): void {
  for (const [s, list] of slotMeshes) {
    const c = s === slot ? active : pickedCand(s);
    const m = c ? material(s, c) : null;
    for (const { mesh, orig } of list) mesh.material = m ?? orig;
  }
}

let pmrem: THREE.PMREMGenerator | null = null;
async function loadSky(id: string | undefined): Promise<void> {
  if (!id) return;
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const hdr = await new HDRLoader().loadAsync(
    `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`,
  );
  pmrem ??= new THREE.PMREMGenerator(renderer);
  scene.environment?.dispose();
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = config.hdris.overcast?.intensity ?? 0.45;
  hdr.dispose();
  requestRender();
}

// --- Camera (drag to look, wheel/pinch to move) ----------------------------------------------
let yaw = 0;
let pitch = 0;
let dolly = 0;
function setView(): void {
  const v = VIEWS[slot] ?? VIEWS.carpet!;
  const d = new THREE.Vector3(...v.look).sub(new THREE.Vector3(...v.pos)).normalize();
  yaw = Math.atan2(-d.x, -d.z);
  pitch = Math.asin(d.y);
  dolly = 0;
  placeCamera();
}
function placeCamera(): void {
  const v = VIEWS[slot] ?? VIEWS.carpet!;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  camera.position.set(...v.pos).addScaledVector(fwd, dolly);
  requestRender();
}
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    yaw -= (e.clientX - p.x) * 0.004;
    pitch = THREE.MathUtils.clamp(pitch - (e.clientY - p.y) * 0.004, -1.4, 1.4);
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch) dolly = THREE.MathUtils.clamp(dolly + (d - pinch) * 0.01, -2, 3);
    pinch = d;
  }
  placeCamera();
});
const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
};
renderer.domElement.addEventListener('pointerup', up);
renderer.domElement.addEventListener('pointercancel', up);
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    dolly = THREE.MathUtils.clamp(dolly - e.deltaY * 0.002, -2, 3);
    placeCamera();
  },
  { passive: false },
);

// --- Rendering (on demand) -------------------------------------------------------------------
let queued = false;
function requestRender(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(render);
}
function render(): void {
  queued = false;
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  if (split && candB) {
    assign(candA);
    renderer.setScissor(0, 0, Math.floor(w / 2), h);
    renderer.render(scene, camera);
    assign(candB);
    renderer.setScissor(Math.floor(w / 2), 0, w - Math.floor(w / 2), h);
    renderer.render(scene, camera);
  } else {
    assign(candA);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
  $('tagA').textContent = candA ? `A · ${candA.name}` : 'A · greybox';
  $('tagB').textContent = split && candB ? `B · ${candB.name}` : '';
  $('tagB').style.display = $('divider').style.display = split && candB ? '' : 'none';
}
new ResizeObserver(requestRender).observe(view);

// --- UI -------------------------------------------------------------------------------------
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function renderSlots(): void {
  $('slots').innerHTML = Object.entries(lab.materials)
    .map(
      ([s, g]) =>
        `<button data-slot="${s}" class="${s === slot ? 'on' : ''}" title="${esc(g.use ?? '')}">${esc(g.label)}</button>`,
    )
    .join('');
  for (const b of $('slots').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => selectSlot(b.dataset.slot!);
}

function renderList(): void {
  const g = lab.materials[slot];
  if (!g) return;
  const p = picks.materials[slot];
  $('list').innerHTML =
    `<p class="w">${esc(g.label)} — used for ${esc(g.use ?? '')}. ${g.candidates.length} candidates, all CC0. Pick ★ = goes into the game. Tiling, brightness, roughness and tint belong to the slot, so they apply to A and B alike.</p>` +
    g.candidates
      .map((c, i) => {
        const picked = p?.source === c.source && p.id === c.id;
        return `<div class="cand${picked ? ' picked' : ''}">
          <img loading="lazy" src="${esc(c.maps.color)}" alt="">
          <div><div class="n">${esc(c.name)}</div>
          <div class="s">${c.source === 'polyhaven' ? 'Poly Haven' : 'ambientCG'} · ${esc(c.authors.join(', '))} · <a href="${esc(c.url)}" target="_blank" rel="noopener">CC0</a></div>
          <div class="w">${esc(c.why ?? '')}</div></div>
          <div class="btns"><button class="a${c === candA ? ' on' : ''}" data-i="${i}" data-k="a">A</button>
          <button class="b${c === candB ? ' on' : ''}" data-i="${i}" data-k="b">B</button>
          <button class="${picked ? 'on' : ''}" data-i="${i}" data-k="pick">${picked ? '★ picked' : '☆ pick'}</button></div></div>`;
      })
      .join('');
  for (const b of $('list').querySelectorAll<HTMLButtonElement>('button[data-k]'))
    b.onclick = () => {
      const c = g.candidates[Number(b.dataset.i)]!;
      if (b.dataset.k === 'a') candA = c;
      else if (b.dataset.k === 'b') candB = c === candB ? null : c;
      else {
        picks.materials[slot] = { source: c.source, id: c.id };
        Object.assign(opts(slot), { source: c.source, id: c.id });
        persist();
      }
      renderList();
      requestRender();
    };
}

function renderControls(): void {
  const o = opts(slot);
  const bind = (id: string, v: number, set: (x: number) => void) => {
    const el = $<HTMLInputElement>(id);
    el.value = String(v);
    $(id + 'V').textContent = v.toFixed(2);
    el.oninput = () => {
      set(Number(el.value));
      $(id + 'V').textContent = Number(el.value).toFixed(2);
      updateUniforms(slot);
    };
  };
  bind('scale', o.scale, (x) => (o.scale = x));
  bind('bright', o.brightness ?? 1, (x) => (o.brightness = x));
  bind('rough', o.roughness ?? 1, (x) => (o.roughness = x));
  const tint = $<HTMLInputElement>('tint');
  tint.value = o.tint ?? '#ffffff';
  tint.oninput = () => {
    o.tint = tint.value;
    updateUniforms(slot);
  };
  const v = vramMB(512);
  const slots = Object.keys(lab.materials).length;
  $('vram').textContent =
    `VRAM per material (colour+normal+ORM, mips): 512 ${v.toFixed(1)} MB · 1k ${vramMB(1024).toFixed(1)} MB · 2k ${vramMB(2048).toFixed(1)} MB. ` +
    `All ${slots} slots: Battery ${(v * slots).toFixed(0)} MB · Medium ${(vramMB(1024) * slots).toFixed(0)} MB · High ${(vramMB(2048) * slots).toFixed(0)} MB.`;
}

function selectSlot(s: string): void {
  slot = s;
  const g = lab.materials[s];
  candA = pickedCand(s) ?? g?.candidates[0] ?? null;
  candB = g?.candidates.find((c) => c !== candA) ?? null;
  renderSlots();
  renderList();
  renderControls();
  setView();
}

function exportConfig(): MaterialsConfig {
  const out: MaterialsConfig = { materials: {}, hdris: {}, models: config.models };
  for (const s of Object.keys(lab.materials)) {
    const p = picks.materials[s];
    if (!p) continue;
    out.materials[s] = { ...opts(s), source: p.source, id: p.id, label: lab.materials[s]!.label };
  }
  for (const [mood, h] of Object.entries(picks.hdris))
    out.hdris[mood] = { ...config.hdris[mood], source: h.source, id: h.id };
  return out;
}

$('split').onclick = () => {
  split = !split;
  $('split').classList.toggle('on', split);
  requestRender();
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(exportConfig(), null, 2));
  $('copy').textContent = 'Copied ✓';
};
$('save').onclick = async () => {
  const body = JSON.stringify(exportConfig(), null, 2) + '\n';
  const r = await fetch('/__lab/save', { method: 'POST', body }).catch(() => null);
  if (r?.ok) {
    $('save').textContent = 'Saved to src/config/materials.json ✓';
    return;
  }
  // Deployed build: no dev server to write the file, so download it instead.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = 'materials.json';
  a.click();
  $('save').textContent = 'Downloaded materials.json (put it in src/config/)';
};
$<HTMLSelectElement>('hdri').onchange = (e) => {
  const id = (e.target as HTMLSelectElement).value;
  picks.hdris.overcast = { source: 'polyhaven', id };
  persist();
  loadSky(id).catch((e: unknown) => console.warn('lab: sky failed to load', e));
};

// --- Boot -----------------------------------------------------------------------------------
lab = (await fetch('/lab/manifest.json').then((r) => (r.ok ? r.json() : null))) ?? lab;
const hdris = lab.hdris.overcast ?? [];
const pack = (await loadPackManifest()) ?? EMPTY_MANIFEST;
void pack;
$('hdri').innerHTML = hdris
  .map(
    (h) =>
      `<option value="${h.id}"${h.id === picks.hdris.overcast?.id ? ' selected' : ''}>${esc(h.name)}</option>`,
  )
  .join('');
if (!lab.materials[slot]) slot = Object.keys(lab.materials)[0] ?? slot;
selectSlot(slot);
loadSky(picks.hdris.overcast?.id ?? hdris[0]?.id).catch((e: unknown) =>
  console.warn('lab: sky failed to load', e),
);
(window as unknown as { __labReady: boolean }).__labReady = true;
