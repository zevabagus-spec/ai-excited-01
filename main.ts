// Teacup Tsunami — make.fun ai-excited-01 (round 3)
// A program that paints one image, pixel by pixel, with the Node standard
// library only: a tiny porcelain teacup pouring out a colossal golden
// tea-tsunami, a surfer riding its curling crest, painted to hit the judge
// with one jolt of energy at first glance. Fully deterministic: no clock,
// no randomness from the environment, no network — every run writes the
// same bytes.

import * as fs from "node:fs";
import * as path from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor: paint at 2048, downsample to 1024
const SW = W * SS;
const SH = H * SS;

// RGB float framebuffer at supersampled resolution.
const buf = new Float32Array(SW * SH * 3);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function hex(s) {
  return [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
}
// Multi-stop gradient: stops = [[position, [r, g, b]], ...], sorted by position.
function grad(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const span = stops[i][0] - stops[i - 1][0];
      const f = span === 0 ? 0 : (t - stops[i - 1][0]) / span;
      return mixColor(stops[i - 1][1], stops[i][1], f);
    }
  }
  return stops[stops.length - 1][1];
}

// Deterministic PRNG (mulberry32) with a fixed seed.
let rngState = 0xC0FFEE;
function rand() {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randRange(lo, hi) {
  return lo + rand() * (hi - lo);
}

// Blend one supersampled pixel toward a color. x, y are supersampled coords.
function blend(x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  if (a >= 1) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    return;
  }
  buf[i] += (r - buf[i]) * a;
  buf[i + 1] += (g - buf[i + 1]) * a;
  buf[i + 2] += (b - buf[i + 2]) * a;
}

// ---- Shape primitives (all coordinates in 1024-space; feather in px) ----

function disc(cx, cy, rad, col, alpha, feather) {
  const cxp = cx * SS;
  const cyp = cy * SS;
  const rp = rad * SS;
  const fp = Math.max(feather * SS, 1);
  const x0 = Math.max(0, Math.floor(cxp - rp - fp));
  const x1 = Math.min(SW - 1, Math.ceil(cxp + rp + fp));
  const y0 = Math.max(0, Math.floor(cyp - rp - fp));
  const y1 = Math.min(SH - 1, Math.ceil(cyp + rp + fp));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cyp;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cxp;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = clamp((rp - d) / fp + 0.5, 0, 1);
      if (t > 0) blend(x, y, col[0], col[1], col[2], alpha * t);
    }
  }
}

// Rotated ellipse. fn(lx, ly, q, xArt, yArt) returns [r, g, b, a] or null.
// lx, ly are normalized local coords (-1..1 across the ellipse).
function ellipseFn(cx, cy, rx, ry, rotDeg, feather, fn) {
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cxp = cx * SS;
  const cyp = cy * SS;
  const rxp = rx * SS;
  const ryp = ry * SS;
  const fp = Math.max(feather * SS, 1);
  const rMin = Math.min(rxp, ryp);
  const reach = Math.sqrt(rxp * rxp + ryp * ryp) + fp;
  const x0 = Math.max(0, Math.floor(cxp - reach));
  const x1 = Math.min(SW - 1, Math.ceil(cxp + reach));
  const y0 = Math.max(0, Math.floor(cyp - reach));
  const y1 = Math.min(SH - 1, Math.ceil(cyp + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cxp;
      const dy = y + 0.5 - cyp;
      const lx = (dx * cos + dy * sin) / rxp;
      const ly = (-dx * sin + dy * cos) / ryp;
      const q = lx * lx + ly * ly;
      if (q > 1.2) continue;
      const edge = clamp((1 - Math.sqrt(q)) * (rMin / fp) + 0.5, 0, 1);
      if (edge <= 0) continue;
      const got = fn(lx, ly, q, (x + 0.5) / SS, (y + 0.5) / SS);
      if (got) blend(x, y, got[0], got[1], got[2], got[3] * edge);
    }
  }
}

function ellipse(cx, cy, rx, ry, rotDeg, col, alpha, feather) {
  ellipseFn(cx, cy, rx, ry, rotDeg, feather, () => [col[0], col[1], col[2], alpha]);
}

