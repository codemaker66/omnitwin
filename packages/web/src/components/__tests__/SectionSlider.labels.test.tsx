import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionSlider } from "../SectionSlider.js";
import { useSectionStore } from "../../stores/section-store.js";

const initialSection = useSectionStore.getState();

afterEach(() => {
  cleanup();
  useSectionStore.setState(initialSection);
});

describe("SectionSlider labels", () => {
  // The Grand Hall's clear height is 6.7 m; a whole-metre label read "7m",
  // the old figure the planner no longer uses.
  it("labels the standalone slider's top with the room's height to a tenth of a metre", () => {
    useSectionStore.getState().setMaxHeight(6.7);
    useSectionStore.getState().setHeight(3.2);
    render(<SectionSlider />);
    expect(screen.getByText("6.7m")).toBeTruthy();
    expect(screen.getByText("3.2m")).toBeTruthy();
    expect(screen.queryByText("7m")).toBeNull();
  });

  it("agrees with the embedded slider's reading of the same height", () => {
    useSectionStore.getState().setMaxHeight(6.7);
    useSectionStore.getState().setHeight(3.2);
    render(<SectionSlider embedded />);
    expect(screen.getByText("3.2 m / 6.7 m")).toBeTruthy();
  });
});
