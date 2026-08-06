import { describe, expect, it } from "vitest";
import {
  CONVENER_DOZE,
  CONVENER_DOZE_AFTER_MS,
  CONVENER_FINAL_POKE_INDEX,
  CONVENER_POKES,
  CONVENER_WAKE,
} from "../convener-lines.js";
import {
  type ConvenerState,
  WAKE_POKE_GRACE_MS,
  clearUtterance,
  initialConvenerState,
  pokeLine,
  reduceConvener,
} from "../convener-state.js";

const T0 = 1_000_000;

function pokeTimes(count: number, from: ConvenerState = initialConvenerState(T0)): ConvenerState {
  let state = from;
  for (let i = 0; i < count; i += 1) {
    state = reduceConvener(state, { type: "poke" }, T0 + i);
  }
  return state;
}

describe("pokeLine", () => {
  it("starts at the first line, not the second", () => {
    expect(pokeLine(0)).toBe(CONVENER_POKES[0]);
  });

  it("holds at the terminal line instead of running off the end", () => {
    expect(pokeLine(CONVENER_FINAL_POKE_INDEX)).toBe(CONVENER_POKES[CONVENER_FINAL_POKE_INDEX]);
    expect(pokeLine(CONVENER_FINAL_POKE_INDEX + 50)).toBe(
      CONVENER_POKES[CONVENER_FINAL_POKE_INDEX],
    );
  });

  it("never returns undefined for a negative count", () => {
    expect(pokeLine(-3)).toBe(CONVENER_POKES[0]);
  });
});

describe("poking the portrait", () => {
  it("speaks the first line on the first poke", () => {
    const state = reduceConvener(initialConvenerState(T0), { type: "poke" }, T0);
    expect(state.utterance?.text).toBe(CONVENER_POKES[0]);
    expect(state.utterance?.kind).toBe("poke");
  });

  it("escalates rather than repeating — the joke is that he remembers", () => {
    const spoken: string[] = [];
    let state = initialConvenerState(T0);
    for (let i = 0; i < CONVENER_POKES.length; i += 1) {
      state = reduceConvener(state, { type: "poke" }, T0 + i);
      spoken.push(state.utterance?.text ?? "");
    }
    expect(spoken).toEqual([...CONVENER_POKES]);
  });

  it("holds the last line forever once exhausted, never wrapping to the start", () => {
    const state = pokeTimes(CONVENER_POKES.length + 5);
    expect(state.utterance?.text).toBe(CONVENER_POKES[CONVENER_FINAL_POKE_INDEX]);
    expect(state.pokeCount).toBe(CONVENER_FINAL_POKE_INDEX);
  });

  it("gives every utterance a fresh seq so a repeated line still re-triggers", () => {
    const first = pokeTimes(CONVENER_POKES.length + 1);
    const second = reduceConvener(first, { type: "poke" }, T0 + 999);
    expect(second.utterance?.text).toBe(first.utterance?.text);
    expect(second.utterance?.seq).toBeGreaterThan(first.utterance?.seq ?? 0);
  });
});

describe("dozing off", () => {
  it("stays awake while the idle span is short of the threshold", () => {
    const state = reduceConvener(
      initialConvenerState(T0),
      { type: "tick" },
      T0 + CONVENER_DOZE_AFTER_MS - 1,
    );
    expect(state.dozing).toBe(false);
    expect(state.utterance).toBeNull();
  });

  it("dozes once the threshold is reached", () => {
    const state = reduceConvener(
      initialConvenerState(T0),
      { type: "tick" },
      T0 + CONVENER_DOZE_AFTER_MS,
    );
    expect(state.dozing).toBe(true);
    expect(state.utterance?.text).toBe(CONVENER_DOZE);
    expect(state.utterance?.kind).toBe("doze");
  });

  it("does not re-announce dozing on every subsequent tick", () => {
    const asleep = reduceConvener(
      initialConvenerState(T0),
      { type: "tick" },
      T0 + CONVENER_DOZE_AFTER_MS,
    );
    const later = reduceConvener(asleep, { type: "tick" }, T0 + CONVENER_DOZE_AFTER_MS * 4);
    expect(later).toBe(asleep);
  });

  it("is deferred by activity, so an active user never sees him sleep", () => {
    let state = initialConvenerState(T0);
    for (let i = 1; i <= 10; i += 1) {
      const at = T0 + i * (CONVENER_DOZE_AFTER_MS - 1_000);
      state = reduceConvener(state, { type: "activity" }, at);
      state = reduceConvener(state, { type: "tick" }, at + 1);
    }
    expect(state.dozing).toBe(false);
  });
});

