import { describe, expect, it } from "vitest";
import { EventBriefExtractionSchema, interpretEventBriefExtraction } from "@omnitwin/types";
import {
  EVENT_BRIEF_ANSWER_SCHEMA,
  STRUCTURED_OUTPUT_MAX_UNION_PARAMETERS,
  answerAsContract,
  countUnionParameters,
} from "../services/event-brief-draft.js";

// ---------------------------------------------------------------------------
// Every answer schema the API sends for structured outputs stays within what
// the provider compiles. Past 16 union-typed parameters (anyOf, or a type
// array) every request is refused, 400 invalid_request_error "Schemas
// contains too many parameters with union types"; and nullable values make
// the compiled grammar big enough to be refused under that ("The compiled
// grammar is too large"). The event brief reader's first schema (33 unions)
// and its first fix (11) were both refused on every live read, 5 Nov 2026;
// the brief now sends one. The brief's is the only schema product code sends
// (anthropic-draft-adapter's buildAnthropicStructuredRequest is the one
// path); a new one joins SCHEMAS_SENT. The grammar's size has no count to
// test, so the live evaluation (eval:event-briefs) is its proof.
// ---------------------------------------------------------------------------

const SCHEMAS_SENT: readonly (readonly [string, unknown])[] = [
  ["event brief answer", EVENT_BRIEF_ANSWER_SCHEMA],
];

describe("structured-output answer schemas", () => {
  it.each(SCHEMAS_SENT)("keep the %s schema within the provider's union limit", (_name, schema) => {
    expect(countUnionParameters(schema)).toBeLessThanOrEqual(STRUCTURED_OUTPUT_MAX_UNION_PARAMETERS);
  });

  it("send the brief with one union only, an unsupported item's field: every value is a string", () => {
    expect(STRUCTURED_OUTPUT_MAX_UNION_PARAMETERS).toBe(16);
    expect(countUnionParameters(EVENT_BRIEF_ANSWER_SCHEMA)).toBe(1);
  });

  it("counts anyOf and type arrays wherever they sit, and nothing else", () => {
    const nullableText = { anyOf: [{ type: "string" }, { type: "null" }] };
    expect(countUnionParameters({
      type: "object",
      required: ["a", "b", "c"],
      properties: {
        a: nullableText,
        b: { type: ["integer", "null"] },
        c: { type: "array", items: { type: "object", properties: { d: nullableText, e: { type: "string", enum: ["x", "y"] } } } },
      },
    })).toBe(3);
    // The first brief schema's shape: a nullable value, quote and basis on ten fields, two on accessibility, one on unsupported.
    const reading = { type: "object", properties: { value: nullableText, words: nullableText, basis: nullableText } };
    const first = {
      fields: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${String(i)}`, reading])),
      accessibility: { items: { properties: { words: nullableText, basis: nullableText } } },
      unsupported: { items: { properties: { field: nullableText } } },
    };
    expect(countUnionParameters(first)).toBe(33);
  });
});

const ABSENT_AS_SENT = { value: "", source: "absent", words: "", basis: "" } as const;
const ABSENT = { value: null, source: "absent", words: null, basis: null } as const;

/** An answer as the schema has the model write it: strings, "" for none. */
function sent(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fields: {
      eventName: ABSENT_AS_SENT,
      eventType: { value: "wedding", source: "stated", words: "wedding", basis: "" },
      guestCount: { value: "120", source: "inferred", words: "about 120", basis: "An approximate figure taken as the count." },
      layoutStyle: ABSENT_AS_SENT,
      budgetGbp: { value: "4500.50", source: "stated", words: "£4,500.50", basis: "" },
      preferredDate: ABSENT_AS_SENT, startTime: ABSENT_AS_SENT, endTime: ABSENT_AS_SENT,
      serviceModel: { value: "plated", source: "inferred", words: "  ", basis: "Dinner is usually plated." },
      planningEmphasis: ABSENT_AS_SENT,
      ...fields,
    },
    accessibility: [{ requirement: "step_free_route", source: "stated", words: "step-free", basis: "" }],
    unsupported: [{ words: "a dance floor", kind: "not_modelled", explanation: "The engine does not place a dance floor.", field: null }],
  };
}

/** The same answer as the contract has it: nulls and numbers. */
const AS_CONTRACT = {
  fields: {
    eventName: ABSENT,
    eventType: { value: "wedding", source: "stated", words: "wedding", basis: null },
    guestCount: { value: 120, source: "inferred", words: "about 120", basis: "An approximate figure taken as the count." },
    layoutStyle: ABSENT,
    budgetGbp: { value: 4500.5, source: "stated", words: "£4,500.50", basis: null },
    preferredDate: ABSENT, startTime: ABSENT, endTime: ABSENT,
    serviceModel: { value: "plated", source: "inferred", words: null, basis: "Dinner is usually plated." },
    planningEmphasis: ABSENT,
  },
  accessibility: [{ requirement: "step_free_route", source: "stated", words: "step-free", basis: null }],
  unsupported: [{ words: "a dance floor", kind: "not_modelled", explanation: "The engine does not place a dance floor.", field: null }],
};

describe("an answer as the schema sends it", () => {
  it("is the contract's answer once each \"\" is null and each number field's digits a number", () => {
    expect(answerAsContract(sent())).toEqual(AS_CONTRACT);
    expect(EventBriefExtractionSchema.safeParse(answerAsContract(sent())).success).toBe(true);
  });

  it("passes on a number written any other way, for the contract to refuse rather than guess", () => {
    const words = answerAsContract(sent({ guestCount: { value: "about 120", source: "inferred", words: "about 120", basis: "x" } })) as typeof AS_CONTRACT;
    expect(words.fields.guestCount.value).toBe("about 120");
    expect(EventBriefExtractionSchema.safeParse(words).success).toBe(false);
    const comma = answerAsContract(sent({ budgetGbp: { value: "4,500", source: "stated", words: "£4,500", basis: "" } })) as typeof AS_CONTRACT;
    expect(comma.fields.budgetGbp.value).toBe("4,500");
    expect(EventBriefExtractionSchema.safeParse(comma).success).toBe(false);
  });

  it("leaves text fields' digits as text, and an answer that is not the expected shape as it is", () => {
    const named = answerAsContract(sent({ eventName: { value: "2027", source: "stated", words: "2027", basis: "" } })) as typeof AS_CONTRACT;
    expect(named.fields.eventName.value).toBe("2027");
    expect(answerAsContract(null)).toBeNull();
    expect(answerAsContract("text")).toBe("text");
    expect(answerAsContract({ fields: "nope", accessibility: 3 })).toEqual({ fields: "nope", accessibility: 3 });
  });

  it("reads exactly as the answer written with nulls and numbers would", () => {
    const description = "A wedding for about 120 with a dance floor, budget £4,500.50. Step-free access please.";
    const at = { description, contactDetailsRemoved: false, generatedAt: "2026-11-05T12:00:00.000Z" };
    expect(interpretEventBriefExtraction({ ...at, extraction: answerAsContract(sent()) }))
      .toEqual(interpretEventBriefExtraction({ ...at, extraction: AS_CONTRACT }));
  });
});
