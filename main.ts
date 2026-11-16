import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// "THE THIMBLE TSUNAMI"
// A tiny sewing thimble on a wooden table unleashes a towering wave that
// rises, curls, and bursts into a flock of glowing seabirds, while one giant
// luminous drop hangs suspended above the crest. Scale twist (thimble ->
// tsunami) plus transformation twist (water -> birds). Pure Node, no deps,
// fully deterministic: every random choice comes from one seeded PRNG.

const W = 1024;
const H = 1024;
const SEED = 20261117;

type RGB = [number, number, number];
type Pt = [number, number];

// ---------------------------------------------------------------- PRNG ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function rr(min: number, max: number): number {
  return min + rand() * (max - min);
}

// ------------------------------------------------------------- helpers ---
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function gradAt(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const span = stops[i][0] - stops[i - 1][0];
      const f = span <= 0 ? 0 : (t - stops[i - 1][0]) / span;
      return lerpColor(stops[i - 1][1], stops[i][1], f);
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------------------------------------------------- framebuffer ---
const px = new Uint8Array(W * H * 3);

function blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  if (a > 1) a = 1;
  const i = (y * W + x) * 3;
  px[i] = Math.round(px[i] * (1 - a) + r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
}

function disc(cx: number, cy: number, rad: number, c: RGB, a: number): void {
  if (rad <= 0 || a <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rad - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad + 1));
  const y0 = Math.max(0, Math.floor(cy - rad - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      const edge = clamp(rad + 0.5 - d, 0, 1);
      if (edge > 0) blend(x, y, c[0], c[1], c[2], a * edge);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number): void {
  if (rx <= 0 || ry <= 0 || a <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
  const scale = Math.min(rx, ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(nx * nx + ny * ny);
      const edge = clamp((1 - d) * scale + 0.5, 0, 1);
      if (edge > 0) blend(x, y, c[0], c[1], c[2], a * edge);
    }
  }
}

function rect(x: number, y: number, w: number, h: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(W - 1, Math.ceil(x + w) - 1);
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H - 1, Math.ceil(y + h) - 1);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      blend(xx, yy, c[0], c[1], c[2], a);
    }
  }
}

function glow(cx: number, cy: number, rad: number, c: RGB, peak: number, power: number): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / rad;
      if (d < 1) blend(x, y, c[0], c[1], c[2], peak * Math.pow(1 - d, power));
    }
  }
}

// -------------------------------------------------------------- curves ---
function quad(p0: Pt, p1: Pt, p2: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

function catmullOpen(pts: Pt[], per: number): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

function catmullClosed(pts: Pt[], per: number): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

function stroke(points: Pt[], rad: number, c: RGB, a: number): void {
  for (let s = 0; s < points.length - 1; s++) {
    const x1 = points[s][0];
    const y1 = points[s][1];
    const x2 = points[s + 1][0];
    const y2 = points[s + 1][1];
    const len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    const steps = Math.max(1, Math.ceil(len / 0.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      disc(lerp(x1, x2, t), lerp(y1, y2, t), rad, c, a);
    }
  }
}

function ellipseStroke(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number, rad: number): void {
  const pts: Pt[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  stroke(pts, rad, c, a);
}

type Shader = (x: number, y: number) => [number, number, number, number];

function fillPoly(points: Pt[], shade: Shader): void {
  let minY = H;
  let maxY = 0;
  for (const p of points) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  const n = points.length;
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x1 = points[i][0];
      const y1 = points[i][1];
      const x2 = points[(i + 1) % n][0];
      const y2 = points[(i + 1) % n][1];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) {
        const s = shade(x, y);
        blend(x, y, s[0], s[1], s[2], s[3]);
      }
    }
  }
}

// ------------------------------------------------------------ pixel font ---
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(text: string, x0: number, y0: number, scale: number, c: RGB): void {
  const adv = 5 * scale + 4;
  for (let ci = 0; ci < text.length; ci++) {
    const glyph = FONT[text[ci]] || FONT[' '];
    const gx = x0 + ci * adv;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              blend(gx + col * scale + dx, y0 + row * scale + dy, c[0], c[1], c[2], 1);
            }
          }
        }
      }
    }
  }
}