// Elliptical arc band: only the ring near the ellipse edge, between local
// angles a0..a1 (degrees, 0 = +x, 90 = +y i.e. downward). thick in px.
function ellipseArc(cx, cy, rx, ry, rotDeg, thick, a0, a1, col, alpha, feather) {
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cxp = cx * SS;
  const cyp = cy * SS;
  const rxp = rx * SS;
  const ryp = ry * SS;
  const fp = Math.max(feather * SS, 1);
  const half = (thick * SS) / 2;
  const rMin = Math.min(rxp, ryp);
  const reach = Math.sqrt(rxp * rxp + ryp * ryp) + half + fp;
  const x0 = Math.max(0, Math.floor(cxp - reach));
  const x1 = Math.min(SW - 1, Math.ceil(cxp + reach));
  const y0 = Math.max(0, Math.floor(cyp - reach));
  const y1 = Math.min(SH - 1, Math.ceil(cyp + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cxp;
      const dy = y + 0.5 - cyp;
      const lx = (dx * cos + dy * sin) / rxp;
      const ly = (-dx * sin + dy * cos) / ryp;
      const q = Math.sqrt(lx * lx + ly * ly);
      const radial = Math.abs(q - 1) * rMin;
      if (radial > half + fp) continue;
      let ang = (Math.atan2(ly, lx) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      let lo = a0;
      let hi = a1;
      while (hi < lo) hi += 360;
      let a = ang;
      while (a < lo) a += 360;
      const dEnd = Math.min(a - lo, hi - a);
      if (dEnd < -2) continue;
      const endFade = clamp((dEnd * rMin * Math.PI) / 180 / fp + 0.5, 0, 1);
      const t = clamp((half - radial) / fp + 0.5, 0, 1) * endFade;
      if (t > 0) blend(x, y, col[0], col[1], col[2], alpha * t);
    }
  }
}

// Circular arc band (for the cup handle). Angles in degrees, atan2 space.
function ringArc(cx, cy, rad, thick, a0, a1, col, alpha, feather) {
  const cxp = cx * SS;
  const cyp = cy * SS;
  const rp = rad * SS;
  const half = (thick * SS) / 2;
  const fp = Math.max(feather * SS, 1);
  const reach = rp + half + fp;
  const x0 = Math.max(0, Math.floor(cxp - reach));
  const x1 = Math.min(SW - 1, Math.ceil(cxp + reach));
  const y0 = Math.max(0, Math.floor(cyp - reach));
  const y1 = Math.min(SH - 1, Math.ceil(cyp + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cxp;
      const dy = y + 0.5 - cyp;
      const d = Math.sqrt(dx * dx + dy * dy);
      const radial = Math.abs(d - rp);
      if (radial > half + fp) continue;
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      let lo = a0;
      let hi = a1;
      while (hi < lo) hi += 360;
      let a = ang;
      while (a < lo) a += 360;
      const dEnd = Math.min(a - lo, hi - a);
      if (dEnd < -2) continue;
      const endFade = clamp((dEnd * rp * Math.PI) / 180 / fp + 0.5, 0, 1);
      const t = clamp((half - radial) / fp + 0.5, 0, 1) * endFade;
      if (t > 0) blend(x, y, col[0], col[1], col[2], alpha * t);
    }
  }
}

// Soft radial glow, quadratic falloff.
function glow(cx, cy, rad, col, peak) {
  const cxp = cx * SS;
  const cyp = cy * SS;
  const rp = rad * SS;
  const x0 = Math.max(0, Math.floor(cxp - rp));
  const x1 = Math.min(SW - 1, Math.ceil(cxp + rp));
  const y0 = Math.max(0, Math.floor(cyp - rp));
  const y1 = Math.min(SH - 1, Math.ceil(cyp + rp));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cyp;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cxp;
      const q = (dx * dx + dy * dy) / (rp * rp);
      if (q >= 1) continue;
      const a = peak * (1 - q) * (1 - q);
      blend(x, y, col[0], col[1], col[2], a);
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  const ex = px - qx;
  const ey = py - qy;
  return { d: Math.sqrt(ex * ex + ey * ey), t };
}

// Polyline stroke with linear width and alpha taper along its length.
function strokePath(pts, w0, w1, col, a0, a1, feather) {
  const fp = Math.max(feather * SS, 1);
  const segLens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    total += len;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = segLens[i];
    const wMax = Math.max(w0, w1);
    const pad = (wMax / 2 + feather) * SS + 2;
    const x0 = Math.max(0, Math.floor(Math.min(x1, x2) * SS - pad));
    const x1p = Math.min(SW - 1, Math.ceil(Math.max(x1, x2) * SS + pad));
    const y0 = Math.max(0, Math.floor(Math.min(y1, y2) * SS - pad));
    const y1p = Math.min(SH - 1, Math.ceil(Math.max(y1, y2) * SS + pad));
    for (let y = y0; y <= y1p; y++) {
      for (let x = x0; x <= x1p; x++) {
        const r = distToSegment(
          x + 0.5,
          y + 0.5,
          x1 * SS,
          y1 * SS,
          x2 * SS,
          y2 * SS,
        );
        const tGlobal = total === 0 ? 0 : (acc + r.t * len) / total;
        const halfW = (lerp(w0, w1, tGlobal) * SS) / 2;
        const t = clamp((halfW - r.d) / fp + 0.5, 0, 1);
        if (t > 0) {
          blend(x, y, col[0], col[1], col[2], lerp(a0, a1, tGlobal) * t);
        }
      }
    }
    acc += len;
  }
}

function fillRect(x, y, w, h, col, alpha) {
  const x0 = Math.max(0, Math.floor(x * SS));
  const x1 = Math.min(SW - 1, Math.ceil((x + w) * SS));
  const y0 = Math.max(0, Math.floor(y * SS));
  const y1 = Math.min(SH - 1, Math.ceil((y + h) * SS));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      blend(xx, yy, col[0], col[1], col[2], alpha);
    }
  }
}

// Four-point star sparkle: two crossed thin ellipses.
function sparkle(cx, cy, size, col, alpha) {
  ellipse(cx, cy, size * 0.16, size, 0, col, alpha, size * 0.35);
  ellipse(cx, cy, size, size * 0.16, 0, col, alpha, size * 0.35);
  disc(cx, cy, size * 0.22, col, alpha, size * 0.2);
}

