import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { HallkeeperSheetV2Schema, type HallkeeperSheetV2 } from "@omnitwin/types";
import { HallkeeperPage } from "../HallkeeperPage.js";
import {
  ackProgress,
  enqueueProgress,
  listPendingProgress,
  QUEUE_RETRY_MS,
  SHARED_CHECKS_REFRESH_MS,
} from "../../lib/progress-sync-queue.js";

// ---------------------------------------------------------------------------
// The hallkeeper sheet's ticks, through its real offline queue.
//
// Nothing of the queue is mocked here: a tap that cannot reach the server is
// written to the queue the sheet ships with (in memory under happy-dom, which
// has no IndexedDB), and the "server" below keeps one set of ticked rows per
// sheet, as the API's idempotent set-state PATCH does. What is asserted is
// what the venue would see: which writes reached the server, in which order,
// and what the server holds at the end.
// ---------------------------------------------------------------------------

vi.mock("../../api/client.js", () => ({ getAuthToken: vi.fn().mockResolvedValue(null) }));
vi.mock("../../components/hallkeeper/HallkeeperStatusBanner.js", () => ({ HallkeeperStatusBanner: () => null }));
vi.mock("../../components/hallkeeper/useHallkeeperContext.js", () => ({
  useHallkeeperContext: () => ({ status: "idle", context: null, error: null, retry: vi.fn() }),
}));

const CONFIG_A = "00000000-0000-4000-8000-00000000000a";
const CONFIG_B = "00000000-0000-4000-8000-00000000000b";
const ROW_KEY = "furniture|Centre|Round table|0";
const OTHER_ROW_KEY = "furniture|Centre|Lectern|0";
const ONE_PENDING = "1 offline edit pending sync";

function sheet(configId: string, name: string): HallkeeperSheetV2 {
  return HallkeeperSheetV2Schema.parse({
    config: { id: configId, name, guestCount: 8, layoutStyle: "dinner-rounds" },
    venue: { name: "Test venue", address: "Test address", timezone: "Europe/London" },
    space: { name: "Test room", widthM: 21, lengthM: 10.5, heightM: 6 },
    timing: null,
    instructions: null,
    phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
      key: ROW_KEY, name: "Round table", category: "table", qty: 1,
      afterDepth: 0, isAccessory: false, notes: "",
    }, {
      key: OTHER_ROW_KEY, name: "Lectern", category: "other", qty: 1,
      afterDepth: 0, isAccessory: false, notes: "",
    }] }] }],
    totals: { entries: [], totalRows: 2, totalItems: 2 },
    diagramUrl: null,
    floorPlan: null,
    webViewUrl: `https://example.test/hallkeeper/${configId}`,
    generatedAt: "2026-09-07T08:00:00.000Z",
    approval: null,
  });
}

interface Write {
  readonly configId: string;
  readonly rowKey: string;
  readonly checked: boolean;
}

/** What the server does with a write or a read: take it, or answer otherwise. */
type Answer = "take" | Response;

interface VenueServer {
  /** Every write that reached the server, in the order it arrived. */
  readonly writes: Write[];
  /** How many times the shared checks were read. */
  readonly reads: () => number;
  /** Is this row ticked on the server? */
  readonly ticked: (configId: string, rowKey?: string) => boolean;
  /** Another hallkeeper's device sets a row. */
  readonly set: (configId: string, rowKey: string, checked: boolean) => void;
}

