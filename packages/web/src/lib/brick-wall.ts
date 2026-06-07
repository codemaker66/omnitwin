/** Stone block dimensions in meters (width x height x depth). */
export const BLOCK_WIDTH = 0.4;
export const BLOCK_HEIGHT = 0.2;
export const BLOCK_DEPTH = 0.08;

/** Mortar gap between blocks in meters. */
export const MORTAR_GAP = 0.008;

/** How far blocks scatter outward from the wall face (meters). */
export const SCATTER_DISTANCE = 2.2;

/** Proportion of the 0->1 timeline used for row stagger. */
export const STAGGER_SPAN = 0.8;

/** Random per-brick timing jitter (fraction of timeline). */
export const BRICK_JITTER = 0.03;

/** Max random rotation (radians) when fully scattered. */
export const MAX_SCATTER_ROTATION = 0.12;

/** Fraction of per-brick timeline where the brick reaches its rest position. */
export const IMPACT_POINT = 0.6;

/** How far past rest position the brick overshoots on impact. */
export const BOUNCE_OVERSHOOT = 0.04;

export interface BrickInstance {
  readonly restX: number;
  readonly restY: number;
  readonly stagger: number;
  readonly scatterDirX: number;
  readonly scatterDirY: number;
  readonly scatterDirZ: number;
  readonly scatterRotX: number;
  readonly scatterRotY: number;
  readonly scatterRotZ: number;
}

export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeBrickLayout(
  wallWidth: number,
  wallHeight: number,
  seed: number,
): readonly BrickInstance[] {
  const rand = createSeededRandom(seed);
  const bricks: BrickInstance[] = [];

  const cellW = BLOCK_WIDTH + MORTAR_GAP;
  const cellH = BLOCK_HEIGHT + MORTAR_GAP;
  const cols = Math.ceil(wallWidth / cellW);
  const rows = Math.ceil(wallHeight / cellH);

  const halfW = wallWidth / 2;
  const halfH = wallHeight / 2;
  const maxRow = Math.max(rows - 1, 1);

  for (let row = 0; row < rows; row++) {
    const xOffset = row % 2 === 0 ? 0 : cellW * 0.5;
    const rowStagger = row / maxRow;

    for (let col = 0; col < cols; col++) {
      const x = -halfW + col * cellW + xOffset + cellW * 0.5;
      const y = -halfH + row * cellH + cellH * 0.5;

      if (x - BLOCK_WIDTH / 2 > halfW || x + BLOCK_WIDTH / 2 < -halfW) continue;
      if (y - BLOCK_HEIGHT / 2 > halfH || y + BLOCK_HEIGHT / 2 < -halfH) continue;

      const jitter = (rand() - 0.5) * BRICK_JITTER * 2;
      const stagger = Math.max(0, Math.min(1, rowStagger + jitter));

      const spreadX = (rand() - 0.5) * 0.15;
      const spreadY = 0.85 + rand() * 0.15;
      const spreadZ = (rand() - 0.5) * 0.1;
      const len = Math.sqrt(spreadX * spreadX + spreadY * spreadY + spreadZ * spreadZ);

      bricks.push({
        restX: x,
        restY: y,
        stagger,
        scatterDirX: spreadX / len,
        scatterDirY: spreadY / len,
        scatterDirZ: spreadZ / len,
        scatterRotX: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
        scatterRotY: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
        scatterRotZ: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
      });
    }
  }

  return bricks;
}

export function easeHeavyLanding(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  if (t < IMPACT_POINT) {
    const n = t / IMPACT_POINT;
    return n * n;
  }

  const postT = (t - IMPACT_POINT) / (1 - IMPACT_POINT);
  const bounce = Math.sin(postT * Math.PI) * BOUNCE_OVERSHOOT * (1 - postT);
  return 1 + bounce;
}

export function computeBrickProgress(globalProgress: number, stagger: number): number {
  const startTime = stagger * STAGGER_SPAN;
  const endTime = startTime + (1 - STAGGER_SPAN);
  const raw = (globalProgress - startTime) / (endTime - startTime);
  return Math.max(0, Math.min(1, raw));
}

export function shouldUpdateBrickWallMatrices(
  progress: number,
  target: number,
  needsMatrixUpdate: boolean,
  targetChanged: boolean,
): boolean {
  return targetChanged || needsMatrixUpdate || Math.abs(progress - target) > 0.001;
}