// ----------------------------------------------------------------- birds ---
function drawBird(cx: number, cy: number, s: number, flap: number, c: RGB, a: number, hero: boolean): void {
  const tipY = cy - s * flap;
  const leftTip: Pt = [cx - s, tipY + s * 0.12];
  const rightTip: Pt = [cx + s, tipY + s * 0.12];
  const body: Pt = [cx, cy];
  const leftCtrl: Pt = [cx - s * 0.52, cy - s * 0.62 - s * flap * 0.25];
  const rightCtrl: Pt = [cx + s * 0.52, cy - s * 0.62 - s * flap * 0.25];
  const w = Math.max(1.4, s * 0.09);
  stroke(quad(leftTip, leftCtrl, body, 14), w, c, a);
  stroke(quad(body, rightCtrl, rightTip, 14), w, c, a);
  if (hero) {
    // second feather layer, slightly lower and fainter
    const l2: Pt = [cx - s * 0.92, tipY + s * 0.42];
    const r2: Pt = [cx + s * 0.92, tipY + s * 0.42];
    const lc2: Pt = [cx - s * 0.48, cy - s * 0.28];
    const rc2: Pt = [cx + s * 0.48, cy - s * 0.28];
    stroke(quad(l2, lc2, body, 12), w * 0.8, c, a * 0.55);
    stroke(quad(body, rc2, r2, 12), w * 0.8, c, a * 0.55);
    // motion trail behind (down-left, they fly up-right)
    stroke([[cx - s * 0.2, cy + s * 0.1], [cx - s * 1.15, cy + s * 0.55]], Math.max(1, s * 0.05), [220, 240, 255], 0.10);
    stroke([[cx - s * 0.1, cy + s * 0.28], [cx - s * 0.95, cy + s * 0.72]], Math.max(1, s * 0.04), [220, 240, 255], 0.08);
  }
  ellipse(cx, cy, Math.max(1.6, s * 0.17), Math.max(1.1, s * 0.08), c, a);
}

// ----------------------------------------------------------------- scene ---
const TABLE_Y = 848;

function drawBackground(): void {
  const skyStops: Array<[number, RGB]> = [
    [0.0, [6, 9, 30]],
    [0.35, [13, 27, 66]],
    [0.62, [19, 62, 104]],
    [0.82, [36, 108, 138]],
    [1.0, [64, 140, 158]],
  ];
  const tableTop: RGB = [52, 32, 19];
  const tableBot: RGB = [26, 15, 9];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (y < TABLE_Y) {
        const c = gradAt(skyStops, y / TABLE_Y);
        px[i] = Math.round(c[0]);
        px[i + 1] = Math.round(c[1]);
        px[i + 2] = Math.round(c[2]);
      } else {
        const t = (y - TABLE_Y) / (H - TABLE_Y);
        const c = lerpColor(tableTop, tableBot, t);
        px[i] = Math.round(c[0]);
        px[i + 1] = Math.round(c[1]);
        px[i + 2] = Math.round(c[2]);
      }
    }
  }
  // warm sunset glow behind the wave, low on the horizon
  glow(620, 820, 430, [255, 150, 70], 0.50, 2.2);
  glow(620, 820, 220, [255, 200, 120], 0.45, 2.0);
  // cool glow high up, behind the drop
  glow(705, 190, 300, [70, 150, 210], 0.30, 2.4);
}

function drawStars(): void {
  for (let i = 0; i < 170; i++) {
    const x = rr(0, W);
    const y = rr(0, 540);
    const r = rr(0.6, 1.7);
    const pick = rand();
    const c: RGB = pick < 0.7 ? [235, 242, 255] : pick < 0.9 ? [180, 210, 255] : [255, 220, 160];
    disc(x, y, r, c, rr(0.35, 1));
    if (r > 1.45) {
      stroke([[x - 5, y], [x + 5, y]], 0.7, c, 0.35);
      stroke([[x, y - 5], [x, y + 5]], 0.7, c, 0.35);
    }
  }
}

function drawSpeedLines(): void {
  const fx = 640;
  const fy = 380;
  for (let i = 0; i < 16; i++) {
    const ang = (rr(-165, -15) * Math.PI) / 180;
    const startR = rr(170, 280);
    const len = rr(60, 170);
    const p1: Pt = [fx + Math.cos(ang) * startR, fy + Math.sin(ang) * startR];
    const p2: Pt = [fx + Math.cos(ang) * (startR + len), fy + Math.sin(ang) * (startR + len)];
    if (p1[1] > 830) continue;
    stroke([p1, p2], rr(1, 2), [220, 240, 255], 0.06);
  }
}

