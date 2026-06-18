import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION,
  RuntimeCompositionDecisionV0Schema,
  type RuntimeCompositionDecisionV0,
} from "../runtime-composition-decision.js";

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomRuntimeCompositionDecision(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-composition-decision-2026-06-16.json",
  );
}

function parsedDecision(): RuntimeCompositionDecisionV0 {
  return RuntimeCompositionDecisionV0Schema.parse(
    loadReceptionRoomRuntimeCompositionDecision(),
  );
}

describe("Runtime composition decision", () => {
  it("validates the Reception Room direct SOG chunk composition decision artifact", () => {
    const decision = parsedDecision();

    expect(decision.schemaVersion).toBe(RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION);
    expect(decision.decisionId).toBe("reception-room-runtime-composition-2026-06-16");
    expect(decision.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(decision.decision).toBe("serve_manifest_room_sog_chunks");
    expect(decision.lcc2Manifest.authority).toBe("not_runtime_authoritative");
    expect(decision.runtimeLoading.visualAssetUrlsExpectedCount).toBe(7);
    expect(decision.runtimeLoading.loadedSplatsExpected).toBe(3491322);
    expect(decision.runtimeLoading.servedRoomChunks.map((chunk) => chunk.fileName)).toEqual([
      "0_0.sog",
      "0_15_0_0.sog",
      "0_1_0.sog",
      "0_1_0_5.sog",
      "0_20_0.sog",
      "0_6_0_0.sog",
      "0_7_0_0.sog",
    ]);
    expect(decision.runtimeLoading.excludedChunks.map((chunk) => chunk.fileName)).toEqual([
      "env.sog",
    ]);
    expect(decision.guardrails).toEqual({
      lcc2DirectLoaderEnabled: false,
      signedTransformCreated: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    });
  });

  it("rejects direct chunk-serving decisions that claim LCC2 graph runtime authority", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      lcc2Manifest: {
        ...decision.lcc2Manifest,
        authority: "runtime_authoritative",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects served chunk totals that drift from the LCC2 room total", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      runtimeLoading: {
        ...decision.runtimeLoading,
        servedRoomChunks: decision.runtimeLoading.servedRoomChunks.map((chunk, index) =>
          index === 0 ? { ...chunk, loadedSplats: chunk.loadedSplats + 1 } : chunk,
        ),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects chunks that are both served and excluded", () => {
    const decision = parsedDecision();
    const servedChunk = decision.runtimeLoading.servedRoomChunks[0];

    if (servedChunk === undefined) {
      throw new Error("Expected Reception Room decision to include served chunks.");
    }

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      runtimeLoading: {
        ...decision.runtimeLoading,
        excludedChunks: [
          {
            ...servedChunk,
            role: "environment_chunk",
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects composition decisions that create public exposure side effects", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      guardrails: {
        ...decision.guardrails,
        publicExposureChanged: true,
      },
    });

    expect(result.success).toBe(false);
  });
});