// Scanline polygon fill. colorFn(xArt, yArt) returns [r, g, b, a] or null.
// Horizontal span-end feathering plus supersampling gives clean edges.
function fillPoly(pts, colorFn, feather) {
  const sp = pts.map((p) => [p[0] * SS, p[1] * SS]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of sp) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const fp = Math.max(feather * SS, 1);
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(SH - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < sp.length; i++) {
      const [x1, y1p] = sp[i];
      const [x2, y2p] = sp[(i + 1) % sp.length];
      if ((y1p <= yc && yc < y2p) || (y2p <= yc && yc < y1p)) {
        xs.push(x1 + ((yc - y1p) * (x2 - x1)) / (y2p - y1p));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xl = xs[k];
      const xr = xs[k + 1];
      const xa = Math.max(0, Math.floor(xl - fp));
      const xb = Math.min(SW - 1, Math.ceil(xr + fp));
      for (let x = xa; x <= xb; x++) {
        const xc = x + 0.5;
        const edge = clamp(Math.min(xc - xl, xr - xc) / fp + 0.5, 0, 1);
        if (edge <= 0) continue;
        const got = colorFn(xc / SS, yc / SS);
        if (got) blend(x, y, got[0], got[1], got[2], got[3] * edge);
      }
    }
  }
}

// Catmull-Rom spline through control points (open curve, duplicated ends).
function catmullRom(points, samplesPerSeg) {
  const pts = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 0; i < pts.length - 2; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const p2 = pts[i + 2];
    const p3 = pts[i + 3] || p2;
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}

// ---- Scene part 1: sky, sun, sea ----

const SKY_STOPS = [
  [0.0, hex("#150a30")],
  [0.32, hex("#3d1660")],
  [0.55, hex("#7a2364")],
  [0.72, hex("#c93a5e")],
  [0.86, hex("#ff7a36")],
  [1.0, hex("#ffb84d")],
];

function paintSky() {
  for (let y = 0; y < SH; y++) {
    const t = y / SH;
    const c = grad(SKY_STOPS, t);
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
  // Warm wash toward the sun's side of the sky.
  glow(590, 280, 620, hex("#ff8a3d"), 0.22);
  glow(590, 280, 300, hex("#ffc93c"), 0.25);
}

function paintStars() {
  for (let i = 0; i < 52; i++) {
    const x = randRange(10, 1014);
    const y = randRange(8, 400) * (1 - 0.35 * rand());
    const r = randRange(0.9, 2.6);
    const col = rand() < 0.3 ? hex("#ffd76a") : hex("#ffffff");
    disc(x, y, r, col, randRange(0.3, 0.95), 1.2);
  }
  const twinkles = [
    [120, 90, 9],
    [430, 70, 7],
    [950, 120, 8],
    [330, 150, 6],
    [560, 110, 7],
  ];
  for (const [x, y, s] of twinkles) {
    sparkle(x, y, s, hex("#fff6d8"), 0.85);
  }
}

function paintClouds() {
  const clouds = [
    [180, 300, 190, 26, -4, hex("#ff9a6b"), 0.2],
    [520, 220, 150, 20, 3, hex("#e86a8a"), 0.18],
    [880, 150, 170, 22, -2, hex("#b44a7a"), 0.17],
    [300, 460, 220, 24, 2, hex("#ff8a5c"), 0.12],
    [760, 480, 150, 18, -3, hex("#ff9a6b"), 0.13],
  ];
  for (const [x, y, rx, ry, rot, col, a] of clouds) {
    ellipse(x, y, rx, ry, rot, col, a, 30);
  }
}

function paintSun() {
  glow(590, 280, 320, hex("#ffb040"), 0.5);
  glow(590, 280, 170, hex("#ffd678"), 0.55);
  disc(590, 280, 75, hex("#fff3c4"), 1, 2);
  disc(590, 280, 56, hex("#fffbe8"), 1, 2);
  // Radiating rays, subtle.
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + randRange(-0.08, 0.08);
    if (Math.sin(ang) > 0.75) continue; // skip rays pointing straight down
    const len = randRange(190, 390);
    const x2 = 590 + Math.cos(ang) * len;
    const y2 = 280 + Math.sin(ang) * len;
    strokePath(
      [
        [590, 280],
        [x2, y2],
      ],
      11,
      2,
      hex("#ffd76a"),
      0.1,
      0.0,
      6,
    );
  }
}

function paintSea() {
  // Distant sea band; mostly hidden behind the wave, visible at the left.
  fillPoly(
    [
      [0, 690],
      [1024, 660],
      [1024, 850],
      [0, 850],
    ],
    (x, y) => {
      const t = clamp((y - 660) / 190, 0, 1);
      const c = grad(
        [
          [0, hex("#1d5f66")],
          [1, hex("#123a4d")],
        ],
        t,
      );
      return [c[0], c[1], c[2], 1];
    },
    2,
  );
  // Glints on the water.
  for (let i = 0; i < 16; i++) {
    const x = randRange(20, 980);
    const y = randRange(685, 800);
    const len = randRange(18, 60);
    strokePath(
      [
        [x, y],
        [x + len, y + randRange(-2, 2)],
      ],
      2.5,
      2.5,
      hex("#ffd76a"),
      randRange(0.15, 0.35),
      randRange(0.15, 0.35),
      2,
    );
  }
  // Horizon glow line.
  strokePath(
    [
      [0, 688],
      [1024, 658],
    ],
    5,
    5,
    hex("#ffd76a"),
    0.35,
    0.35,
    4,
  );
}

// ---- Scene part 2: the tea-tsunami ----

