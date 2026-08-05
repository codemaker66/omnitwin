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

  it("runs all nine supplied questions and produces a deterministic result", async () => {
    // The Convener now reacts to every answer before the quiz advances, so
    // the click-through plays his typewriter out on fake timers.
    vi.useFakeTimers();
    renderQuiz();

    expect(screen.getByRole("heading", { name: "Which Craft is yours?" })).toBeTruthy();
    expect(screen.getAllByTestId("craft-rail-crest")).toHaveLength(14);

    fireEvent.click(screen.getByRole("button", { name: "Begin the Craft quiz" }));
    expect(screen.getByText("QUESTION 1 OF 9")).toBeTruthy();

    const firstAnswers = [
      /THE BROKEN MECHANISM/u,
      /THE WORKBENCH/u,
      /BUILT TO LAST/u,
      /THE STAIRCASE/u,
      /RAISE THE HALL/u,
      /PRECISION/u,
      /IRON & SILVER/u,
      /A STANDARD/u,
      /IN THE WORKSHOP/u,
    ] as const;

    for (const answer of firstAnswers) {
      fireEvent.click(screen.getByRole("button", { name: answer }));
      // Let his reaction line finish typing and the quiz advance.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
    }

    vi.useRealTimers();
    expect(screen.getByText("THE HAMMERMEN")).toBeTruthy();
    expect(screen.getByText("The Forge-Mind")).toBeTruthy();
    const introduction = screen.getByRole("link", { name: "Request an introduction" });
    expect(decodeURIComponent(introduction.getAttribute("href") ?? "")).toContain(
      "Craft introduction — THE HAMMERMEN",
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
    expect(statuses.some((status) => status.textContent?.includes("Question 1 of 9") ?? false)).toBe(true);
    // Four answer options — the Convener's pokeable portrait is a fifth
    // button, so count options by their own class, not by role.
    expect(document.querySelectorAll(".craft-quiz-option")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ye Auld Convener — poke the portrait" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /THE TORN ROBE/u })).toBeInstanceOf(HTMLButtonElement);
  });
});
