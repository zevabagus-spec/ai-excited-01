// Teacup Tsunami — make.fun ai-excited-01 entry (Node 22, standard library only).
//
// A porcelain teacup rides a giant curling wave at sunset, rendered fully
// procedurally: no image assets, no network, one deterministic program that
// writes /output/entry.png (1024x1024 PNG, well under 1 MiB).
//
// Run outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------- deterministic PRNG (fixed seed: no Date, no Math.random) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------- small math helpers ----------
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
// Blend foreground colour fg (alpha a) over background bg.
const over = (bg: RGB, fg: RGB, a: number): RGB => [
  lerp(bg[0], fg[0], a),
  lerp(bg[1], fg[1], a),
  lerp(bg[2], fg[2], a),
];

// ---------- value noise (deterministic, integer-hash based) ----------
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x: number, y: number): number {
  return (
    vnoise(x, y) * 0.55 +
    vnoise(x * 2.13 + 7.7, y * 2.13 + 3.1) * 0.3 +
    vnoise(x * 4.31 + 13.7, y * 4.31 + 9.4) * 0.15
  );
}

// ---------- 2D signed-distance helpers ----------
// Distance to a circle outline (negative inside).
const sdCirc = (px: number, py: number, cx: number, cy: number, r: number): number =>
  Math.hypot(px - cx, py - cy) - r;