// Crest control points (art coords): the wave's upper edge sweeps from the
// low swell at the left up to the curling crest at the top right.
const CREST_CTRL = [
  [40, 850],
  [140, 810],
  [250, 765],
  [370, 700],
  [490, 600],
  [610, 495],
  [730, 385],
  [830, 300],
  [905, 255],
];
const CREST = catmullRom(CREST_CTRL, 40);

// Lookup: crest top y (art units) per supersampled column.
const topY = new Float32Array(SW + 1);
function buildTopLookup() {
  let s = 0;
  for (let col = 0; col <= SW; col++) {
    const xArt = col / SS;
    while (
      s < CREST.length - 2 &&
      CREST[s + 1][0] < xArt
    ) {
      s++;
    }
    const [x1, y1] = CREST[s];
    const [x2, y2] = CREST[s + 1];
    let y;
    if (xArt <= x1) y = y1;
    else if (xArt >= x2) y = y2;
    else y = y1 + ((xArt - x1) * (y2 - y1)) / (x2 - x1);
    topY[col] = y;
  }
}

const FACE_STOPS = [
  [0.0, hex("#ffd166")],
  [0.22, hex("#f5a83d")],
  [0.5, hex("#c97a1e")],
  [0.78, hex("#8a4a12")],
  [1.0, hex("#5e2f0e")],
];

function faceColor(x, y, depth) {
  const t = clamp((y - 250) / 760, 0, 1);
  let c = grad(FACE_STOPS, t);
  // Deep shadow toward the lower left, where the swell turns away.
  const sh = (1 - x / W) * 0.28 * t;
  c = mixColor(c, hex("#3a1e08"), sh);
  // Sunlit glow hugging the crest edge.
  const g = Math.exp(-Math.max(depth, 0) / 110);
  c = mixColor(c, hex("#ffe9a8"), g * 0.55);
  // Broad diagonal shaft of light across the face.
  const band =
    Math.exp(-Math.pow((x * 0.65 + y - 760) / 200, 2)) * 0.16;
  c = mixColor(c, hex("#ffdf8e"), band);
  // Faint large-scale ripple variation so the face is not flat.
  const rip = Math.sin(x * 0.008 + y * 0.004) * 0.025;
  c = mixColor(c, hex("#ffffff"), Math.max(0, rip));
  c = mixColor(c, hex("#2a1506"), Math.max(0, -rip));
  return c;
}

function paintWaveFace() {
  const feather = 2.5;
  for (let row = 0; row < SH; row++) {
    const yArt = (row + 0.5) / SS;
    if (yArt < 235) continue;
    for (let col = 0; col < SW; col++) {
      const depth = yArt - topY[col];
      if (depth < -feather) continue;
      const a = clamp(depth / feather + 0.5, 0, 1);
      const c = faceColor((col + 0.5) / SS, yArt, depth);
      blend(col, row, c[0], c[1], c[2], a);
    }
  }
  // Dark rim along the crest so the gold face separates from the sky.
  strokePath(CREST, 7, 7, hex("#6b3410"), 0.5, 0.5, 3);
  // Continuous soft foam edge along the crest, under the blobs.
  strokePath(CREST, 11, 11, hex("#fff6e0"), 0.5, 0.5, 6);
}

// The outer surface of the folding tongue: the region between the crest
// curve and the curl path, so the curl reads as solid water folding over
// instead of a ring floating in the sky.
function paintCurlFace() {
  const startIdx = CREST.findIndex((p) => p[0] >= 600);
  const edge = CREST.slice(startIdx);
  const poly = [...edge, ...[...CURL].reverse(), [646, 480]];
  fillPoly(
    poly,
    (x, y) => {
      const t = clamp((y - 180) / 300, 0, 1);
      let c = grad(
        [
          [0, hex("#f7b64e")],
          [0.5, hex("#e09a2e")],
          [1, hex("#c97a1e")],
        ],
        t,
      );
      // Shadow deepening toward the barrel mouth.
      const dx = x - 740;
      const dy = y - 335;
      const d = Math.sqrt(dx * dx + dy * dy);
      const sh = clamp(1 - d / 190, 0, 1) * 0.35;
      c = mixColor(c, hex("#7a4a12"), sh);
      return [c[0], c[1], c[2], 1];
    },
    2.5,
  );
}

// The barrel: the tube mouth under the curling lip — dark but lit from
// within, so it reads as water, not a hole punched through the wave.
function paintBarrel() {
  ellipse(742, 342, 70, 45, -16, hex("#3a2410"), 1, 3);
  ellipse(742, 348, 56, 35, -16, hex("#2a1a0c"), 1, 4);
  // Light glowing at the far end of the tube.
  glow(712, 348, 42, hex("#ffbe50"), 0.35);
  ellipse(710, 350, 26, 14, -16, hex("#ffd166"), 0.5, 6);
  // Gold rim light along the lower-left inner edge of the tube.
  ellipseArc(742, 342, 70, 45, -16, 6, 55, 175, hex("#ffd166"), 0.55, 3);
  ellipseArc(742, 342, 60, 38, -16, 4, 70, 160, hex("#ffedb8"), 0.45, 3);
}

// The curling lip: the crest folding over into a hook.
const CURL_CTRL = [
  [905, 255],
  [868, 208],
  [795, 182],
  [718, 192],
  [662, 240],
  [638, 300],
  [646, 338],
];
const CURL = catmullRom(CURL_CTRL, 30);

