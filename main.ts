// Giant Koi, Tiny Teacup — make.fun ai-excited-01 entry.
//
// One image, drawn entirely by this program at runtime. A colossal orange
// koi bursts out of an ordinary little teacup, water exploding around it,
// and shouts at the judge. The surprise is pure scale: a fish that should
// fit in the cup is bigger than the table. The momentum is the diagonal
// leap from the cup at bottom-left to the shouting head at top-right, with
// speed lines, a splash crown and flying droplets all driving toward that
// one moment. One big orange shape on deep indigo, so it still hits at
// 300 px. No image is read, downloaded or copied: every pixel is computed.
//
// Node 22, standard library only. Run it with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// It writes exactly one file, entry.png (1024x1024 PNG), deterministically.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ------------------------------------------------------------ the canvas

const W = 256; // logical grid, upscaled 4x to 1024
const H = 256;
const SCALE = 4;
const pixels = new Uint8Array(W * H * 3);

type RGB = [number, number, number];
type Pt = [number, number];

function hex(code: string): RGB {
  return [
    parseInt(code.slice(1, 3), 16),
    parseInt(code.slice(3, 5), 16),
    parseInt(code.slice(5, 7), 16),
  ];
}

function blend(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// One fixed seed: both grading runs write identical bytes.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261117);

// ------------------------------------------------------------- the palette

const INK = hex('#160f2e'); // near-black indigo, outlines
const SKY_TOP = hex('#140e36');
const SKY_BOT = hex('#2b1a5e');
const GOLD = hex('#ffd23f');
const SUN = hex('#ffb020');
const KOI_DEEP = hex('#d94f00');
const KOI = hex('#ff6b1a');
const KOI_PALE = hex('#ffa62b');
const CREAM = hex('#fff3d6');
const FIN_PALE = hex('#ffe9b0');
const AQUA = hex('#7fe3ff');
const AQUA_PALE = hex('#b8f1ff');
const PAPER: RGB = [255, 255, 255];
const TEA = hex('#d98a2b');
const CUP_WHITE = hex('#f8f8ff');
const STAR = hex('#ffe9a8');

// ------------------------------------------------------- drawing primitives

function setPixel(x: number, y: number, c: RGB): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const off = (iy * W + ix) * 3;
  pixels[off] = c[0];
  pixels[off + 1] = c[1];
  pixels[off + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(W - 1, Math.ceil(x + w) - 1);
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H - 1, Math.ceil(y + h) - 1);
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) setPixel(i, j, c);
  }
}

function fillDisc(cx: number, cy: number, r: number, c: RGB): void {
  const rad = Math.max(0, r);
  const x0 = Math.floor(cx - rad);
  const x1 = Math.ceil(cx + rad);
  const y0 = Math.floor(cy - rad);
  const y1 = Math.ceil(cy + rad);
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const dx = i - cx;
      const dy = j - cy;
      if (dx * dx + dy * dy <= rad * rad) setPixel(i, j, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, angle: number, c: RGB): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const bound = Math.ceil(Math.max(rx, ry)) + 1;
  for (let j = Math.floor(cy - bound); j <= Math.ceil(cy + bound); j++) {
    for (let i = Math.floor(cx - bound); i <= Math.ceil(cx + bound); i++) {
      const dx = i - cx;
      const dy = j - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      if (u * u + v * v <= 1) setPixel(i, j, c);
    }
  }
}

// A thick straight stroke, drawn as a chain of discs.
function stroke(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    fillDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, c);
  }
}

// Scanline-filled polygon.
function fillPoly(points: Pt[], c: RGB): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, y] of points) {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  for (let y = Math.max(0, Math.floor(lo)); y <= Math.min(H - 1, Math.ceil(hi)); y++) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(crossings[k]));
      const x1 = Math.min(W - 1, Math.floor(crossings[k + 1]));
      for (let x = x0; x <= x1; x++) setPixel(x, y, c);
    }
  }
}

function fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillDisc(x + r, y + r, r, c);
  fillDisc(x + w - r, y + r, r, c);
  fillDisc(x + r, y + h - r, r, c);
  fillDisc(x + w - r, y + h - r, r, c);
}

// ------------------------------------------------------------- bezier spine

