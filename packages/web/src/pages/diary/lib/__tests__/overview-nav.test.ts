import { describe, expect, it } from "vitest";
import { overviewMove, type NavPlace } from "../overview-nav.js";

// A week of three days for brevity. Row 0 is the day headings; the Grand Hall
// (row 1) has two bookings on day 0 and one on day 2, the Saloon (row 2) one on
// day 1. A read-only role, so an empty square holds nothing to land on.
const HEADINGS: NavPlace[] = [0, 1, 2].map((col) => ({ row: 0, col, stack: 0 }));
const READ_ONLY: NavPlace[] = [
  ...HEADINGS,
  { row: 1, col: 0, stack: 0 }, { row: 1, col: 0, stack: 1 }, { row: 1, col: 2, stack: 0 },
  { row: 2, col: 1, stack: 0 },
];
// A writer's board: every square also ends with its Add.
const WRITABLE: NavPlace[] = [
  ...HEADINGS,
  { row: 1, col: 0, stack: 0 }, { row: 1, col: 0, stack: 1 }, { row: 1, col: 0, stack: 2 },
  { row: 1, col: 1, stack: 0 },
  { row: 1, col: 2, stack: 0 }, { row: 1, col: 2, stack: 1 },
  { row: 2, col: 0, stack: 0 },
  { row: 2, col: 1, stack: 0 }, { row: 2, col: 1, stack: 1 },
  { row: 2, col: 2, stack: 0 },
];

const at = (row: number, col: number, stack = 0): NavPlace => ({ row, col, stack });

describe("overviewMove", () => {
  it("moves across the days, keeping its place in the stack where the next square has one", () => {
    expect(overviewMove(WRITABLE, at(1, 0, 1), "ArrowRight")).toEqual(at(1, 1, 0));
    expect(overviewMove(WRITABLE, at(1, 2, 1), "ArrowLeft")).toEqual(at(1, 1, 0));
    expect(overviewMove(WRITABLE, at(1, 0, 2), "ArrowRight")).toEqual(at(1, 1, 0));
    expect(overviewMove(WRITABLE, at(2, 1, 1), "ArrowRight")).toEqual(at(2, 2, 0));
    expect(overviewMove(WRITABLE, at(0, 1), "ArrowRight")).toEqual(at(0, 2));
  });

  it("steps over a day with nothing to land on, and stops at the week's ends", () => {
    expect(overviewMove(READ_ONLY, at(1, 0, 1), "ArrowRight")).toEqual(at(1, 2, 0));
    expect(overviewMove(READ_ONLY, at(1, 2), "ArrowLeft")).toEqual(at(1, 0, 0));
    expect(overviewMove(READ_ONLY, at(1, 2), "ArrowRight")).toBeNull();
    expect(overviewMove(READ_ONLY, at(0, 0), "ArrowLeft")).toBeNull();
  });

  it("walks a square's stack before crossing rooms, and steps over a room with nothing that day", () => {
    expect(overviewMove(READ_ONLY, at(0, 0), "ArrowDown")).toEqual(at(1, 0, 0));
    expect(overviewMove(READ_ONLY, at(1, 0, 0), "ArrowDown")).toEqual(at(1, 0, 1));
    // The Saloon has nothing on day 0: the bottom of the grid.
    expect(overviewMove(READ_ONLY, at(1, 0, 1), "ArrowDown")).toBeNull();
    // Day 1: the Grand Hall is empty, so the heading leads to the Saloon.
    expect(overviewMove(READ_ONLY, at(0, 1), "ArrowDown")).toEqual(at(2, 1, 0));
    expect(overviewMove(READ_ONLY, at(2, 1), "ArrowUp")).toEqual(at(0, 1, 0));
  });

  it("comes up into the last of the square above, and up from the first room to the day's heading", () => {
    expect(overviewMove(WRITABLE, at(2, 0), "ArrowUp")).toEqual(at(1, 0, 2));
    expect(overviewMove(WRITABLE, at(1, 0, 2), "ArrowUp")).toEqual(at(1, 0, 1));
    expect(overviewMove(WRITABLE, at(1, 2, 0), "ArrowUp")).toEqual(at(0, 2, 0));
    expect(overviewMove(WRITABLE, at(0, 2), "ArrowUp")).toBeNull();
  });

  it("goes to the row's ends with Home and End, and the grid's with Ctrl", () => {
    expect(overviewMove(WRITABLE, at(2, 1, 1), "Home")).toEqual(at(2, 0, 0));
    expect(overviewMove(WRITABLE, at(1, 0, 0), "End")).toEqual(at(1, 2, 1));
    expect(overviewMove(WRITABLE, at(2, 1, 1), "Home", true)).toEqual(at(0, 0, 0));
    expect(overviewMove(WRITABLE, at(0, 1), "End", true)).toEqual(at(2, 2, 0));
    expect(overviewMove(READ_ONLY, at(2, 1), "Home")).toEqual(at(2, 1, 0));
  });

  it("ignores every other key", () => {
    expect(overviewMove(WRITABLE, at(1, 0), "Enter")).toBeNull();
    expect(overviewMove(WRITABLE, at(1, 0), "a")).toBeNull();
  });
});
