import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  findUnsupportedProposalClaim,
  GUEST_ENQUIRY_LATEST_EVENT_DATE,
  GUEST_ENQUIRY_LIMITS,
  GuestEnquirySchema,
} from "@omnitwin/types";
import type { VenueDetail } from "../../../api/spaces.js";

const mocks = vi.hoisted(() => ({ getVenue: vi.fn(), submit: vi.fn(), createLink: vi.fn(), listLinks: vi.fn(), flush: vi.fn() }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.getVenue }));
vi.mock("../../../api/configurations.js", () => ({ submitGuestEnquiry: mocks.submit }));
vi.mock("../../../api/plan-view.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/plan-view.js")>()),
  createPlanViewLink: mocks.createLink,
  listPlanViewLinks: mocks.listLinks,
}));
vi.mock("../EditorBridge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../EditorBridge.js")>()),
  flushAutoSave: mocks.flush,
}));

const { GuestEnquiryModal } = await import("../GuestEnquiryModal.js");
import { pressEnterIn } from "../../../test/implicit-submit.js";
import { expectOutOfReach, hiddenTrapIn } from "../../../test/enquiry-trap.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../constants/scale.js";
import { CATALOGUE_ITEMS } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import * as plannerTruthFixtures from "../cockpit/__tests__/planner-truth-fixtures.js";

// Drafts persist per tab (E-08), so no test inherits another's typing.
beforeEach(() => { sessionStorage.clear(); });

