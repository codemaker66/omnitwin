import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  GrandHallT554NativeReviewDurableSourceHistoryV2Error,
  assertGrandHallT554NativeReviewActiveHistoryConsistencyV2,
  projectGrandHallT554NativeReviewDurableSourceHistoryV2,
} from "../grand-hall-t554-native-review-durable-source-history-v2.js";

type Sha256 = `sha256:${string}`;
type ProjectionInput = Parameters<
  typeof projectGrandHallT554NativeReviewDurableSourceHistoryV2
>[0];
type DecisionInput = ProjectionInput["recordedSourceDecisions"][number];
type AttestationInput = ProjectionInput["recordedHumanAttestations"][number];

function digest(label: string): Sha256 {
  return `sha256:${Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function source(inventoryIndex: number): GrandHallPanoramaSourceJpgIdentityV2 {
  const sweepNumber = inventoryIndex + 1;
  return {
    inventoryIndex,
    sweepNumber,
    fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
    sha256: digest(`source-${String(inventoryIndex)}`),
    byteLength: 1_000_000 + inventoryIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
  };
}

function sourceCatalog(): readonly GrandHallPanoramaSourceJpgIdentityV2[] {
  return Array.from({ length: 148 }, (_, inventoryIndex) =>
    source(inventoryIndex),
  );
}

function excludeDecision(
  inventoryIndex: number,
  decisionSha256 = digest(`decision-${String(inventoryIndex)}`),
): DecisionInput {
  return {
    decisionSha256,
    sourceCustody: {
      source: source(inventoryIndex),
      sourceReviewSubjectSha256: digest(`subject-${String(inventoryIndex)}`),
    },
    result: "EXCLUDE",
    classification: "no_observed_grand_hall_pixels",
  };
}

function includeDecision(
  inventoryIndex: number,
  decisionSha256 = digest(`decision-${String(inventoryIndex)}`),
): DecisionInput {
  return {
    decisionSha256,
    sourceCustody: {
      source: source(inventoryIndex),
      sourceReviewSubjectSha256: digest(`subject-${String(inventoryIndex)}`),
    },
    result: "INCLUDE",
    classification: "grand_hall_portal_threshold",
  };
}

function attestation(decision: DecisionInput): AttestationInput {
  return {
    decisionSha256: decision.decisionSha256,
    sourceReviewSubjectSha256: decision.sourceCustody.sourceReviewSubjectSha256,
    humanPresenceProof: "not_cryptographic",
    agentDecisionAuthority: "none",
    authority: "none",
  };
}

function project(input?: {
  readonly sources?: readonly GrandHallPanoramaSourceJpgIdentityV2[];
  readonly decisions?: readonly DecisionInput[];
  readonly attestations?: readonly AttestationInput[];
}) {
  const sources = input?.sources ?? sourceCatalog();
  return projectGrandHallT554NativeReviewDurableSourceHistoryV2({
    sourceAt: (inventoryIndex) => {
      const entry = sources[inventoryIndex];
      if (entry === undefined) throw new Error("missing source fixture");
      return entry;
    },
    recordedSourceDecisions: input?.decisions ?? [],
    recordedHumanAttestations: input?.attestations ?? [],
  });
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function collectKeysAndStrings(
  value: unknown,
  keys: string[] = [],
  strings: string[] = [],
): { readonly keys: readonly string[]; readonly strings: readonly string[] } {
  if (typeof value === "string") {
    strings.push(value);
    return { keys, strings };
  }
  if (typeof value !== "object" || value === null) return { keys, strings };
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeysAndStrings(child, keys, strings);
  }
  return { keys, strings };
}

describe("Grand Hall T-554 durable authority-none source history v2", () => {
  it("projects all 148 rows with undecided, decision-only, and attested records in catalog order", () => {
    const excluded = excludeDecision(4);
    const included = includeDecision(91);
    const history = project({
      decisions: [included, excluded],
      attestations: [attestation(included)],
    });

    expect(history).toHaveLength(148);
    expect(history[0]).toEqual({
      inventoryIndex: 0,
      sweepNumber: 1,
      authorityNoneRecord: { state: "no_recorded_decision" },
    });
    expect(history[4]?.authorityNoneRecord).toEqual({
      state: "decision_recorded",
      decision: {
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      },
      attestation: "not_recorded",
    });
    expect(history[91]?.authorityNoneRecord).toEqual({
      state: "authority_none_attestation_recorded",
      decision: {
        result: "INCLUDE",
        classification: "grand_hall_portal_threshold",
      },
      attestation: "not_cryptographic",
    });
    expectDeepFrozen(history);
  });

  it("strips every internal decision and attestation field before returning history", () => {
    const decision = {
      ...excludeDecision(7),
      note: "sensitive decision note",
      decidedAtUtc: "2026-08-29T10:00:00.000Z",
      childJournalLeafName: "sensitive-child.jsonl",
    };
    const recordedAttestation = {
      ...attestation(decision),
      reviewerId: "sensitive reviewer",
      knowledgeBasis: ["sensitive knowledge"],
      attestationSha256: digest("attestation"),
    };
    const history = project({
      decisions: [decision],
      attestations: [recordedAttestation],
    });
    const collected = collectKeysAndStrings(history);

    expect(
      collected.keys.some((key) =>
        /(sha256|subject|journal|leaf|note|reviewer|knowledge|time|path|bitmap|dwell|mask)/iu.test(
          key,
        ),
      ),
    ).toBe(false);
    expect(
      collected.strings.some((value) =>
        /(?:sha256:|sensitive|\.jsonl)/iu.test(value),
      ),
    ).toBe(false);
    expect(
      [...collected.keys, ...collected.strings].some((value) =>
        /(?:accept|complete|reviewed)/iu.test(value),
      ),
    ).toBe(false);
  });

  it("fails closed on duplicate decisions and exact registry identity mismatch", () => {
    const first = excludeDecision(3, digest("decision-a"));
    const duplicate = includeDecision(3, digest("decision-b"));
    expect(() => project({ decisions: [first, duplicate] })).toThrowError(
      expect.objectContaining({
        code: "DECISION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );

    const changedSource = {
      ...excludeDecision(8),
      sourceCustody: {
        ...excludeDecision(8).sourceCustody,
        source: {
          ...source(8),
          sha256: digest("different-source-bytes"),
        },
      },
    };
    expect(() => project({ decisions: [changedSource] })).toThrowError(
      expect.objectContaining({
        code: "DECISION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );

    const changedSweep = {
      ...excludeDecision(8),
      sourceCustody: {
        ...excludeDecision(8).sourceCustody,
        source: {
          ...source(8),
          sweepNumber: 99,
        },
      },
    };
    expect(() => project({ decisions: [changedSweep] })).toThrowError(
      expect.objectContaining({
        code: "DECISION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
  });

  it("rejects duplicate durable source and review-subject joins across different rows", () => {
    const first = excludeDecision(0);
    const duplicateSubject = {
      ...includeDecision(1),
      sourceCustody: {
        ...includeDecision(1).sourceCustody,
        sourceReviewSubjectSha256:
          first.sourceCustody.sourceReviewSubjectSha256,
      },
    };
    expect(() =>
      project({ decisions: [first, duplicateSubject] }),
    ).toThrowError(
      expect.objectContaining({
        code: "DECISION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );

    const sources = [...sourceCatalog()];
    const firstSource = sources[0];
    const secondSource = sources[1];
    if (firstSource === undefined || secondSource === undefined) {
      throw new Error("source fixture is incomplete");
    }
    sources[1] = { ...secondSource, sha256: firstSource.sha256 };
    const duplicateSourceDecision = {
      ...includeDecision(1),
      sourceCustody: {
        ...includeDecision(1).sourceCustody,
        source: sources[1],
      },
    };
    expect(() =>
      project({
        sources,
        decisions: [first, duplicateSourceDecision],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DECISION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
  });

  it("fails closed on orphaned, mismatched, and duplicate attestation joins", () => {
    const decision = includeDecision(12);
    expect(() =>
      project({ attestations: [attestation(decision)] }),
    ).toThrowError(
      expect.objectContaining({
        code: "ATTESTATION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );

    expect(() =>
      project({
        decisions: [decision],
        attestations: [
          {
            ...attestation(decision),
            sourceReviewSubjectSha256: digest("wrong-subject"),
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ATTESTATION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );

    expect(() =>
      project({
        decisions: [decision],
        attestations: [attestation(decision), attestation(decision)],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ATTESTATION_JOIN_INVALID",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
  });

  it("keeps historical attestation independent from reinspection and checks only active decision phases", () => {
    const decision = excludeDecision(19);
    const history = project({
      decisions: [decision],
      attestations: [attestation(decision)],
    });

    expect(() => {
      assertGrandHallT554NativeReviewActiveHistoryConsistencyV2(history, {
        inventoryIndex: 19,
        sweepNumber: 20,
        phase: "source_review",
        decision: null,
        humanAttestationRecorded: false,
      });
    }).not.toThrow();
    expect(() => {
      assertGrandHallT554NativeReviewActiveHistoryConsistencyV2(history, {
        inventoryIndex: 19,
        sweepNumber: 20,
        phase: "decision_recorded",
        decision: {
          result: "EXCLUDE",
          classification: "no_observed_grand_hall_pixels",
        },
        humanAttestationRecorded: false,
      });
    }).toThrowError(
      expect.objectContaining({
        code: "ACTIVE_HISTORY_MISMATCH",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
    expect(() => {
      assertGrandHallT554NativeReviewActiveHistoryConsistencyV2(history, {
        inventoryIndex: 19,
        sweepNumber: 20,
        phase: "source_review",
        decision: {
          result: "EXCLUDE",
          classification: "no_observed_grand_hall_pixels",
        },
        humanAttestationRecorded: false,
      });
    }).toThrowError(
      expect.objectContaining({
        code: "ACTIVE_HISTORY_MISMATCH",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
    expect(() => {
      assertGrandHallT554NativeReviewActiveHistoryConsistencyV2(history, {
        inventoryIndex: 19,
        sweepNumber: 20,
        phase: "mask_review",
        decision: null,
        humanAttestationRecorded: true,
      });
    }).toThrowError(
      expect.objectContaining({
        code: "ACTIVE_HISTORY_MISMATCH",
      }) as GrandHallT554NativeReviewDurableSourceHistoryV2Error,
    );
  });
});
