import { describe, expect, it } from "vitest";
import { mentionPatterns, namesToErase, withoutNames } from "../services/people-erasure-text.js";

describe("taking an erased person's names out of kept text", () => {
  const morag = namesToErase(["Morag Smith", "Morag", "Smith", "morag@example.test"]);

  it("replaces the full name as written, and the address in any case", () => {
    expect(withoutNames("Wedding — Morag Smith", morag)).toBe("Wedding — Erased");
    expect(withoutNames("morag@example.test — Dinner", morag)).toBe("Erased — Dinner");
    expect(withoutNames("MORAG@Example.TEST — Dinner", morag)).toBe("Erased — Dinner");
    // A name is matched with its capitals: other words that spell it stay.
    expect(withoutNames("MORAG SMITH — Dinner", morag)).toBe("MORAG SMITH — Dinner");
    const will = namesToErase(["Will Smith", "Will", "May"]);
    expect(withoutNames("will call back on 12 may", will)).toBe("will call back on 12 may");
    expect(withoutNames("Will Smith will call back on 1 May", will)).toBe("Erased will call back on 1 May");
    // A first or family name alone is a word in other sentences: it stays.
    expect(withoutNames("Call Morag about the Smith order", morag)).toBe("Call Morag about the Smith order");
    expect(withoutNames("Morag Smith, morag@example.test", morag)).toBe("Erased");
    expect(withoutNames("Morag  Smith's wedding", morag)).toBe("Erased's wedding");
  });

  it("rewords every casing the name was written in", () => {
    const typed = namesToErase(["Morag Smith", "morag smith", "MORAG SMITH", "Morag Smith"]);
    expect(typed).toEqual(["MORAG SMITH", "Morag Smith", "morag smith"]);
    expect(withoutNames("morag smith — Wedding", typed)).toBe("Erased — Wedding");
    expect(withoutNames("MORAG SMITH — Dinner", typed)).toBe("Erased — Dinner");
    // A casing nobody wrote is not hers.
    expect(withoutNames("Morag SMITH — Dinner", typed)).toBe("Morag SMITH — Dinner");
  });

  it("matches whole words only, in any script", () => {
    expect(withoutNames("Grand Hall dinner", namesToErase(["Al Hall"]))).toBe("Grand Hall dinner");
    expect(withoutNames("Smithson ceilidh", morag)).toBe("Smithson ceilidh");
    expect(withoutNames("Dinner for Ròs Nic", namesToErase(["Ròs Nic"]))).toBe("Dinner for Erased");
    expect(withoutNames("Ròsan Nic's lunch", namesToErase(["Ròs Nic"]))).toBe("Ròsan Nic's lunch");
  });

  it("treats a name's punctuation as text, not as a pattern", () => {
    expect(withoutNames("Lunch — Jo (Jo) Smith+1", namesToErase(["Jo (Jo) Smith+1"]))).toBe("Lunch — Erased");
    expect(withoutNames("Lunch — JoX (Jo) Smith1", namesToErase(["Jo (Jo) Smith+1"]))).toBe("Lunch — JoX (Jo) Smith1");
  });

  it("hands back null, and text naming nobody, unchanged", () => {
    const text = "Wedding — Isla Brown";
    expect(withoutNames(text, morag)).toBe(text);
    expect(withoutNames(null, morag)).toBeNull();
    expect(withoutNames(text, [])).toBe(text);
  });

  it("takes full names of two words or more and addresses, never a single word or an initial", () => {
    expect(namesToErase([" Morag ", "May", "M. Smith", "M", null, undefined, "", "Morag  Smith", "MORAG@Example.test", "morag@example.test"]))
      .toEqual(["morag@example.test", "Morag Smith"]);
  });

  it("builds a pre-filter that every match passes, with LIKE's own characters escaped", () => {
    expect(mentionPatterns(["Morag Smith", "100%_jo@x.test"])).toEqual(["%morag%smith%", "%100\\%\\_jo@x.test%"]);
  });
});