describe("waking", () => {
  const asleep = reduceConvener(
    initialConvenerState(T0),
    { type: "tick" },
    T0 + CONVENER_DOZE_AFTER_MS,
  );

  it("wakes on any activity with the wake line", () => {
    const state = reduceConvener(asleep, { type: "activity" }, T0 + 90_000);
    expect(state.dozing).toBe(false);
    expect(state.utterance?.text).toBe(CONVENER_WAKE);
    expect(state.utterance?.kind).toBe("wake");
  });

  it("wakes on a poke with the wake line, not the next poke line", () => {
    const state = reduceConvener(asleep, { type: "poke" }, T0 + 90_000);
    expect(state.utterance?.text).toBe(CONVENER_WAKE);
  });

  // Prodding a sleeping man should not cost him his patience: the escalation
  // has to resume exactly where it left off, or the running joke resets.
  it("does not spend a poke on being woken", () => {
    const poked = pokeTimes(2);
    const wakeAt = T0 + CONVENER_DOZE_AFTER_MS * 2;
    const dropped = reduceConvener(poked, { type: "tick" }, wakeAt);
    const woken = reduceConvener(dropped, { type: "poke" }, wakeAt + 10);
    expect(woken.pokeCount).toBe(poked.pokeCount);

    const next = reduceConvener(woken, { type: "poke" }, wakeAt + 10 + WAKE_POKE_GRACE_MS);
    expect(next.utterance?.text).toBe(CONVENER_POKES[2]);
  });

  // Browsers fire pointerdown (activity → wake) before click (poke). Without
  // the grace, every real prod of a sleeping portrait would clobber the wake
  // line and spend patience — the free-wake rule would be unreachable.
  it("treats a poke inside the wake grace as the same prod — wake line stands", () => {
    const woken = reduceConvener(asleep, { type: "activity" }, T0 + 90_000);
    const clicked = reduceConvener(woken, { type: "poke" }, T0 + 90_000 + 40);
    expect(clicked).toBe(woken);
  });

  it("escalates normally once the wake grace has passed", () => {
    const woken = reduceConvener(asleep, { type: "activity" }, T0 + 90_000);
    const poked = reduceConvener(woken, { type: "poke" }, T0 + 90_000 + WAKE_POKE_GRACE_MS);
    expect(poked.utterance?.text).toBe(CONVENER_POKES[0]);
    expect(poked.pokeCount).toBe(1);
  });

  it("resets the idle clock, so he does not fall straight back asleep", () => {
    const woken = reduceConvener(asleep, { type: "activity" }, T0 + 90_000);
    const tick = reduceConvener(woken, { type: "tick" }, T0 + 90_000 + 1);
    expect(tick.dozing).toBe(false);
  });
});

describe("clearUtterance", () => {
  it("clears a consumed line", () => {
    const spoken = reduceConvener(initialConvenerState(T0), { type: "poke" }, T0);
    expect(clearUtterance(spoken).utterance).toBeNull();
  });

  it("preserves poke escalation and sleep state when clearing", () => {
    const spoken = pokeTimes(3);
    const cleared = clearUtterance(spoken);
    expect(cleared.pokeCount).toBe(spoken.pokeCount);
    expect(cleared.dozing).toBe(spoken.dozing);
    expect(cleared.seq).toBe(spoken.seq);
  });

  it("returns the same object when there is nothing to clear", () => {
    const idle = initialConvenerState(T0);
    expect(clearUtterance(idle)).toBe(idle);
  });
});