function drawTable(): void {
  // wood grain
  for (let i = 0; i < 26; i++) {
    const y0 = rr(858, 1015);
    const phase = rr(0, 6.28);
    const pts: Pt[] = [];
    for (let x = 0; x <= W; x += 64) {
      pts.push([x, y0 + Math.sin(x * 0.01 + phase) * 3 + rr(-1.5, 1.5)]);
    }
    stroke(pts, 1.2, [18, 10, 5], 0.18);
  }
  for (let i = 0; i < 6; i++) {
    const y0 = rr(860, 1010);
    const phase = rr(0, 6.28);
    const pts: Pt[] = [];
    for (let x = 0; x <= W; x += 64) {
      pts.push([x, y0 + Math.sin(x * 0.012 + phase) * 2.5]);
    }
    stroke(pts, 1.1, [140, 95, 60], 0.10);
  }
  // reflection of the wave on the polished table
  for (let y = TABLE_Y; y < H; y++) {
    const fy = 1 - (y - TABLE_Y) / (H - TABLE_Y);
    for (let x = 360; x <= 700; x++) {
      const fx = clamp(1 - Math.abs(x - 530) / 170, 0, 1);
      blend(x, y, 50, 170, 200, 0.16 * fx * fy);
    }
  }
  ellipseStroke(520, 900, 120, 12, [150, 220, 235], 0.14, 1.2);
  ellipseStroke(520, 940, 150, 15, [150, 220, 235], 0.11, 1.2);
  ellipseStroke(520, 982, 180, 17, [150, 220, 235], 0.08, 1.2);
}

function drawWave(): Pt[] {
  const ctrl: Pt[] = [
    [320, 860],
    [335, 720],
    [375, 580],
    [435, 455],
    [515, 355],
    [595, 295],
    [665, 268],
    [720, 270],
    [770, 295],
    [805, 335],
    [812, 372],
    [778, 392],
    [738, 382],
    [706, 352],
    [688, 430],
    [668, 545],
    [655, 680],
    [658, 860],
  ];
  const outline = catmullClosed(ctrl, 16);
  fillPoly(outline, (x, y) => {
    const t = clamp((y - 262) / 598, 0, 1);
    let c: RGB;
    if (t < 0.45) {
      c = lerpColor([126, 224, 242], [18, 116, 156], smoothstep(0, 0.45, t));
    } else {
      c = lerpColor([18, 116, 156], [7, 38, 74], smoothstep(0.45, 1, t));
    }
    const sun = Math.pow(1 - t, 2) * clamp((x - 420) / 400, 0, 1) * 26;
    const streak = (Math.sin(x * 0.045 + y * 0.012) * 0.5 + 0.5) * 10 * (1 - t);
    return [
      clamp(c[0] + sun + streak, 0, 255),
      clamp(c[1] + sun + streak, 0, 255),
      clamp(c[2] + sun * 0.7 + streak, 0, 255),
      1,
    ];
  });
  // shadow inside the curl, under the lip
  const curl = catmullClosed(
    [
      [700, 338],
      [748, 322],
      [792, 344],
      [800, 372],
      [772, 394],
      [728, 388],
      [700, 362],
    ],
    12,
  );
  fillPoly(curl, () => [5, 28, 56, 0.38]);
  // light catching the inside of the curl
  const curlLine = catmullOpen(
    [
      [706, 348],
      [740, 332],
      [776, 342],
      [792, 366],
    ],
    14,
  );
  stroke(curlLine, 5, [90, 200, 230], 0.16);
  stroke(curlLine, 2, [170, 235, 250], 0.20);
  // flow streaks rising through the body, bowed to follow the wave's lean
  const flows: Array<[Pt, Pt, Pt]> = [
    [[395, 790], [400, 580], [520, 380]],
    [[455, 800], [455, 570], [575, 330]],
    [[515, 800], [510, 555], [625, 300]],
    [[570, 795], [560, 550], [675, 285]],
  ];
  for (const f of flows) {
    stroke(quad(f[0], f[1], f[2], 40), rr(2, 3), [150, 230, 245], 0.07);
  }
  stroke(quad([485, 800], [485, 560], [605, 312], 40), 1.4, [200, 245, 255], 0.10);
  stroke(quad([545, 800], [540, 550], [655, 290], 40), 1.4, [200, 245, 255], 0.10);
  return outline;
}

