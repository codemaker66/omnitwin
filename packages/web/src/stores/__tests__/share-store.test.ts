import { afterEach, describe, expect, it } from "vitest";
import { useShareStore } from "../share-store.js";

afterEach(() => { useShareStore.getState().reset(); });

describe("share-store", () => {
  it("starts blank", () => {
    const s = useShareStore.getState();
    expect(s.eventTitle).toBe("");
    expect(s.clientMessage).toBe("");
    expect(s.lastShareUrl).toBeNull();
  });

  it("sets the editable title, message and last share URL", () => {
    useShareStore.getState().setEventTitle("Autumn Gala");
    useShareStore.getState().setClientMessage("Looking forward to hosting you.");
    useShareStore.getState().setLastShareUrl("https://example.com/proposal-share/abc");
    const s = useShareStore.getState();
    expect(s.eventTitle).toBe("Autumn Gala");
    expect(s.clientMessage).toBe("Looking forward to hosting you.");
    expect(s.lastShareUrl).toBe("https://example.com/proposal-share/abc");
  });

  it("reset restores the blank state", () => {
    useShareStore.getState().setEventTitle("X");
    useShareStore.getState().setLastShareUrl("https://example.com/y");
    useShareStore.getState().reset();
    const s = useShareStore.getState();
    expect(s.eventTitle).toBe("");
    expect(s.lastShareUrl).toBeNull();
  });
});
