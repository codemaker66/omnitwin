import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCraftQuizAnswer,
  CRAFT_PROFILES,
  CRAFT_QUESTIONS,
  rankCrafts,
  ZERO_CRAFT_QUIZ_PROGRESS,
} from "../features/trades-house/craft-quiz-model.js";
import {
  CONVENER_DELIBERATION,
  CONVENER_POKES,
  CONVENER_THRESHOLD,
} from "../features/trades-house/convener/convener-lines.js";
import { DELIBERATION_PREAMBLE, DELIBERATION_REPLY, applyDeliberation, deliberate } from "../features/trades-house/craft-quiz-deliberation.js";
import { TradesHouseCraftQuizPage } from "../pages/TradesHouseCraftQuizPage.js";

// The reveal records the run (no PII) to the API. A unit test must not make
// API traffic, and the wiring is worth asserting: one run, twelve answers, the
// same Craft the page names.
const recordQuizRun = vi.fn<(run: unknown) => boolean>(() => true);
vi.mock("../features/trades-house/quiz-telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/trades-house/quiz-telemetry.js")>();
  return { ...actual, recordQuizRun: (run: unknown) => recordQuizRun(run) };
});
import { TradesHouseLeafletPage } from "../pages/TradesHouseLeafletPage.js";

/**
 * Where the always-third-option walk actually lands, computed the way the app
 * computes it. The old fixture named THE MALTMEN, which this path no longer
 * reaches — and a test that hard-codes the answer proves the writing has not
 * changed, not that the sorting is deterministic, which is the property meant.
 */
const WALK = (() => {
  let progress = ZERO_CRAFT_QUIZ_PROGRESS;
  for (let index = 0; index < CRAFT_QUESTIONS.length; index += 1) {
    progress = applyCraftQuizAnswer(progress, index, 2);
  }
  // If the twelve finish close, he asks one more thing; the walk always takes
  // the first answer to it. Derived here the way the app derives it, so the
  // test proves determinism whether or not this path happens to be close.
  const asked = deliberate(progress);
  if (asked !== null) progress = applyDeliberation(progress, asked, 0);
  const [top] = rankCrafts(progress);
  if (top === undefined) throw new Error("the ranking is never empty");
  return { profile: CRAFT_PROFILES[top.craftId], deliberated: asked !== null };
})();
const EXPECTED = WALK.profile;

