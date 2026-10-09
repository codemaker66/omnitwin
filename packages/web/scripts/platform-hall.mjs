/**
 * The /platform photographs of the Grand Hall, from Venviewer's own capture,
 * and the layouts drawn onto its floor in each camera's perspective.
 *
 *   node scripts/platform-hall.mjs <work-folder>
 *
 * Photographs. Panoramas from the live tour (tiles/scan_NNN/equirect_8192.webp
 * at twin.venviewer.com, each SHA-256 checked against the tour's manifest) are
 * resampled to level pinhole views, their principal points shifted so
 * verticals stay vertical: scan 44 at the entrance end looking down the hall
 * (a wide desktop frame and a narrower phone frame), scan 34 at the top table
 * looking back, and scan 39 beside the windows looking up at the dome (taken
 * off-centre so the panorama's filled zenith stays out of frame). The tour stores its
 * equirects mirrored (longitude grows to the left): the window wall, the scan
 * mesh and the venue's own photographs all agree on which side the windows are.
 *
 * Geometry. In the tour's frame (metres, z up) the scans' poses place the
 * cameras; sections of the tour's dollhouse mesh give the floor at z = 0.04
 * and the wainscot planes at x = -1.78 and 19.37, y = -10.25 and 0.35: 21.15 by
 * 10.60 m (the venue states 21 by 10.5). Each view's yaw and tilt are fitted
 * from the vanishing point of the side walls' feet; so placed, the mesh's floor
 * rectangle lands on the wainscot bases in the photograph, and the walls'
 * distances read from the photograph agree with the mesh to within 15 cm. A
 * floor circle then maps to the conic H^-T Q H^-1, written as one exact
 * <ellipse>; a rectangle maps to its four corners.
 *
 * Layouts, which illustrate planning in the room and record no event: the
 * wedding breakfast for 160 that the product captures open (fifteen rounds of
 * ten and a top table of ten, e2e/support/crawford-layout.json, turned from
 * the planner's frame into the tour's), and the same 160 seated for their
 * ceremony. Writes <work-folder>/hall-desktop.png, hall-phone.png,
 * hall-night.png, hall-dome.png and og-source.png, the hero frames' lamps
 * alone (hall-desktop-glow.png, hall-phone-glow.png), and the ink between each
 * view's markers in index.html.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const work = process.argv[2];
if (!work) throw new Error("Usage: node scripts/platform-hall.mjs <work-folder>");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "..", "..");
const sharp = createRequire(path.join(repository, "node_modules", ".pnpm", "node_modules", "noop.js"))("sharp");
const pagePath = path.join(web, "public", "platform", "index.html");

const TOUR = "https://twin.venviewer.com/trades-hall";
const HALL = { x0: -1.78, x1: 19.37, y0: -10.25, y1: 0.35, floor: 0.04 };
const MID = (HALL.y0 + HALL.y1) / 2;

// Cameras from the scans' poses. yaw is the panorama's yaw that looks along
// the view's heading (degrees from +x, anticlockwise from above); tilt levels
// the view there. Both are fitted from the walls' vanishing point.
const SCANS = {
  scan_044: { x: -0.2438, y: -4.9046, z: 1.492 },
  scan_034: { x: 17.2042, y: -4.9258, z: 1.4878 },
  scan_039: { x: 8.9266, y: -9.5346, z: 1.5191 },
};

// The desktop frame's horizon sits low (cy) so the vault stays clear above the
// words and the floor, with its drawing, below them; glow marks the views
// whose lamps the page brings up first.
const VIEWS = [
  { name: "desktop", scan: "scan_044", heading: 0, yaw: 179.811, tilt: -0.244, width: 2560, height: 1440, f: 1150, cx: 0.56 * 2560, cy: 0.55 * 1440, scenes: ["breakfast", "ceremony"], markers: "hall-ink", glow: true },
  { name: "phone", scan: "scan_044", heading: 0, yaw: 179.811, tilt: -0.244, width: 1170, height: 1416, f: 1000, cx: 0.5 * 1170, cy: 0.43 * 1416, scenes: ["breakfast", "ceremony"], markers: "hall-ink", glow: true },
  { name: "night", scan: "scan_034", heading: 180, yaw: -0.045, tilt: 0.121, width: 2560, height: 1440, f: 1150, cx: 0.5 * 2560, cy: 0.52 * 1440, scenes: ["breakfast"], markers: "night-ink" },
  { name: "dome", scan: "scan_039", heading: 90, yaw: 89.811, tilt: 45, width: 2880, height: 1620, f: 1100, cx: 1440, cy: 810, scenes: [], markers: null },
];

// ---------------------------------------------------------------- photograph

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}

const manifest = JSON.parse((await fetchBytes(`${TOUR}/manifest.json`)).toString("utf8"));
const panoramas = new Map();

async function panorama(scan) {
  const cached = panoramas.get(scan);
  if (cached !== undefined) return cached;
  const tile = `tiles/${scan}/equirect_8192.webp`;
  const expected = manifest.contentHashes?.[tile];
  if (typeof expected !== "string") throw new Error(`The tour's manifest has no hash for ${tile}`);
  const cache = path.join(work, `${scan}_8192.webp`);
  let bytes = await fs.readFile(cache).catch(() => null);
  if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== expected) {
    bytes = await fetchBytes(`${TOUR}/${tile}`);
    await fs.writeFile(cache, bytes);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected) throw new Error(`${tile}: SHA-256 ${sha256} is not the manifest's ${expected}`);
  const exposure = manifest.nodes.find((node) => node.id === scan)?.exposure ?? { gain: 1, wb: [1, 1, 1] };
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pano = { tile, data, width: info.width, height: info.height, channels: info.channels, sha256, exposure };
  panoramas.set(scan, pano);
  return pano;
}

const catmullRom = (t) => {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
};

/** The view, rendered with Catmull-Rom sampling and the tour's own exposure for the scan. */
function render(pano, view) {
  const { data, width: SW, height: SH, channels: C } = pano;
  const gain = [0, 1, 2].map((k) => pano.exposure.gain * (pano.exposure.wb[k] ?? 1));
  const yaw = (view.yaw * Math.PI) / 180, tilt = (view.tilt * Math.PI) / 180;
  const out = Buffer.alloc(view.width * view.height * 3);
  for (let j = 0; j < view.height; j += 1) {
    for (let i = 0; i < view.width; i += 1) {
      const x = (i + 0.5 - view.cx) / view.f, y = (view.cy - (j + 0.5)) / view.f;
      const y1 = y * Math.cos(tilt) + Math.sin(tilt), z1 = -y * Math.sin(tilt) + Math.cos(tilt);
      const x2 = x * Math.cos(yaw) + z1 * Math.sin(yaw), z2 = -x * Math.sin(yaw) + z1 * Math.cos(yaw);
      const lon = Math.atan2(x2, z2), lat = Math.atan2(y1, Math.hypot(x2, z2));
      const su = (0.5 - lon / (2 * Math.PI)) * SW - 0.5, sv = (0.5 - lat / Math.PI) * SH - 0.5;
      const iu = Math.floor(su), iv = Math.floor(sv);
      const wu = catmullRom(su - iu), wv = catmullRom(sv - iv);
      const sum = [0, 0, 0];
      for (let m = 0; m < 4; m += 1) {
        const row = Math.min(SH - 1, Math.max(0, iv - 1 + m));
        for (let n = 0; n < 4; n += 1) {
          const column = (((iu - 1 + n) % SW) + SW) % SW;
          const w = wu[n] * wv[m], k = (row * SW + column) * C;
          sum[0] += data[k] * w; sum[1] += data[k + 1] * w; sum[2] += data[k + 2] * w;
        }
      }
      const o = (j * view.width + i) * 3;
      for (let k = 0; k < 3; k += 1) out[o + k] = Math.max(0, Math.min(255, Math.round(sum[k] * gain[k])));
    }
  }
  return out;
}

