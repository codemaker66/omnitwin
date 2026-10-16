import { describe, expect, it } from "vitest";
import { clockFace, describeWindow, readWindowDraft, ruleSaveError, WINDOW_COPY } from "../pricing-rule-window.js";

describe("pricing rule window", () => {
  describe("clockFace", () => {
    it("shows Postgres's HH:MM:SS and the form's HH:MM as the same clock face", () => {
      expect(clockFace("09:00:00")).toBe("09:00");
      expect(clockFace("09:00")).toBe("09:00");
      expect(clockFace("00:30:00")).toBe("00:30");
    });

    it("leaves anything else as it came", () => {
      expect(clockFace("noon")).toBe("noon");
      expect(clockFace("")).toBe("");
    });
  });

  describe("describeWindow", () => {
    it("reads a window as from–until", () => {
      expect(describeWindow({ appliesFrom: "09:00:00", appliesUntil: "13:00:00" })).toBe("09:00–13:00");
      expect(describeWindow({ appliesFrom: "09:00", appliesUntil: "17:30" })).toBe("09:00–17:30");
    });

    it("says when a window runs past midnight", () => {
      expect(describeWindow({ appliesFrom: "19:00:00", appliesUntil: "00:30:00" })).toBe("19:00–00:30 (past midnight)");
      // An until equal to its from is a full turn of the clock, which the
      // calculator also reads as past midnight.
      expect(describeWindow({ appliesFrom: "09:00", appliesUntil: "09:00" })).toBe("09:00–09:00 (past midnight)");
    });

    it("says any time for a rule with no window, including one from an older server", () => {
      expect(describeWindow({ appliesFrom: null, appliesUntil: null })).toBe("any time");
      expect(describeWindow({})).toBe("any time");
      expect(describeWindow({ appliesFrom: undefined, appliesUntil: undefined })).toBe("any time");
    });

    it("does not pretend a half window is a window", () => {
      expect(describeWindow({ appliesFrom: "09:00", appliesUntil: null })).toBe("any time");
    });
  });

  describe("readWindowDraft", () => {
    it("sends both null when both inputs are empty", () => {
      expect(readWindowDraft({ from: "", until: "" })).toEqual({ kind: "any", appliesFrom: null, appliesUntil: null });
    });

    it("sends both HH:MM when both are entered, trimmed", () => {
      expect(readWindowDraft({ from: " 09:00", until: "13:00 " }))
        .toEqual({ kind: "set", appliesFrom: "09:00", appliesUntil: "13:00" });
    });

    it("accepts a window that runs past midnight", () => {
      expect(readWindowDraft({ from: "19:00", until: "00:30" }))
        .toEqual({ kind: "set", appliesFrom: "19:00", appliesUntil: "00:30" });
    });

    it("refuses one side only, mirroring the API's both-or-neither rule", () => {
      expect(readWindowDraft({ from: "09:00", until: "" })).toEqual({ kind: "half", message: WINDOW_COPY.pairNeeded });
      expect(readWindowDraft({ from: "", until: "13:00" })).toEqual({ kind: "half", message: WINDOW_COPY.pairNeeded });
    });

    it("refuses a time that is not HH:MM on a 24-hour clock", () => {
      for (const bad of ["9:00", "24:00", "13:60", "1pm", "09:00:00"]) {
        expect(readWindowDraft({ from: bad, until: "13:00" }), bad).toEqual({ kind: "invalid", message: WINDOW_COPY.clockNeeded });
      }
    });
  });

  describe("ruleSaveError", () => {
    it("reads the plain message out of a 400 whose body only says Validation failed", () => {
      const error = Object.assign(new Error("Validation failed"), {
        status: 400,
        code: "VALIDATION_ERROR",
        details: [{ path: ["appliesUntil"], message: "appliesFrom and appliesUntil go together: both, or neither" }],
      });
      expect(ruleSaveError(error, "Failed to save pricing rule")).toBe("appliesFrom and appliesUntil go together: both, or neither");
    });

    it("keeps an API message that already says what went wrong", () => {
      const error = Object.assign(new Error("appliesFrom and appliesUntil go together: both, or neither"), {
        status: 400, code: "VALIDATION_ERROR",
      });
      expect(ruleSaveError(error, "fallback")).toBe("appliesFrom and appliesUntil go together: both, or neither");
    });

    it("falls back when the error says nothing readable", () => {
      expect(ruleSaveError(new Error(""), "Failed to save pricing rule")).toBe("Failed to save pricing rule");
      expect(ruleSaveError("boom", "Failed to save pricing rule")).toBe("Failed to save pricing rule");
      const bare = Object.assign(new Error("Validation failed"), { code: "VALIDATION_ERROR", details: [{}] });
      expect(ruleSaveError(bare, "fallback")).toBe("Validation failed");
    });
  });
});