/** Corpus text is data, not a literal to retype into an assertion. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

declare global {
  interface Window {
    readonly happyDOM: {
      readonly settings: {
        readonly navigation: {
          disableChildFrameNavigation: boolean;
        };
      };
    };
  }
}

function setIframeLoadingDisabled(disabled: boolean): void {
  window.happyDOM.settings.navigation.disableChildFrameNavigation = disabled;
}

function renderQuiz(): void {
  render(
    <MemoryRouter>
      <TradesHouseCraftQuizPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setIframeLoadingDisabled(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setIframeLoadingDisabled(false);
});

describe("Trades House leaflet experience", () => {
  it("embeds the print-faithful leaflet and exposes the connected quiz", () => {
    render(
      <MemoryRouter>
        <TradesHouseLeafletPage />
      </MemoryRouter>,
    );

    const leaflet = screen.getByTitle("Trades House Glasgow two-sided leaflet");
    expect(leaflet.getAttribute("src")).toBe("/trades-house-media/leaflet.html");
    expect(screen.getByRole("link", { name: "Discover your Craft" }).getAttribute("href")).toBe(
      "/trades-house/discover-your-craft",
    );
    expect(screen.getByRole("link", { name: "Open printable leaflet" }).getAttribute("href")).toBe(
      "/trades-house-media/leaflet.html",
    );
  });

  it("runs all twelve scenes and produces a deterministic result", async () => {
    // The Convener now reacts to every answer before the quiz advances, so
    // the click-through plays his typewriter out on fake timers.
    vi.useFakeTimers();
    renderQuiz();

    expect(screen.getByRole("heading", { name: "Which Craft is yours?" })).toBeTruthy();
    expect(screen.getAllByTestId("craft-rail-crest")).toHaveLength(14);

    fireEvent.click(screen.getByRole("button", { name: "Begin the Craft quiz" }));
    // He explains what this is before the first dilemma; the reader crosses
    // that threshold when they are ready, not on a timer.
    expect(screen.getByText(CONVENER_THRESHOLD[0] ?? "")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /I am ready|Skip ahead/u }));
    expect(screen.getByText("QUESTION 1 OF 12")).toBeTruthy();

    // Answering the third option of every scene is a fixed path through axis
    // space. Which Craft it reaches is derived above rather than named here —
    // all four constant-option walks now land on different Crafts, which is a
    // healthier signal than the exact tie the old option-one path produced.
    for (let scene = 0; scene < 12; scene += 1) {
      const options = document.querySelectorAll<HTMLButtonElement>(".craft-quiz-option");
      expect(options, `scene ${String(scene + 1)} should offer four options`).toHaveLength(4);
      const third = options[2];
      if (third === undefined) throw new Error("missing option");
      fireEvent.click(third);

      // Answering opens his reply and stops. Nothing advances on a clock, so
      // the scene stays put no matter how long the reader sits with the line.
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      const reply = screen.getByRole("group", { name: "The Convener replies" });
      expect(reply.textContent, `scene ${String(scene + 1)} reply`).toContain("The Convener");
      expect(
        screen.getByText(`QUESTION ${String(scene + 1)} OF 12`),
        "the scene must still be on screen while he replies",
      ).toBeTruthy();

      // The reader presses on when they are ready. The twelfth reply promises
      // the verdict only when the verdict is next: when it hung, he says so
      // in the aside and the button stays "Go on".
      if (scene === 11 && WALK.deliberated) {
        expect(reply.textContent).toContain(DELIBERATION_PREAMBLE);
      }
      fireEvent.click(screen.getByRole("button", { name: scene === 11 && !WALK.deliberated ? "See your Craft" : "Go on" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }

    // When it was close he asks one more thing: two answers, no progress pip,
    // and the same reply-then-continue rhythm as the twelve.
    if (WALK.deliberated) {
      expect(screen.getByText("IT IS CLOSE · ONE MORE THING")).toBeTruthy();
      const two = document.querySelectorAll<HTMLButtonElement>(".craft-quiz-option");
      expect(two, "a deliberation offers exactly two answers").toHaveLength(2);
      const first = two[0];
      if (first === undefined) throw new Error("missing deliberation option");
      fireEvent.click(first);
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      expect(screen.getByRole("group", { name: "The Convener replies" }).textContent).toContain(DELIBERATION_REPLY);
      fireEvent.click(screen.getByRole("button", { name: "See your Craft" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    } else {
      expect(screen.queryByText("IT IS CLOSE · ONE MORE THING")).toBeNull();
    }

    // The last answer hands over to his deliberation, not to the verdict —
    // an instant answer after twelve dilemmas reads as a lookup table.
    expect(screen.getByText(CONVENER_DELIBERATION[0] ?? "")).toBeTruthy();
    expect(screen.queryByText(EXPECTED.name), "the verdict must not arrive early").toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

    vi.useRealTimers();
    expect(screen.getByText(EXPECTED.name)).toBeTruthy();

    // The run went out once, whole, and names the same Craft the page does.
    expect(recordQuizRun).toHaveBeenCalledTimes(1);
    const sent = recordQuizRun.mock.calls[0]?.[0] as { answers: number[]; result: string; deliberation: unknown; viewport: string } | undefined;
    expect(sent?.answers).toHaveLength(12);
    expect(sent?.answers.every((seat: number) => seat === 2)).toBe(true);
    expect(CRAFT_PROFILES[sent?.result as keyof typeof CRAFT_PROFILES].name).toBe(EXPECTED.name);
    expect(sent?.deliberation === null).toBe(!WALK.deliberated);
    expect(screen.getByText(EXPECTED.archetype)).toBeTruthy();
    const introduction = screen.getByRole("link", { name: "Request an introduction" });
    expect(decodeURIComponent(introduction.getAttribute("href") ?? "")).toContain(
      `Craft introduction — ${EXPECTED.name}`,
    );
    expect(
      screen.getByRole("link", { name: "View the visitor leaflet" }).getAttribute("href"),
    ).toBe("/trades-house/leaflet");

    fireEvent.click(screen.getByRole("button", { name: "Retake the questions" }));
    expect(screen.getByRole("button", { name: "Begin the Craft quiz" })).toBeTruthy();
  });

  it("explains itself before the first dilemma instead of dropping the reader into one", () => {
    renderQuiz();
    fireEvent.click(screen.getByRole("button", { name: "Begin the Craft quiz" }));

    // Pressing begin used to land on a moral dilemma with no idea what this
    // was. It now lands on him telling you.
    expect(screen.queryByText("QUESTION 1 OF 12"), "the quiz must not start yet").toBeNull();
    expect(screen.getByText(CONVENER_THRESHOLD[0] ?? "")).toBeTruthy();

    // The way out is available from the first frame — nobody should have to
    // sit through an introduction to reach what they came for.
    const ready = screen.getByRole("button", { name: /I am ready|Skip ahead/u });
    fireEvent.click(ready);
    expect(screen.getByText("QUESTION 1 OF 12")).toBeTruthy();
  });

  it("announces quiz progress and keeps the option controls keyboard-native", () => {
    renderQuiz();
    fireEvent.click(screen.getByRole("button", { name: "Begin the Craft quiz" }));
    fireEvent.click(screen.getByRole("button", { name: /I am ready|Skip ahead/u }));

    // Two polite live regions now share the screen: the quiz's progress
    // announcer and the Convener's speech mirror.
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((status) => status.textContent?.includes("Question 1 of 12") ?? false)).toBe(true);
    // Four answer options — the Convener's pokeable portrait is a fifth
    // button, so count options by their own class, not by role.
    expect(document.querySelectorAll(".craft-quiz-option")).toHaveLength(4);

    // The portrait is an invitation to prod it, so it has to be a real control:
    // a native button (Enter and Space activate it for free), reachable by tab,
    // named for the ACTION, and described by what actually hangs there. Anything
    // reachable only by mouse would make the invitation a lie for half the room.
    const portrait = screen.getByRole("button", { name: "The Convener — poke the portrait" });
    expect(portrait).toBeInstanceOf(HTMLButtonElement);
    expect((portrait as HTMLButtonElement).disabled).toBe(false);
    expect(portrait.getAttribute("tabindex")).toBeNull();
    portrait.focus();
    expect(document.activeElement).toBe(portrait);
    expect(
      document.getElementById(portrait.getAttribute("aria-describedby") ?? "")?.textContent,
      "the painting's own description survives the button's name",
    ).toContain("oil portrait of the Convener");

    // And it answers. The first prod speaks the first line of the escalation
    // into his live region — poking is the visitor's own action, so it is
    // announced rather than left as silent theatre.
    fireEvent.click(portrait);
    expect(document.querySelector(".convener-painting-live")?.textContent).toBe(CONVENER_POKES[0]);

    // Scene one, option one: the lead phrase is the option's accessible name.
    const [first] = CRAFT_QUESTIONS[0].options;
    expect(screen.getByRole("button", { name: new RegExp(escapeRe(first.lead), "u") }))
      .toBeInstanceOf(HTMLButtonElement);
    // Every option states its price — that is what keeps the four equal.
    expect(screen.getByText(new RegExp(`Costs you: ${escapeRe(first.cost)}`, "u"))).toBeTruthy();
  });
});