function drawFoam(): void {
  const crest = catmullOpen(
    [
      [430, 468],
      [505, 368],
      [585, 300],
      [660, 270],
      [725, 272],
      [778, 300],
      [806, 340],
      [812, 372],
    ],
    14,
  );
  stroke(crest, 7, [240, 252, 255], 0.42);
  stroke(crest, 3.5, [250, 253, 255], 0.50);
  // scallops along the crest
  for (let i = 0; i < crest.length; i += 2) {
    const p = crest[i];
    disc(p[0] + rr(-4, 4), p[1] + rr(-6, 2), rr(8, 18), [242, 252, 255], rr(0.5, 0.85));
    disc(p[0] + rr(-6, 6), p[1] - rr(4, 14), rr(3, 7), [250, 253, 255], rr(0.5, 0.8));
  }
  // droplets thrown above the crest
  for (let i = 0; i < 40; i++) {
    const p = crest[Math.floor(rand() * crest.length)];
    disc(p[0] + rr(-14, 20), p[1] - rr(10, 50), rr(1.5, 5), [235, 248, 255], rr(0.5, 0.9));
  }
  // foam where the wave meets the table: scattered puffs, no hard edge
  for (let x = 330; x <= 650; x += 11) {
    disc(x + rr(-6, 6), TABLE_Y + rr(-8, 8), rr(5, 12), [230, 246, 252], rr(0.25, 0.45));
    if (rand() < 0.5) disc(x + rr(-6, 6), TABLE_Y + rr(-16, -4), rr(3, 7), [240, 250, 254], rr(0.25, 0.4));
  }
}

function drawSpray(): void {
  // faint mist hugging the crest
  for (let i = 0; i < 22; i++) {
    disc(rr(650, 830), rr(240, 360), rr(14, 30), [225, 242, 250], rr(0.03, 0.07));
  }
  // burst of droplets fanning up and right from the lip
  for (let i = 0; i < 220; i++) {
    const ang = (rr(-78, 28) * Math.PI) / 180;
    const dist = rr(20, 300);
    const x = 770 + Math.cos(ang) * dist + rr(-8, 8);
    const y = 335 + Math.sin(ang) * dist + dist * 0.12 + rr(-8, 8);
    const size = rr(1, 6) * (1 - (dist / 300) * 0.55);
    const c: RGB = rand() < 0.6 ? [245, 252, 255] : [140, 215, 240];
    disc(x, y, Math.max(0.8, size), c, rr(0.5, 1));
  }
  // dense splash right at the lip
  for (let i = 0; i < 50; i++) {
    const ang = rr(0, Math.PI * 2);
    const dist = rr(0, 60);
    disc(800 + Math.cos(ang) * dist, 330 + Math.sin(ang) * dist * 0.8, rr(2, 8), [240, 250, 255], rr(0.5, 0.9));
  }
}

function drawBirds(): void {
  // heroes near the crest, flying up-right
  drawBird(835, 165, 38, 0.8, [255, 226, 160], 0.95, true);
  drawBird(895, 255, 28, 0.5, [255, 244, 220], 0.92, true);
  drawBird(795, 105, 24, 1.0, [255, 205, 110], 0.92, true);
  // mid flock streaming away from the crest
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    let x = 740 + t * 200 + rr(-15, 15);
    const y = 320 - t * 180 + rr(-18, 18);
    if (x > 630 && x < 780 && y > 60 && y < 270) x += 90;
    if (x > 948) x = 948;
    const c: RGB = rand() < 0.5 ? [255, 244, 220] : [255, 215, 140];
    drawBird(x, y, rr(11, 19), rr(0.3, 0.95), c, rr(0.85, 1), false);
  }
  // strays balancing the left sky
  drawBird(240, 210, 15, 0.7, [255, 244, 220], 0.9, false);
  drawBird(170, 300, 11, 0.5, [255, 220, 160], 0.85, false);
  drawBird(315, 140, 9, 0.9, [255, 244, 220], 0.85, false);
  drawBird(120, 180, 8, 0.6, [240, 248, 255], 0.8, false);
}

