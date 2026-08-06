// ---------------------------------------------------------------------------
// ConvenerPortrait — component regressions
//
// These pin the three review findings that live in the component wiring, not
// the pure modules: the stale hold-timer (a prompt's hold must never truncate
// the reaction that follows it), the return to the resting line after his own
// theatre, and total timer cleanup on unmount.
// ---------------------------------------------------------------------------

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVENER_POKES } from "../convener-lines.js";
import { ConvenerPortrait, type ConvenerHandle } from "../ConvenerPortrait.js";

function typedText(): string {
  return document.querySelector(".convener-speech-text span")?.textContent ?? "";
}

async function playOut(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConvenerPortrait", () => {
  it("finishes a line, holds, and resolves in order", async () => {
    const ref = createRef<ConvenerHandle>();
    render(<ConvenerPortrait ref={ref} />);
    let resolved = false;
    act(() => {
      void ref.current?.say("Aye, hullo.").then(() => { resolved = true; });
    });
    await playOut(150);
    expect(typedText().length).toBeGreaterThan(0);
    expect(resolved).toBe(false);
    await playOut(2_000);
    expect(typedText()).toBe("Aye, hullo.");
    expect(resolved).toBe(true);
  });

  // The critical review finding: line A's post-typing hold timer must die the
  // moment line B starts, or it fires mid-B — freezing B's typewriter and
  // resolving B's promise early, which advanced the quiz without the beat.
  it("never lets a previous line's hold timer truncate the next line", async () => {
    const ref = createRef<ConvenerHandle>();
    render(<ConvenerPortrait ref={ref} />);
    act(() => { void ref.current?.say("Aye."); });
    // "Aye." types out in ~77ms; its 350ms hold is now armed.
    await playOut(200);

    const reaction = "Ye hear the tick naebody else can! A bench stays warm for ye.";
    let reactionResolved = false;
    act(() => {
      void ref.current?.say(reaction).then(() => { reactionResolved = true; });
    });
    // 400ms in: the stale hold (armed for ~150ms into this window) would have
    // frozen the reaction mid-word and resolved it early.
    await playOut(400);
    expect(reactionResolved).toBe(false);
    expect(typedText().length).toBeLessThan(reaction.length);

    await playOut(3_000);
    expect(typedText()).toBe(reaction);
    expect(reactionResolved).toBe(true);
  });

  it("returns to the resting line after a poke — the prompt is never lost", async () => {
    const ref = createRef<ConvenerHandle>();
    const resting = "The Hall asks its question.";
    const { container } = render(<ConvenerPortrait ref={ref} restingLine={resting} />);
    const frame = container.querySelector(".convener-frame");
    expect(frame).not.toBeNull();
    if (frame === null) return;

    fireEvent.click(frame);
    await playOut(300);
    // Mid-poke: he is saying the quip, not the prompt.
    expect(CONVENER_POKES[0]?.startsWith(typedText())).toBe(true);
    // Play the quip and the return fully out.
    await playOut(6_000);
    expect(typedText()).toBe(resting);
  });

  it("clears every timer on unmount", async () => {
    const ref = createRef<ConvenerHandle>();
    const { unmount } = render(<ConvenerPortrait ref={ref} />);
    act(() => { void ref.current?.say("A line long enough to leave timers running."); });
    await playOut(120);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
