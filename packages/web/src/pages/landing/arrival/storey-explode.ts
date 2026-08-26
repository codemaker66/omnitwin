/**
 * Storey bucketing — pure math for mapping manifest chunks to explosive layers.
 *
 * Given a collection of world-space height samples tagged with their storey floor,
 * this module computes:
 * - Sorted unique floors present in the building
 * - Vertical boundaries between storeys (midpoints of adjacent mean heights)
 * - Which storey bucket a world-space Y coordinate belongs to
 * - Vertical offset for a storey at a given explosion progress (for the dollhouse explode effect)
 */

export interface StoreySample {
  readonly floor: number;
  readonly yMeters: number;
}

/**
 * Sorted unique floors present in the samples.
 * Returns empty array if samples is empty.
 */
export function storeyFloors(samples: readonly StoreySample[]): readonly number[] {
  if (samples.length === 0) {
    return [];
  }
  const floorsSet = new Set<number>();
  for (const sample of samples) {
    floorsSet.add(sample.floor);
  }
  return Array.from(floorsSet).sort((a, b) => a - b);
}

/**
 * Boundary Ys between adjacent storeys: midpoints of neighbouring floors' mean sample heights.
 * Length = floors.length - 1.
 * Returns empty array if samples is empty or has only one unique floor.
 */
export function storeyBoundaries(samples: readonly StoreySample[]): readonly number[] {
  const floors = storeyFloors(samples);
  if (floors.length < 2) {
    return [];
  }

  // Compute mean height for each floor
  const floorSums = new Map<number, number>();
  const floorCounts = new Map<number, number>();

  for (const sample of samples) {
    const prevCount = floorCounts.get(sample.floor) ?? 0;
    const prevSum = floorSums.get(sample.floor) ?? 0;
    floorCounts.set(sample.floor, prevCount + 1);
    floorSums.set(sample.floor, prevSum + sample.yMeters);
  }

  // Build a function to get mean safely
  const getMean = (floor: number): number | undefined => {
    const sum = floorSums.get(floor);
    const count = floorCounts.get(floor);
    if (typeof sum === "number" && typeof count === "number" && count > 0) {
      return sum / count;
    }
    return undefined;
  };

  // Compute midpoints between adjacent floors
  const boundaries: number[] = [];
  for (let i = 0; i < floors.length - 1; i++) {
    const floorA = floors[i];
    const floorB = floors[i + 1];
    if (typeof floorA === "number" && typeof floorB === "number") {
      const meanA = getMean(floorA);
      const meanB = getMean(floorB);
      if (typeof meanA === "number" && typeof meanB === "number") {
        boundaries.push((meanA + meanB) / 2);
      }
    }
  }

  return boundaries;
}

/**
 * Bucket a world-space centroid Y into a storey index (0-based from the lowest floor).
 * The bucket is determined by counting how many boundaries are strictly below y.
 * - y below all boundaries → bucket 0
 * - y between boundary[i-1] and boundary[i] → bucket i
 * - y above all boundaries → bucket = boundaries.length
 */
export function bucketForY(y: number, boundaries: readonly number[]): number {
  let bucket = 0;
  for (const boundary of boundaries) {
    if (y > boundary) {
      bucket++;
    } else {
      break;
    }
  }
  return bucket;
}

/**
 * Vertical explode offset for a bucket at explode progress 0..1.
 * Ground floor (bucket 0) never moves.
 * Other storeys move proportionally: offset = bucket * progress * separationM
 */
export function explodeOffsetY(
  bucket: number,
  progress: number,
  separationM: number,
): number {
  if (bucket === 0) {
    return 0;
  }
  return bucket * progress * separationM;
}