// Approximate distance to an axis-aligned ellipse (good enough for soft shapes).
function sdEllipse(px: number, py: number, cx: number, cy: number, rx: number, ry: number): number {
  const qx = (px - cx) / rx;
  const qy = (py - cy) / ry;
  const k = Math.hypot(qx, qy);
  return (k - 1) * Math.min(rx, ry);
}
// Distance to a rounded box centred at (cx, cy) with half-sizes (hx, hy).
function sdRoundBox(px: number, py: number, cx: number, cy: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
// Distance to a line segment.
function sdSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// Anti-aliased coverage of an SDF: 1 deep inside, 0 outside, smooth edge.
const aa = (d: number, w = 1.4): number => sstep(w, -w, d);

// ---------- palette ----------
const SKY_TOP: RGB = [34, 22, 80];
const SKY_MID: RGB = [124, 45, 110];
const SKY_LOW: RGB = [214, 84, 106];
const SKY_HOR: RGB = [255, 158, 87];
const SUN_CORE: RGB = [255, 243, 196];
const SUN_HALO: RGB = [255, 178, 110];
const CLOUD: RGB = [247, 184, 196];
const WATER_SHALLOW: RGB = [55, 184, 168];
const WATER_MID: RGB = [14, 107, 138];
const WATER_DEEP: RGB = [6, 44, 76];
const FOAM: RGB = [234, 252, 255];
const PORCELAIN: RGB = [251, 247, 238];
const PORCELAIN_SHADE: RGB = [214, 205, 190];
const TEA: RGB = [217, 138, 43];
const TEA_DARK: RGB = [164, 92, 22];
const PETAL: RGB = [229, 107, 154];
const GOLD: RGB = [242, 193, 78];
const BIRD: RGB = [42, 26, 74];

// ---------- sky ----------
const SUN_X = 420;
const SUN_Y = 390;
const SUN_R = 80;

function skyColor(x: number, y: number): RGB {
  const t = clamp(y / 620, 0, 1);
  let c: RGB;
  if (t < 0.45) c = mix3(SKY_TOP, SKY_MID, t / 0.45);
  else if (t < 0.75) c = mix3(SKY_MID, SKY_LOW, (t - 0.45) / 0.3);
  else c = mix3(SKY_LOW, SKY_HOR, (t - 0.75) / 0.25);
  // Sun: glowing disc with a soft halo.
  const dSun = Math.hypot(x - SUN_X, y - SUN_Y);
  const glow = Math.exp(-dSun / 170);
  c = over(c, SUN_HALO, glow * 0.55);
  c = over(c, SUN_CORE, sstep(SUN_R + 2, SUN_R - 4, dSun));
  // A thin bright ring right at the disc edge.
  c = over(c, [255, 255, 240], sstep(6, 0, Math.abs(dSun - SUN_R)) * 0.35);
  // Clouds: three soft horizontal bands with fbm-eroded edges.
  const clouds: Array<[number, number, number, number, number]> = [
    [300, 150, 260, 34, 0.5],
    [760, 235, 300, 40, 0.45],
    [180, 330, 210, 30, 0.4],
  ];
  for (const [cx, cy, rx, ry, strength] of clouds) {
    if (Math.abs(x - cx) > rx + 40 || Math.abs(y - cy) > ry + 40) continue;
    const d = sdEllipse(x, y, cx, cy, rx, ry);
    const n = fbm(x * 0.02 + 3.1, y * 0.03 + 8.4);
    const a = sstep(14, -14, d + (n - 0.5) * 46) * strength;
    if (a > 0) c = over(c, CLOUD, a);
  }
  // Four distant birds, drawn as shallow chevrons.
  const birds: Array<[number, number, number]> = [
    [185, 178, 16],
    [248, 208, 12],
    [305, 162, 14],
    [845, 172, 13],
  ];
  for (const [bx, by, s] of birds) {
    if (Math.abs(x - bx) > s + 4 || Math.abs(y - by) > s * 0.6 + 4) continue;
    const d1 = sdSeg(x, y, bx - s, by - s * 0.35, bx, by + s * 0.25);
    const d2 = sdSeg(x, y, bx, by + s * 0.25, bx + s, by - s * 0.35);
    const d = Math.min(d1, d2);
    c = over(c, BIRD, aa(d, 1.6) * 0.85);
  }
  return c;
}

// ---------- the wave ----------
function crestY(x: number): number {
  // A great wave wall: low at the left horizon, rising steeply to the
  // curling crest at the right.
  const t = sstep(80, 1024, x);
  return 720 - 460 * Math.pow(t, 1.3) + 22 * Math.sin(x * 0.011 + 1.2);
}
// Curling lip: a rotated ellipse — the crest folding over on itself.
const LIP_X = 740;
const LIP_Y = 315;
const LIP_RX = 215;
const LIP_RY = 78;
const LIP_ROT = -0.42;

function inLip(x: number, y: number): boolean {
  const dx = x - LIP_X;
  const dy = y - LIP_Y;
  const cos = Math.cos(-LIP_ROT);
  const sin = Math.sin(-LIP_ROT);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return (lx * lx) / (LIP_RX * LIP_RX) + (ly * ly) / (LIP_RY * LIP_RY) < 1;
}

// Normalised local y inside the lip ellipse (-1 top, +1 bottom edge).
function lipLocalY(x: number, y: number): number {
  const dx = x - LIP_X;
  const dy = y - LIP_Y;
  const cos = Math.cos(-LIP_ROT);
  const sin = Math.sin(-LIP_ROT);
  return (dx * sin + dy * cos) / LIP_RY;
}

function waterColor(x: number, y: number): RGB {
  const cy = crestY(x);
  const depth = clamp((y - cy) / 420, 0, 1);
  let c = mix3(WATER_SHALLOW, WATER_MID, sstep(0, 0.45, depth));
  c = mix3(c, WATER_DEEP, sstep(0.45, 1, depth));
  // Long streaks of lighter water running down the face.
  const streak = fbm(x * 0.02 + 3.3, y * 0.015 + 1.2);
  c = over(c, [120, 220, 205], (streak - 0.5) * 0.45);
  // The curling lip shades darker toward its lower edge, foams at the tip,
  // and catches light along its top leading edge.
  if (inLip(x, y)) {
    const ly = lipLocalY(x, y);
    c = mix3(c, WATER_MID, sstep(-0.7, 0.9, ly) * 0.5);
    c = over(c, FOAM, sstep(0.55, 0.9, ly) * 0.45);
    c = over(c, [200, 245, 238], sstep(-0.9, -0.6, ly) * 0.4);
  }
  // Horizontal whitecaps streaking the deep water near the bottom.
  if (y > 700) {
    const fl = sstep(0.6, 0.78, fbm(x * 0.012 + 11.1, y * 0.004 + 5.5));
    c = over(c, FOAM, fl * sstep(700, 900, y) * 0.3);
  }
  // Foam band hugging the crest surface only (not the lip above it).
  const foamBand =
    sstep(30, 2, y - cy) * sstep(-40, -2, y - cy) * (0.5 + 0.5 * fbm(x * 0.05 + 9.1, 3.7));
  c = over(c, FOAM, foamBand * 0.85);
  // A second, fainter foam line breaking a little below the crest.
  const foam2 =
    sstep(64, 50, y - cy) * sstep(96, 82, y - cy) * (0.35 + 0.65 * fbm(x * 0.04 + 6.2, 8.8));
  c = over(c, FOAM, foam2 * 0.4);
  return c;
}

// ---------- the teacup (drawn in rotated local space) ----------
const CUP_X = 600;
const CUP_Y = 470;
const CUP_ROT = 0.42; // local frame rotated this far from world frame

function cupColor(lx: number, ly: number): RGB | null {
  // Returns the cup's colour at a local point, or null when outside the cup.
  // Saucer first (drawn under the body).
  const saucer = sdEllipse(lx, ly, 0, 66, 98, 15);
  // Handle: torus centred right of the body, only its outer half shows.
  const hd = Math.abs(Math.hypot(lx - 86, ly + 8) - 26) - 9;
  // Cup body: rounded box with a rim ellipse and amber tea on top.
  const body = sdRoundBox(lx, ly, 0, 0, 78, 52, 20);
  const rim = sdEllipse(lx, ly, 0, -50, 80, 13);
  const tea = sdEllipse(lx, ly, 0, -48, 70, 10);

  // Porcelain shading: light from the upper right, darker toward the base.
  let shade = 0.94 + 0.08 * clamp(lx / 78, -1, 1) - 0.16 * sstep(18, 52, ly);
  let col: RGB = [PORCELAIN[0] * shade, PORCELAIN[1] * shade, PORCELAIN[2] * shade];
  let hit = false;

  // Saucer (soft blue-grey porcelain edge).
  const sa = aa(saucer, 1.6);
  if (sa > 0) {
    col = over(col, [226, 232, 238], sa * 0.95);
    hit = true;
  }
  // Handle.
  const ha = aa(hd, 1.6) * (lx > 58 ? 1 : 0);
  if (ha > 0) {
    col = over(col, [PORCELAIN[0] * 0.96, PORCELAIN[1] * 0.96, PORCELAIN[2] * 0.96], ha);
    hit = true;
  }
  // Body.
  const ba = aa(body, 1.6);
  if (ba > 0) {
    col = over(col, [PORCELAIN[0] * shade, PORCELAIN[1] * shade, PORCELAIN[2] * shade], ba);
    hit = true;
    // Floral pattern: three small five-petal flowers on the body.
    const flowers: Array<[number, number]> = [
      [-38, 6],
      [6, 20],
      [44, 2],
    ];
    for (const [fx, fy] of flowers) {
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2;
        const px = fx + Math.cos(ang) * 8;
        const py = fy + Math.sin(ang) * 8;
        const pd = sdCirc(lx, ly, px, py, 4.6);
        col = over(col, PETAL, aa(pd, 1.2) * ba * 0.95);
      }
      const cd = sdCirc(lx, ly, fx, fy, 3.2);
      col = over(col, GOLD, aa(cd, 1.2) * ba * 0.95);
    }
    // Thin gold band under the rim.
    const band = sstep(3, 0, Math.abs(ly + 34) - 1.5) * sstep(78, 70, Math.abs(lx));
    col = over(col, GOLD, band * ba * 0.8);
  }
  // Rim lip.
  const ra = aa(rim, 1.4);
  if (ra > 0) {
    col = over(col, [255, 255, 252], ra * 0.9);
    hit = true;
  }
  // Tea surface inside the rim.
  const ta = aa(tea, 1.4);
  if (ta > 0) {
    const teaShade = 1 - 0.25 * sstep(-70, 70, lx);
    col = over(col, [TEA[0] * teaShade, TEA[1] * teaShade, TEA[2] * teaShade], ta);
    // Bright tea highlight.
    const hi = sdEllipse(lx, ly, -18, -50, 30, 4);
    col = over(col, [255, 205, 120], aa(hi, 1.2) * ta * 0.7);
    hit = true;
  }
  if (!hit) return null;
  return col;
}