function paintLip() {
  // Underside shadow first, offset into the face/barrel side.
  const shadow = CURL.map((p) => [p[0] + 10, p[1] + 14]);
  strokePath(shadow, 34, 20, hex("#7a4a12"), 0.35, 0.3, 8);
  // Layered strokes: deep gold, bright gold, cream highlight.
  strokePath(CURL, 80, 34, hex("#d98a24"), 1, 1, 4);
  const mid = CURL.map((p) => [p[0] - 5, p[1] - 7]);
  strokePath(mid, 56, 22, hex("#f7b64e"), 1, 1, 4);
  const hi = CURL.map((p) => [p[0] - 11, p[1] - 15]);
  strokePath(hi, 18, 8, hex("#fff6e0"), 0.9, 0.9, 4);
  // Rounded tip droplet where the lip points down.
  disc(646, 338, 20, hex("#fff3d6"), 1, 3);
  disc(652, 362, 10, hex("#fff8ec"), 0.95, 2);
  disc(656, 382, 5, hex("#fff8ec"), 0.85, 2);
}

function curveTangent(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / len, dy / len];
}

function paintFoam() {
  const white = hex("#fff8ec");
  const cream = hex("#ffe9bf");
  // Foam blobs riding the crest edge.
  for (let i = 0; i < CREST.length; i += 2) {
    const p = CREST[i];
    const [tx, ty] = curveTangent(CREST, i);
    const nx = ty;
    const ny = -tx;
    const flip = ny > 0 ? -1 : 1;
    const off = randRange(-4, 10);
    const cx = p[0] + nx * off * flip + randRange(-6, 6);
    const cy = p[1] + ny * off * flip + randRange(-6, 6);
    const r = randRange(5, 17);
    const col = mixColor(white, cream, rand());
    disc(cx, cy, r, col, randRange(0.75, 1), 2.5);
    if (rand() < 0.35) {
      disc(
        cx + randRange(-14, 14),
        cy + randRange(-14, 14),
        randRange(2.5, 6),
        white,
        randRange(0.6, 0.95),
        2,
      );
    }
  }
  // Foam blobs along the curling lip, placed only on the OUTER side of the
  // curl (away from the barrel) so the lip keeps its shape and the inner
  // edge stays clean.
  const barrelCx = 742;
  const barrelCy = 342;
  for (let i = 0; i < CURL.length; i += 3) {
    const p = CURL[i];
    const [tx, ty] = curveTangent(CURL, i);
    let nx = ty;
    let ny = -tx;
    if (
      nx * (p[0] - barrelCx) + ny * (p[1] - barrelCy) <
      0
    ) {
      nx = -nx;
      ny = -ny;
    }
    const off = randRange(8, 26);
    const r = randRange(4, 11);
    const col = mixColor(white, cream, rand());
    disc(
      p[0] + nx * off + randRange(-6, 6),
      p[1] + ny * off + randRange(-6, 6),
      r,
      col,
      randRange(0.7, 1),
      2.5,
    );
  }
}

function paintSpray() {
  const white = hex("#fff8ec");
  const cream = hex("#ffe9bf");
  // Droplet spray thrown outward above the crest and lip.
  for (let i = 0; i < 330; i++) {
    const useCurl = rand() < 0.35;
    const pts = useCurl ? CURL : CREST;
    const idx = Math.floor(rand() * pts.length);
    const p = pts[idx];
    const [tx, ty] = curveTangent(pts, idx);
    let nx = ty;
    let ny = -tx;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = 8 + Math.pow(rand(), 2) * 175;
    const cx = p[0] + nx * off + tx * randRange(-24, 24);
    const cy = p[1] + ny * off + ty * randRange(-24, 24);
    if (cx < -10 || cx > 1034 || cy < -10 || cy > 1034) continue;
    const r = randRange(1.2, 6.5);
    const stretch = rand() < 0.4;
    const col = mixColor(white, cream, rand());
    const a = randRange(0.25, 0.85);
    if (stretch) {
      const ang = (Math.atan2(ny, nx) * 180) / Math.PI;
      ellipse(cx, cy, r * 2.3, r * 0.8, ang, col, a, 1.5);
    } else {
      disc(cx, cy, r, col, a, 1.5);
    }
  }
  // Tea leaves caught in the spray.
  for (let i = 0; i < 22; i++) {
    const idx = Math.floor(rand() * CREST.length);
    const p = CREST[idx];
    const [tx, ty] = curveTangent(CREST, idx);
    let nx = ty;
    let ny = -tx;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = randRange(10, 130);
    const cx = p[0] + nx * off + randRange(-20, 20);
    const cy = p[1] + ny * off + randRange(-20, 20);
    const col = rand() < 0.5 ? hex("#4a7a34") : hex("#c9a227");
    ellipse(cx, cy, randRange(5, 8), randRange(2.5, 4), randRange(0, 180), col, 0.9, 1.5);
  }
}

