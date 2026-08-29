const SOURCE_COUNT = 148;

interface ExactSourceIdentityInputV2 {
  readonly inventoryIndex: number;
  readonly sweepNumber: number;
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export type GrandHallT554NativeReviewAuthorityNoneRecordedDecisionV2 =
  | {
      readonly result: "EXCLUDE";
      readonly classification: "no_observed_grand_hall_pixels";
    }
  | {
      readonly result: "INCLUDE";
      readonly classification:
        | "grand_hall_core"
        | "grand_hall_portal_threshold";
    };

export type GrandHallT554NativeReviewAuthorityNoneRecordV2 =
  | {
      readonly state: "no_recorded_decision";
    }
  | {
      readonly state: "decision_recorded";
      readonly decision: GrandHallT554NativeReviewAuthorityNoneRecordedDecisionV2;
      readonly attestation: "not_recorded";
    }
  | {
      readonly state: "authority_none_attestation_recorded";
      readonly decision: GrandHallT554NativeReviewAuthorityNoneRecordedDecisionV2;
      readonly attestation: "not_cryptographic";
    };

export interface GrandHallT554NativeReviewDurableSourceHistoryEntryV2 {
  readonly inventoryIndex: number;
  readonly sweepNumber: number;
  readonly authorityNoneRecord: GrandHallT554NativeReviewAuthorityNoneRecordV2;
}

interface RecordedDecisionInputV2 {
  readonly decisionSha256: string;
  readonly sourceCustody: {
    readonly source: ExactSourceIdentityInputV2;
    readonly sourceReviewSubjectSha256: string;
  };
  readonly result: string;
  readonly classification: string;
}

interface RecordedAttestationInputV2 {
  readonly decisionSha256: string;
  readonly sourceReviewSubjectSha256: string;
  readonly humanPresenceProof: string;
  readonly agentDecisionAuthority: string;
  readonly authority: string;
}

export interface GrandHallT554NativeReviewDurableSourceHistoryInputV2 {
  readonly sourceAt: (inventoryIndex: number) => ExactSourceIdentityInputV2;
  readonly recordedSourceDecisions: readonly RecordedDecisionInputV2[];
  readonly recordedHumanAttestations: readonly RecordedAttestationInputV2[];
}

export type GrandHallT554NativeReviewDurableSourceHistoryV2ErrorCode =
  | "CATALOG_INVALID"
  | "DECISION_JOIN_INVALID"
  | "ATTESTATION_JOIN_INVALID"
  | "ACTIVE_HISTORY_MISMATCH";

export class GrandHallT554NativeReviewDurableSourceHistoryV2Error extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewDurableSourceHistoryV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewDurableSourceHistoryV2Error";
  }
}