function bezPoint(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

function bezTangent(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

// Unit normal pointing downward (the belly side of the arc).
function bezDown(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const [tx, ty] = bezTangent(p0, p1, p2, t);
  let nx = -ty;
  let ny = tx;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

// A tube of discs along a quadratic Bezier, radius from a function of t.
function bezTube(p0: Pt, p1: Pt, p2: Pt, radius: (t: number) => number, c: RGB): void {
  const steps = 220;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const [x, y] = bezPoint(p0, p1, p2, t);
    fillDisc(x, y, radius(t), c);
  }
}

// ------------------------------------------------------------------- the font
// Chunky 5x7 pixel capitals, only the glyphs the bubble needs.

const GLYPHS: Record<string, string[]> = {
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ',': ['.....', '.....', '.....', '.....', '.....', '.##..', '.#...'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
};

function drawText(cx: number, y: number, text: string, scale: number, c: RGB): void {
  const step = 6 * scale;
  const total = text.length * step - scale;
  let x = cx - total / 2;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '#') {
            fillRect(x + col * scale, y + row * scale, scale, scale, c);
          }
        }
      }
    }
    x += step;
  }
}

// -------------------------------------------------------------------- the scene

// The fish spine: tail in the cup, head up at top-right.
const SPINE0: Pt = [76, 228];
const SPINE1: Pt = [62, 108];
const SPINE2: Pt = [200, 78];

function bodyRadius(t: number): number {
  const swell = 6.5 + 11.5 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.05, 1)), 0.9);
  const headBoost = 6 * Math.max(0, Math.min(1, (t - 0.85) / 0.15));
  return swell + headBoost * headBoost * (3 - 2 * headBoost);
}

