import { describe, expect, it } from "vitest";
import {
  REDACTED_HEALTH_TEXT,
  redactHealthFreeText,
  redactHealthFreeTextInString,
} from "../event-requirements.js";

const NOTE = "Table 4: severe sesame allergy; one guest coeliac";

describe("redactHealthFreeText", () => {
  it("replaces the allergy note at any depth and leaves the counts", () => {
    const body = { instructions: { dietary: { vegetarian: 12, glutenFree: 3, otherAllergies: NOTE } }, name: "Layout" };
    expect(redactHealthFreeText(body)).toEqual({
      instructions: { dietary: { vegetarian: 12, glutenFree: 3, otherAllergies: REDACTED_HEALTH_TEXT } },
      name: "Layout",
    });
    // The input is never touched.
    expect(body.instructions.dietary.otherAllergies).toBe(NOTE);
  });

  it("leaves an empty note empty, so a redacted log never claims a note existed", () => {
    expect(redactHealthFreeText({ otherAllergies: "" })).toEqual({ otherAllergies: "" });
  });

  it("turns an Error into a plain record with its message, stack, fields and cause scrubbed", () => {
    const cause = new Error(`detail: Failing row contains ({"dietary": {"otherAllergies": "${NOTE}"}})`);
    const error = Object.assign(new Error(`Failed query: insert\nparams: {"otherAllergies":"${NOTE}"}`, { cause }), {
      code: "23514",
      params: [JSON.stringify({ instructions: { dietary: { otherAllergies: NOTE } } })],
    });
    const redacted = JSON.stringify(redactHealthFreeText(error));
    expect(redacted).not.toContain("sesame");
    expect(redacted).not.toContain("coeliac");
    expect(redacted).toContain("23514");
    expect(redacted).toContain("Failed query: insert");
  });

  it("survives a cycle", () => {
    const loop: Record<string, unknown> = { otherAllergies: NOTE };
    loop["self"] = loop;
    const redacted = redactHealthFreeText(loop) as Record<string, unknown>;
    expect(redacted["otherAllergies"]).toBe(REDACTED_HEALTH_TEXT);
    expect(redacted["self"]).toBe(redacted);
  });

  it("leaves class instances to their own serialisers", () => {
    const when = new Date("2026-10-17T09:00:00Z");
    expect(redactHealthFreeText({ when })).toEqual({ when });
  });
});

describe("redactHealthFreeTextInString", () => {
  it("scrubs JSON, JSON inside JSON, and key=value text", () => {
    const plain = `{"otherAllergies": "${NOTE}", "vegan": 2}`;
    expect(redactHealthFreeTextInString(plain)).toBe(`{"otherAllergies": "${REDACTED_HEALTH_TEXT}", "vegan": 2}`);

    const nested = JSON.stringify({ metadata: JSON.stringify({ otherAllergies: `say "nuts" twice` }) });
    const scrubbedNested = redactHealthFreeTextInString(nested);
    expect(scrubbedNested).not.toContain("nuts");
    expect(scrubbedNested).toContain(REDACTED_HEALTH_TEXT);

    expect(redactHealthFreeTextInString(`otherAllergies=${NOTE.split(";")[0] ?? ""}; vegan=2`))
      .toBe(`otherAllergies=${REDACTED_HEALTH_TEXT}; vegan=2`);
  });

  it("keeps a note with escaped quotes from leaking its tail", () => {
    const text = JSON.stringify({ otherAllergies: `the "nut" table; shellfish` });
    const scrubbed = redactHealthFreeTextInString(text);
    expect(scrubbed).not.toContain("shellfish");
    expect(JSON.parse(scrubbed)).toEqual({ otherAllergies: REDACTED_HEALTH_TEXT });
  });

  it("returns text without the key unchanged", () => {
    const text = "Vegetarian 12, gluten free 3";
    expect(redactHealthFreeTextInString(text)).toBe(text);
  });
});