// --------------------------------------------------------------- the floor

/** Floor (x, y) to image for a level camera with the view's heading:
 *  [u w, v w, w] = H [x, y, 1], w the depth along the heading. */
function floorHomography(view) {
  const camera = SCANS[view.scan];
  const h = camera.z - HALL.floor;
  const heading = (view.heading * Math.PI) / 180;
  const c = Math.cos(heading), s = Math.sin(heading);
  const w0 = -(c * camera.x + s * camera.y);
  const across0 = -(s * camera.x - c * camera.y);
  return [
    [view.cx * c + view.f * s, view.cx * s - view.f * c, view.cx * w0 + view.f * across0],
    [view.cy * c, view.cy * s, view.cy * w0 + view.f * h],
    [c, s, w0],
  ];
}

function multiply(a, b) {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
}
function transpose(m) {
  return m[0].map((_, j) => m.map((row) => row[j]));
}
function inverse(m) {
  const [[a, b, c], [d, e, g], [k, l, n]] = m;
  const A = e * n - g * l, B = -(d * n - g * k), C = d * l - e * k;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * n - c * l) / det, (b * g - c * e) / det],
    [B / det, (a * n - c * k) / det, -(a * g - c * d) / det],
    [C / det, -(a * l - b * k) / det, (a * e - b * d) / det],
  ];
}