function paintFlowStreaks() {
  // Short white streaks flowing down the wave face, parallel to the crest.
  for (let i = 0; i < 40; i++) {
    const idx = Math.floor(randRange(8, CREST.length - 4));
    const p = CREST[idx];
    const [tx, ty] = curveTangent(CREST, idx);
    const depth = randRange(28, 220);
    const x0 = p[0] - ty * depth * -1 + randRange(-10, 10);
    const y0 = p[1] + depth + randRange(-10, 10);
    const len = randRange(40, 130);
    strokePath(
      [
        [x0, y0],
        [x0 + tx * len, y0 + ty * len],
      ],
      randRange(2.5, 6),
      randRange(1.5, 3),
      hex("#fff6e0"),
      randRange(0.12, 0.32),
      randRange(0.06, 0.18),
      3.5,
    );
  }
}

function paintFaceSheets() {
  // Broad translucent sheets of water sliding down the face.
  for (let i = 0; i < 3; i++) {
    const depth = 70 + i * 70;
    const pts = [];
    for (let s = 0; s < CREST.length; s += 6) {
      const p = CREST[s];
      pts.push([p[0] + 18, p[1] + depth]);
    }
    strokePath(pts, 34, 34, hex("#ffdf8e"), 0.1, 0.1, 16);
  }
  // Shadow lane under the barrel, running down the face.
  strokePath(
    [
      [760, 400],
      [640, 560],
      [520, 720],
      [430, 880],
    ],
    60,
    90,
    hex("#5e2f0e"),
    0.18,
    0.1,
    20,
  );
}

function paintBottomWash() {
  // Churning foam where the wave's base meets the bottom edge.
  glow(512, 1030, 420, hex("#fff6e0"), 0.12);
  for (let i = 0; i < 42; i++) {
    const x = randRange(0, 1024);
    const y = randRange(940, 1024);
    disc(
      x,
      y,
      randRange(4, 14),
      mixColor(hex("#fff8ec"), hex("#ffe9bf"), rand()),
      randRange(0.4, 0.85),
      3,
    );
  }
}

// ---- Scene part 3: teacup, surfer, speech bubble ----

const CUP = { x: 215, y: 790, tilt: -0.45 }; // tilt in radians, top leaning right
const COS_T = Math.cos(CUP.tilt);
const SIN_T = Math.sin(CUP.tilt);

function toArt(lx, ly) {
  return [
    CUP.x + lx * COS_T - ly * SIN_T,
    CUP.y + lx * SIN_T + ly * COS_T,
  ];
}
function toLocal(x, y) {
  const dx = x - CUP.x;
  const dy = y - CUP.y;
  return [dx * COS_T + dy * SIN_T, -dx * SIN_T + dy * COS_T];
}

function paintSteam() {
  // Three ribbons of steam curling from the cup mouth up into the wave.
  const cream = hex("#fff6e6");
  const paths = [
    [
      [250, 730],
      [300, 660],
      [360, 620],
      [430, 580],
      [480, 530],
    ],
    [
      [272, 722],
      [330, 650],
      [410, 600],
      [480, 540],
      [525, 485],
    ],
    [
      [292, 716],
      [340, 640],
      [380, 560],
      [420, 510],
      [445, 460],
    ],
  ];
  for (const p of paths) {
    strokePath(p, 24, 5, cream, 0.22, 0.05, 9);
  }
}

function paintSaucer() {
  // Soft shadow under the saucer, then the saucer itself.
  ellipse(215, 905, 150, 30, -8, hex("#2a1506"), 0.3, 12);
  ellipseFn(215, 885, 155, 36, -8, 2.5, (lx, ly) => {
    const c = grad(
      [
        [0, hex("#f7f3ea")],
        [1, hex("#d9d0ba")],
      ],
      clamp(ly * 0.5 + 0.5, 0, 1),
    );
    return [c[0], c[1], c[2], 1];
  });
  ellipse(215, 882, 118, 25, -8, hex("#fbf8f1"), 1, 2);
  ellipseArc(215, 885, 155, 36, -8, 4, 0, 360, hex("#d9a441"), 0.9, 2);
  ellipseArc(215, 882, 118, 25, -8, 3, 0, 360, hex("#d9a441"), 0.7, 2);
}

