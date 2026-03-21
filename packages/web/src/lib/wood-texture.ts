import {
  DataTexture,
  RGBAFormat,
  RepeatWrapping,
  LinearFilter,
  NearestFilter,
} from "three";

// ---------------------------------------------------------------------------
// wood-texture — high-detail procedural oak trunk bark textures
// ---------------------------------------------------------------------------

/** Texture resolution — 256 balances detail vs. memory/perf. */
const TEX_SIZE = 256;

/** Seeded pseudo-random for deterministic textures. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 2D hash-based noise. */
function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth 2D value noise. */
function noise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);

  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal brownian motion — layered noise for organic detail. */
function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency);
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return value;
}

/** Turbulence — absolute-value noise, gives sharper crease-like detail. */
function turbulence(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * Math.abs(noise2D(x * frequency, y * frequency) * 2 - 1);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

/**
 * Creates a high-detail procedural oak bark colour texture.
 *
 * Deep, contrasty bark with:
 * - Thick vertical fissures (deep dark cracks)
 * - Raised ridges with lighter heartwood colour
 * - Knots and burls scattered randomly
 * - Moss/lichen patches (subtle green tint)
 * - High colour range for photorealistic feel
 */
export function createWoodColorTexture(seed: number = 42): DataTexture {
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
  const rand = seededRandom(seed);

  // Colour palette — deep oak bark
  const fissure: [number, number, number] = [28, 16, 8];    // near-black deep cracks
  const darkBark: [number, number, number] = [52, 30, 14];   // dark bark ridges
  const midBark: [number, number, number] = [85, 52, 26];    // mid-tone bark
  const lightBark: [number, number, number] = [115, 72, 38]; // ridge highlights
  const heartwood: [number, number, number] = [140, 90, 48]; // warm exposed wood
  const knot: [number, number, number] = [35, 18, 8];        // dark knot centres
  const moss: [number, number, number] = [55, 62, 35];       // subtle green moss tint

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const v = y / TEX_SIZE;

      // --- Deep vertical fissures (the signature bark crack pattern) ---
      const fissureFreq = 18;
      const fissureWarp = fbm(u * 4 + seed, v * 1.2 + seed * 0.1, 4) * 0.5;
      const fissureRaw = Math.sin((u + fissureWarp) * fissureFreq * Math.PI);
      // Sharp fissures — narrow dark lines
      const fissureStrength = Math.pow(Math.max(0, -fissureRaw), 3);

      // --- Secondary fissures (thinner, cross-hatching) ---
      const fissure2Freq = 32;
      const fissure2Warp = fbm(u * 6 + seed * 0.5, v * 3, 3) * 0.3;
      const fissure2 = Math.pow(Math.max(0, -Math.sin((u + fissure2Warp) * fissure2Freq * Math.PI)), 5) * 0.4;

      // --- Ridge pattern (raised bark plates between fissures) ---
      const ridgeNoise = fbm(u * 5 + seed * 0.2, v * 8, 5);
      const ridgeTurbulence = turbulence(u * 10 + seed, v * 15, 4) * 0.3;

      // --- Broad colour zones (large-scale variation across trunk) ---
      const broadZone = fbm(u * 2 + seed * 0.7, v * 3 + seed * 0.3, 3);

      // --- Knots and burls ---
      const knotNoise = noise2D(u * 4 + seed * 1.3, v * 6 + seed * 0.8);
      const isKnot = knotNoise > 0.85 ? Math.pow((knotNoise - 0.85) / 0.15, 2) : 0;

      // --- Moss/lichen patches (north-facing illusion) ---
      const mossNoise = fbm(u * 3 + seed * 2, v * 4 + seed, 3);
      const isMoss = mossNoise > 0.65 ? (mossNoise - 0.65) / 0.35 * 0.25 : 0;

      // Combine fissure depth (0 = deep crack, 1 = raised ridge)
      const depth = 1 - Math.max(fissureStrength, fissure2) * 1.2;
      const depthClamped = Math.max(0, Math.min(1, depth));

      // Colour mixing based on depth
      // Deep = fissure colour, mid = bark colours, high = highlights
      let r: number, g: number, b: number;
      if (depthClamped < 0.3) {
        // Deep fissure zone
        const t = depthClamped / 0.3;
        r = fissure[0] + (darkBark[0] - fissure[0]) * t;
        g = fissure[1] + (darkBark[1] - fissure[1]) * t;
        b = fissure[2] + (darkBark[2] - fissure[2]) * t;
      } else if (depthClamped < 0.7) {
        // Mid bark zone
        const t = (depthClamped - 0.3) / 0.4;
        r = darkBark[0] + (midBark[0] - darkBark[0]) * t;
        g = darkBark[1] + (midBark[1] - darkBark[1]) * t;
        b = darkBark[2] + (midBark[2] - darkBark[2]) * t;
      } else {
        // Ridge highlights
        const t = (depthClamped - 0.7) / 0.3;
        r = midBark[0] + (lightBark[0] - midBark[0]) * t;
        g = midBark[1] + (lightBark[1] - midBark[1]) * t;
        b = midBark[2] + (lightBark[2] - midBark[2]) * t;
      }

      // Ridge noise variation
      const ridgeMix = ridgeNoise * 0.3 + ridgeTurbulence;
      r += (heartwood[0] - r) * ridgeMix * 0.2;
      g += (heartwood[1] - g) * ridgeMix * 0.2;
      b += (heartwood[2] - b) * ridgeMix * 0.2;

      // Broad zone warm/cool shift
      r += broadZone * 15 - 7;
      g += broadZone * 8 - 4;
      b += broadZone * 5 - 2;

      // Dark knots
      r = r + (knot[0] - r) * isKnot;
      g = g + (knot[1] - g) * isKnot;
      b = b + (knot[2] - b) * isKnot;

      // Moss tint
      r = r + (moss[0] - r) * isMoss;
      g = g + (moss[1] - g) * isMoss;
      b = b + (moss[2] - b) * isMoss;

      // Micro noise for film grain / natural imperfection
      const micro = (rand() - 0.5) * 16;
      r = Math.max(0, Math.min(255, r + micro));
      g = Math.max(0, Math.min(255, g + micro));
      b = Math.max(0, Math.min(255, b + micro));

      const idx = (y * TEX_SIZE + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  const texture = new DataTexture(data, TEX_SIZE, TEX_SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates a roughness map with deep variation — cracks are rough (1.0),
 * raised ridges are smoother (0.65), creating visible surface contrast.
 */
export function createWoodRoughnessTexture(seed: number = 42): DataTexture {
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const v = y / TEX_SIZE;

      // Match fissure pattern from colour texture
      const fissureWarp = fbm(u * 4 + seed, v * 1.2 + seed * 0.1, 4) * 0.5;
      const fissureRaw = Math.sin((u + fissureWarp) * 18 * Math.PI);
      const inFissure = Math.pow(Math.max(0, -fissureRaw), 2);

      // Base roughness varies by surface type
      const base = 0.7 + inFissure * 0.3; // 0.7 on ridges, 1.0 in cracks

      // Fine detail
      const detail = turbulence(u * 20 + seed * 2, v * 25, 3) * 0.08;

      const roughness = Math.max(0, Math.min(1, base + detail));
      const val = Math.round(roughness * 255);

      const idx = (y * TEX_SIZE + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  const texture = new DataTexture(data, TEX_SIZE, TEX_SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates a high-contrast bump map for deep bark relief.
 * Fissures are dark (low), ridges are bright (high).
 */
export function createWoodBumpTexture(seed: number = 42): DataTexture {
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const v = y / TEX_SIZE;

      // Deep fissures — match colour texture pattern
      const fissureWarp = fbm(u * 4 + seed, v * 1.2 + seed * 0.1, 4) * 0.5;
      const fissureRaw = Math.sin((u + fissureWarp) * 18 * Math.PI);
      const fissureDepth = Math.pow(Math.max(0, -fissureRaw), 2);

      // Secondary cracks
      const crack2Warp = fbm(u * 6 + seed * 0.5, v * 3, 3) * 0.3;
      const crack2 = Math.pow(Math.max(0, -Math.sin((u + crack2Warp) * 32 * Math.PI)), 4) * 0.5;

      // Ridge plates — raised bumpy bark
      const ridgeBump = fbm(u * 12 + seed * 0.7, v * 8, 5) * 0.4;
      const microBump = turbulence(u * 30 + seed, v * 40, 3) * 0.15;

      // Combine: 1.0 = raised ridge, 0.0 = deep crack
      const bump = 1 - Math.max(fissureDepth, crack2) + ridgeBump + microBump;
      const val = Math.max(0, Math.min(255, Math.round(bump * 180)));

      const idx = (y * TEX_SIZE + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  const texture = new DataTexture(data, TEX_SIZE, TEX_SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates a normal map from a bump/height map for more realistic lighting.
 * Generates tangent-space normals using Sobel-like finite differences.
 */
export function createWoodNormalTexture(seed: number = 42): DataTexture {
  // First generate a height map
  const heights = new Float32Array(TEX_SIZE * TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const v = y / TEX_SIZE;

      const fissureWarp = fbm(u * 4 + seed, v * 1.2 + seed * 0.1, 4) * 0.5;
      const fissureRaw = Math.sin((u + fissureWarp) * 18 * Math.PI);
      const fissureDepth = Math.pow(Math.max(0, -fissureRaw), 2);
      const crack2Warp = fbm(u * 6 + seed * 0.5, v * 3, 3) * 0.3;
      const crack2 = Math.pow(Math.max(0, -Math.sin((u + crack2Warp) * 32 * Math.PI)), 4) * 0.5;
      const ridge = fbm(u * 12 + seed * 0.7, v * 8, 5) * 0.4;
      const micro = turbulence(u * 30 + seed, v * 40, 3) * 0.1;

      const h = 1 - Math.max(fissureDepth, crack2) + ridge + micro;
      heights[y * TEX_SIZE + x] = h;
    }
  }

  // Convert height map to tangent-space normal map
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
  const strength = 3.0; // normal map intensity

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const xp = (x + 1) % TEX_SIZE;
      const xm = (x - 1 + TEX_SIZE) % TEX_SIZE;
      const yp = (y + 1) % TEX_SIZE;
      const ym = (y - 1 + TEX_SIZE) % TEX_SIZE;

      const hL = heights[y * TEX_SIZE + xm] ?? 0;
      const hR = heights[y * TEX_SIZE + xp] ?? 0;
      const hD = heights[ym * TEX_SIZE + x] ?? 0;
      const hU = heights[yp * TEX_SIZE + x] ?? 0;

      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;
      // Tangent-space normal
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = 1 / len;

      const idx = (y * TEX_SIZE + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new DataTexture(data, TEX_SIZE, TEX_SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
