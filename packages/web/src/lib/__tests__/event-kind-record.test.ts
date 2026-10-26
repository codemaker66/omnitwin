import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** A device whose storage refuses every write (a full quota, a locked-down browser). jsdom's own
 *  localStorage keeps a spy on its methods as a stored item, so the whole object is swapped instead. */
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

describe("the open layout's answer", () => {
  it("reads a guest draft's answer from this device and sets the planner's kind", async () => {
    rememberDeviceEventKind("draft", "wedding");
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    expect(question()).toMatchObject({ configId: "draft", guest: true, known: true, answer: "wedding" });
    expect(plannerKind()).toBe("wedding");
  });

  it("leaves a guest draft the device holds nothing for unasked", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    expect(question()).toMatchObject({ known: true, answer: undefined });
    expect(plannerKind()).toBeNull();
  });

  it("takes the address's answer for a guest draft and keeps it on the device", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "?event=corporate" });
    expect(question().answer).toBe("corporate");
    expect(deviceEventKind("draft")).toBe("corporate");
  });

  it("reads a signed-in layout's answer from its metadata, writing nothing", async () => {
    const writeMetadata = vi.fn(() => Promise.resolve());
    await openLayoutEventKind(
      { configId: "mine", isPublicPreview: false, search: "" },
      { readMetadata: () => Promise.resolve({ eventKind: "corporate", instructions: {} }), writeMetadata },
    );
    expect(question()).toMatchObject({ guest: false, known: true, answer: "corporate" });
    expect(plannerKind()).toBe("corporate");
    expect(writeMetadata).not.toHaveBeenCalled();
  });

  it("uses the metadata the caller already holds instead of reading it again", async () => {
    const readMetadata = vi.fn(() => Promise.resolve({}));
    await openLayoutEventKind({ configId: "mine", isPublicPreview: false, search: "", metadata: { eventKind: null } }, { readMetadata });
    expect(question()).toMatchObject({ known: true, answer: null });
    expect(readMetadata).not.toHaveBeenCalled();
  });

  it("gives a claimed draft the answer this device kept for it as a guest's", async () => {
    rememberDeviceEventKind("claimed", "wedding");
    const writeMetadata = vi.fn(() => Promise.resolve());
    await openLayoutEventKind({ configId: "claimed", isPublicPreview: true, search: "" });
    await openLayoutEventKind({ configId: "claimed", isPublicPreview: false, search: "" }, { readMetadata: () => Promise.resolve({}), writeMetadata });
    expect(question()).toMatchObject({ guest: false, answer: "wedding" });
    await vi.waitFor(() => { expect(writeMetadata).toHaveBeenCalledWith("claimed", "wedding"); });
  });

  it("neither asks nor keeps another layout's chair when the answer cannot be read", async () => {
    rememberDeviceEventKind("before", "wedding");
    await openLayoutEventKind({ configId: "before", isPublicPreview: true, search: "" });
    expect(plannerKind()).toBe("wedding");
    await openLayoutEventKind({ configId: "unreadable", isPublicPreview: false, search: "" }, { readMetadata: () => Promise.reject(new Error("offline")) });
    expect(question()).toMatchObject({ configId: "unreadable", known: false, answer: undefined });
    expect(plannerKind()).toBeNull();
  });

  it("drops a slow read for a layout already left", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => { finish = resolve; });
    const first = openLayoutEventKind({ configId: "left", isPublicPreview: false, search: "" }, { readMetadata: () => slow });
    await openLayoutEventKind({ configId: "now", isPublicPreview: true, search: "" });
    finish({ eventKind: "wedding" });
    await first;
    expect(question()).toMatchObject({ configId: "now", answer: undefined });
    expect(plannerKind()).toBeNull();
  });
});

describe("answering", () => {
  it("keeps a guest's answer on this device and gives a receipt", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    answerEventKind("corporate");
    expect(deviceEventKind("draft")).toBe("corporate");
    expect(question()).toMatchObject({ answer: "corporate", unsaved: false, receipt: { answer: "corporate" } });
    expect(plannerKind()).toBe("corporate");
  });

  it("records a skip as null, so the layout is never asked again", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    answerEventKind(null);
    expect(deviceEventKind("draft")).toBeNull();
    expect(question()).toMatchObject({ known: true, answer: null, receipt: { answer: null } });
    expect(plannerKind()).toBeNull();
  });

  it("says a guest's answer holds for this visit only when the device cannot keep it", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    refuseStorage();
    answerEventKind("wedding");
    expect(question()).toMatchObject({ answer: "wedding", unsaved: true });
    expect(plannerKind()).toBe("wedding");
  });

  it("writes a signed-in layout's answer, and tries again once the browser is back online", async () => {
    await openLayoutEventKind({ configId: "mine", isPublicPreview: false, search: "" }, { readMetadata: () => Promise.resolve({}) });
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    const writeMetadata = vi.fn<(configId: string, answer: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue({});
    answerEventKind("wedding", { writeMetadata });
    expect(plannerKind()).toBe("wedding");
    await vi.waitFor(() => { expect(question().unsaved).toBe(true); });
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => { expect(writeMetadata).toHaveBeenCalledTimes(2); });
    await vi.waitFor(() => { expect(question().unsaved).toBe(false); });
    expect(writeMetadata).toHaveBeenLastCalledWith("mine", "wedding");
  });

  it("writes one answer at a time, in the order given", async () => {
    await openLayoutEventKind({ configId: "mine", isPublicPreview: false, search: "" }, { readMetadata: () => Promise.resolve({}) });
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const writeMetadata = vi.fn((_configId: string, answer: unknown): Promise<unknown> => {
      calls.push(`start ${String(answer)}`);
      if (answer === "wedding") return new Promise<void>((resolve) => { release = () => { calls.push("end wedding"); resolve(); }; });
      calls.push(`end ${String(answer)}`);
      return Promise.resolve();
    });
    answerEventKind("wedding", { writeMetadata });
    answerEventKind("corporate", { writeMetadata });
    await vi.waitFor(() => { expect(calls).toEqual(["start wedding"]); });
    release();
    await vi.waitFor(() => { expect(calls).toEqual(["start wedding", "end wedding", "start corporate", "end corporate"]); });
    expect(question().answer).toBe("corporate");
  });

  it("opens a change and closes it again without touching the answer", async () => {
    await openLayoutEventKind({ configId: "draft", isPublicPreview: true, search: "" });
    answerEventKind("other");
    changeEventKind();
    expect(question()).toMatchObject({ changing: true, receipt: null, answer: "other" });
    keepEventKind();
    expect(question()).toMatchObject({ changing: false, answer: "other" });
  });
});