// Tea spilling from the rim in a loose arc (local space).
// Returns [colour, alpha] or null when the point is outside the spill.
function spillColor(lx: number, ly: number): [RGB, number] | null {
  // A thin amber stream leaving the rim toward the lower left.
  const stream = sdSeg(lx, ly, -72, -44, -150, 8);
  let a = aa(stream - 4.5, 1.6) * 0.9;
  // Droplets strung along a parabola past the stream's end.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const dx = -150 - 90 * t;
    const dy = 8 + 150 * t * t - 20 * t;
    const r = 7 - 3.5 * t;
    const d = sdCirc(lx, ly, dx, dy, r);
    a = Math.max(a, aa(d, 1.4) * 0.95);
  }
  if (a <= 0) return null;
  // Droplets further out catch the light; the stream stays deep amber.
  const bright = sstep(0.4, 0.9, a);
  return [
    [lerp(TEA_DARK[0], 244, bright * 0.4), lerp(TEA_DARK[1], 178, bright * 0.4), lerp(TEA_DARK[2], 90, bright * 0.4)],
    a,
  ];
}

// Steam rising off the hot tea: two soft wavy columns (local space).
function steamAlpha(lx: number, ly: number): number {
  if (ly > -55 || ly < -170) return 0;
  let a = 0;
  for (const [base, phase] of [
    [-20, 0],
    [16, 2.1],
  ] as Array<[number, number]>) {
    const cx = base + 13 * Math.sin((ly + 60) * 0.035 + phase);
    const d = Math.abs(lx - cx) - 5.5 * (1 - (ly + 60) / 110);
    const fade = sstep(-55, -80, ly) * sstep(-170, -140, ly);
    a = Math.max(a, aa(d, 3) * 0.32 * fade);
  }
  return a;
}

