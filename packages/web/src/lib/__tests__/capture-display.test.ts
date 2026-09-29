import { describe, expect, it } from "vitest";
import { ACESFilmicToneMapping, NoToneMapping } from "three";
import { captureToneMapping } from "../capture-display.js";

describe("captured-room display (T-639)", () => {
  it("shows a captured room as photographed, with no film curve", () => {
    expect(captureToneMapping(true)).toBe(NoToneMapping);
  });

  it("keeps the canvas default for the procedural room", () => {
    expect(captureToneMapping(false)).toBe(ACESFilmicToneMapping);
  });
});
