import {
  FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS,
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES,
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS,
  FoundryE57GeometryCropArtifactV0Schema,
  FoundryIntegrityError,
  compileFoundryE57PointClassificationMaskV0,
  deriveFoundryE57PointClassificationSelectorsV0,
  verifyFoundryE57PointClassificationMaskV0,
  type FoundryE57PointClassificationMaskV0,
  type FoundryE57PointClassificationRuleV0,
} from "@omnitwin/reconstruction-foundry";

export const LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0 =
  "omnitwin.local-foundry.e57-point-classification-mask-request.v0";

export const LOCAL_E57_POINT_CLASSIFICATION_MASK_MAXIMUM_BODY_BYTES =
  16 * 1_024 * 1_024;

type LocalMaskClassification =
  | "captured_movable_visual_excluded"
  | "privacy_excluded";

interface LocalExactPointReferenceV0 {
  readonly scanIndex: number;
  readonly sourcePointIndex: number;
}

interface LocalExactPointSelectionV0 {
  readonly kind: "exact_point_references";
  readonly points: readonly LocalExactPointReferenceV0[];
}

interface LocalMetricBoundsSelectionV0 {
  readonly kind: "inclusive_bounds_e57_root_m";
  readonly frame: "e57_root";
  readonly units: "metre";
  readonly minimum: readonly [number, number, number];
  readonly maximum: readonly [number, number, number];
}

interface LocalMaskRuleV0 {
  readonly ruleId: string;
  readonly classification: LocalMaskClassification;
  readonly rationale: string;
  readonly selection:
    | LocalExactPointSelectionV0
    | LocalMetricBoundsSelectionV0;
}

interface LocalMaskAuthorshipV0 {
  readonly operatorId: string;
  readonly operatorDisplayName: string;
  readonly authoredAt: string;
  readonly purposeNote: string;
  readonly identityAuthority: "caller_supplied_unverified";
}

interface LocalE57PointClassificationMaskRequestV0 {
  readonly schemaVersion: typeof LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0;
  readonly artifact: unknown;
  readonly authorship: LocalMaskAuthorshipV0;
  readonly defaultClassification: "unclassified_static_candidate";
  readonly rules: readonly LocalMaskRuleV0[];
}

export class LocalE57PointClassificationMaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalE57PointClassificationMaskError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LocalE57PointClassificationMaskError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("LOCAL_E57_MASK_REQUEST_INVALID", `${label} must be one JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      `${label} contains an invalid field set.`,
    );
  }
}

function boundedArray(
  value: unknown,
  maximum: number,
  label: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      `${label} must contain between 1 and ${String(maximum)} entries.`,
    );
  }
  return value;
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): string {
  if (typeof value !== "string") {
    fail("LOCAL_E57_MASK_REQUEST_INVALID", `${label} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      `${label} must contain ${String(minimum)} to ${String(maximum)} characters.`,
    );
  }
  return trimmed;
}

function metricVector(
  value: unknown,
  label: string,
): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (member) =>
        typeof member !== "number" ||
        !Number.isFinite(member) ||
        Math.abs(member) >
          FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS,
    )
  ) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      `${label} must contain three finite E57-root metre coordinates.`,
    );
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function parseAuthorship(value: unknown): LocalMaskAuthorshipV0 {
  const authorship = record(value, "Mask authorship");
  exactKeys(
    authorship,
    [
      "operatorId",
      "operatorDisplayName",
      "authoredAt",
      "purposeNote",
      "identityAuthority",
    ],
    "Mask authorship",
  );
  if (authorship.identityAuthority !== "caller_supplied_unverified") {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      "Mask authorship must remain caller-supplied and unverified.",
    );
  }
  return {
    operatorId: boundedString(
      authorship.operatorId,
      2,
      160,
      "Operator reference",
    ),
    operatorDisplayName: boundedString(
      authorship.operatorDisplayName,
      2,
      160,
      "Operator display name",
    ),
    authoredAt: boundedString(authorship.authoredAt, 20, 40, "Authored time"),
    purposeNote: boundedString(
      authorship.purposeNote,
      20,
      1_000,
      "Mask purpose note",
    ),
    identityAuthority: "caller_supplied_unverified",
  };
}

function parseReference(value: unknown): LocalExactPointReferenceV0 {
  const reference = record(value, "Exact point reference");
  exactKeys(
    reference,
    ["scanIndex", "sourcePointIndex"],
    "Exact point reference",
  );
  if (
    !Number.isSafeInteger(reference.scanIndex) ||
    (reference.scanIndex as number) < 0 ||
    !Number.isSafeInteger(reference.sourcePointIndex) ||
    (reference.sourcePointIndex as number) < 0
  ) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      "Exact point references require non-negative scan and source-point indices.",
    );
  }
  return {
    scanIndex: reference.scanIndex as number,
    sourcePointIndex: reference.sourcePointIndex as number,
  };
}

