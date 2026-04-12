import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToastStore } from "../toast-store.js";

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

describe("toast-store", () => {
  it("starts with an empty toast list", () => {
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("addToast appends a toast with type and auto-generated id", () => {
    useToastStore.getState().addToast("Saved", "success");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("Saved");
    expect(toasts[0]?.type).toBe("success");
    expect(toasts[0]?.id).toMatch(/^toast-\d+$/);
  });

  it("addToast supports all three types", () => {
    useToastStore.getState().addToast("Info", "info");
    useToastStore.getState().addToast("Error", "error");
    useToastStore.getState().addToast("OK", "success");
    const types = useToastStore.getState().toasts.map((t) => t.type);
    expect(types).toEqual(["info", "error", "success"]);
  });

  it("multiple toasts accumulate in order", () => {
    useToastStore.getState().addToast("First", "info");
    useToastStore.getState().addToast("Second", "info");
    useToastStore.getState().addToast("Third", "info");
    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(["First", "Second", "Third"]);
  });

  it("removeToast removes a specific toast by id", () => {
    useToastStore.getState().addToast("Keep", "info");
    useToastStore.getState().addToast("Remove", "error");
    const idToRemove = useToastStore.getState().toasts[1]?.id ?? "";
    useToastStore.getState().removeToast(idToRemove);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe("Keep");
  });

  it("removeToast is a no-op for a non-existent id", () => {
    useToastStore.getState().addToast("Exists", "info");
    useToastStore.getState().removeToast("toast-nonexistent");
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("auto-removes toast after 4 seconds", () => {
    useToastStore.getState().addToast("Disappears", "success");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("auto-remove only targets the specific toast, not others", () => {
    useToastStore.getState().addToast("First", "info");
    vi.advanceTimersByTime(2000);
    useToastStore.getState().addToast("Second", "info");
    // First toast auto-removes at t=4000
    vi.advanceTimersByTime(2000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe("Second");
    // Second toast auto-removes at t=6000
    vi.advanceTimersByTime(2000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("each toast gets a unique id", () => {
    useToastStore.getState().addToast("A", "info");
    useToastStore.getState().addToast("B", "info");
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
