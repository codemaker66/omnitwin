import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradesHouseCraftQuizPage } from "../pages/TradesHouseCraftQuizPage.js";
import { TradesHouseLeafletPage } from "../pages/TradesHouseLeafletPage.js";

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
    expect(screen.getByText("QUESTION 1 OF 12")).toBeTruthy();

    // Answering the third option of every scene is a fixed path through axis
    // space; the geometry puts it nearest the Maltmen by a wide margin.
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
      expect(reply.textContent, `scene ${String(scene + 1)} reply`).toContain("Ye Auld Convener");
      expect(
        screen.getByText(`QUESTION ${String(scene + 1)} OF 12`),
        "the scene must still be on screen while he replies",
      ).toBeTruthy();

      // The reader presses on when they are ready.
      fireEvent.click(screen.getByRole("button", { name: scene === 11 ? "See your Craft" : "Go on" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }

    vi.useRealTimers();
    expect(screen.getByText("THE MALTMEN")).toBeTruthy();
    expect(screen.getByText("The Fermenter")).toBeTruthy();
    const introduction = screen.getByRole("link", { name: "Request an introduction" });
    expect(decodeURIComponent(introduction.getAttribute("href") ?? "")).toContain(
      "Craft introduction — THE MALTMEN",
    );
    expect(
      screen.getByRole("link", { name: "View the visitor leaflet" }).getAttribute("href"),
    ).toBe("/trades-house/leaflet");

    fireEvent.click(screen.getByRole("button", { name: "Retake the questions" }));
    expect(screen.getByRole("button", { name: "Begin the Craft quiz" })).toBeTruthy();
  });

  it("announces quiz progress and keeps the option controls keyboard-native", () => {
    renderQuiz();
    fireEvent.click(screen.getByRole("button", { name: "Begin the Craft quiz" }));

    // Two polite live regions now share the screen: the quiz's progress
    // announcer and the Convener's speech mirror.
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((status) => status.textContent?.includes("Question 1 of 12") ?? false)).toBe(true);
    // Four answer options — the Convener's pokeable portrait is a fifth
    // button, so count options by their own class, not by role.
    expect(document.querySelectorAll(".craft-quiz-option")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ye Auld Convener — poke the portrait" })).toBeTruthy();
    // Scene one, option one: the lead phrase is the option's accessible name.
    expect(screen.getByRole("button", { name: /Finish the work itself/u })).toBeInstanceOf(HTMLButtonElement);
    // Every option states its price — that is what keeps the four equal.
    expect(screen.getByText(/Costs you: ten years of yer own life/u)).toBeTruthy();
  });
});