function projector(view) {
  const H = floorHomography(view);
  const Hinv = inverse(H);
  const HinvT = transpose(Hinv);
  const point = (x, y) => {
    const w = H[2][0] * x + H[2][1] * y + H[2][2];
    return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
  };
  const depth = (x, y) => H[2][0] * x + H[2][1] * y + H[2][2];
  /** The image of the floor circle centred (a, b) with radius r. */
  const circle = (a, b, r) => {
    const Q = [[1, 0, -a], [0, 1, -b], [-a, -b, a * a + b * b - r * r]];
    const K = multiply(multiply(HinvT, Q), Hinv);
    const A = K[0][0], B = 2 * K[0][1], Cc = K[1][1], D = 2 * K[0][2], E = 2 * K[1][2], F = K[2][2];
    const det = 4 * A * Cc - B * B;
    const cx = (B * E - 2 * Cc * D) / det;
    const cy = (B * D - 2 * A * E) / det;
    const F0 = F + (D * cx + E * cy) / 2;
    const theta = 0.5 * Math.atan2(B, A - Cc);
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const Ar = A * cos * cos + B * cos * sin + Cc * sin * sin;
    const Cr = A * sin * sin - B * sin * cos + Cc * cos * cos;
    return { cx, cy, rx: Math.sqrt(-F0 / Ar), ry: Math.sqrt(-F0 / Cr), angle: (theta * 180) / Math.PI };
  };
  return { point, depth, circle };
}

// ----------------------------------------------------------------- layouts

/** The planner's frame (metres from the room's centre, x along the length with
 *  the fireplace end at -10.5, z across) to the tour's: a half turn about the
 *  hall's measured centre, so the fireplace ends agree. */
const toTour = (x, z) => ({ x: (HALL.x0 + HALL.x1) / 2 - x, y: MID - z });

/** Pieces in metres in the tour's frame: circles { kind, x, y, r } and
 *  polygons { kind, corners }, each with the moment (ms) it is drawn after its
 *  scene begins. The wedding breakfast is the Crawford layout the product
 *  captures open (e2e/support/crawford-layout.json). */
async function breakfast() {
  const layout = JSON.parse(await fs.readFile(path.join(web, "e2e", "support", "crawford-layout.json"), "utf8"));
  const { round, chair } = layout.footprints;
  const top = layout.footprints["top-table"];
  const pieces = [];
  const tableAt = new Map();
  for (const piece of layout.breakfast) {
    if (piece.kind === "top-table") {
      // A trestle turned by rotationY: local +x towards -z, as three.js turns it.
      const c = Math.cos(piece.rotationY), s = Math.sin(piece.rotationY);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const lx = (u * top.widthM) / 2, lz = (v * top.depthM) / 2;
        return toTour(piece.x + c * lx + s * lz, piece.z - s * lx + c * lz);
      });
      pieces.push({ kind: "table", corners, at: 0 });
    } else if (piece.kind === "round") {
      const at = 240 + Math.round((piece.x + 6.4) * 40) + Math.round((piece.z + 3) * 12);
      tableAt.set(piece.group, at);
      pieces.push({ kind: "table", ...toTour(piece.x, piece.z), r: round.radiusM, at });
    }
  }
  const seated = new Map();
  for (const piece of layout.breakfast) {
    if (piece.kind !== "chair") continue;
    const k = seated.get(piece.group) ?? 0;
    seated.set(piece.group, k + 1);
    const at = piece.group === "top" ? 160 + k * 18 : (tableAt.get(piece.group) ?? 0) + 220 + k * 16;
    pieces.push({ kind: "chair", ...toTour(piece.x, piece.z), r: chair.radiusM, at });
  }
  return pieces;
}

