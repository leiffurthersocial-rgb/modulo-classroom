// Original procedural poster art (canvas -> CanvasTexture) in white frames. Nothing here is copied
// from a real poster; no people. Textures are generated once and shared between lessons.
import * as THREE from 'three';

const W = 480;
const H = 640;

type Painter = (g: CanvasRenderingContext2D) => void;

const SYMBOLS =
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn'.split(
    ' ',
  );

/** 1: a periodic-table-style chart. */
const chart: Painter = (g) => {
  g.fillStyle = '#f7f4ec';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d3b53';
  g.font = '700 38px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('THE ELEMENTS', 28, 66);
  g.font = '500 17px system-ui, sans-serif';
  g.fillStyle = '#5a6b78';
  g.fillText('a small chart for a big idea', 30, 92);
  const cols = 18;
  const cw = (W - 40) / cols;
  const palette = ['#e4572e', '#f3a712', '#a8c686', '#29b0a6', '#669bbc', '#7b6fb5', '#c4709a'];
  // Classic block layout (symbols are plain facts); the gap columns stay empty.
  let n = 0;
  const layout: [number, number][] = [];
  const addRow = (r: number, cs: number[]) => cs.forEach((c) => layout.push([r, c]));
  addRow(0, [0, 17]);
  addRow(1, [0, 1, 12, 13, 14, 15, 16, 17]);
  addRow(2, [0, 1, 12, 13, 14, 15, 16, 17]);
  addRow(
    3,
    Array.from({ length: 18 }, (_, i) => i),
  );
  addRow(
    4,
    Array.from({ length: 18 }, (_, i) => i),
  );
  addRow(
    5,
    Array.from({ length: 18 }, (_, i) => i),
  );
  for (const [r, c] of layout) {
    const sym = SYMBOLS[n++ % SYMBOLS.length]!;
    const x = 20 + c * cw;
    const y = 130 + r * (cw + 1);
    const kind =
      c === 0 ? 0 : c === 1 ? 1 : c >= 2 && c <= 11 ? 2 + ((c + r) % 2) : 4 + ((c + r) % 3);
    g.fillStyle = palette[kind % palette.length]!;
    g.fillRect(x + 1, y + 1, cw - 2, cw - 2);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '700 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(sym, x + cw / 2, y + cw / 2 + 4);
  }
  // Lower block (the "f-block" strip) and a colour legend.
  for (let i = 0; i < 14; i++) {
    g.fillStyle = palette[(i % 3) + 4]!;
    g.fillRect(60 + i * cw + 1, 130 + 7 * (cw + 1) + 1, cw - 2, cw - 2);
  }
  const legend = ['Metals', 'Light', 'Heavy', 'Gases', 'Rare'];
  legend.forEach((t, i) => {
    g.fillStyle = palette[i]!;
    g.fillRect(30 + i * 88, 500, 14, 14);
    g.fillStyle = '#2a3a46';
    g.font = '500 15px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(t, 50 + i * 88, 512);
  });
  g.fillStyle = '#1d3b53';
  g.font = '600 20px system-ui, sans-serif';
  g.fillText('Everything is made of something.', 28, 580);
};

/** Rough continent blobs (lon, lat) used only to make a dot-matrix world silhouette. */
const LAND: [number, number][][] = [
  [
    [-168, 66],
    [-140, 70],
    [-95, 72],
    [-62, 60],
    [-55, 50],
    [-80, 25],
    [-97, 17],
    [-82, 8],
    [-110, 22],
    [-125, 40],
    [-150, 58],
  ],
  [
    [-80, 10],
    [-60, 8],
    [-35, -6],
    [-40, -22],
    [-58, -38],
    [-68, -54],
    [-75, -40],
    [-72, -15],
    [-80, -2],
  ],
  [
    [-10, 36],
    [5, 44],
    [-5, 50],
    [10, 58],
    [28, 70],
    [40, 62],
    [38, 46],
    [28, 38],
    [12, 38],
  ],
  [
    [-17, 21],
    [-5, 35],
    [20, 33],
    [34, 30],
    [43, 12],
    [51, 11],
    [40, -12],
    [33, -28],
    [20, -35],
    [12, -18],
    [8, 4],
    [-12, 8],
  ],
  [
    [42, 40],
    [60, 70],
    [110, 76],
    [150, 68],
    [178, 65],
    [140, 45],
    [122, 30],
    [108, 12],
    [95, 18],
    [80, 8],
    [68, 22],
    [52, 28],
    [44, 18],
  ],
  [
    [113, -12],
    [130, -11],
    [145, -15],
    [153, -28],
    [146, -39],
    [130, -32],
    [115, -34],
  ],
  [
    [-52, 60],
    [-30, 70],
    [-20, 80],
    [-45, 82],
    [-60, 76],
  ],
];