// ---------- scene assembly (one pixel) ----------
function pixelColor(x: number, y: number): RGB {
  let c = skyColor(x, y);

  // Water is the wave face plus the curling lip.
  const waterA = Math.max(y > crestY(x) ? 1 : 0, inLip(x, y) ? 1 : 0);
  if (waterA > 0) {
    c = over(c, waterColor(x, y), waterA);
    // Soft shadow the curl throws onto the wave face below it.
    const sh = sdEllipse(x, y, 700, 560, 260, 90);
    c = over(c, [4, 28, 48], aa(sh, 60) * 0.22 * waterA);
    // Hollow shadow tucked under the curling lip.
    const tube = sdEllipse(x, y, 770, 395, 140, 40);
    c = over(c, [4, 28, 48], aa(tube, 24) * 0.2 * waterA);
  }

  // The teacup, riding the wave face (world-space shadow first).
  const cupShadow = sdEllipse(x, y, CUP_X, CUP_Y + 88, 135, 22);
  if (waterA > 0) c = over(c, [4, 28, 48], aa(cupShadow, 18) * 0.22 * waterA);

  const dx = x - CUP_X;
  const dy = y - CUP_Y;
  // Cheap bounding-box test before the rotated local evaluation.
  if (Math.abs(dx) < 260 && Math.abs(dy) < 260) {
    const cos = Math.cos(CUP_ROT);
    const sin = Math.sin(CUP_ROT);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const spill = spillColor(lx, ly);
    if (spill) c = over(c, spill[0], spill[1]);
    const cup = cupColor(lx, ly);
    if (cup) c = over(c, cup, 1);
    const steam = steamAlpha(lx, ly);
    if (steam > 0) c = over(c, [255, 255, 255], steam);
  }

  // Gentle vignette to hold the eye on the wave and the cup.
  const vx = (x - W / 2) / (W / 2);
  const vy = (y - H / 2) / (H / 2);
  const vig = sstep(0.62, 1.35, Math.hypot(vx, vy));
  c = [c[0] * (1 - vig * 0.14), c[1] * (1 - vig * 0.14), c[2] * (1 - vig * 0.16)];
  return c;
}