function unavailable(): Response {
  return new Response(null, { status: 503 });
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

/**
 * The API, as far as ticks go. A write the server takes sets the row and
 * answers 200; `onWrite` and `onRead` may answer otherwise (a 503, a held
 * reply) for the nth write or read.
 */
function serve(handlers: {
  readonly onWrite?: (write: Write, nth: number) => Answer | Promise<Answer>;
  readonly onRead?: (configId: string, nth: number) => Answer | Promise<Answer>;
} = {}): VenueServer {
  const ticks = new Set<string>();
  const writes: Write[] = [];
  let reads = 0;
  const key = (configId: string, rowKey: string): string => `${configId}|${rowKey}`;
  const json = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });
  const checkedOf = (configId: string): Record<string, string> => {
    const checked: Record<string, string> = {};
    for (const tick of ticks) {
      if (tick.startsWith(`${configId}|`)) checked[tick.slice(configId.length + 1)] = "2026-09-07T08:00:00.000Z";
    }
    return checked;
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const configId = /\/hallkeeper\/([0-9a-f-]{36})\//u.exec(url)?.[1];
    if (configId === undefined) throw new Error(`Unexpected request: ${url}`);
    if (url.endsWith("/v2")) return json(sheet(configId, configId === CONFIG_A ? "First dinner" : "Second dinner"));
    if (!url.endsWith("/progress")) throw new Error(`Unexpected request: ${url}`);
    if (init?.method === "PATCH") {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as { rowKey: string; checked: boolean };
      const write: Write = { configId, rowKey: body.rowKey, checked: body.checked };
      writes.push(write);
      const answer = await (handlers.onWrite?.(write, writes.length) ?? "take");
      if (answer !== "take") return answer;
      if (write.checked) ticks.add(key(configId, write.rowKey));
      else ticks.delete(key(configId, write.rowKey));
      return json({ configId, eventId: null, rowKey: write.rowKey, checked: write.checked });
    }
    reads += 1;
    const answer = await (handlers.onRead?.(configId, reads) ?? "take");
    if (answer !== "take") return answer;
    return json({ configId, eventId: null, linkedEvents: 0, checked: checkedOf(configId) });
  }));
  return {
    writes,
    reads: () => reads,
    ticked: (configId, rowKey = ROW_KEY) => ticks.has(key(configId, rowKey)),
    set: (configId, rowKey, checked) => {
      if (checked) ticks.add(key(configId, rowKey));
      else ticks.delete(key(configId, rowKey));
    },
  };
}

function mount(): void {
  render(<MemoryRouter initialEntries={[`/hallkeeper/${CONFIG_A}`]}>
    <Link to={`/hallkeeper/${CONFIG_A}`}>Open first sheet</Link>
    <Link to={`/hallkeeper/${CONFIG_B}`}>Open second sheet</Link>
    <Routes><Route path="/hallkeeper/:configId" element={<HallkeeperPage />} /></Routes>
  </MemoryRouter>);
}

function row(checked: boolean): Promise<HTMLElement> {
  return screen.findByRole("checkbox", { name: /Round table/u, checked });
}

function lectern(checked: boolean): Promise<HTMLElement> {
  return screen.findByRole("checkbox", { name: /Lectern/u, checked });
}

/** The API's answer to a read of the shared checks, made by hand. */
function checksAnswer(checkedRows: readonly string[], scope: { eventId: string | null; linkedEvents: number } = { eventId: null, linkedEvents: 0 }): Response {
  const checked: Record<string, string> = {};
  for (const rowKey of checkedRows) checked[rowKey] = "2026-09-07T08:00:00.000Z";
  return new Response(JSON.stringify({ data: { configId: CONFIG_A, ...scope, checked } }), { status: 200 });
}

/**
 * The page is shown again: the phone is unlocked, or the tab comes to the front.
 *
 * One turn of the event loop passes first. The page hears this through
 * listeners its effects attach, and React runs a commit's effects a turn later
 * whenever that commit's task ran past the scheduler's 5 ms. A test resumed
 * the moment a row appears can be ahead of them, and an event sent then
 * reaches nobody: the next read is a whole refresh away, long after the wait
 * has given up (CI, 11 November 2026: "expected 1 to be greater than 1").
 * HallkeeperPage.release.test.tsx meets the same gap in comeBackOnline, by
 * sending until one lands; here each case needs exactly one read, so it waits.
 */
