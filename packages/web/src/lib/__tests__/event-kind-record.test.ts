import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import {
  DEVICE_RECORD_LIMIT,
  EVENT_KIND_WORDS,
  answerEventKind,
  changeEventKind,
  deviceAsksEventKind,
  deviceEventKind,
  eventKindFromSearch,
  keepEventKind,
  layOutStyleFor,
  openLayoutEventKind,
  readDeviceRecord,
  rememberDeviceEventKind,
  resetEventKindQuestionForTesting,
  shouldAskEventKind,
  storedEventKind,
  useEventKindQuestion,
  type EventKindQuestionFacts,
} from "../event-kind-record.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";

const KEY = "venviewer.planner.eventKind";

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

const realStorage = window.localStorage;

/** A device whose storage refuses every write (a full quota, a locked-down browser). happy-dom keeps a spy on
 *  its localStorage methods as a stored item, so the whole object is swapped instead. */
function refuseStorage(): void {
  const refusing: Storage = {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => { throw new Error("quota"); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: refusing });
}

const question = (): ReturnType<typeof useEventKindQuestion.getState> => useEventKindQuestion.getState();
const plannerKind = (): ReturnType<typeof usePlannerEventStore.getState>["eventKind"] => usePlannerEventStore.getState().eventKind;

/** A guest's draft as editor-store's load hands it over. */
function openDraft(configId = "draft", search = ""): void {
  openLayoutEventKind({ configId, isPublicPreview: true, search, metadata: null });
}

/** A signed-in layout as editor-store's load hands it over, with the metadata it holds. */
function openOwn(configId: string, metadata: unknown, write?: (configId: string, answer: unknown) => Promise<unknown>, search = ""): void {
  openLayoutEventKind({ configId, isPublicPreview: false, search, metadata }, write === undefined ? {} : { writeMetadata: write });
}

beforeEach(() => {
  window.localStorage.clear();
  resetEventKindQuestionForTesting();
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: realStorage });
  vi.restoreAllMocks();
  setOnline(true);
  window.dispatchEvent(new Event("online"));
  resetEventKindQuestionForTesting();
});

describe("a layout's stored answer", () => {
  it("reads a kind, a skip, or nothing", () => {
    expect(storedEventKind({ eventKind: "wedding" })).toBe("wedding");
    expect(storedEventKind({ eventKind: null })).toBeNull();
    expect(storedEventKind({ instructions: {} })).toBeUndefined();
    expect(storedEventKind({ eventKind: "gala" })).toBeUndefined();
    expect(storedEventKind(null)).toBeUndefined();
    expect(storedEventKind("wedding")).toBeUndefined();
  });

  it("takes an answer from the address only when it is one of the kinds", () => {
    expect(eventKindFromSearch("?space=grand-hall&event=corporate")).toBe("corporate");
    expect(eventKindFromSearch("?event=Wedding")).toBeUndefined();
    expect(eventKindFromSearch("")).toBeUndefined();
  });
});

describe("this device's record", () => {
  it("keeps answers newest first, one per layout, the latest 200", () => {
    for (let index = 0; index < DEVICE_RECORD_LIMIT + 5; index += 1) rememberDeviceEventKind(`layout-${String(index)}`, "other");
    rememberDeviceEventKind("layout-3", "wedding");
    const { entries } = readDeviceRecord();
    expect(entries).toHaveLength(DEVICE_RECORD_LIMIT);
    expect(entries[0]).toEqual({ configId: "layout-3", kind: "wedding" });
    expect(deviceEventKind("layout-4")).toBeUndefined();
    expect(deviceEventKind("layout-204")).toBe("other");
  });

  it("keeps a skip as null, apart from never asked", () => {
    rememberDeviceEventKind("skipped", null);
    expect(deviceEventKind("skipped")).toBeNull();
    expect(deviceEventKind("never-asked")).toBeUndefined();
  });

  it("reads a damaged record as empty and drops entries that are not answers", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readDeviceRecord().entries).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({ version: 2, entries: [{ configId: "a", kind: "wedding" }] }));
    expect(readDeviceRecord().entries).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      entries: [{ configId: "a", kind: "gala" }, { configId: "", kind: "other" }, { configId: "b", kind: "corporate" }, { configId: "b", kind: "wedding" }, "x", null],
    }));
    expect(readDeviceRecord().entries).toEqual([{ configId: "b", kind: "corporate" }]);
  });

  it("says so when the device cannot keep an answer", () => {
    refuseStorage();
    expect(rememberDeviceEventKind("draft", "wedding")).toBe(false);
  });

  it("asks unless this device was told not to, and remembers being told", () => {
    expect(deviceAsksEventKind("")).toBe(true);
    expect(deviceAsksEventKind("?event-question=off")).toBe(false);
    expect(deviceAsksEventKind("")).toBe(false);
    rememberDeviceEventKind("kept", "other");
    expect(deviceAsksEventKind("?event-question=on")).toBe(true);
    expect(deviceAsksEventKind("")).toBe(true);
    expect(deviceEventKind("kept")).toBe("other");
  });
});