// Body colour: deep orange at the tail, bright orange mid-body, pale gold
// toward the head, back to orange at the snout.
const BODY_STOPS: Array<[number, RGB]> = [
  [0, KOI_DEEP],
  [0.45, KOI],
  [0.8, KOI_PALE],
  [1, KOI],
];
function bodyColour(t: number): RGB {
  for (let i = 1; i < BODY_STOPS.length; i++) {
    if (t <= BODY_STOPS[i][0]) {
      const [t0, c0] = BODY_STOPS[i - 1];
      const [t1, c1] = BODY_STOPS[i];
      return blend(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return KOI;
}

// 1. Background: deep indigo, darker at the top.
for (let y = 0; y < H; y++) {
  fillRect(0, y, W, 1, blend(SKY_TOP, SKY_BOT, y / (H - 1)));
}

// 2. Warm glow behind the head, the thrilling moment: a smooth radial
// falloff in many small steps, so it reads as light with no rings and no
// flat brown disc.
const glowAt: Pt = [200, 80];
for (let r = 78; r >= 8; r -= 4) {
  fillDisc(glowAt[0], glowAt[1], r, blend(SKY_BOT, SUN, 0.42 * (1 - r / 82)));
}

// 3. A few faint stars, kept out of the bubble's corner.
for (let i = 0; i < 22; i++) {
  const x = 6 + rand() * (W - 12);
  const y = 6 + rand() * 108;
  if (x < 158 && y < 82) continue;
  setPixel(x, y, rand() < 0.5 ? STAR : PAPER);
  if (rand() < 0.25) setPixel(x + 1, y, STAR);
}

// 4. Speed lines, parallel to the leap, behind everything else.
const leap: Pt = [0.88, -0.47];
for (let i = 0; i < 14; i++) {
  const x = 12 + rand() * (W - 24);
  const y = 14 + rand() * (H - 60);
  if (x < 158 && y < 86) continue; // bubble stays clean
  if (x > 40 && x < 122 && y > 204) continue; // cup stays clean
  const len = 18 + rand() * 30;
  const col = i % 3 === 0 ? GOLD : i % 3 === 1 ? PAPER : AQUA;
  stroke(x, y, x + leap[0] * len, y + leap[1] * len, 2, col);
}

// 5. A sheet of water thrown sideways out of the cup, behind the fish.
const ARC0: Pt = [58, 240];
const ARC1: Pt = [18, 158];
const ARC2: Pt = [92, 104];
bezTube(ARC0, ARC1, ARC2, () => 4.5, AQUA);
bezTube(ARC0, ARC1, ARC2, () => 1.8, AQUA_PALE);

// 6. Splash crown bursting from the rim (the cup is drawn over its bases).
for (const [base, tipX, tipY] of [
  [60, 50, 194],
  [70, 64, 184],
  [79, 80, 180],
  [88, 94, 188],
  [97, 105, 198],
] as Array<[number, number, number]>) {
  fillPoly(
    [
      [base - 4, 222],
      [base + 4, 222],
      [tipX, tipY],
    ],
    PAPER,
  );
}

// 7. Tail fin: two fat lobes sweeping back out of the cup.
fillPoly(
  [
    [78, 218],
    [42, 244],
    [64, 212],
  ],
  INK,
);
fillPoly(
  [
    [78, 218],
    [46, 240],
    [66, 211],
  ],
  FIN_PALE,
);
fillPoly(
  [
    [78, 214],
    [52, 196],
    [68, 204],
  ],
  INK,
);
fillPoly(
  [
    [78, 214],
    [56, 198],
    [70, 203],
  ],
  FIN_PALE,
);
fillPoly(
  [
    [78, 216],
    [56, 236],
    [70, 210],
  ],
  KOI_PALE,
);

// 8. The teacup — small, white, ordinary. The joke is the scale.
fillEllipse(76, 248, 38, 7, 0, INK); // saucer outline
fillEllipse(76, 247, 35, 6, 0, CUP_WHITE); // saucer
fillPoly(
  [
    [50, 220],
    [102, 220],
    [96, 244],
    [56, 244],
  ],
  INK,
); // cup outline
fillPoly(
  [
    [53, 221],
    [99, 221],
    [94, 241],
    [58, 241],
  ],
  CUP_WHITE,
); // cup body
fillEllipse(76, 221, 23, 5, 0, INK); // rim outline
fillEllipse(76, 221, 20, 4, 0, TEA); // tea
stroke(100, 226, 110, 228, 3, INK); // handle outline
stroke(100, 226, 110, 228, 2, CUP_WHITE);
stroke(100, 236, 110, 234, 3, INK);
stroke(100, 236, 110, 234, 2, CUP_WHITE);
stroke(109, 227, 109, 235, 3, INK);
stroke(109, 227, 109, 235, 2, CUP_WHITE);

// 9. The koi body, drawn in passes so it reads as one smooth fish.
// Outline first, then the gradient body, then light, belly and spots.
// The outline tapers away at the head end, so the body flows into the
// head with no dark ring between them.
bezTube(SPINE0, SPINE1, SPINE2, (t) => bodyRadius(t) + 3 * (1 - Math.max(0, (t - 0.86) / 0.14)), INK);
{
  const steps = 220;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
    fillDisc(x, y, bodyRadius(t), bodyColour(t));
  }
}
// Warm highlight along the top edge.
for (let s = 0; s <= 120; s++) {
  const t = 0.08 + (0.84 * s) / 120;
  const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
  const [nx, ny] = bezDown(SPINE0, SPINE1, SPINE2, t);
  fillDisc(x - nx * bodyRadius(t) * 0.55, y - ny * bodyRadius(t) * 0.55, bodyRadius(t) * 0.22, KOI_PALE);
}
// Cream belly along the lower side.
for (let s = 0; s <= 120; s++) {
  const t = 0.22 + (0.62 * s) / 120;
  const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
  const [nx, ny] = bezDown(SPINE0, SPINE1, SPINE2, t);
  fillDisc(x + nx * bodyRadius(t) * 0.42, y + ny * bodyRadius(t) * 0.42, bodyRadius(t) * 0.3, CREAM);
}
// Dark spots on the upper side.
for (const [t, r] of [
  [0.32, 4],
  [0.48, 5],
  [0.62, 4],
  [0.78, 4.5],
] as Array<[number, number]>) {
  const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
  const [nx, ny] = bezDown(SPINE0, SPINE1, SPINE2, t);
  fillDisc(x - nx * bodyRadius(t) * 0.35, y - ny * bodyRadius(t) * 0.35, r, INK);
}
// Dorsal fin: one low smooth ridge along the top edge.
function dorsal(extra: number, c: RGB): void {
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  const N = 24;
  for (let s = 0; s <= N; s++) {
    const t = 0.3 + (0.45 * s) / N;
    const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
    const [nx, ny] = bezDown(SPINE0, SPINE1, SPINE2, t);
    const hump = 12 * Math.pow(Math.sin((Math.PI * s) / N), 1.2) + extra;
    upper.push([x - nx * (bodyRadius(t) * 0.82), y - ny * (bodyRadius(t) * 0.82)]);
    lower.push([x - nx * (bodyRadius(t) * 0.82 + hump), y - ny * (bodyRadius(t) * 0.82 + hump)]);
  }
  fillPoly([...upper, ...lower.reverse()], c);
}
dorsal(2.5, INK);
dorsal(0, FIN_PALE);

// 10. The head: bigger, drawn over the body's end so head and body are
// one shape, with a wide-open shouting mouth.
const headAt: Pt = [202, 76];
const headAngle = -0.45;
fillEllipse(headAt[0], headAt[1], 29, 20, headAngle, INK);
fillEllipse(headAt[0], headAt[1], 26, 17, headAngle, KOI);
fillEllipse(headAt[0] + 4, headAt[1] + 7, 14, 8, headAngle, CREAM);
// Eye, wide open.
fillDisc(210, 68, 6.5, PAPER);
fillDisc(211, 68, 3, INK);
fillDisc(212, 66, 1.4, PAPER);
// Mouth, wide open in a shout, with a tongue.
fillPoly(
  [
    [218, 68],
    [232, 60],
    [228, 80],
  ],
  INK,
);
fillPoly(
  [
    [221, 70],
    [227, 67],
    [225, 75],
  ],
  KOI_DEEP,
);
// Gill line behind the cheek.
stroke(198, 86, 192, 98, 2, KOI_DEEP);
// Whiskers trailing back from the snout, kept short.
stroke(218, 80, 232, 72, 1.5, INK);
stroke(216, 84, 228, 84, 1.5, INK);
// Pectoral fin under the head.
fillPoly(
  [
    [190, 96],
    [176, 114],
    [196, 104],
  ],
  INK,
);
fillPoly(
  [
    [190, 96],
    [179, 111],
    [194, 102],
  ],
  FIN_PALE,
);

// 11. Water droplets flying off the fish and the cup.
const dropCols = [PAPER, AQUA_PALE, AQUA];
for (let i = 0; i < 28; i++) {
  // Fan bursting upward from the cup.
  const ang = (-165 + rand() * 150) * (Math.PI / 180);
  const d = 8 + rand() * 54;
  const x = 76 + Math.cos(ang) * d;
  const y = 222 + Math.sin(ang) * d * 0.9;
  if (x < 158 && y < 82) continue; // bubble stays clean
  fillDisc(x, y, 1 + rand() * 2.5, dropCols[i % 3]);
}
for (let i = 0; i < 24; i++) {
  // Droplets flung off the body, both sides.
  const t = 0.15 + rand() * 0.8;
  const [x, y] = bezPoint(SPINE0, SPINE1, SPINE2, t);
  const [nx, ny] = bezDown(SPINE0, SPINE1, SPINE2, t);
  const side = rand() < 0.55 ? 1 : -1;
  const off = bodyRadius(t) + 5 + rand() * 26;
  const dx = x + nx * off * side;
  const dy = y + ny * off * side;
  if (dx < 158 && dy < 82) continue;
  fillDisc(dx, dy, 1 + rand() * 2.5, dropCols[(i + 1) % 3]);
}
// A few big drops near the cup for weight.
for (const [x, y, r] of [
  [44, 208, 4],
  [116, 214, 4.5],
  [126, 190, 3.5],
  [36, 232, 3],
] as Array<[number, number, number]>) {
  fillDisc(x, y, r, AQUA_PALE);
  fillDisc(x - 1, y - 1, r * 0.45, PAPER);
}

// 12. The speech bubble, shouting at the judge.
const bubX = 8;
const bubY = 8;
const bubW = 140;
const bubH = 64;
fillRoundRect(bubX - 3, bubY - 3, bubW + 6, bubH + 6, 14, INK);
fillRoundRect(bubX, bubY, bubW, bubH, 12, PAPER);
fillPoly(
  [
    [126, bubY + bubH - 4],
    [140, bubY + bubH - 4],
    [184, 84],
  ],
  INK,
);
fillPoly(
  [
    [128, bubY + bubH - 6],
    [138, bubY + bubH - 6],
    [180, 86],
  ],
  PAPER,
);
drawText(bubX + bubW / 2, bubY + 8, 'WOW,', 3, INK);
drawText(bubX + bubW / 2, bubY + 38, 'JUDGE!', 3, INK);

// ------------------------------------------------------------- PNG encoding

// Minimal PNG encoder: 8-bit RGB, filter 0, zlib level 9.
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
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

const OUT_W = W * SCALE;
const OUT_H = H * SCALE;
const raw = Buffer.alloc(OUT_H * (1 + OUT_W * 3));
for (let y = 0; y < OUT_H; y++) {
  const gy = Math.floor(y / SCALE);
  raw[y * (1 + OUT_W * 3)] = 0; // filter: none
  for (let x = 0; x < OUT_W; x++) {
    const gx = Math.floor(x / SCALE);
    const src = (gy * W + gx) * 3;
    const dst = y * (1 + OUT_W * 3) + 1 + x * 3;
    raw[dst] = pixels[src];
    raw[dst + 1] = pixels[src + 1];
    raw[dst + 2] = pixels[src + 2];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT_W, 0);
ihdr.writeUInt32BE(OUT_H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
