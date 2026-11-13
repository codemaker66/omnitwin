import { describe, expect, it } from "vitest";
import { namesToErase, withoutNames } from "../services/people-erasure-text.js";

describe("taking an erased person's names out of kept text", () => {
  const morag = namesToErase(["Morag Smith", "Morag", "Smith", "morag@example.test"]);

  it("replaces the whole name and its parts as written, and the address in any case", () => {
    expect(withoutNames("Wedding — Morag Smith", morag)).toBe("Wedding — Erased");
    expect(withoutNames("morag@example.test — Dinner", morag)).toBe("Erased — Dinner");
    expect(withoutNames("MORAG@Example.TEST — Dinner", morag)).toBe("Erased — Dinner");
    // A name is matched with its capitals: other words that spell it stay.
    expect(withoutNames("MORAG SMITH — Dinner", morag)).toBe("MORAG SMITH — Dinner");
    const will = namesToErase(["Will Smith", "Will", "May"]);
    expect(withoutNames("will call back on 12 may", will)).toBe("will call back on 12 may");
    expect(withoutNames("Will Smith will call back", will)).toBe("Erased will call back");
    expect(withoutNames("Call Morag about the Saloon", morag)).toBe("Call Erased about the Saloon");
    expect(withoutNames("Smith, Morag", morag)).toBe("Erased");
    expect(withoutNames("Morag  Smith's wedding", morag)).toBe("Erased's wedding");
  });

  it("matches whole words only, in any script", () => {
    expect(withoutNames("Grand Hall dinner", namesToErase(["Al"]))).toBe("Grand Hall dinner");
    expect(withoutNames("Smithson ceilidh", morag)).toBe("Smithson ceilidh");
    expect(withoutNames("Dinner for Ròs", namesToErase(["Ròs"]))).toBe("Dinner for Erased");
    expect(withoutNames("Ròsan's lunch", namesToErase(["Ròs"]))).toBe("Ròsan's lunch");
  });

  it("treats a name's punctuation as text, not as a pattern", () => {
    expect(withoutNames("Lunch — J. (Jo) Smith+1", namesToErase(["J. (Jo) Smith+1"]))).toBe("Lunch — Erased");
    expect(withoutNames("Lunch — JX (Jo) Smith1", namesToErase(["J. (Jo) Smith+1"]))).toBe("Lunch — JX (Jo) Smith1");
  });

  it("hands back null, and text naming nobody, unchanged", () => {
    const text = "Wedding — Isla Brown";
    expect(withoutNames(text, morag)).toBe(text);
    expect(withoutNames(null, morag)).toBeNull();
    expect(withoutNames(text, [])).toBe(text);
  });

  it("keeps distinct names of two letters or more, longest first", () => {
    expect(namesToErase([" Morag ", "morag", "M", null, undefined, "", "Morag  Smith"]))
      .toEqual(["Morag Smith", "Morag"]);
  });
});