describe("when the planner asks, and what an answer sets", () => {
  const ask: EventKindQuestionFacts = { editable: true, floorEmpty: true, eventLinked: false, known: true, answer: undefined, deviceAsks: true };

  it("asks a new, empty layout that nothing has answered for", () => {
    expect(shouldAskEventKind(ask)).toBe(true);
  });

  it.each<[string, Partial<EventKindQuestionFacts>]>([
    ["the layout is locked or previewing a phase", { editable: false }],
    ["something is on the floor", { floorEmpty: false }],
    ["it was opened from an event", { eventLinked: true }],
    ["its answer is still being read", { known: false }],
    ["it was answered", { answer: "wedding" }],
    ["it was skipped", { answer: null }],
    ["the device was told not to ask", { deviceAsks: false }],
  ])("never asks when %s", (_, change) => {
    expect(shouldAskEventKind({ ...ask, ...change })).toBe(false);
  });

  it("starts Lay out with rows for a corporate event and round tables otherwise", () => {
    expect(layOutStyleFor("corporate")).toBe("theatre");
    expect(layOutStyleFor("wedding")).toBe("dinner-rounds");
    expect(layOutStyleFor("other")).toBe("dinner-rounds");
    expect(layOutStyleFor(null)).toBe("dinner-rounds");
    expect(layOutStyleFor(undefined)).toBe("dinner-rounds");
  });

  it("names the chair each kind sets", () => {
    expect(EVENT_KIND_WORDS.wedding.line).toMatch(/gold Chiavari chairs/u);
    expect(EVENT_KIND_WORDS.corporate.line).toMatch(/venue's pink chairs/u);
    expect(EVENT_KIND_WORDS.other.line).toMatch(/venue's pink chairs/u);
  });
});

describe("a guest's draft as it opens", () => {
  it("takes this device's answer and sets the planner's kind", () => {
    rememberDeviceEventKind("draft", "wedding");
    openDraft();
    expect(question()).toMatchObject({ configId: "draft", guest: true, known: true, answer: "wedding", save: "kept" });
    expect(plannerKind()).toBe("wedding");
  });

  it("is unasked when the device holds nothing for it", () => {
    openDraft();
    expect(question()).toMatchObject({ known: true, answer: undefined });
    expect(plannerKind()).toBeNull();
  });

  it("takes the address's answer when it has none, and keeps it on the device", () => {
    openDraft("draft", "?event=corporate");
    expect(question().answer).toBe("corporate");
    expect(deviceEventKind("draft")).toBe("corporate");
  });

  it("never lets the address override an answer it already has", () => {
    rememberDeviceEventKind("draft", "corporate");
    openDraft("draft", "?event=wedding");
    expect(question().answer).toBe("corporate");
    expect(deviceEventKind("draft")).toBe("corporate");
    expect(plannerKind()).toBe("corporate");
  });
});

describe("a signed-in layout as it opens", () => {
  it("takes the answer it holds, writing nothing", () => {
    const write = vi.fn(() => Promise.resolve());
    openOwn("mine", { eventKind: "corporate", instructions: {} }, write);
    expect(question()).toMatchObject({ guest: false, known: true, answer: "corporate", save: "kept" });
    expect(plannerKind()).toBe("corporate");
    expect(write).not.toHaveBeenCalled();
  });

  it("is set before the load returns: no seat can take another event's chair in between", () => {
    rememberDeviceEventKind("before", "wedding");
    openDraft("before");
    expect(plannerKind()).toBe("wedding");
    openOwn("next", { eventKind: "corporate" });
    expect(plannerKind()).toBe("corporate");
    openOwn("third", null);
    expect(question()).toMatchObject({ configId: "third", answer: undefined });
    expect(plannerKind()).toBeNull();
  });

  it("never takes the address: a link cannot change a layout's event, and opening writes nothing", () => {
    const write = vi.fn(() => Promise.resolve());
    openOwn("mine", { eventKind: "corporate" }, write, "?event=wedding");
    expect(question().answer).toBe("corporate");
    openOwn("unanswered", {}, write, "?event=wedding");
    expect(question().answer).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("is given the answer this device kept for it as a guest's draft, claimed since", async () => {
    rememberDeviceEventKind("claimed", "wedding");
    const write = vi.fn(() => Promise.resolve());
    openOwn("claimed", {}, write);
    expect(question()).toMatchObject({ guest: false, answer: "wedding" });
    await vi.waitFor(() => { expect(write).toHaveBeenCalledWith("claimed", "wedding"); });
  });

  it("keeps an answer still waiting to be written when the same layout loads again, and writes it again", async () => {
    openOwn("mine", {});
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    const write = vi.fn<(configId: string, answer: unknown) => Promise<unknown>>().mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    answerEventKind("wedding", { writeMetadata: write });
    await vi.waitFor(() => { expect(question().save).toBe("retrying"); });
    // A reload of the server's copy (a save conflict) holds no answer yet.
    openOwn("mine", {}, write);
    expect(question()).toMatchObject({ answer: "wedding", save: "retrying" });
    expect(plannerKind()).toBe("wedding");
    await vi.waitFor(() => { expect(write).toHaveBeenCalledTimes(2); });
  });

  it("lets the layout's own answer stand over one this tab could not write", async () => {
    openOwn("theirs", {});
    const refusedWrite = vi.fn(() => Promise.reject(new ApiError(403, "Insufficient permissions", "FORBIDDEN")));
    answerEventKind("wedding", { writeMetadata: refusedWrite });
    await vi.waitFor(() => { expect(question().save).toBe("this-visit"); });
    openOwn("theirs", {});
    expect(question()).toMatchObject({ answer: "wedding", save: "this-visit" });
    openOwn("theirs", { eventKind: "corporate" });
    expect(question()).toMatchObject({ answer: "corporate", save: "kept" });
  });
});

describe("answering", () => {
  it("keeps a guest's answer on this device and gives a receipt", () => {
    openDraft();
    answerEventKind("corporate");
    expect(deviceEventKind("draft")).toBe("corporate");
    expect(question()).toMatchObject({ answer: "corporate", save: "kept", receipt: { answer: "corporate" } });
    expect(plannerKind()).toBe("corporate");
  });

  it("records a skip as null, so the layout is never asked again", () => {
    openDraft();
    answerEventKind(null);
    expect(deviceEventKind("draft")).toBeNull();
    expect(question()).toMatchObject({ known: true, answer: null, receipt: { answer: null } });
    expect(plannerKind()).toBeNull();
  });

  it("holds a guest's answer for this visit when the device cannot keep it", () => {
    openDraft();
    refuseStorage();
    answerEventKind("wedding");
    expect(question()).toMatchObject({ answer: "wedding", save: "this-visit" });
    expect(plannerKind()).toBe("wedding");
  });

  it("writes a signed-in layout's answer, and tries again once the browser is back online", async () => {
    openOwn("mine", {});
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    const write = vi.fn<(configId: string, answer: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"))
      .mockResolvedValue({});
    answerEventKind("wedding", { writeMetadata: write });
    expect(plannerKind()).toBe("wedding");
    await vi.waitFor(() => { expect(question().save).toBe("retrying"); });
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => { expect(write).toHaveBeenCalledTimes(2); });
    await vi.waitFor(() => { expect(question().save).toBe("kept"); });
    expect(write).toHaveBeenLastCalledWith("mine", "wedding");
  });

  it("holds a refused answer for this visit and does not try again (no permission to write)", async () => {
    openOwn("theirs", {});
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    const write = vi.fn(() => Promise.reject(new ApiError(403, "Insufficient permissions", "FORBIDDEN")));
    answerEventKind("other", { writeMetadata: write });
    await vi.waitFor(() => { expect(question().save).toBe("this-visit"); });
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(plannerKind()).toBe("other");
  });

  it("writes one answer at a time, in the order given", async () => {
    openOwn("mine", {});
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const write = vi.fn((_configId: string, answer: unknown): Promise<unknown> => {
      calls.push(`start ${String(answer)}`);
      if (answer === "wedding") return new Promise<void>((resolve) => { release = () => { calls.push("end wedding"); resolve(); }; });
      calls.push(`end ${String(answer)}`);
      return Promise.resolve();
    });
    answerEventKind("wedding", { writeMetadata: write });
    answerEventKind("corporate", { writeMetadata: write });
    await vi.waitFor(() => { expect(calls).toEqual(["start wedding"]); });
    release();
    await vi.waitFor(() => { expect(calls).toEqual(["start wedding", "end wedding", "start corporate", "end corporate"]); });
    expect(question()).toMatchObject({ answer: "corporate", save: "kept" });
  });

  it("opens a change and closes it again without touching the answer", () => {
    openDraft();
    answerEventKind("other");
    changeEventKind();
    expect(question()).toMatchObject({ changing: true, receipt: null, answer: "other" });
    keepEventKind();
    expect(question()).toMatchObject({ changing: false, answer: "other" });
  });
});
