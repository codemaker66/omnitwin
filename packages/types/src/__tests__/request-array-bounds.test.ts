import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CreateAIDraftRequestSchema, AI_DRAFT_CONTEXT_MAX_BYTES } from "../ai-assistant.js";
import { CalendarQuerySchema } from "../booking.js";
import { RegisterCaptureControlSourceRecordInputSchema } from "../capture-control.js";
import { CreateEventArchitectRunInputSchema } from "../event-architect.js";
import { CreateGuestFlowReplayScenarioSchema } from "../guest-flow-replay.js";
import {
  CreateIntegrationConnectionSchema,
  INTEGRATION_CONFIG_MAX_BYTES,
  UpdateIntegrationConnectionSchema,
  WebhookOutboundTestInputSchema,
} from "../integration-layer.js";
import { ReconstructionReleaseReviewInputSchema } from "../reconstruction-release.js";
import { RegisterRuntimeQaRecordInputSchema } from "../runtime-qa-record.js";
import { RegisterRuntimeTransformArtifactInputSchema } from "../asset-version.js";

// ---------------------------------------------------------------------------
// Every array a signed-in route accepts has a ceiling (.claude/gotchas/
// zod4-semantics.md). Without one, zod reports one issue per bad element, so
// a 2 MB body of them costs hundreds of megabytes of heap and a reply of
// megabytes. Each case below fills one array with 5,000 bad elements and
// expects the refusal to name that array once, as too big, in a handful of
// issues; the free-form JSON objects are refused by size before they are read.
// ---------------------------------------------------------------------------

const MANY = 5_000;
const badElements = (): unknown[] => Array.from({ length: MANY }, () => ({}));

/** An object holding `leaf` at `path` (numbers make one-element arrays). */
function at(path: readonly (string | number)[], leaf: unknown): unknown {
  if (path.length === 0) return leaf;
  const [head, ...rest] = path;
  return typeof head === "number" ? [at(rest, leaf)] : { [head as string]: at(rest, leaf) };
}

const CASES: readonly (readonly [string, z.ZodType, readonly (string | number)[]])[] = [
  ["calendar rooms", CalendarQuerySchema, ["spaceIds"]],
  ["event architect accessibility", CreateEventArchitectRunInputSchema, ["brief", "accessibilityRequirements"]],
  ["guest flow room outline", CreateGuestFlowReplayScenarioSchema, ["input", "roomPolygon"]],
  ["guest flow obstacles", CreateGuestFlowReplayScenarioSchema, ["input", "obstacles"]],
  ["guest flow entrances", CreateGuestFlowReplayScenarioSchema, ["input", "entrances"]],
  ["guest flow exits", CreateGuestFlowReplayScenarioSchema, ["input", "exits"]],
  ["guest flow destinations", CreateGuestFlowReplayScenarioSchema, ["input", "destinations"]],
  ["guest flow staff lanes", CreateGuestFlowReplayScenarioSchema, ["input", "staffLanes"]],
  ["guest flow staff lane line", CreateGuestFlowReplayScenarioSchema, ["input", "staffLanes", 0, "line"]],
  ["guest flow assumptions", CreateGuestFlowReplayScenarioSchema, ["input", "assumptions"]],
  ["release review evidence", ReconstructionReleaseReviewInputSchema, ["visualEvidence"]],
  ["capture source alignment methods", RegisterCaptureControlSourceRecordInputSchema, ["source", "alignmentMethods"]],
  ["capture source refs", RegisterCaptureControlSourceRecordInputSchema, ["source", "sourceRefs"]],
  ["capture source transform refs", RegisterCaptureControlSourceRecordInputSchema, ["source", "transformArtifactRefs"]],
  ["capture source residual refs", RegisterCaptureControlSourceRecordInputSchema, ["source", "residualMetricRefs"]],
  ["capture source staleness", RegisterCaptureControlSourceRecordInputSchema, ["source", "staleWhen"]],
  ["runtime QA load evidence", RegisterRuntimeQaRecordInputSchema, ["record", "sparkLoad", "evidenceRefs"]],
  ["runtime QA checks", RegisterRuntimeQaRecordInputSchema, ["record", "checks"]],
  ["runtime QA check evidence", RegisterRuntimeQaRecordInputSchema, ["record", "checks", 0, "evidenceRefs"]],
  ["runtime QA limitations", RegisterRuntimeQaRecordInputSchema, ["record", "limitations"]],
  ["runtime QA approval needs", RegisterRuntimeQaRecordInputSchema, ["record", "publicExposure", "requiredBeforeApproval"]],
  ["transform landmarks", RegisterRuntimeTransformArtifactInputSchema, ["transformArtifact", "landmarks"]],
  ["transform landmark provenance", RegisterRuntimeTransformArtifactInputSchema, ["transformArtifact", "landmarks", 0, "provenanceRefs"]],
  ["transform provenance", RegisterRuntimeTransformArtifactInputSchema, ["transformArtifact", "provenance", "refs"]],
];

describe("request arrays have ceilings", () => {
  it.each(CASES)("%s: one too-big issue for 5,000 bad elements", (_name, schema, path) => {
    const result = schema.safeParse(at(path, badElements()));
    expect(result.success).toBe(false);
    if (result.success) return;
    const tooBig = result.error.issues.filter((issue) => issue.code === "too_big" && issue.path.join(".") === path.join("."));
    expect(tooBig).toHaveLength(1);
    // The rest are the other required fields of a mostly empty body, not one per element.
    expect(result.error.issues.length).toBeLessThan(50);
  });
});

describe("free-form JSON in a request is refused by size before it is read", () => {
  const bigJson = (bytes: number): Record<string, unknown> => ({ items: badElements(), padding: "x".repeat(bytes) });

  it.each([
    ["an AI draft's context", CreateAIDraftRequestSchema, ["context"], AI_DRAFT_CONTEXT_MAX_BYTES],
    ["a new integration's config", CreateIntegrationConnectionSchema, ["config"], INTEGRATION_CONFIG_MAX_BYTES],
    ["an integration's changed config", UpdateIntegrationConnectionSchema, ["config"], INTEGRATION_CONFIG_MAX_BYTES],
    ["a webhook test payload", WebhookOutboundTestInputSchema, ["payload"], INTEGRATION_CONFIG_MAX_BYTES],
  ] as const)("%s", (_name, schema, path, maxBytes) => {
    const result = (schema as z.ZodType).safeParse(at(path, bigJson(maxBytes)));
    expect(result.success).toBe(false);
    if (result.success) return;
    const tooBig = result.error.issues.filter((issue) => issue.code === "too_big" && issue.path.join(".") === path.join("."));
    expect(tooBig).toHaveLength(1);
    expect(result.error.issues.length).toBeLessThan(50);
  });

  it("still takes a context of an ordinary size", () => {
    const parsed = CreateAIDraftRequestSchema.safeParse({
      useCase: "enquiry_summary",
      context: { guests: 90, rooms: ["Grand Hall"], notes: { access: "step-free route" } },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("free-form JSON in a request is refused when nested too deep", () => {
  it("refuses 5,000 levels of nesting with one issue instead of overflowing the parser", () => {
    const deep = JSON.parse(`${"[".repeat(5_000)}${"]".repeat(5_000)}`) as unknown;
    const result = CreateAIDraftRequestSchema.safeParse({ useCase: "enquiry_summary", context: { deep } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.path).toEqual(["context"]);
  });
});