/** Round tables on the floor, which the venue's figures read as a dinner. */
function withRounds(count: number): PlacedItem[] {
  const round = CATALOGUE_ITEMS.find((item) => item.category === "table" && item.tableShape === "round");
  if (round === undefined) throw new Error("No round table in the catalogue");
  return Array.from({ length: count }, (_unused, index) => ({
    id: `round-${String(index)}`,
    catalogueItemId: round.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

function resetStores(): void {
  usePlacementStore.setState({
    placedItems: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
}

// ---------------------------------------------------------------------------
// The venue's published figure, never floor area ÷ generic spacing (redteam
// fix-first 1): the form once told a visitor "comfortable for around 339" in
// a Grand Hall the venue publishes at 250 standing.
// ---------------------------------------------------------------------------
describe("GuestEnquiryModal states the venue's published capacity", () => {
  const tradesHall: VenueDetail = {
    id: plannerTruthFixtures.TRADES_HALL_VENUE_ID, name: "Trades Hall", slug: "trades-hall-glasgow",
    address: "85 Glassford Street", logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    mocks.getVenue.mockReset();
    mocks.getVenue.mockResolvedValue(tradesHall);
    plannerTruthFixtures.openRoom(plannerTruthFixtures.plannerRoom());
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  it("shows nothing until a guest count is entered", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText(/shared only with the/u);
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });

  it("states every published figure, with who stated it and when, before a layout is drawn", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    expect(guidance.textContent).toContain(
      "The venue publishes 250 for theatre, 80 for classroom, 180 for dinner and 250 for reception in the Grand Hall.",
    );
    expect(screen.getByTestId("enquiry-capacity-source").textContent).toBe("Published guide · Trades Hall · 9 Jul 2026");
  });

  it("reads round tables as dinner and says what happens above the published figure", async () => {
    usePlacementStore.setState({ placedItems: withRounds(25) });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "200" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    expect(guidance.textContent).toContain("The venue publishes 180 for dinner in the Grand Hall.");
    expect(guidance.textContent).toContain("200 guests is more than the published 180 for dinner.");
    expect(guidance.textContent).toContain("The events team will say what is possible when they reply.");
  });

  it("never states a computed count or a comfort verdict", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "500" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    const text = guidance.textContent ?? "";
    expect(text).not.toMatch(/\b(339|275|147|comfortable|within|fits)\b/iu);
    expect(findUnsupportedProposalClaim(text)).toBeNull();
  });

  it("clears again when the guest count is emptied", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    const input = screen.getByLabelText("Guest count");

    fireEvent.change(input, { target: { value: "120" } });
    expect(await screen.findByTestId("enquiry-capacity-guidance")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });

  it("states no figure for another venue's room of the same name", async () => {
    const elsewhere: VenueDetail = { ...tradesHall, id: "venue-grand-elsewhere", name: "Elsewhere", slug: "elsewhere" };
    mocks.getVenue.mockResolvedValue(elsewhere);
    plannerTruthFixtures.openRoom(plannerTruthFixtures.plannerRoom("grand-hall", "Grand Hall", elsewhere.id));
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });

    expect(await screen.findByText("Your details are shared only with the Elsewhere events team.")).toBeTruthy();
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The layout's own venue, never a hard-coded one (T-635 N5, item 1). The form
// told every venue's guests that "Trades Hall will reply" and that their
// details went to "the Trades Hall events team".
// ---------------------------------------------------------------------------
describe("GuestEnquiryModal names the layout's own venue", () => {
  const cityRooms: VenueDetail = {
    id: "venue-city", name: "City Rooms", slug: "city-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    mocks.getVenue.mockReset();
    mocks.submit.mockReset();
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  it("says whose team gets the details and who replies", async () => {
    mocks.getVenue.mockResolvedValue(cityRooms);
    mocks.submit.mockResolvedValue({});
    useEditorStore.setState({ venueId: cityRooms.id });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);

    expect(await screen.findByText("Your details are shared only with the City Rooms events team.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(await screen.findByText("City Rooms will reply to")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Trades Hall/u);
  });

  it("names no venue until it knows which, and never a placeholder", async () => {
    mocks.getVenue.mockRejectedValue(new Error("offline"));
    useEditorStore.setState({ venueId: cityRooms.id });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);

    expect(await screen.findByText("Your details are shared only with this venue's events team.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Venue unavailable|Trades Hall/u);
  });
});

// planner-qol E-X2: iOS Safari zooms into a field set under 16px and leaves
// the planner zoomed after the form closes. On a touch screen every field is
// 16px, read from the stylesheet the modal installs.
describe("GuestEnquiryModal on a touch screen", () => {
  it("sets every field at 16px or more for a coarse pointer, so iOS does not zoom in", () => {
    const style = document.getElementById("omni-enquiry-modal");
    expect(style).not.toBeNull();
    const sheet = (style as HTMLStyleElement).sheet;
    expect(sheet).not.toBeNull();
    const coarse = [...(sheet?.cssRules ?? [])].filter((rule): rule is CSSMediaRule =>
      rule instanceof CSSMediaRule && rule.conditionText.replace(/\s+/gu, "") === "(pointer:coarse)");
    const sizes = coarse.flatMap((media) => [...media.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".omni-enq-input")
      .map((rule) => Number.parseFloat(rule.style.fontSize));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  });

  it("keeps pinch zoom: the page's viewport never forbids zooming", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const html = await fs.readFile(path.resolve("index.html"), "utf-8");
    const viewport = /<meta name="viewport" content="([^"]*)"/u.exec(html)?.[1];
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/u);
  });
});

// planner-qol E-10: "Copy layout link" handed out /plan/<id>, an anonymous
// plan's edit capability, so whoever the guest sent it to could change the
// layout the venue is reading. After sending, the guest shares a view-only link.
describe("GuestEnquiryModal shares a view-only link after sending", () => {
  const venueRooms: VenueDetail = {
    id: "venue-share", name: "Share Rooms", slug: "share-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };
  let written: string[] = [];

  beforeEach(() => {
    resetStores();
    written = [];
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(venueRooms);
    mocks.submit.mockResolvedValue({});
    mocks.flush.mockResolvedValue(true);
    mocks.listLinks.mockResolvedValue([]);
    mocks.createLink.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111", prefix: "tokenpre", token: "tokenprefix0123456789abcdefghijklmnopqrstuv",
      createdAt: "2026-10-26T12:00:00.000Z", expiresAt: "2026-11-25T12:00:00.000Z",
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } },
    });
    useEditorStore.setState({ configId: "cfg-1", venueId: venueRooms.id, isPublicPreview: true });
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  async function send(): Promise<void> {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Share Rooms events team.");
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await screen.findByText("Share Rooms will reply to");
  }

  it("copies a view-only link, never the planner address", async () => {
    await send();
    expect(screen.queryByText(/Copy layout link/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy a view-only link" }));
    expect(await screen.findByRole("button", { name: "View-only link copied" })).toBeTruthy();
    expect(mocks.flush).toHaveBeenCalled();
    expect(mocks.createLink).toHaveBeenCalledWith("cfg-1");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/\/plan-view\/tokenprefix/u);
    expect(written[0]).not.toMatch(/\/plan\/cfg-1/u);
    expect(screen.getByText(/Nobody can change the plan through it\./u)).toBeTruthy();
  });

  it("offers no public link for a plan already saved to an account", async () => {
    useEditorStore.setState({ isPublicPreview: false });
    await send();
    expect(screen.queryByRole("button", { name: /view-only link/u })).toBeNull();
    expect(mocks.createLink).not.toHaveBeenCalled();
  });
});

// planner-qol E-08, E-X1 and E-X6: what the guest types survives a close,
// the form cannot be closed while the enquiry is on its way, and the answer
// takes focus and is announced.
// enquiries-crm-2: the API refuses a long name, telephone or message, or a
// guest count past its limit, as "Validation failed", which this form then
// shows with no field named. The fields take no more than the API accepts.
describe("GuestEnquiryModal takes no more than the API accepts", () => {
  const rooms: VenueDetail = {
    id: "venue-limits", name: "Limit Rooms", slug: "limit-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: false });
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  async function open(): Promise<void> {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Limit Rooms events team.");
  }

  // The message is held at Send instead (below).
  it("limits every field to the shared enquiry limits", async () => {
    await open();
    const limits: readonly [string, number][] = [
      ["Your name", screen.getByRole<HTMLInputElement>("textbox", { name: "Your name" }).maxLength],
      ["Phone", screen.getByRole<HTMLInputElement>("textbox", { name: /^Phone/u }).maxLength],
      ["Guest count", Number(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Guest count" }).max)],
    ];
    expect(limits).toEqual([
      ["Your name", GUEST_ENQUIRY_LIMITS.nameLength],
      ["Phone", GUEST_ENQUIRY_LIMITS.phoneLength],
      ["Guest count", GUEST_ENQUIRY_LIMITS.guestCount],
    ]);
  });

  // Review of #405, F5. A maxlength message field cut a longer paste at the
  // API's limit without a word, and the events team got a brief that stopped
  // mid-sentence. The field keeps everything; Send holds the enquiry, says
  // why in the alert the email's problem uses, and takes the guest there.
  it("keeps a long pasted message and holds Send, saying how long it is", async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    const message = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" });
    expect(message.hasAttribute("maxlength"), "a maxlength field cuts a paste without a word").toBe(false);
    const brief = "b".repeat(3214);
    fireEvent.change(message, { target: { value: brief } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Messages can be up to 2,000 characters. Yours is 3,214.");
    expect(document.activeElement, "focus after Send").toBe(message);
    expect(message.value).toBe(brief);
  });

  // Review of #405, Q1 and Q2. The sentence was said in the alert above the
  // form while focus went to the message at its foot, out of view on a
  // phone, and it kept the first count while the guest cut the message. It
  // is now said beside the message, which names it as its problem, where
  // focus lands; and it follows the message as the guest cuts it, quietly,
  // until it fits.
  it("says the message's length beside it, where focus lands, and follows the guest's cuts until it fits", async () => {
    mocks.submit.mockResolvedValue({});
    await open();
    const form = screen.getByTestId("guest-enquiry-form");
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    const message = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" });
    fireEvent.change(message, { target: { value: "b".repeat(3214) } });
    const send = screen.getByRole("button", { name: "Send to Events Team" });
    fireEvent.click(send);

    const held = "Messages can be up to 2,000 characters. Yours is 3,214.";
    expect(screen.getByRole("textbox", { name: "Anything else?", description: held })).toBe(message);
    expect(message.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement, "focus after Send").toBe(message);
    const sentence = screen.getByRole("alert");
    expect(sentence.textContent).toBe(held);
    // Beside the field: inside the form, directly above the message, not in the box above the form.
    expect(form.contains(sentence)).toBe(true);
    expect(sentence.nextElementSibling).toBe(message);

    // Cut, and the number follows, without an alert at each keystroke.
    fireEvent.change(message, { target: { value: "b".repeat(2950) } });
    expect(screen.queryByRole("alert"), "no alert while the guest edits").toBeNull();
    expect(screen.getByRole("textbox", {
      name: "Anything else?", description: "Messages can be up to 2,000 characters. Yours is 2,950.",
    })).toBe(message);

    // Short enough: the sentence goes, and Send sends.
    fireEvent.change(message, { target: { value: "b".repeat(1950) } });
    expect(message.getAttribute("aria-invalid")).toBe("false");
    expect(message.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText(/^Messages can be up to/u)).toBeNull();
    fireEvent.click(send);
    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ message: "b".repeat(1950) }));
    });
  });

  // Counted as the API counts, or a message one past the limit is sent and
  // refused, or one at it is held for nothing: what is posted (trimmed), in
  // Unicode code points, as zod 4 reads a string's length. An emoji outside
  // the basic plane is one, though it is two UTF-16 units.
  it("holds a message one past the API's limit and sends one at it, counting as the API does", async () => {
    mocks.submit.mockResolvedValue({});
    const limit = GUEST_ENQUIRY_LIMITS.messageLength;
    const onePast = `${"a".repeat(limit)}🎻`;
    const atLimit = ` \n${"a".repeat(limit - 1)}🎻\n `;
    expect(atLimit.trim().length, "UTF-16 units: a count of these would hold it").toBe(limit + 1);
    const apiTakes = (text: string): boolean => GuestEnquirySchema.safeParse({
      venueSlug: rooms.slug, email: "guest@example.test", message: text,
    }).success;
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    const message = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" });
    const send = screen.getByRole("button", { name: "Send to Events Team" });

    fireEvent.change(message, { target: { value: onePast } });
    fireEvent.click(send);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Messages can be up to 2,000 characters. Yours is 2,001.");
    expect(apiTakes(onePast.trim()), "the API refuses it too").toBe(false);

    fireEvent.change(message, { target: { value: atLimit } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ message: atLimit.trim() }));
    });
    expect(apiTakes(atLimit.trim()), "the API takes it").toBe(true);
  });

  // Review of #405, F2: a date field with no max takes a year of five digits
  // (a doubled key), which the API refuses as "Validation failed".
  it("takes no year in the date field that the API refuses", async () => {
    await open();
    const date = screen.getByLabelText<HTMLInputElement>("Event date");
    expect(date.type).toBe("date");
    expect(date.max).toBe(GUEST_ENQUIRY_LATEST_EVENT_DATE);
  });

  it("does not post a guest count past what the API accepts", async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    const guests = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Guest count" });
    fireEvent.change(guests, { target: { value: String(GUEST_ENQUIRY_LIMITS.guestCount + 1) } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(guests.checkValidity()).toBe(false);
  });
});

// Review of #405, F1. Enter in the email field sends the form with focus
// already there, so only the alert says what Send found. It is a new alert
// each Send, so a repeated Enter is heard again, for the email's problem and
// the message's alike.
describe("GuestEnquiryModal says again what each Send finds", () => {
  const rooms: VenueDetail = {
    id: "venue-said", name: "Said Rooms", slug: "said-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: false });
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  it.each([
    ["an email the API refuses", "jane@gmail.c", "", "We need a valid email so the events team can reach you"],
    ["a message over the limit", "guest@example.test", "b".repeat(3214), "Messages can be up to 2,000 characters. Yours is 3,214."],
  ])("says %s again on each Enter in the email field", async (_case, address, brief, problem) => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Said Rooms events team.");
    const field = screen.getByLabelText<HTMLInputElement>(/email/iu);
    fireEvent.change(field, { target: { value: address } });
    if (brief !== "") fireEvent.change(screen.getByRole("textbox", { name: "Anything else?" }), { target: { value: brief } });
    pressEnterIn(field);
    const first = screen.getByRole("alert");
    expect(first.textContent).toBe(problem);
    pressEnterIn(field);
    const again = screen.getByRole("alert");
    expect(again.textContent).toBe(problem);
    expect(again, "a new alert, so a screen reader hears it again").not.toBe(first);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

// Blake, 13 November 2026: no event date before today. The planner's form
// sets the date field's min to the guest's own today, so the browser refuses
// an earlier date in its own words. happy-dom does not run that check on a
// date field; a browser does, and min is what it reads.
describe("GuestEnquiryModal's date field", () => {
  const rooms: VenueDetail = {
    id: "venue-dates", name: "Date Rooms", slug: "date-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };
  const zone = process.env["TZ"];

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    mocks.submit.mockResolvedValue({});
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: false });
    // West of Greenwich, where the UTC date is tomorrow by the evening.
    process.env["TZ"] = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) Reflect.deleteProperty(process.env, "TZ");
    else process.env["TZ"] = zone;
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  async function open(): Promise<HTMLInputElement> {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Date Rooms events team.");
    return screen.getByLabelText<HTMLInputElement>("Event date");
  }

  it("takes no date before the guest's own today, which is not the UTC date", async () => {
    // 22:30 on 30 April in California, 05:30 on 1 May in UTC.
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    expect((await open()).min).toBe("2027-04-30");
  });

  it("reads today when Send is pressed, so a form left open past midnight takes the new day", async () => {
    // 23:59:30 on 30 April, local.
    vi.setSystemTime(new Date("2027-05-01T06:59:30Z"));
    const date = await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.change(date, { target: { value: "2027-04-30" } });
    expect(date.min).toBe("2027-04-30");
    // 00:00:30 on 1 May, local, with nothing touched since.
    vi.setSystemTime(new Date("2027-05-01T07:00:30Z"));
    // A browser checks the field against min just before the form's submit
    // event, before anything the form does on Send can draw it again.
    let minAsChecked = "";
    screen.getByTestId("guest-enquiry-form").addEventListener("submit", () => { minAsChecked = date.min; }, { capture: true });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    // 30 April is now yesterday and refused; 1 May, today, is taken.
    expect(minAsChecked).toBe("2027-05-01");
  });
});

// Blake, 12 November 2026: a hidden trap on the public forms. The form sends
// what its hidden field holds and how long it was open before Send; the API
// judges a hit, keeps the enquiry and emails nobody.
describe("GuestEnquiryModal's hidden trap", () => {
  const rooms: VenueDetail = {
    id: "venue-trap", name: "Trap Rooms", slug: "trap-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    mocks.submit.mockResolvedValue({});
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: false });
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  async function open(): Promise<HTMLElement> {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Trap Rooms events team.");
    return screen.getByTestId("guest-enquiry-form");
  }

  it("sends an empty hidden field and how long the form was open before Send", async () => {
    await open();
    act(() => { vi.advanceTimersByTime(5300); });
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ email: "guest@example.test", trap: "", openMs: 5300 }));
    });
  });

  it("sends whatever a script put in the hidden field, whether or not it said so", async () => {
    const form = await open();
    hiddenTrapIn(form).value = "https://example.test/offer";
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ trap: "https://example.test/offer", openMs: 0 }));
    });
  });

  // The form keeps what the guest typed when it is closed (planner-qol
  // E-08), and starts the next plan's enquiry from the contact details they
  // gave last time, so Send at once on opening it again is a person, not a
  // script. The time is then not sent, which the API reads as no hit; the
  // hidden field still is.
  it.each([
    ["a draft kept from an earlier opening", "venviewer.enquiry-draft.cfg-1"],
    ["the contact details of the last send", "venviewer.enquiry-contact"],
  ])("sends no time for a form opened with %s, and still sends the hidden field", async (_case, key) => {
    sessionStorage.setItem(key, JSON.stringify({ email: "guest@example.test" }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await waitFor(() => { expect(mocks.submit).toHaveBeenCalledTimes(1); });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ email: "guest@example.test", trap: "" }));
    // Absent, as JSON sends an undefined field: not posted at all.
    expect(mocks.submit).toHaveBeenCalledWith(expect.not.objectContaining({ openMs: expect.anything() as unknown }));
  });

  it("keeps the hidden field out of a person's reach by eye, keyboard and screen reader, and carries nothing in its attributes that autofill or a password manager reads", async () => {
    const form = await open();
    expectOutOfReach(hiddenTrapIn(form), form);
  });
});

