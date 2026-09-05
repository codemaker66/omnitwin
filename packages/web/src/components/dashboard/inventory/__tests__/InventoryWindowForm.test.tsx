import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InventoryWindowForm } from "../InventoryWindowForm.js";

afterEach(cleanup);
describe("InventoryWindowForm", () => {
  it("requires a valid window before requesting an assessment", () => {
    const onAssess = vi.fn();
    render(<InventoryWindowForm initial={{ startsAt: "2026-09-06T12:00", endsAt: "2026-09-06T11:00" }}
      onAssess={onAssess} onChange={vi.fn()} disabled={false} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Assess demand" }));
    expect(onAssess).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("end must be after");
  });

  it("invalidates prior choices on edits and sends exact instants after review", () => {
    const onAssess = vi.fn(); const onChange = vi.fn();
    render(<InventoryWindowForm initial={{ startsAt: "2026-09-06T12:00", endsAt: "2026-09-06T13:00" }}
      onAssess={onAssess} onChange={onChange} disabled={false} busy={false} />);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-09-06T14:00" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onAssess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Assess demand" }));
    expect(onAssess).toHaveBeenCalledWith({ startsAt: new Date(2026, 8, 6, 12).toISOString(), endsAt: new Date(2026, 8, 6, 14).toISOString() });
  });
});
