import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../../stores/editor-store.js";
import { useMarkupStore } from "../../stores/markup-store.js";
import { useUndoRedoShortcuts } from "../use-undo-redo-shortcuts.js";

function Harness(): null {
  useUndoRedoShortcuts();
  return null;
}

/**
 * Dispatch a keydown the way a browser would: bubbling and cancelable,
 * optionally from a focused element (events bubble up to window).
 */
function pressKey(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  useEditorStore.getState().reset();
  useMarkupStore.setState({ active: false });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

describe("useUndoRedoShortcuts", () => {
  it("undoes the last editor change on Ctrl+Z and consumes the event", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);

    const event = pressKey({ key: "z", ctrlKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it("undoes on Cmd+Z for macOS", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);

    pressKey({ key: "z", metaKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(0);
  });

  it("redoes on Ctrl+Shift+Z, where browsers report the key as uppercase Z", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().objects).toHaveLength(0);
    render(<Harness />);

    const event = pressKey({ key: "Z", ctrlKey: true, shiftKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("redoes on Ctrl+Y", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useEditorStore.getState().undo();
    render(<Harness />);

    pressKey({ key: "y", ctrlKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it("ignores Z without a modifier", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);

    const event = pressKey({ key: "z" });

    expect(useEditorStore.getState().objects).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves native text undo alone while typing in an input", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = pressKey({ key: "z", ctrlKey: true }, input);

    expect(useEditorStore.getState().objects).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });

  it("leaves native text undo alone while typing in a textarea", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    pressKey({ key: "z", ctrlKey: true }, textarea);

    expect(useEditorStore.getState().objects).toHaveLength(1);
    textarea.remove();
  });

  it("leaves rich-text editing alone inside contenteditable", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    render(<Harness />);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);

    pressKey({ key: "z", ctrlKey: true }, editable);

    expect(useEditorStore.getState().objects).toHaveLength(1);
    editable.remove();
  });

  it("defers to the laser markup tool's own stroke undo while drawing", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    useMarkupStore.setState({ active: true });
    render(<Harness />);

    const event = pressKey({ key: "z", ctrlKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    useEditorStore.getState().addObject("a1", 0, 0, 0);
    const { unmount } = render(<Harness />);
    unmount();

    pressKey({ key: "z", ctrlKey: true });

    expect(useEditorStore.getState().objects).toHaveLength(1);
  });
});