function drawDrop(): void {
  const cx = 705;
  const cy = 185;
  glow(cx, cy, 200, [110, 200, 245], 0.32, 2.0);
  glow(cx, cy, 110, [225, 248, 255], 0.38, 2.0);
  // rising streaks between crest and drop
  for (let i = 0; i < 8; i++) {
    const x = rr(660, 750);
    stroke(
      [
        [x, rr(320, 350)],
        [x + rr(-6, 6), rr(262, 285)],
      ],
      2,
      [210, 240, 252],
      0.18,
    );
  }
  // satellite droplets orbiting the big drop
  for (let i = 0; i < 14; i++) {
    const ang = rr(0, Math.PI * 2);
    const dist = rr(80, 140);
    disc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, rr(2, 6), [215, 242, 252], rr(0.55, 0.9));
  }
  const outline = catmullClosed(
    [
      [705, 78],
      [718, 108],
      [748, 148],
      [762, 190],
      [748, 230],
      [705, 254],
      [662, 230],
      [648, 190],
      [662, 148],
      [692, 108],
    ],
    14,
  );
  fillPoly(outline, (x, y) => {
    const dx = x - 700;
    const dy = y - 188;
    const d = Math.sqrt(dx * dx + dy * dy) / 100;
    const t = clamp(d, 0, 1);
    let c = lerpColor([222, 248, 255], [96, 196, 238], smoothstep(0, 0.55, t));
    c = lerpColor(c, [16, 78, 152], smoothstep(0.55, 1, t));
    const bx = x - 676;
    const by = y - 146;
    const band = clamp(1 - Math.sqrt(bx * bx + by * by) / 55, 0, 1) * 30;
    return [clamp(c[0] + band, 0, 255), clamp(c[1] + band, 0, 255), clamp(c[2] + band * 0.6, 0, 255), 1];
  });
  // rim light
  const closed: Pt[] = outline.concat([outline[0]]);
  stroke(closed, 2.2, [225, 248, 255], 0.45);
  // warm kiss of sunset on the lower-right rim
  stroke(quad([742, 210], [752, 236], [722, 252], 16), 2, [255, 205, 110], 0.22);
  // speculars
  ellipse(678, 146, 15, 24, [255, 255, 255], 0.90);
  ellipse(726, 214, 7, 11, [255, 255, 255], 0.45);
  // inner caustic arc
  stroke(quad([668, 200], [690, 232], [724, 220], 16), 2, [190, 235, 250], 0.30);
}

function drawThimble(): void {
  const cx = 380;
  // puddle catching the wave's light
  ellipse(cx, 898, 150, 20, [30, 120, 150], 0.35);
  ellipse(cx, 898, 110, 14, [120, 210, 230], 0.25);
  stroke(
    [
      [318, 892],
      [360, 890],
    ],
    1.4,
    [220, 244, 250],
    0.20,
  );
  stroke(
    [
      [398, 904],
      [440, 902],
    ],
    1.4,
    [220, 244, 250],
    0.18,
  );
  // shadow
  ellipse(cx, 896, 52, 10, [0, 0, 0], 0.45);
  // body: tapered sides + domed top
  const pts: Pt[] = [
    [346, 892],
    [351, 838],
    [356, 810],
  ];
  for (let a = 180; a <= 360; a += 12) {
    const rad = (a * Math.PI) / 180;
    pts.push([cx + 24 * Math.cos(rad), 810 + 22 * Math.sin(rad)]);
  }
  pts.push([404, 810], [409, 838], [414, 892]);
  const metalStops: Array<[number, RGB]> = [
    [0.0, [88, 98, 114]],
    [0.22, [214, 224, 238]],
    [0.45, [138, 150, 168]],
    [0.68, [205, 214, 228]],
    [1.0, [66, 76, 94]],
  ];
  fillPoly(pts, (x, y) => {
    const c = gradAt(metalStops, clamp((x - 346) / 68, 0, 1));
    const v = 1 - 0.22 * clamp((y - 788) / 104, 0, 1);
    return [c[0] * v, c[1] * v, c[2] * v, 1];
  });
  // dome highlight
  ellipse(366, 806, 12, 8, [255, 255, 255], 0.50);
  // dimples
  const rows = [822, 838, 854, 868];
  for (let ri = 0; ri < rows.length; ri++) {
    const y = rows[ri];
    const hw = lerp(24, 34, (y - 810) / 82);
    const off = ri % 2 === 0 ? 0 : 5.5;
    for (let x = cx - hw + 8 + off; x <= cx + hw - 8; x += 11) {
      if (Math.abs(x - cx) > hw - 4) continue;
      disc(x, y, 2.8, [40, 48, 60], 0.50);
      disc(x - 1, y - 1, 1.1, [230, 238, 248], 0.50);
    }
  }
  // brass base band
  fillPoly(
    [
      [345, 876],
      [415, 876],
      [415, 892],
      [345, 892],
    ],
    () => [52, 60, 74, 0.9],
  );
  stroke(
    [
      [345, 878],
      [415, 878],
    ],
    1.4,
    [255, 205, 110],
    0.50,
  );
  // outline + highlight stripe
  const closed: Pt[] = pts.concat([pts[0]]);
  stroke(closed, 1.8, [28, 34, 46], 0.55);
  stroke(
    [
      [361, 816],
      [359, 884],
    ],
    2.6,
    [255, 255, 255],
    0.20,
  );
  // splash crown bursting from the thimble's rim
  for (let i = 0; i < 7; i++) {
    const x = cx + rr(-46, 46);
    const top = 892 - rr(10, 30);
    disc(x, top, rr(2, 4.5), rand() < 0.5 ? [245, 252, 255] : [150, 225, 245], rr(0.6, 0.9));
  }
  // faint shockwave rings where the wave erupts
  ellipseStroke(cx, 896, 118, 20, [230, 250, 255], 0.12, 1.8);
  ellipseStroke(cx, 896, 152, 26, [230, 250, 255], 0.07, 1.4);
}

