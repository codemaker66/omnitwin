import { rm } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { GrandHallT554ReviewPackV3SourceBundle } from
  "../grand-hall-t554-review-pack-v3.js";

interface OrchestrationState {
  bundle: GrandHallT554ReviewPackV3SourceBundle | undefined;
  t561Calls: number;
  cleanupCalls: number;
  reviewCalls: number;
}

const orchestration = vi.hoisted<OrchestrationState>(() => ({
  bundle: undefined, t561Calls: 0, cleanupCalls: 0, reviewCalls: 0,
}));

function requireBundle(): GrandHallT554ReviewPackV3SourceBundle {
  if (orchestration.bundle === undefined) throw new Error("Fixture bundle is not installed.");
  return orchestration.bundle;
}

vi.mock("../grand-hall-t561-panorama-visual-observation.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../grand-hall-t561-panorama-visual-observation.js")
  >();
  return { ...actual, checkGrandHallT561ObservationPack: () => {
    orchestration.t561Calls += 1;
    return Promise.resolve(requireBundle().t561Exact);
  } };
});

vi.mock("../grand-hall-t554-cleanup-marker-evidence.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../grand-hall-t554-cleanup-marker-evidence.js")
  >();
  return { ...actual, checkGrandHallT554CleanupMarkerEvidencePack: () => {
    orchestration.cleanupCalls += 1;
    return Promise.resolve(requireBundle().cleanupExact);
  } };
});

vi.mock("../grand-hall-t554-review-pack-v2.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../grand-hall-t554-review-pack-v2.js")>();
  return { ...actual, loadGrandHallT554ReviewPackV2Sources: () => {
    orchestration.reviewCalls += 1;
    return Promise.resolve(requireBundle().review);
  } };
});

import {
  checkGrandHallT554ReviewPackV3,
  generateGrandHallT554ReviewPackV3,
} from "../grand-hall-t554-review-pack-v3.js";
import { createGrandHallT554V3Fixture } from
  "./grand-hall-t554-review-pack-v3-fixture.js";

function resetCalls(): void {
  orchestration.t561Calls = 0;
  orchestration.cleanupCalls = 0;
  orchestration.reviewCalls = 0;
}

function expectTwoExactCycles(): void {
  expect({ t561: orchestration.t561Calls, cleanup: orchestration.cleanupCalls,
    review: orchestration.reviewCalls }).toEqual({ t561: 2, cleanup: 2, review: 2 });
}

describe("T-554 v3 immutable public orchestration", () => {
  it("runs both fixed exact-check module boundaries twice for generate and check", async () => {
    const harness = await createGrandHallT554V3Fixture();
    orchestration.bundle = harness.bundle;
    try {
      resetCalls();
      await expect(generateGrandHallT554ReviewPackV3(harness.options)).resolves.toMatchObject({
        verificationMode: "published_exact_sources", exactRegenerationVerified: true,
      });
      expectTwoExactCycles();

      resetCalls();
      await expect(checkGrandHallT554ReviewPackV3(harness.options)).resolves.toMatchObject({
        verificationMode: "checked_exact_regeneration", exactRegenerationVerified: true,
      });
      expectTwoExactCycles();
    } finally {
      orchestration.bundle = undefined;
      await rm(harness.root, { recursive: true, force: true });
    }
  });
});