function paintCup() {
  // Cup body: trapezoid with a rounded bottom, in local coords, rotated.
  const local = [
    [-78, -62],
    [78, -62],
    [56, 28],
    [48, 48],
    [28, 60],
    [0, 66],
    [-28, 60],
    [-48, 48],
    [-56, 28],
  ];
  const bodyPts = local.map((p) => toArt(p[0], p[1]));
  const porcelainTop = hex("#fbf8f1");
  const porcelainBot = hex("#cfc6b4");
  const shade = hex("#b3a893");
  const bandBlue = hex("#2b5aa6");
  const bandDark = hex("#1e3f7d");
  const gold = hex("#d9a441");
  fillPoly(bodyPts, (x, y) => {
    const [lx, ly] = toLocal(x, y);
    let c = grad(
      [
        [0, porcelainTop],
        [1, porcelainBot],
      ],
      clamp((ly + 62) / 128, 0, 1),
    );
    // Soft shadow on the cup's left flank.
    if (lx < -18) c = mixColor(c, shade, clamp((-lx - 18) / 55, 0, 0.55));
    // Highlight stripe near the right edge.
    if (lx > 30) c = mixColor(c, hex("#ffffff"), 0.25);
    // Blue band with a dot motif and gold pinstripes.
    if (ly >= -40 && ly <= -14) {
      c = bandBlue;
      // Gold pinstripes at the band edges.
      if (Math.abs(ly + 40) < 2.5 || Math.abs(ly + 14) < 2.5) c = gold;
      // White dots in staggered rows.
      const row = Math.floor((ly + 40) / 13);
      const cx = lx + (row % 2 === 0 ? 0 : 11);
      const gx = ((cx % 22) + 22) % 22;
      const gy = (ly + 40) % 13;
      const dx = gx - 11;
      const dy = gy - 6.5;
      if (dx * dx + dy * dy < 16) c = hex("#fbf8f1");
      // Darker blue shading inside the band at the bottom.
      if (ly > -20) c = mixColor(c, bandDark, 0.35);
    }
    return [c[0], c[1], c[2], 1];
  }, 2.5);

  // Handle: an arc on the cup's outer (left) side.
  const [hx, hy] = toArt(-92, -2);
  const dirAng = (Math.atan2(hy - CUP.y, hx - CUP.x) * 180) / Math.PI;
  ringArc(hx, hy, 34, 15, dirAng - 105, dirAng + 105, hex("#efe9db"), 1, 2.5);
  ringArc(hx, hy, 34, 15, dirAng - 105, dirAng + 105, hex("#cfc6b4"), 0.35, 2.5);

  // Rim: outer ellipse, then the tea surface inside.
  const [rimX, rimY] = toArt(0, -62);
  const rimRot = (CUP.tilt * 180) / Math.PI;
  ellipse(rimX, rimY, 80, 22, rimRot, hex("#fbf8f1"), 1, 2);
  ellipseArc(rimX, rimY, 80, 22, rimRot, 4, 0, 360, gold, 0.9, 1.5);
  ellipse(rimX, rimY, 68, 16, rimRot, hex("#c07a24"), 1, 2);
  // Tea highlight + a slow swirl.
  const [teaHx, teaHy] = toArt(-18, -64);
  ellipse(teaHx, teaHy, 26, 6, rimRot, hex("#e8a94e"), 0.8, 2);
  ellipseArc(rimX, rimY, 44, 10, rimRot, 3, 200, 330, hex("#8a4a12"), 0.6, 1.5);
}

function paintPourStream() {
  // Liquid arcing out of the cup mouth to join the wave, widening as it
  // merges into the face.
  const stream = [
    [272, 718],
    [330, 672],
    [400, 628],
    [470, 600],
    [515, 596],
  ];
  strokePath(stream, 22, 48, hex("#e09a2e"), 0.95, 0.95, 4);
  strokePath(stream, 12, 30, hex("#f5b545"), 0.95, 0.95, 4);
  const edge = stream.map((p) => [p[0] - 7, p[1] - 8]);
  strokePath(edge, 6, 6, hex("#fff6e0"), 0.6, 0.6, 3);
  // White flow streaks riding on the stream, and foam beading along its
  // lower edge, so it reads as splashing liquid, not a smooth tube.
  const flow = stream.map((p) => [p[0] + 2, p[1] + 6]);
  strokePath(flow, 5, 5, hex("#fff6e0"), 0.5, 0.5, 3);
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const seg = Math.min(3, Math.floor(t * 4));
    const ft = t * 4 - seg;
    const bx = lerp(stream[seg][0], stream[seg + 1][0], ft);
    const by = lerp(stream[seg][1], stream[seg + 1][1], ft);
    disc(
      bx + randRange(-6, 6),
      by + randRange(10, 22),
      randRange(3, 7),
      hex("#fff8ec"),
      randRange(0.55, 0.9),
      2,
    );
  }
  // Foam where the stream merges into the wave face.
  for (let i = 0; i < 9; i++) {
    disc(
      515 + randRange(-26, 26),
      596 + randRange(-20, 20),
      randRange(4, 10),
      hex("#fff8ec"),
      randRange(0.6, 0.95),
      2,
    );
  }
  // Splash burst where the stream leaves the rim.
  for (let i = 0; i < 14; i++) {
    const ang = randRange(-1.2, 0.4);
    const dist = randRange(6, 46);
    disc(
      272 + Math.cos(ang) * dist,
      718 + Math.sin(ang) * dist - dist * 0.4,
      randRange(2, 6),
      hex("#fff6e0"),
      randRange(0.5, 0.95),
      1.5,
    );
  }
  // Foam ring where the saucer meets the swell.
  for (let i = 0; i < 18; i++) {
    const ang = randRange(0, Math.PI * 2);
    const rx = 150 + randRange(-8, 14);
    const ry = 34 + randRange(-4, 6);
    disc(
      215 + Math.cos(ang) * rx,
      885 + Math.sin(ang) * ry,
      randRange(3, 8),
      hex("#fff8ec"),
      randRange(0.5, 0.9),
      2,
    );
  }
}

function paintSurfer() {
  // Tiny dark silhouette riding the face below the barrel mouth.
  const ink = hex("#1a2340");
  const board = hex("#ff4a3d");
  // Board.
  ellipse(715, 520, 36, 7, -28, board, 1, 1.5);
  ellipse(715, 520, 14, 4.5, -28, hex("#ffffff"), 0.9, 1);
  // Figure: head, torso, bent legs, outstretched arms.
  disc(700, 474, 10, ink, 1, 1.5);
  strokePath(
    [
      [703, 484],
      [710, 504],
    ],
    13,
    11,
    ink,
    1,
    1,
    2,
  );
  strokePath(
    [
      [710, 504],
      [723, 516],
    ],
    8,
    7,
    ink,
    1,
    1,
    2,
  );
  strokePath(
    [
      [710, 504],
      [697, 517],
    ],
    8,
    7,
    ink,
    1,
    1,
    2,
  );
  strokePath(
    [
      [705, 488],
      [687, 480],
    ],
    6,
    5,
    ink,
    1,
    1,
    2,
  );
  strokePath(
    [
      [705, 488],
      [725, 481],
    ],
    6,
    5,
    ink,
    1,
    1,
    2,
  );
  // Splash at the board's tail.
  disc(688, 526, 6, hex("#fff8ec"), 0.9, 1.5);
  disc(679, 521, 4, hex("#fff8ec"), 0.8, 1.5);
  disc(697, 530, 4, hex("#fff8ec"), 0.8, 1.5);
}