// ---------- spray and foam stamps (post-pass) ----------
// Deterministic droplet field, generated once from the fixed seed.
interface Drop {
  x: number;
  y: number;
  r: number;
  a: number;
}
function makeDrops(): Drop[] {
  const drops: Drop[] = [];
  // Spray bursting off the crest lip.
  for (let i = 0; i < 90; i++) {
    const x = 560 + rand() * 460;
    const cy = crestY(x);
    const y = cy - 70 + rand() * 120;
    drops.push({ x, y, r: 2 + rand() * 4.5, a: 0.5 + rand() * 0.45 });
  }
  // Spray ringing the teacup.
  for (let i = 0; i < 45; i++) {
    const ang = rand() * Math.PI * 2;
    const rad = 120 + rand() * 90;
    drops.push({
      x: CUP_X + Math.cos(ang) * rad,
      y: CUP_Y + Math.sin(ang) * rad * 0.8,
      r: 1.8 + rand() * 3.6,
      a: 0.45 + rand() * 0.45,
    });
  }
  // Foam flecks along the crest line.
  for (let i = 0; i < 60; i++) {
    const x = 60 + rand() * 940;
    drops.push({ x, y: crestY(x) + 4 + rand() * 10, r: 2 + rand() * 3, a: 0.5 + rand() * 0.4 });
  }
  // A few foam flecks in the deep water at the bottom.
  for (let i = 0; i < 28; i++) {
    drops.push({ x: rand() * W, y: 930 + rand() * 85, r: 2 + rand() * 3, a: 0.15 + rand() * 0.25 });
  }
  return drops;
}

// ---------- PNG encoder (stdlib zlib; per-row filter choice) ----------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

// Filter one scanline with the given PNG filter type (0..4).
function filterRow(row: Buffer, prev: Buffer | null, type: number): Buffer {
  const out = Buffer.alloc(row.length + 1);
  out[0] = type;
  const bpp = 3;
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
    let pred = 0;
    if (type === 1) pred = left;
    else if (type === 2) pred = up;
    else if (type === 3) pred = (left + up) >> 1;
    else if (type === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    out[i + 1] = (row[i] - pred) & 0xff;
  }
  return out;
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  const raw: Buffer[] = [];
  let prev: Buffer | null = null;
  const stride = w * 3;
  for (let y = 0; y < h; y++) {
    const row = Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride);
    // Pick the filter with the smallest sum of absolute signed bytes.
    let best: Buffer | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < 5; t++) {
      const f = filterRow(row, prev, t);
      let score = 0;
      for (let i = 1; i < f.length; i++) {
        const v = f[i];
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw.push(best as Buffer);
    prev = row;
  }
  const idat = deflateSync(Buffer.concat(raw), { level: 9 });
  parts.push(pngChunk('IDAT', idat));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------- main: render, stamp, encode, write ----------
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const buf = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = pixelColor(x, y);
      const i = (y * W + x) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
  // Spray and foam stamps.
  for (const d of makeDrops()) {
    const r = Math.ceil(d.r + 1);
    const x0 = Math.max(0, Math.floor(d.x - r));
    const x1 = Math.min(W - 1, Math.ceil(d.x + r));
    const y0 = Math.max(0, Math.floor(d.y - r));
    const y1 = Math.min(H - 1, Math.ceil(d.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x - d.x, y - d.y);
        const a = sstep(d.r + 1, d.r - 1, dist) * d.a;
        if (a <= 0) continue;
        const i = (y * W + x) * 3;
        buf[i] = lerp(buf[i], 240, a);
        buf[i + 1] = lerp(buf[i + 1], 252, a);
        buf[i + 2] = lerp(buf[i + 2], 255, a);
      }
    }
  }
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = clamp(Math.round(buf[i]), 0, 255);
  const png = encodePNG(rgb, W, H);
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
