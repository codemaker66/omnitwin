import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientHome, ClientHomeEvent, ClientHomePlan } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { ClientHomePage, eventIsPast, eventWhen, homeSummary, planHref } from "../ClientHomePage.js";

// ---------------------------------------------------------------------------
// The client's own home (fix-first 12). What it promises: the next event is
// the one focal thing, with the way into it; other events and the person's
// own plans follow; with nothing yet, the page says what will appear and
// offers two ways forward; a failed read says so and offers a retry; and an
// answer for one account never shows on another's screen.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ getClientHome: vi.fn() }));
vi.mock("../../api/client-home.js", () => ({ getClientHome: mocks.getClientHome }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn() }) }));

const VENUE = { id: "00000000-0000-4000-8000-0000000000f1", name: "Trades Hall Glasgow", timezone: "Europe/London" };
const DAY = 86_400_000;

function event(id: string, name: string, startsAt: string | null, endsAt: string | null = null): ClientHomeEvent {
  return { id, name, eventType: "dinner", startsAt, endsAt, guestCount: 120, venue: VENUE, layoutCount: 1 };
}

function plan(id: string, name: string, eventId: string | null): ClientHomePlan {
  return {
    id, name, updatedAt: "2026-10-15T10:00:00.000Z", eventId,
    space: { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall" },
    venue: { id: VENUE.id, name: VENUE.name },
  };
}

const NEXT_ID = "00000000-0000-4000-8000-0000000000e1";
const LATER_ID = "00000000-0000-4000-8000-0000000000e2";
const PAST_ID = "00000000-0000-4000-8000-0000000000e3";
const PLAN_ID = "00000000-0000-4000-8000-0000000000c1";
const LONE_PLAN_ID = "00000000-0000-4000-8000-0000000000c2";

const soon = new Date(Date.now() + 10 * DAY).toISOString();
const soonEnd = new Date(Date.now() + 10 * DAY + 5 * 3_600_000).toISOString();
const later = new Date(Date.now() + 90 * DAY).toISOString();
const gone = new Date(Date.now() - 30 * DAY).toISOString();

const FULL: ClientHome = {
  events: [
    event(PAST_ID, "Spring lunch", gone),
    event(NEXT_ID, "Winter dinner", soon, soonEnd),
    event(LATER_ID, "Summer ball", later),
  ],
  plans: [plan(LONE_PLAN_ID, "Long tables idea", null), plan(PLAN_ID, "Rounds of ten", NEXT_ID)],
  planTotal: 2,
};

const morag: AuthUser = { id: "00000000-0000-4000-8000-0000000000aa", name: "Morag Reid", email: "morag@example.test", role: "planner", platformRole: "none", venueId: null };
const struan: AuthUser = { id: "00000000-0000-4000-8000-0000000000bb", name: "Struan Bell", email: "struan@example.test", role: "client", platformRole: "none", venueId: null };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function signIn(user: AuthUser): void {
  useAuthStore.setState({ user, isAuthenticated: true, isLoading: false });
}

function show(): void {
  render(<MemoryRouter><ClientHomePage /></MemoryRouter>);
}

beforeEach(() => {
  mocks.getClientHome.mockReset();
  signIn(morag);
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});

describe("the client's home", () => {
  it("opens on the next event, then the others, then the person's own plans", async () => {
    const answer = deferred<ClientHome>();
    mocks.getClientHome.mockReturnValueOnce(answer.promise);
    show();
    expect(screen.getByRole("status").textContent).toContain("Opening your events…");
    await act(async () => { answer.resolve(FULL); await answer.promise; });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
    expect(screen.getByText("2 events coming up and 2 saved plans.")).toBeTruthy();

    const next = screen.getByRole("region", { name: "Winter dinner" });
    expect(within(next).getByText("Next")).toBeTruthy();
    expect(within(next).getByRole("link", { name: "Open your event" }).getAttribute("href")).toBe(`/events/${NEXT_ID}`);
    expect(within(next).getByText("1 of your layouts is linked to it.")).toBeTruthy();

    const comingUp = screen.getByRole("region", { name: "Coming up" });
    expect(within(comingUp).getByRole("link", { name: /Summer ball/ }).getAttribute("href")).toBe(`/events/${LATER_ID}`);
    const earlier = screen.getByRole("region", { name: "Earlier" });
    expect(within(earlier).getByRole("link", { name: /Spring lunch/ }).getAttribute("href")).toBe(`/events/${PAST_ID}`);

    const plans = screen.getByRole("region", { name: "Your room plans" });
    expect(within(plans).getByRole("link", { name: /Rounds of ten/ }).getAttribute("href")).toBe(`/plan/${PLAN_ID}?eventId=${NEXT_ID}`);
    expect(within(plans).getByText(/For Winter dinner/)).toBeTruthy();
    expect(within(plans).getByRole("link", { name: /Long tables idea/ }).getAttribute("href")).toBe(`/plan/${LONE_PLAN_ID}`);
    expect(within(plans).getByRole("link", { name: "Start a new plan" }).getAttribute("href")).toBe("/plan");
    expect(screen.getByText("Dates, times and guest numbers are as the venue team holds them.")).toBeTruthy();
    // The account's own name, and the way out, are on the sheet.
    expect(screen.getByText("Morag Reid")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("with nothing yet, says what will appear and offers a way forward", async () => {
    mocks.getClientHome.mockResolvedValueOnce({ events: [], plans: [], planTotal: 0 });
    show();
    expect(await screen.findByText("Nothing is linked to your account yet.")).toBeTruthy();
    const empty = screen.getByRole("region", { name: "When the venue links your event, it opens here" });
    expect(within(empty).getByRole("link", { name: "Plan a room" }).getAttribute("href")).toBe("/plan");
    expect(within(empty).getByRole("link", { name: "Send an enquiry" }).getAttribute("href")).toBe("/#enquire");
    expect(screen.queryByRole("region", { name: "Your room plans" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with plans but no event, lists the plans beneath the same way forward", async () => {
    mocks.getClientHome.mockResolvedValueOnce({ events: [], plans: [plan(LONE_PLAN_ID, "Long tables idea", null)], planTotal: 1 });
    show();
    expect(await screen.findByText("No event is linked to your account yet. You have 1 saved plan.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "When the venue links your event, it opens here" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Your room plans" })).getByRole("link", { name: /Long tables idea/ })).toBeTruthy();
  });

  it("says when more plans exist than are shown", async () => {
    mocks.getClientHome.mockResolvedValueOnce({ events: [], plans: [plan(LONE_PLAN_ID, "Long tables idea", null)], planTotal: 140 });
    show();
    expect(await screen.findByText("Showing your 1 most recently saved plans of 140.")).toBeTruthy();
  });

  it("says a failed read plainly and loads again on Try again", async () => {
    mocks.getClientHome.mockRejectedValueOnce(new ApiError(500, "Server error", "SERVER_ERROR"));
    show();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your events could not be loaded just now. Nothing on them has changed.");
    const retry = deferred<ClientHome>();
    mocks.getClientHome.mockReturnValueOnce(retry.promise);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status").textContent).toContain("Opening your events…");
    await act(async () => { retry.resolve(FULL); await retry.promise; });
    expect(screen.getByRole("region", { name: "Winter dinner" })).toBeTruthy();
    expect(mocks.getClientHome).toHaveBeenCalledTimes(2);
  });

  it("asks to sign in again when the session has gone", async () => {
    mocks.getClientHome.mockRejectedValueOnce(new ApiError(401, "Session expired", "UNAUTHORIZED"));
    show();
    const signInLink = await screen.findByRole("link", { name: "Sign in" });
    expect(signInLink.getAttribute("href")).toBe("/login?returnTo=%2Fevents");
  });

  it("never shows one account's answer to the next account", async () => {
    const forMorag = deferred<ClientHome>();
    const forStruan = deferred<ClientHome>();
    mocks.getClientHome.mockReturnValueOnce(forMorag.promise).mockReturnValueOnce(forStruan.promise);
    show();
    act(() => { signIn(struan); });
    // Morag's answer arrives after the switch: it was asked for her, so it is dropped.
    await act(async () => { forMorag.resolve(FULL); await forMorag.promise; });
    expect(screen.queryByText("Winter dinner")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Opening your events…");
    await act(async () => { forStruan.resolve({ events: [], plans: [], planTotal: 0 }); await forStruan.promise; });
    expect(screen.getByText("Nothing is linked to your account yet.")).toBeTruthy();
    expect(screen.queryByText("Winter dinner")).toBeNull();
  });
});

describe("the home's facts", () => {
  it("reads an event's date and times on the venue's clock", () => {
    // 18:00 UTC in December is 18:00 in Glasgow; in June it is 19:00.
    expect(eventWhen({ startsAt: "2026-12-05T18:00:00.000Z", endsAt: "2026-12-05T23:00:00.000Z", venue: VENUE }))
      .toEqual({ day: "5", monthYear: "December 2026", weekday: "Saturday", time: "18:00 to 23:00" });
    expect(eventWhen({ startsAt: "2027-06-05T18:00:00.000Z", endsAt: null, venue: VENUE }))
      .toEqual({ day: "5", monthYear: "June 2027", weekday: "Saturday", time: "19:00" });
    expect(eventWhen({ startsAt: null, endsAt: null, venue: VENUE })).toBeNull();
  });

  it("counts an event as past only once it has ended", () => {
    const now = Date.parse("2026-12-05T20:00:00.000Z");
    expect(eventIsPast({ startsAt: "2026-12-05T18:00:00.000Z", endsAt: "2026-12-05T23:00:00.000Z" }, now)).toBe(false);
    expect(eventIsPast({ startsAt: "2026-12-05T18:00:00.000Z", endsAt: null }, now)).toBe(true);
    expect(eventIsPast({ startsAt: null, endsAt: null }, now)).toBe(false);
  });

  it("summarises in plain counts", () => {
    expect(homeSummary(0, 0, 0)).toBe("Nothing is linked to your account yet.");
    expect(homeSummary(0, 0, 3)).toBe("No event is linked to your account yet. You have 3 saved plans.");
    expect(homeSummary(1, 2, 1)).toBe("1 event coming up and 1 saved plan.");
    expect(homeSummary(0, 2, 4)).toBe("2 past events and 4 saved plans.");
  });

  it("opens a linked plan inside its event", () => {
    expect(planHref({ id: PLAN_ID, eventId: NEXT_ID })).toBe(`/plan/${PLAN_ID}?eventId=${NEXT_ID}`);
    expect(planHref({ id: PLAN_ID, eventId: null })).toBe(`/plan/${PLAN_ID}`);
  });
});