// 5x7 block glyphs for the speech bubble text.
const GLYPHS = {
  W: [
    "10001",
    "10001",
    "10001",
    "10101",
    "10101",
    "10101",
    "01010",
  ],
  O: [
    "01110",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "01110",
  ],
  "!": [
    "00100",
    "00100",
    "00100",
    "00100",
    "00100",
    "00000",
    "00100",
  ],
};

function drawBlockText(text, cx, cy, cell, col) {
  const gap = 1; // one blank column between glyphs
  const totalCells = text.length * 5 + (text.length - 1) * gap;
  let x = cx - (totalCells * cell) / 2;
  const y0 = cy - (7 * cell) / 2;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      x += (5 + gap) * cell;
      continue;
    }
    for (let row = 0; row < 7; row++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[row][c] === "1") {
          fillRect(x + c * cell, y0 + row * cell, cell, cell, col, 1);
        }
      }
    }
    x += (5 + gap) * cell;
  }
}

function paintBubble() {
  const ink = hex("#1a2340");
  // Tail first (navy), then the bubble, then the inset white tail.
  fillPoly(
    [
      [262, 268],
      [322, 240],
      [438, 352],
    ],
    () => [ink[0], ink[1], ink[2], 1],
    2,
  );
  ellipse(215, 180, 178, 102, 0, ink, 1, 2);
  ellipse(215, 180, 166, 90, 0, hex("#ffffff"), 1, 2);
  fillPoly(
    [
      [274, 260],
      [320, 244],
      [416, 334],
    ],
    () => [255, 255, 255, 1],
    2,
  );
  drawBlockText("WOW!", 215, 184, 12, ink);
  sparkle(392, 120, 12, hex("#ffd76a"), 0.9);
  sparkle(60, 300, 9, hex("#ffd76a"), 0.8);
}

function paintFinalSparkles() {
  const spots = [
    [880, 300, 14],
    [820, 230, 10],
    [700, 210, 9],
    [560, 430, 8],
    [420, 560, 9],
    [300, 640, 7],
    [950, 420, 11],
    [180, 560, 8],
  ];
  for (const [x, y, s] of spots) {
    sparkle(x, y, s, hex("#fff3c4"), 0.85);
  }
}

function paintVignette() {
  const cx = SW / 2;
  const cy = SH / 2;
  const maxD = 0.72 * SW;
  const dark = hex("#0c0518");
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / maxD;
      const a = 0.17 * smoothstep(0.78, 1.25, d);
      if (a > 0.001) blend(x, y, dark[0], dark[1], dark[2], a);
    }
  }
  // Faint mist along the bottom edge.
  glow(512, 1080, 480, hex("#fff6e0"), 0.1);
}

// ---- Downsample + PNG encoding (stdlib only) ----

function downsample() {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * SW + (x * SS + sx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * W + x) * 3;
      rgb[o] = clamp(Math.round(r / n), 0, 255);
      rgb[o + 1] = clamp(Math.round(g / n), 0, 255);
      rgb[o + 2] = clamp(Math.round(b / n), 0, 255);
    }
  }
  return rgb;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcData), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Encode RGB bytes as a PNG. Each row tries all five filters and keeps the
// one with the smallest sum of absolute signed-byte values (deterministic).
function encodePNG(rgb, w, h) {
  const bpp = 3;
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  const filtered = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestCost = Infinity;
    let bestBytes = null;
    for (let f = 0; f <= 4; f++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = Math.floor((left + up) / 2);
        else if (f === 4) pred = paeth(left, up, upLeft);
        const v = (row[i] - pred) & 0xff;
        filtered[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestFilter = f;
        bestBytes = Buffer.from(filtered);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    bestBytes.copy(raw, y * (stride + 1) + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Compose and write ----

function paint() {
  buildTopLookup();
  paintSky();
  paintStars();
  paintClouds();
  // Dark violet halo behind the upper wave so the gold crest pops. It goes
  // down before the sun so the sun disc itself stays bright.
  glow(760, 360, 430, hex("#261050"), 0.38);
  paintSun();
  paintSea();
  paintWaveFace();
  paintCurlFace();
  paintBarrel();
  paintLip();
  paintFoam();
  paintSpray();
  paintFlowStreaks();
  paintFaceSheets();
  paintBottomWash();
  paintSteam();
  paintSaucer();
  paintCup();
  paintPourStream();
  paintSurfer();
  paintBubble();
  paintFinalSparkles();
  paintVignette();
}

function main() {
  paint();
  const rgb = downsample();
  const png = encodePNG(rgb, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  console.log("wrote " + outPath + " " + png.length + " bytes");
}

main();