function inPoly(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 2: a dot-matrix world silhouette. */
const worldDots: Painter = (g) => {
  g.fillStyle = '#12304a';
  g.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(255,255,255,0.07)');
  grd.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2e9d0';
  g.font = '700 42px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('ONE WORLD', W / 2, 78);
  const step = 8.5;
  const x0 = 24;
  const mapW = W - 48;
  const mapH = 250;
  const y0 = 150;
  for (let py = 0; py < mapH; py += step) {
    for (let px = 0; px < mapW; px += step) {
      const lon = (px / mapW) * 360 - 180;
      const lat = 85 - (py / mapH) * 150;
      const land = LAND.some((p) => inPoly(p, lon, lat));
      g.fillStyle = land ? '#f4b63f' : 'rgba(180,210,235,0.16)';
      g.beginPath();
      g.arc(x0 + px, y0 + py, land ? 3.1 : 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#9fc3dd';
  g.font = '500 18px system-ui, sans-serif';
  g.fillText('many places, one classroom', W / 2, 470);
  g.strokeStyle = '#f4b63f';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W / 2 - 60, 500);
  g.lineTo(W / 2 + 60, 500);
  g.stroke();
};

/** 3: typographic "Quiet, please". */
const quiet: Painter = (g) => {
  g.fillStyle = '#f1e6d2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d9503a';
  g.beginPath();
  g.arc(W * 0.78, 130, 92, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f4e5f';
  g.textAlign = 'left';
  g.font = '800 128px Georgia, serif';
  g.fillText('Quiet,', 26, 330);
  g.font = 'italic 600 96px Georgia, serif';
  g.fillStyle = '#d9503a';
  g.fillText('please', 40, 430);
  g.fillStyle = '#1f4e5f';
  g.fillRect(40, 470, 120, 6);
  g.font = '500 20px system-ui, sans-serif';
  g.fillText('thinking in progress', 40, 520);
  // Three little "sound waves" fading out
  g.strokeStyle = '#1f4e5f';
  g.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 1 - i * 0.3;
    g.beginPath();
    g.arc(W * 0.78 - 60, 135, 40 + i * 20, -0.7, 0.7);
    g.stroke();
  }
  g.globalAlpha = 1;
};

/** 4: pop-art grid of geometric shapes with halftone dots. */
const popGrid: Painter = (g) => {
  g.fillStyle = '#fbf3d6';
  g.fillRect(0, 0, W, H);
  const cols = 3;
  const rows = 4;
  const m = 18;
  const cw = (W - m * 2) / cols;
  const ch = (H - m * 2) / rows;
  const bg = ['#2f6fb3', '#f2c230', '#e24e42', '#2aa198', '#f08c3a', '#6a4fa3'];
  const fg = ['#fbf3d6', '#d6402f', '#1d2a44', '#f2c230', '#fbf3d6', '#2f6fb3'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = m + c * cw;
      const y = m + r * ch;
      g.fillStyle = bg[(i * 5) % bg.length]!;
      g.fillRect(x + 4, y + 4, cw - 8, ch - 8);
      // halftone dots
      g.fillStyle = 'rgba(0,0,0,0.13)';
      for (let dy = 0; dy < ch - 8; dy += 10)
        for (let dx = (dy / 10) % 2 ? 5 : 0; dx < cw - 8; dx += 10) {
          const rad = 1 + 3.2 * (dy / ch);
          g.beginPath();
          g.arc(x + 4 + dx, y + 4 + dy, rad, 0, Math.PI * 2);
          g.fill();
        }
      g.fillStyle = fg[(i * 3 + 1) % fg.length]!;
      const cx = x + cw / 2;
      const cy = y + ch / 2;
      const s = Math.min(cw, ch) * 0.3;
      g.beginPath();
      switch (i % 4) {
        case 0:
          g.arc(cx, cy, s, 0, Math.PI * 2);
          break;
        case 1:
          g.moveTo(cx, cy - s);
          g.lineTo(cx + s, cy + s * 0.8);
          g.lineTo(cx - s, cy + s * 0.8);
          g.closePath();
          break;
        case 2:
          g.arc(cx, cy + s * 0.3, s, Math.PI, 0);
          g.closePath();
          break;
        default:
          g.rect(cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6);
      }
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = '#1d2a44';
      g.stroke();
    }
  }
};

const PAINTERS: Painter[] = [chart, worldDots, quiet, popGrid];
const cache = new Map<number, THREE.CanvasTexture>();

/** Shared poster texture (index wraps over the four designs). */
export function posterTexture(index: number): THREE.CanvasTexture {
  const i = index % PAINTERS.length;
  let tex = cache.get(i);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  PAINTERS[i]!(g);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(i, tex);
  return tex;
}

/** A framed poster: white frame + white mat + the art, facing +Z (callers rotate it). */
export function createPoster(w: number, h: number, index: number): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.55 });
  const f = 0.022;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + f * 2, h + f * 2, 0.018), frameMat);
  frame.castShadow = true;
  frame.receiveShadow = true;
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: posterTexture(index),
      roughness: 0.55,
      metalness: 0,
    }),
  );
  art.position.z = 0.0095;
  art.receiveShadow = true;
  g.add(frame, art);
  return g;
}
