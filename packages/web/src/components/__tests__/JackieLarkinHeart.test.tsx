import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JackieLarkinHeart } from "../JackieLarkinHeart.js";

function dispatchKey(target: Window | HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  }));
}

function typeSequence(target: Window | HTMLElement, sequence: string): void {
  act(() => {
    for (const letter of sequence) {
      dispatchKey(target, letter);
    }
  });
}

describe("JackieLarkinHeart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a hidden seven-pulse love heart when jackielarkin is typed", () => {
    render(<JackieLarkinHeart />);

    typeSequence(window, "jackielarkin");

    expect(screen.getByTestId("jackie-larkin-heart")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4_100);
    });

    expect(screen.queryByTestId("jackie-larkin-heart")).toBeNull();
  });

  it("keeps the easter egg hidden while the same letters are typed into an input", () => {
    render(
      <>
        <label htmlFor="seat-name">Seat name</label>
        <input id="seat-name" />
        <JackieLarkinHeart />
      </>,
    );

    const input = screen.getByLabelText("Seat name");
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected an input field");

    typeSequence(input, "jackielarkin");

    expect(screen.queryByTestId("jackie-larkin-heart")).toBeNull();
  });

  it("does not trigger from partial or shortcut sequences", () => {
    render(<JackieLarkinHeart />);

    act(() => {
      for (const letter of "jackielarkin") {
        window.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: letter,
        }));
      }
    });
    typeSequence(window, "jackie");

    expect(screen.queryByTestId("jackie-larkin-heart")).toBeNull();
  });
});