async function showAgain(): Promise<void> {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

/** Long enough for anything already set in motion to reach the server. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 40); }); });
}

async function queueIsEmpty(): Promise<void> {
  await waitFor(async () => { expect(await listPendingProgress()).toEqual([]); });
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const queued of await listPendingProgress()) await ackProgress(queued.configId, queued.rowKey, queued.eventId ?? null);
});

// Audit hallkeeper-web-1: the server keeps the last write it hears for a row,
// so this device must send a row's ticks in the order they were made and
// never send an older one after a newer one.
describe("a row's ticks reach the server in the order they were made", () => {
  it("never replays a queued tick over a later untick the server took", async () => {
    // The tick meets a 503 (an API restart: the WiFi never dropped) and waits
    // in the queue. The untick, seconds later, gets through.
    const server = serve({ onWrite: (_write, nth) => (nth === 1 ? unavailable() : "take") });
    mount();
    fireEvent.click(await row(false));
    await screen.findByRole("status", { name: ONE_PENDING });
    fireEvent.click(await row(true));
    await waitFor(() => { expect(server.writes).toHaveLength(2); });

    // The next sync (here, the device coming back online) has nothing to send.
    act(() => { window.dispatchEvent(new Event("online")); });
    await queueIsEmpty();
    await settle();

    expect(server.writes.map((write) => write.checked)).toEqual([true, false]);
    expect(server.ticked(CONFIG_A)).toBe(false);
    expect((await row(false)).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("status", { name: ONE_PENDING })).toBeNull();
  });

  it("sends two quick taps on one row one after the other, never side by side", async () => {
    const firstReply = deferred<Answer>();
    const server = serve({ onWrite: (_write, nth) => (nth === 1 ? firstReply.promise : "take") });
    mount();
    const checkbox = await row(false);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    await waitFor(() => { expect(server.writes).toHaveLength(1); });
    await settle();
    // The untick waits for the tick's answer: sent side by side, either could
    // be the one the server hears last.
    expect(server.writes).toEqual([{ configId: CONFIG_A, rowKey: ROW_KEY, checked: true }]);

    await act(async () => { firstReply.resolve("take"); await firstReply.promise; });
    await waitFor(() => { expect(server.writes).toHaveLength(2); });
    await waitFor(() => { expect(screen.queryByText("Saving shared checks…")).toBeNull(); });
    expect(server.writes.map((write) => write.checked)).toEqual([true, false]);
    expect(server.ticked(CONFIG_A)).toBe(false);
  });

  it("holds a tap on a row until a replay under way for that row has settled", async () => {
    // A tick from an earlier visit is still queued. Its replay is on its way
    // when the hallkeeper taps the same row.
    let refuse = true;
    const replayReply = deferred<Answer>();
    const server = serve({ onWrite: (_write, nth) => (refuse ? unavailable() : nth === 2 ? replayReply.promise : "take") });
    mount();
    fireEvent.click(await row(false));
    await screen.findByRole("status", { name: ONE_PENDING });
    refuse = false;
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => { expect(server.writes).toHaveLength(2); });

    fireEvent.click(await row(true));
    await settle();
    expect(server.writes).toHaveLength(2);

    await act(async () => { replayReply.resolve("take"); await replayReply.promise; });
    await waitFor(() => { expect(server.writes).toHaveLength(3); });
    await queueIsEmpty();
    await settle();
    expect(server.writes.map((write) => write.checked)).toEqual([true, true, false]);
    expect(server.ticked(CONFIG_A)).toBe(false);
  });

  it("keeps a newer queued untick when the server turns out to hold the older tick already", async () => {
    // The tick is queued on a 503. Another hallkeeper ticks the same row, so
    // the next sync finds the server already agrees with the queued tick.
    // While that sync is reading the server, this hallkeeper unticks the row
    // and that write is queued too: it is the newer word and must survive.
    let serverDown = true;
    const syncRead = deferred<Answer>();
    let holdReads = false;
    const server = serve({
      onWrite: () => (serverDown ? unavailable() : "take"),
      onRead: () => (holdReads ? syncRead.promise : "take"),
    });
    mount();
    fireEvent.click(await row(false));
    await screen.findByRole("status", { name: ONE_PENDING });
    server.set(CONFIG_A, ROW_KEY, true);

    holdReads = true;
    const readsBefore = server.reads();
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => { expect(server.reads()).toBeGreaterThan(readsBefore); });
    fireEvent.click(await row(true));
    await waitFor(() => { expect(server.writes).toHaveLength(2); });
    await settle();

    holdReads = false;
    await act(async () => { syncRead.resolve("take"); await syncRead.promise; });
    await settle();
    expect(await listPendingProgress()).toEqual([
      expect.objectContaining({ configId: CONFIG_A, rowKey: ROW_KEY, desiredChecked: false }),
    ]);

    // Once the server is back the untick is what it ends up holding.
    serverDown = false;
    act(() => { window.dispatchEvent(new Event("online")); });
    await queueIsEmpty();
    await settle();
    expect(server.ticked(CONFIG_A)).toBe(false);
    expect((await row(false)).getAttribute("aria-checked")).toBe("false");
  });
});

// Audit hallkeeper-web-3: a tick queued on a 5xx or a blip has no "online"
// event to wait for, and a tick queued on one room's sheet must not wait for
// that same sheet to be opened again on that same device.
describe("ticks that are waiting get sent", () => {
  it("tries a tick queued on a server blip again, with no reconnect to wait for", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let serverDown = true;
    const server = serve({ onWrite: () => (serverDown ? unavailable() : "take") });
    mount();
    fireEvent.click(await row(false));
    const badge = await screen.findByRole("status", { name: ONE_PENDING });
    // The WiFi never dropped, so the badge must not say it is waiting for WiFi.
    expect(badge.textContent).not.toMatch(/wi-?fi/iu);

    serverDown = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS); });
    await waitFor(() => { expect(screen.queryByRole("status", { name: ONE_PENDING })).toBeNull(); });
    expect(server.ticked(CONFIG_A)).toBe(true);
    expect(await listPendingProgress()).toEqual([]);
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");
  });

  it("tries again when the sheet is shown again", async () => {
    let serverDown = true;
    const server = serve({ onWrite: () => (serverDown ? unavailable() : "take") });
    mount();
    fireEvent.click(await row(false));
    await screen.findByRole("status", { name: ONE_PENDING });

    serverDown = false;
    // The phone is unlocked, or the tab comes back to the front.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(screen.queryByRole("status", { name: ONE_PENDING })).toBeNull(); });
    expect(server.ticked(CONFIG_A)).toBe(true);
    expect(await listPendingProgress()).toEqual([]);
  });

  it("sends ticks waiting for another room's sheet from whichever sheet is open", async () => {
    // Queued on the second room's sheet earlier today; that sheet is closed.
    await enqueueProgress(CONFIG_B, ROW_KEY, true, null);
    const server = serve();
    mount();
    await row(false);
    await queueIsEmpty();
    expect(server.writes).toEqual([{ configId: CONFIG_B, rowKey: ROW_KEY, checked: true }]);
    expect(server.ticked(CONFIG_B)).toBe(true);
    // The open sheet's own row is nobody's to tick but the hallkeeper's.
    expect(server.ticked(CONFIG_A)).toBe(false);
    expect((await row(false)).getAttribute("aria-checked")).toBe("false");
  });

  it("still sends a room's waiting ticks after the hallkeeper has moved to another room's sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let serverDown = true;
    const server = serve({ onWrite: () => (serverDown ? unavailable() : "take") });
    mount();
    fireEvent.click(await row(false));
    await screen.findByRole("status", { name: ONE_PENDING });

    fireEvent.click(screen.getByRole("link", { name: "Open second sheet" }));
    await screen.findByText("Second dinner", { exact: true, selector: "p" });
    await row(false);
    // The badge counts the open sheet's ticks, and this one is the first room's.
    await waitFor(() => { expect(screen.queryByRole("status", { name: ONE_PENDING })).toBeNull(); });
    expect(await listPendingProgress()).toHaveLength(1);

    serverDown = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS); });
    await queueIsEmpty();
    expect(server.ticked(CONFIG_A)).toBe(true);
    expect(server.ticked(CONFIG_B)).toBe(false);
  });
});

// Audit hallkeeper-web-7: the checks are shared, so an open sheet reads them
// again (on a timer while in view, when shown again, when back online, after
// a sync) and never lets a read undo what this hallkeeper has just done.
describe("an open sheet keeps up with the shared checks", () => {
  const printedCount = (): string => document.querySelector(".hk-print-only")?.textContent ?? "";

  it("shows another hallkeeper's ticks within a minute, on screen and on the print copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = serve();
    mount();
    await row(false);
    expect(printedCount()).toContain("0 of 2 setup rows checked");

    server.set(CONFIG_A, ROW_KEY, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(SHARED_CHECKS_REFRESH_MS); });
    await row(true);
    expect(printedCount()).toContain("1 of 2 setup rows checked");

    // And their untick.
    server.set(CONFIG_A, ROW_KEY, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(SHARED_CHECKS_REFRESH_MS); });
    await row(false);
  });

  it("reads again when the sheet is shown again and when the device comes back online", async () => {
    const server = serve();
    mount();
    await row(false);

    server.set(CONFIG_A, ROW_KEY, true);
    await showAgain();
    await row(true);

    server.set(CONFIG_A, OTHER_ROW_KEY, true);
    act(() => { window.dispatchEvent(new Event("online")); });
    await lectern(true);
  });

  it("does not read while the page is out of view, and catches up when it is shown again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = serve();
    mount();
    await row(false);

    const outOfView = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const readsBefore = server.reads();
      server.set(CONFIG_A, ROW_KEY, true);
      await act(async () => { await vi.advanceTimersByTimeAsync(SHARED_CHECKS_REFRESH_MS * 2); });
      expect(server.reads()).toBe(readsBefore);
    } finally {
      outOfView.mockRestore();
    }
    await showAgain();
    await row(true);
  });

  it("leaves a row the hallkeeper is saving as they left it, and still brings in the others", async () => {
    const read = deferred<Answer>();
    const write = deferred<Answer>();
    let hold = false;
    const server = serve({ onRead: () => (hold ? read.promise : "take"), onWrite: () => write.promise });
    mount();
    await row(false);

    // A read is on its way when the hallkeeper ticks the round tables; their
    // write has not landed when the server answers, and a colleague has
    // ticked the lectern.
    hold = true;
    const readsBefore = server.reads();
    await showAgain();
    await waitFor(() => { expect(server.reads()).toBeGreaterThan(readsBefore); });
    fireEvent.click(await row(false));
    server.set(CONFIG_A, OTHER_ROW_KEY, true);
    hold = false;
    await act(async () => { read.resolve("take"); await read.promise; });

    await lectern(true);
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");
    await act(async () => { write.resolve("take"); await write.promise; });
    await waitFor(() => { expect(screen.queryByText("Saving shared checks…")).toBeNull(); });
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");
  });

  it("does not undo a tick with an answer the server gave before the tick reached it", async () => {
    const lateAnswer = deferred<Answer>();
    let hold = false;
    const server = serve({ onRead: () => (hold ? lateAnswer.promise : "take") });
    mount();
    await row(false);

    hold = true;
    const readsBefore = server.reads();
    await showAgain();
    await waitFor(() => { expect(server.reads()).toBeGreaterThan(readsBefore); });
    fireEvent.click(await row(false));
    await waitFor(() => { expect(server.ticked(CONFIG_A)).toBe(true); });
    await waitFor(() => { expect(screen.queryByText("Saving shared checks…")).toBeNull(); });
    hold = false;
    // The answer was made before the tick arrived, and comes in after it.
    await act(async () => { lateAnswer.resolve(checksAnswer([])); await lateAnswer.promise; });
    await settle();
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");

    // The next read agrees with the hallkeeper.
    await showAgain();
    await settle();
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");
  });
});

describe("ticks still waiting to be sent stand on the sheet", () => {
  it("shows them when the sheet is opened again, and through a fresh read of the shared checks", async () => {
    // Ticked on an earlier visit while the server was down; it still is.
    await enqueueProgress(CONFIG_A, ROW_KEY, true, null);
    const server = serve({ onWrite: () => unavailable() });
    mount();
    await row(true);
    await screen.findByRole("status", { name: ONE_PENDING });
    expect(server.ticked(CONFIG_A)).toBe(false);

    const readsBefore = server.reads();
    await showAgain();
    await waitFor(() => { expect(server.reads()).toBeGreaterThan(readsBefore); });
    await settle();
    expect((await row(true)).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status", { name: ONE_PENDING })).toBeTruthy();
  });

  it("takes a tick the server refuses for good back off the sheet", async () => {
    await enqueueProgress(CONFIG_A, ROW_KEY, true, null);
    serve({ onWrite: () => new Response(null, { status: 403 }) });
    mount();
    await queueIsEmpty();
    await row(false);
    expect(screen.queryByRole("status", { name: ONE_PENDING })).toBeNull();
  });

  it("ignores an answer about another event's ticks: the sheet's own stay where its first read put them", async () => {
    // The layout had no event when the sheet was opened. A booking is linked
    // to it mid-setup, and the server now answers with that event's ticks.
    let linked = false;
    const server = serve({
      onRead: () => (linked ? checksAnswer([ROW_KEY], { eventId: "00000000-0000-4000-8000-0000000000e1", linkedEvents: 1 }) : "take"),
    });
    mount();
    await row(false);

    linked = true;
    const readsBefore = server.reads();
    await showAgain();
    await waitFor(() => { expect(server.reads()).toBeGreaterThan(readsBefore); });
    await settle();
    expect((await row(false)).getAttribute("aria-checked")).toBe("false");
  });
});