function parseRule(value: unknown): LocalMaskRuleV0 {
  const rule = record(value, "Mask rule");
  exactKeys(
    rule,
    ["ruleId", "classification", "rationale", "selection"],
    "Mask rule",
  );
  if (
    rule.classification !== "captured_movable_visual_excluded" &&
    rule.classification !== "privacy_excluded"
  ) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      "A local exclusion rule must be explicitly movable or privacy.",
    );
  }
  const selection = record(rule.selection, "Mask rule selection");
  let parsedSelection:
    | LocalExactPointSelectionV0
    | LocalMetricBoundsSelectionV0;
  if (selection.kind === "exact_point_references") {
    exactKeys(selection, ["kind", "points"], "Exact point selection");
    parsedSelection = {
      kind: "exact_point_references",
      points: boundedArray(
        selection.points,
        FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS,
        "Exact point selection",
      ).map(parseReference),
    };
  } else if (selection.kind === "inclusive_bounds_e57_root_m") {
    exactKeys(
      selection,
      ["kind", "frame", "units", "minimum", "maximum"],
      "Metric bounds selection",
    );
    if (selection.frame !== "e57_root" || selection.units !== "metre") {
      fail(
        "LOCAL_E57_MASK_REQUEST_INVALID",
        "Bounds must use the original E57-root frame in metres.",
      );
    }
    parsedSelection = {
      kind: "inclusive_bounds_e57_root_m",
      frame: "e57_root",
      units: "metre",
      minimum: metricVector(selection.minimum, "Bounds minimum"),
      maximum: metricVector(selection.maximum, "Bounds maximum"),
    };
  } else {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      "Mask selection must use E57-root bounds or exact retained-point references.",
    );
  }
  return {
    ruleId: boundedString(rule.ruleId, 1, 120, "Rule ID"),
    classification: rule.classification,
    rationale: boundedString(rule.rationale, 20, 1_000, "Rule rationale"),
    selection: parsedSelection,
  };
}

function parseRequest(
  input: unknown,
): LocalE57PointClassificationMaskRequestV0 {
  const request = record(input, "Point-classification mask request");
  exactKeys(
    request,
    [
      "schemaVersion",
      "artifact",
      "authorship",
      "defaultClassification",
      "rules",
    ],
    "Point-classification mask request",
  );
  if (
    request.schemaVersion !==
      LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0 ||
    request.defaultClassification !== "unclassified_static_candidate"
  ) {
    fail(
      "LOCAL_E57_MASK_REQUEST_INVALID",
      "The point-classification request contract is invalid.",
    );
  }
  return {
    schemaVersion: LOCAL_E57_POINT_CLASSIFICATION_MASK_REQUEST_V0,
    artifact: request.artifact,
    authorship: parseAuthorship(request.authorship),
    defaultClassification: "unclassified_static_candidate",
    rules: boundedArray(
      request.rules,
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES,
      "Mask rules",
    ).map(parseRule),
  };
}

function sharedRule(
  artifact: ReturnType<typeof FoundryE57GeometryCropArtifactV0Schema.parse>,
  rule: LocalMaskRuleV0,
): FoundryE57PointClassificationRuleV0 {
  if (rule.selection.kind === "inclusive_bounds_e57_root_m") {
    return {
      ruleId: rule.ruleId,
      classification: rule.classification,
      rationale: rule.rationale,
      selection: {
        ...rule.selection,
        minimum: [...rule.selection.minimum],
        maximum: [...rule.selection.maximum],
      },
    };
  }
  return {
    ruleId: rule.ruleId,
    classification: rule.classification,
    rationale: rule.rationale,
    selection: {
      kind: "exact_point_selectors",
      points: deriveFoundryE57PointClassificationSelectorsV0(
        artifact,
        rule.selection.points,
      ),
    },
  };
}

export function compileLocalE57PointClassificationMaskV0(
  input: unknown,
): FoundryE57PointClassificationMaskV0 {
  try {
    const request = parseRequest(input);
    const artifact = FoundryE57GeometryCropArtifactV0Schema.parse(
      request.artifact,
    );
    const mask = compileFoundryE57PointClassificationMaskV0({
      schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
      artifact,
      authorship: request.authorship,
      defaultClassification: request.defaultClassification,
      rules: request.rules.map((rule) => sharedRule(artifact, rule)),
    });
    return verifyFoundryE57PointClassificationMaskV0(mask, artifact);
  } catch (error: unknown) {
    if (error instanceof LocalE57PointClassificationMaskError) throw error;
    if (error instanceof FoundryIntegrityError) {
      throw new LocalE57PointClassificationMaskError(
        error.code,
        error.message,
        { cause: error },
      );
    }
    throw new LocalE57PointClassificationMaskError(
      "LOCAL_E57_MASK_COMPILATION_FAILED",
      "The local point-classification mask request is invalid. No mask was created.",
      { cause: error },
    );
  }
}