describe("GuestEnquiryModal keeps the guest's work", () => {
  const rooms: VenueDetail = {
    id: "venue-keep", name: "Keep Rooms", slug: "keep-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    mocks.listLinks.mockResolvedValue([]);
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: true });
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  async function open(onClose: () => void = () => { /* noop */ }): Promise<void> {
    render(<GuestEnquiryModal configId="cfg-1" onClose={onClose} />);
    await screen.findByText("Your details are shared only with the Keep Rooms events team.");
  }

  it("keeps what was typed when the form is closed and opened again", async () => {
    const onClose = vi.fn();
    await open(onClose);
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    await open();
    expect(screen.getByLabelText<HTMLInputElement>(/email/iu).value).toBe("guest@example.test");
    expect(screen.getByLabelText<HTMLInputElement>("Guest count").value).toBe("120");
  });

  // Review of #405, F5: a long message is kept whole, and that holds across
  // a close. Restoring the draft cut it at 2,000 without a word, and the next
  // Send went out with the brief stopping mid-sentence.
  it("keeps a long message whole when the form is closed and opened again, and still holds it", async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    const brief = "b".repeat(3214);
    fireEvent.change(screen.getByRole("textbox", { name: "Anything else?" }), { target: { value: brief } });
    fireEvent.click(screen.getByRole("dialog"));
    cleanup();

    await open();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" }).value).toBe(brief);
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Messages can be up to 2,000 characters. Yours is 3,214.");
  });

  it("starts the next send from the contact details given last time, with the sent draft gone", async () => {
    mocks.submit.mockResolvedValue({});
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await screen.findByText("Keep Rooms will reply to");
    cleanup();

    await open();
    expect(screen.getByLabelText<HTMLInputElement>(/email/iu).value).toBe("guest@example.test");
    expect(screen.getByLabelText<HTMLInputElement>("Guest count").value).toBe("");
  });

  it("does not close while the enquiry is on its way, then shows the answer", async () => {
    let arrive!: (value: unknown) => void;
    mocks.submit.mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const onClose = vi.fn();
    await open(onClose);
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(await screen.findByRole("button", { name: "Sending your layout…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    arrive({});
    expect(await screen.findByText("Keep Rooms will reply to")).toBeTruthy();
  });

  // The planner HUD says a plan is sent from this alone (T-723): putting the form away is not sending it.
  it("tells its opener when the enquiry has arrived, and not for a form put away or a send that failed", async () => {
    const onSubmitted = vi.fn();
    const onClose = vi.fn();
    render(<GuestEnquiryModal configId="cfg-1" onClose={onClose} onSubmitted={onSubmitted} />);
    await screen.findByText("Your details are shared only with the Keep Rooms events team.");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();

    mocks.submit.mockRejectedValueOnce(new Error("The events team could not be reached"));
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The events team could not be reached");
    expect(onSubmitted).not.toHaveBeenCalled();

    mocks.submit.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await screen.findByText("Keep Rooms will reply to");
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("takes focus to the answer and announces it", async () => {
    mocks.submit.mockResolvedValue({});
    await open();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    const heading = await screen.findByRole("heading", { name: "Layout sent" });
    await waitFor(() => { expect(document.activeElement).toBe(heading); });
    expect(screen.getAllByRole("status").some((region) => region.textContent === "Layout sent. Keep Rooms will reply to guest@example.test.")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-732 (the release lead's HE10): while the enquiry was on its way, Send's
// ground became half-transparent copper over the dark card, and its words
// ("Sending your layout…", in #111113) read at about 2.6:1, under the 4.5:1
// the house holds words to (WCAG 1.4.3). The ground stays the solid copper
// while sending, and the work shows through the shared activity component
// with its words, as the activity convention asks.
//
// happy-dom paints nothing, so the contrast is computed from the inline
// grounds the button and its ancestors declare, blended from the dialog's
// own overlay up to the button. Whatever the planner draws beneath the
// overlay is taken at its worst, black or white. The ratio is the WCAG 2.x
// one of relative luminances, as client-surface-contrast.test.ts computes it.
// ---------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

/** Every colour named in a declared background or colour, in order (each stop of a gradient). */
function declaredColours(value: string): Rgba[] {
  const found: Rgba[] = [];
  for (const match of value.matchAll(/#([0-9a-f]{6})\b|rgba?\(([^)]*)\)/giu)) {
    const hexDigits = match[1];
    if (hexDigits !== undefined) {
      const pair = (at: number): number => Number.parseInt(hexDigits.slice(at, at + 2), 16);
      found.push([pair(0), pair(2), pair(4), 1]);
      continue;
    }
    const parts = (match[2] ?? "").split(/[\s,/]+/u).filter((part) => part !== "").map(Number);
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined || parts.some(Number.isNaN)) {
      throw new Error(`Not a colour this test reads: ${match[0]}`);
    }
    found.push([r, g, b, a ?? 1]);
  }
  return found;
}

/** `top` painted over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const [r, g, b, a] = top;
  return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The lowest contrast of an element's words against every ground that can be behind them. */
function wordsContrast(element: HTMLElement): number {
  const layers: Rgba[][] = [];
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const stops = declaredColours(node.style.background || node.style.backgroundColor || "");
    if (stops.length > 0) layers.unshift(stops);
    if (node.getAttribute("role") === "dialog") break;
  }
  let grounds: Rgba[] = [[0, 0, 0, 1], [255, 255, 255, 1]];
  for (const stops of layers) grounds = grounds.flatMap((under) => stops.map((stop) => over(stop, under)));
  const [ink] = declaredColours(element.style.color);
  if (ink === undefined || ink[3] !== 1) throw new Error(`Words not in one opaque colour: ${element.style.color}`);
  return Math.min(...grounds.map((ground) => contrast(ink, ground)));
}

describe("GuestEnquiryModal's Send while the enquiry is on its way", () => {
  const rooms: VenueDetail = {
    id: "venue-send", name: "Send Rooms", slug: "send-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getVenue.mockResolvedValue(rooms);
    mocks.listLinks.mockResolvedValue([]);
    useEditorStore.setState({ configId: "cfg-1", venueId: rooms.id, isPublicPreview: true });
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  /** Opens the form and presses Send, with the enquiry held until `settle` is called. */
  async function sendHeld(): Promise<{ readonly button: HTMLElement; readonly settle: { resolve: (value: unknown) => void; reject: (reason: Error) => void } }> {
    const settle = { resolve: (_value: unknown): void => { /* set below */ }, reject: (_reason: Error): void => { /* set below */ } };
    mocks.submit.mockReturnValue(new Promise((resolve, reject) => { settle.resolve = resolve; settle.reject = reject; }));
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText("Your details are shared only with the Send Rooms events team.");
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    const button = await screen.findByRole("button", { name: "Sending your layout…" });
    return { button, settle };
  }

  function sendingAnnouncements(): HTMLElement[] {
    return screen.queryAllByRole("status").filter((region) => region.textContent === "Sending your layout…");
  }

  it("keeps its words at 4.5:1 or more against what is behind them", async () => {
    const { button } = await sendHeld();
    const ratio = wordsContrast(button);
    expect(ratio, `"Sending your layout…" at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the solid copper ground it has when ready", async () => {
    const { button } = await sendHeld();
    const stops = declaredColours(button.style.background || button.style.backgroundColor);
    expect(new Set(stops.map((stop) => `rgba(${stop.join(", ")})`))).toEqual(new Set(["rgba(201, 138, 91, 1)"]));
  });

  it("shows the work through the shared indicator with its words, says it is busy, and announces it politely", async () => {
    const { button } = await sendHeld();
    expect(button.textContent).toBe("Sending your layout…");
    expect(button.querySelector('[data-activity-indicator="particles"]')).not.toBeNull();
    expect(button.getAttribute("aria-busy")).toBe("true");
    const [announcement, ...more] = sendingAnnouncements();
    expect(more).toHaveLength(0);
    expect(announcement?.getAttribute("aria-live")).toBe("polite");
  });

  it("leaves no working state once the enquiry has arrived", async () => {
    const { settle } = await sendHeld();
    settle.resolve({});
    await screen.findByRole("heading", { name: "Layout sent" });
    expect(document.querySelector('[data-activity-indicator="particles"]')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(sendingAnnouncements()).toHaveLength(0);
  });

  it("leaves no working state when the send fails, and Send is ready again", async () => {
    const { settle } = await sendHeld();
    settle.reject(new Error("The events team could not be reached"));
    expect((await screen.findByRole("alert")).textContent).toBe("The events team could not be reached");
    const button = screen.getByRole("button", { name: "Send to Events Team" });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect(document.querySelector('[data-activity-indicator="particles"]')).toBeNull();
    expect(sendingAnnouncements()).toHaveLength(0);
  });
});
