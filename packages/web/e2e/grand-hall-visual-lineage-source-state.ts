import { createHash } from "node:crypto";

export const GRAND_HALL_LINEAGE_SOURCE_PATHSPEC = Object.freeze([
  "--",
  "pnpm-lock.yaml",
  "packages/types/package.json",
  "packages/types/src",
  "packages/web/package.json",
  "packages/web/vite.config.ts",
  "packages/web/src",
  "packages/web/e2e/grand-hall-visual-lineage.local.spec.ts",
  "packages/web/e2e/grand-hall-visual-lineage-capture-mode.ts",
  "packages/web/e2e/grand-hall-visual-lineage-source-state.ts",
]);

export interface GrandHallLineageSourceStateFile {
  readonly relativePath: string;
  readonly bytes: Buffer;
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function grandHallLineageSourceStateSha256(input: {
  readonly trackedDiff: Buffer;
  readonly untrackedFiles: readonly GrandHallLineageSourceStateFile[];
  readonly runtimeFiles: readonly GrandHallLineageSourceStateFile[];
}): string {
  const stateHash = createHash("sha256");
  stateHash.update("tracked-diff\0");
  stateHash.update(input.trackedDiff);
  for (const file of [...input.untrackedFiles].sort((left, right) => (
    normalizedPath(left.relativePath).localeCompare(normalizedPath(right.relativePath))
  ))) {
    stateHash.update("untracked-file\0");
    stateHash.update(normalizedPath(file.relativePath));
    stateHash.update("\0");
    stateHash.update(file.bytes);
  }
  for (const file of [...input.runtimeFiles].sort((left, right) => (
    normalizedPath(left.relativePath).localeCompare(normalizedPath(right.relativePath))
  ))) {
    stateHash.update("runtime-file\0");
    stateHash.update(normalizedPath(file.relativePath));
    stateHash.update("\0");
    stateHash.update(file.bytes);
  }
  return `sha256:${stateHash.digest("hex")}`;
}
