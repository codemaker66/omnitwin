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

function DisclosureDialog(): ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  return <div ref={trapRef} role="dialog" aria-label="Inventory disclosures">
    <button type="button">First field</button>
    <button type="button">Done</button>
    <details data-testid="history"><summary>Recent adjustments</summary>
      <button type="button">Read receipt</button>
      <details data-testid="audit"><summary>Audit identifiers</summary><button type="button">Copy receipt</button></details>
      <summary>Secondary summary</summary>
    </details>
  </div>;
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

  it("leaves native Tab free to reach a closed disclosure summary after Done", async () => {
    render(<DisclosureDialog />);
    const first = screen.getByRole("button", { name: "First field" });
    await waitFor(() => { expect(document.activeElement).toBe(first); });
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    done.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Recent adjustments"));
  });

  it("excludes closed nested content and secondary summaries from the focus cycle", async () => {
    render(<DisclosureDialog />);
    const first = screen.getByRole("button", { name: "First field" });
    await waitFor(() => { expect(document.activeElement).toBe(first); });
    screen.getByTestId("history").setAttribute("open", "");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Audit identifiers"));
    screen.getByTestId("audit").setAttribute("open", "");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy receipt" }));
    screen.getByTestId("history").removeAttribute("open");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Recent adjustments"));
  });
});
