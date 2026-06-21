import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFocusTrap } from "../use-focus-trap.js";

function Dialog(props: { readonly onClose: () => void }): ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  return (
    <div role="dialog" aria-modal="true" aria-label="Focus test dialog">
      <div ref={trapRef}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
        <button type="button" onClick={props.onClose}>Close dialog</button>
      </div>
    </div>
  );
}

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>Open dialog</button>
      {open ? <Dialog onClose={() => { setOpen(false); }} /> : null}
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("useFocusTrap", () => {
  it("moves focus into the dialog and restores focus to the opener", async () => {
    render(<Harness />);

    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    fireEvent.click(opener);

    const first = screen.getByRole("button", { name: "First action" });
    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it("wraps Tab and Shift+Tab inside the mounted trap", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Close dialog" });

    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