function fail(
  code: GrandHallT554NativeReviewDurableSourceHistoryV2ErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewDurableSourceHistoryV2Error {
  return new GrandHallT554NativeReviewDurableSourceHistoryV2Error(
    code,
    message,
    cause,
  );
}

function sameExactSource(
  left: ExactSourceIdentityInputV2,
  right: ExactSourceIdentityInputV2,
): boolean {
  return (
    left.inventoryIndex === right.inventoryIndex &&
    left.sweepNumber === right.sweepNumber &&
    left.fileName === right.fileName &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.widthPx === right.widthPx &&
    left.heightPx === right.heightPx
  );
}

function frozenDecision(decision: {
  readonly result: string;
  readonly classification: string;
}): GrandHallT554NativeReviewAuthorityNoneRecordedDecisionV2 {
  if (
    decision.result === "EXCLUDE" &&
    decision.classification === "no_observed_grand_hall_pixels"
  ) {
    return Object.freeze({
      result: "EXCLUDE",
      classification: "no_observed_grand_hall_pixels",
    });
  }
  if (
    decision.result === "INCLUDE" &&
    (decision.classification === "grand_hall_core" ||
      decision.classification === "grand_hall_portal_threshold")
  ) {
    return Object.freeze({
      result: "INCLUDE",
      classification: decision.classification,
    });
  }
  throw fail(
    "DECISION_JOIN_INVALID",
    "Recorded source decision has an invalid result and classification pairing.",
  );
}

function sameDecision(
  left: { readonly result: string; readonly classification: string },
  right: { readonly result: string; readonly classification: string },
): boolean {
  return (
    left.result === right.result && left.classification === right.classification
  );
}

export function projectGrandHallT554NativeReviewDurableSourceHistoryV2(
  input: GrandHallT554NativeReviewDurableSourceHistoryInputV2,
): readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[] {
  const catalogSources: ExactSourceIdentityInputV2[] = [];
  try {
    for (
      let inventoryIndex = 0;
      inventoryIndex < SOURCE_COUNT;
      inventoryIndex += 1
    ) {
      const source = input.sourceAt(inventoryIndex);
      if (source.inventoryIndex !== inventoryIndex) {
        throw fail(
          "CATALOG_INVALID",
          "Registry source inventory order is not exact.",
        );
      }
      catalogSources.push(source);
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewDurableSourceHistoryV2Error) {
      throw error;
    }
    throw fail(
      "CATALOG_INVALID",
      "Exact registry source inventory could not be read.",
      error,
    );
  }

  const records: GrandHallT554NativeReviewAuthorityNoneRecordV2[] = Array.from(
    { length: SOURCE_COUNT },
    () => Object.freeze({ state: "no_recorded_decision" as const }),
  );
  const decisionIndexByDigest = new Map<
    string,
    {
      readonly inventoryIndex: number;
      readonly sourceReviewSubjectSha256: string;
    }
  >();
  const decisionIndices = new Set<number>();
  const decisionSourceSha256s = new Set<string>();
  const decisionSourceReviewSubjects = new Set<string>();

  for (const decision of input.recordedSourceDecisions) {
    const inventoryIndex = decision.sourceCustody.source.inventoryIndex;
    const catalogSource = catalogSources[inventoryIndex];
    if (
      !Number.isInteger(inventoryIndex) ||
      catalogSource === undefined ||
      !sameExactSource(catalogSource, decision.sourceCustody.source)
    ) {
      throw fail(
        "DECISION_JOIN_INVALID",
        "Recorded source decision does not match the exact registry source identity.",
      );
    }
    if (
      decisionIndices.has(inventoryIndex) ||
      decisionIndexByDigest.has(decision.decisionSha256) ||
      decisionSourceSha256s.has(decision.sourceCustody.source.sha256) ||
      decisionSourceReviewSubjects.has(
        decision.sourceCustody.sourceReviewSubjectSha256,
      )
    ) {
      throw fail(
        "DECISION_JOIN_INVALID",
        "Recorded source decisions contain a duplicate durable join.",
      );
    }
    const recordedDecision = frozenDecision(decision);
    records[inventoryIndex] = Object.freeze({
      state: "decision_recorded",
      decision: recordedDecision,
      attestation: "not_recorded",
    });
    decisionIndices.add(inventoryIndex);
    decisionSourceSha256s.add(decision.sourceCustody.source.sha256);
    decisionSourceReviewSubjects.add(
      decision.sourceCustody.sourceReviewSubjectSha256,
    );
    decisionIndexByDigest.set(decision.decisionSha256, {
      inventoryIndex,
      sourceReviewSubjectSha256:
        decision.sourceCustody.sourceReviewSubjectSha256,
    });
  }

  const attestedDecisionIndices = new Set<number>();
  for (const attestation of input.recordedHumanAttestations) {
    const joinedDecision = decisionIndexByDigest.get(
      attestation.decisionSha256,
    );
    if (
      joinedDecision === undefined ||
      attestation.sourceReviewSubjectSha256 !==
        joinedDecision.sourceReviewSubjectSha256 ||
      attestation.humanPresenceProof !== "not_cryptographic" ||
      attestation.agentDecisionAuthority !== "none" ||
      attestation.authority !== "none" ||
      attestedDecisionIndices.has(joinedDecision.inventoryIndex)
    ) {
      throw fail(
        "ATTESTATION_JOIN_INVALID",
        "Recorded authority-none attestation does not have one exact decision join.",
      );
    }
    const prior = records[joinedDecision.inventoryIndex];
    if (prior?.state !== "decision_recorded") {
      throw fail(
        "ATTESTATION_JOIN_INVALID",
        "Recorded authority-none attestation does not follow one recorded decision.",
      );
    }
    records[joinedDecision.inventoryIndex] = Object.freeze({
      state: "authority_none_attestation_recorded",
      decision: prior.decision,
      attestation: "not_cryptographic",
    });
    attestedDecisionIndices.add(joinedDecision.inventoryIndex);
  }

  return Object.freeze(
    catalogSources.map((source, inventoryIndex) =>
      Object.freeze({
        inventoryIndex,
        sweepNumber: source.sweepNumber,
        authorityNoneRecord:
          records[inventoryIndex] ??
          (() => {
            throw fail(
              "CATALOG_INVALID",
              "Durable source history did not cover the exact registry inventory.",
            );
          })(),
      }),
    ),
  );
}

export function assertGrandHallT554NativeReviewActiveHistoryConsistencyV2(
  history: readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[],
  activeSource: {
    readonly inventoryIndex: number;
    readonly sweepNumber: number;
    readonly phase:
      | "source_review"
      | "mask_edit"
      | "mask_review"
      | "decision_recorded"
      | "human_attested";
    readonly decision: {
      readonly result: string;
      readonly classification: string;
    } | null;
    readonly humanAttestationRecorded: boolean;
  } | null,
): void {
  if (history.length !== SOURCE_COUNT) {
    throw fail(
      "ACTIVE_HISTORY_MISMATCH",
      "Durable source history does not cover the exact source inventory.",
    );
  }
  if (activeSource === null) return;
  const entry = history[activeSource.inventoryIndex];
  if (
    entry === undefined ||
    entry.inventoryIndex !== activeSource.inventoryIndex ||
    entry.sweepNumber !== activeSource.sweepNumber
  ) {
    throw fail(
      "ACTIVE_HISTORY_MISMATCH",
      "Active source does not match its durable history identity.",
    );
  }
  if (
    activeSource.phase !== "decision_recorded" &&
    activeSource.phase !== "human_attested"
  ) {
    if (
      activeSource.decision !== null ||
      activeSource.humanAttestationRecorded
    ) {
      throw fail(
        "ACTIVE_HISTORY_MISMATCH",
        "Active review phase contains stale decision or attestation state.",
      );
    }
    return;
  }
  if (activeSource.decision === null) {
    throw fail(
      "ACTIVE_HISTORY_MISMATCH",
      "Active decision phase has no recorded decision.",
    );
  }
  const expectedState =
    activeSource.phase === "decision_recorded"
      ? "decision_recorded"
      : "authority_none_attestation_recorded";
  if (
    entry.authorityNoneRecord.state !== expectedState ||
    !sameDecision(entry.authorityNoneRecord.decision, activeSource.decision) ||
    activeSource.humanAttestationRecorded !==
      (activeSource.phase === "human_attested")
  ) {
    throw fail(
      "ACTIVE_HISTORY_MISMATCH",
      "Active decision phase does not match its durable authority-none history.",
    );
  }
}