/** The same 160 for their ceremony: two blocks of ten rows of eight facing the
 *  fireplace end, an aisle runner to the couple, and the registrar's table. */
function ceremony() {
  const box = (x0, x1, y0, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const pieces = [
    { kind: "table", corners: box(17.3, 17.9, MID - 0.9, MID + 0.9), at: 0 },
    { kind: "table", corners: box(2.6, 16.25, MID - 0.5, MID + 0.5), at: 120 },
  ];
  for (const side of [-1, 1]) pieces.push({ kind: "chair", x: 16.6, y: MID + side * 0.35, r: 0.21, at: 200 });
  for (let row = 0; row < 10; row += 1) {
    for (let seat = 0; seat < 8; seat += 1) {
      for (const side of [-1, 1]) {
        pieces.push({ kind: "chair", x: 15.2 - row * 0.95, y: MID + side * (0.65 + 0.24 + seat * 0.48), r: 0.2, at: 240 + row * 70 + seat * 14 });
      }
    }
  }
  return pieces;
}

const SCENES = { breakfast: await breakfast(), ceremony: ceremony() };

// --------------------------------------------------------------------- ink

const one = (n) => (Math.round(n * 10) / 10).toString();

/** Nearer pieces read fainter, so the plan gathers where the hall's
 *  perspective leads: full strength from 8 m out, a sixth at the frame's foot. */
const strength = (metres) => Math.max(0.16, Math.min(1, (metres - 2.6) / 5.4));

/** The view's lamps alone: each pixel kept in proportion to how near it is to
 *  clipping (a smoothstep over luminance 238 to 254, so the chandeliers'
 *  bulbs, the dome's lamps, the picture lights and the cornice's strip survive
 *  and lit walls do not), with a soft halo of the same light. The page screens
 *  it over the dark hall first, then brings the whole exposure up under it. */
async function glowOf(pixels, view) {
  const raw = { raw: { width: view.width, height: view.height, channels: 3 } };
  const lamps = Buffer.alloc(pixels.length);
  for (let k = 0; k < pixels.length; k += 3) {
    const y = 0.2126 * pixels[k] + 0.7152 * pixels[k + 1] + 0.0722 * pixels[k + 2];
    const t = Math.min(1, Math.max(0, (y - 238) / 16));
    const w = t * t * (3 - 2 * t);
    lamps[k] = pixels[k] * w;
    lamps[k + 1] = pixels[k + 1] * w;
    lamps[k + 2] = pixels[k + 2] * w;
  }
  const halo = await sharp(lamps, raw).blur(Math.max(2, view.width / 400)).raw().toBuffer();
  const glow = Buffer.alloc(pixels.length);
  for (let k = 0; k < pixels.length; k += 1) glow[k] = Math.min(255, lamps[k] + 0.85 * halo[k]);
  return glow;
}

function inkFor(view) {
  const { point, depth, circle } = projector(view);
  const inside = ({ cx, cy, rx, ry }) => cx + rx > 0 && cx - rx < view.width && cy + ry > 0 && cy - ry < view.height;
  const groups = view.scenes.map((name) => {
    const pieces = SCENES[name];
    let shown = 0;
    const parts = pieces.map((piece) => {
      const centre = piece.corners === undefined ? piece : {
        x: piece.corners.reduce((sum, corner) => sum + corner.x, 0) / piece.corners.length,
        y: piece.corners.reduce((sum, corner) => sum + corner.y, 0) / piece.corners.length,
      };
      const ahead = depth(centre.x, centre.y);
      if (ahead < 0.6) return "";
      const style = `--d:${String(piece.at)}ms;--o:${strength(ahead).toFixed(2)}`;
      if (piece.corners !== undefined) {
        if (piece.corners.some((corner) => depth(corner.x, corner.y) < 0.3)) return "";
        shown += 1;
        return `<path class="t" pathLength="1" style="${style}" d="M${piece.corners.map((corner) => point(corner.x, corner.y)).map(([u, v]) => `${one(u)} ${one(v)}`).join("L")}Z"/>`;
      }
      if (depth(piece.x, piece.y) - piece.r < 0.3) return "";
      const e = circle(piece.x, piece.y, piece.r);
      if (!inside(e)) return "";
      shown += 1;
      const cls = piece.kind === "chair" ? "c" : "t";
      const length = cls === "t" ? ' pathLength="1"' : "";
      // The same ellipse turned less than 45 degrees, its axes swapped if
      // need be, and left unturned when the turn would not show.
      const quarter = Math.abs(e.angle) > 45;
      const angle = quarter ? e.angle - Math.sign(e.angle) * 90 : e.angle;
      const [rx, ry] = quarter ? [e.ry, e.rx] : [e.rx, e.ry];
      const turn = Math.abs(angle) < 0.3 ? "" : ` transform="rotate(${one(angle)} ${one(e.cx)} ${one(e.cy)})"`;
      return `<ellipse class="${cls}"${length} style="${style}" cx="${one(e.cx)}" cy="${one(e.cy)}" rx="${one(rx)}" ry="${one(ry)}"${turn}/>`;
    }).join("");
    return { name, svg: `<g class="ink" data-scene="${name}">${parts}</g>`, shown, total: pieces.length };
  });
  const svg = `<svg class="hall-ink hall-ink--${view.name}" viewBox="0 0 ${String(view.width)} ${String(view.height)}" aria-hidden="true" focusable="false">${groups.map((g) => g.svg).join("")}</svg>`;
  return { svg, groups };
}

/** The ink with its strokes written in, for an image composited outside the page. */
function standalone(svg, view, keep) {
  return svg
    .replace(/<g class="ink" data-scene="(\w+)">[\s\S]*?<\/g>/gu, (group, name) => (name === keep ? group : ""))
    .replace(/<svg [^>]*>/u, `<svg xmlns="http://www.w3.org/2000/svg" width="${String(view.width)}" height="${String(view.height)}" viewBox="0 0 ${String(view.width)} ${String(view.height)}">`)
    .replaceAll('class="t"', 'fill="none" stroke="#f1d39b" stroke-width="2.6"')
    .replaceAll('class="c"', 'fill="rgba(241,211,155,0.14)" stroke="#f1d39b" stroke-width="1.6"');
}

// -------------------------------------------------------------------- main

await fs.mkdir(work, { recursive: true });
let page = await fs.readFile(pagePath, "utf8");
const inks = new Map();
for (const view of VIEWS) {
  const pano = await panorama(view.scan);
  const pixels = render(pano, view);
  await sharp(pixels, { raw: { width: view.width, height: view.height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(work, `hall-${view.name}.png`));
  if (view.glow === true) {
    const glow = await glowOf(pixels, view);
    await sharp(glow, { raw: { width: view.width, height: view.height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(work, `hall-${view.name}-glow.png`));
  }
  if (view.markers === null) {
    console.log(`${view.name}: ${pano.tile} ${pano.sha256.slice(0, 12)}…, ${String(view.width)}x${String(view.height)}`);
    continue;
  }
  const ink = inkFor(view);
  inks.set(view.markers, [...(inks.get(view.markers) ?? []), ink.svg]);
  console.log(`${view.name}: ${pano.tile} ${pano.sha256.slice(0, 12)}…, ${String(view.width)}x${String(view.height)}, f ${String(view.f)} px; ${ink.groups.map((g) => `${g.name} ${String(g.shown)}/${String(g.total)}`).join(", ")}`);
  if (view.name === "desktop") {
    // The link card's source: the frame a little shaded so the gold reads,
    // with the wedding breakfast inked, as the page settles.
    const dim = await sharp(pixels, { raw: { width: view.width, height: view.height, channels: 3 } }).linear(0.8, 0).png().toBuffer();
    await sharp(dim).composite([{ input: Buffer.from(standalone(ink.svg, view, "breakfast")) }]).png().toFile(path.join(work, "og-source.png"));
  }
}
for (const [markers, svgs] of inks) {
  const start = `<!-- ${markers}:start -->`;
  const end = `<!-- ${markers}:end -->`;
  const from = page.indexOf(start);
  const to = page.indexOf(end);
  if (from === -1 || to === -1 || to < from) throw new Error(`Markers ${start} … ${end} not found in ${pagePath}`);
  page = `${page.slice(0, from + start.length)}${svgs.join("")}${page.slice(to)}`;
}
await fs.writeFile(pagePath, page);
console.log(`ink ${[...inks.values()].flat().join("").length.toString()} bytes`);