function drawFinish(): void {
  // vignette
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - 512) / 512;
      const dy = (y + 0.5 - 512) / 512;
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = 1 - 0.3 * Math.pow(smoothstep(0.62, 1.35, d), 2);
      const i = (y * W + x) * 3;
      px[i] = Math.round(px[i] * f);
      px[i + 1] = Math.round(px[i + 1] * f);
      px[i + 2] = Math.round(px[i + 2] * f);
    }
  }
  // poster frame: dark edge + gold hairline
  rect(0, 0, W, 8, [4, 6, 14], 1);
  rect(0, H - 8, W, 8, [4, 6, 14], 1);
  rect(0, 0, 8, H, [4, 6, 14], 1);
  rect(W - 8, 0, 8, H, [4, 6, 14], 1);
  stroke(
    [
      [11, 11],
      [1012, 11],
      [1012, 1012],
      [11, 1012],
      [11, 11],
    ],
    1,
    [255, 205, 110],
    0.35,
  );
  // caption plaque
  rect(252, 946, 520, 46, [8, 12, 26], 0.88);
  stroke(
    [
      [252, 946],
      [772, 946],
      [772, 992],
      [252, 992],
      [252, 946],
    ],
    1,
    [255, 205, 110],
    0.50,
  );
  fillPoly(
    [
      [276, 961],
      [284, 969],
      [276, 977],
      [268, 969],
    ],
    () => [255, 205, 110, 1],
  );
  fillPoly(
    [
      [748, 961],
      [756, 969],
      [748, 977],
      [740, 969],
    ],
    () => [255, 205, 110, 1],
  );
  drawText('IT CAME FROM A THIMBLE', 305, 958, 3, [255, 233, 176]);
}

function drawScene(): void {
  drawBackground();
  drawStars();
  drawSpeedLines();
  drawTable();
  drawWave();
  drawFoam();
  drawSpray();
  drawBirds();
  drawDrop();
  drawThimble();
  drawFinish();
}

// ------------------------------------------------------------- PNG out ---
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePNG(): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (stride + 1));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const row = Buffer.from(px.buffer, px.byteOffset + y * stride, stride);
    let best = Buffer.alloc(stride);
    let bestScore = Infinity;
    let bestF = 0;
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0;
        const b = prev[i];
        const cc = i >= 3 ? prev[i - 3] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = Math.floor((a + b) / 2);
        else if (f === 4) pred = paeth(a, b, cc);
        out[i] = (row[i] - pred) & 0xff;
      }
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const v = out[i];
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = out;
        bestF = f;
      }
    }
    raw[y * (stride + 1)] = bestF;
    best.copy(raw, y * (stride + 1) + 1);
    prev = row;
  }
  const comp = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', comp),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main(): void {
  drawScene();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
  console.log('wrote entry.png (' + png.length + ' bytes, ' + W + 'x' + H + ')');
}

main();
