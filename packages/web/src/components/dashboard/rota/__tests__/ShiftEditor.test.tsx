import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RotaShift } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { ShiftEditor, type PanelMessage } from "../ShiftEditor.js";
import { CALLUM, MORAG, MORAG_SATURDAY, VENUE, record, rotaWeek, shift } from "./rota-fixtures.js";

// ---------------------------------------------------------------------------
// One shift beside the week: its warnings first, in plain words, kept with a
// reason; a colleague's newer change shown rather than overwritten; the
// consequence of cancelling said before it is done; and the break the law
// asks for said beside the break.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), cancel: vi.fn(), keep: vi.fn() },
}));

vi.mock("../../../../api/rota.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/rota.js")>(),
  createRotaShift: mocks.create,
  updateRotaShift: mocks.update,
  removeRotaShift: mocks.remove,
  cancelRotaShift: mocks.cancel,
  keepRotaWarning: mocks.keep,
}));

const onSaved = vi.fn<(shift: RotaShift, message: PanelMessage) => void>();
const onRemoved = vi.fn<(words: string) => void>();
const onClose = vi.fn<() => void>();

function renderEditor(target: RotaShift, options: { readonly canManage?: boolean; readonly message?: PanelMessage | null; readonly week?: ReturnType<typeof rotaWeek> } = {}): HTMLElement {
  render(
    <ShiftEditor venueId={VENUE} week={options.week ?? rotaWeek()} functions={null} shift={target} newDraft={null}
      canManage={options.canManage ?? true} message={options.message ?? null} onSaved={onSaved} onRemoved={onRemoved} onClose={onClose} />,
  );
  return screen.getByRole("region", { name: /shift/iu });
}

function published(fields: Partial<RotaShift> = {}): RotaShift {
  return shift({ id: MORAG_SATURDAY.id, staffMemberId: MORAG, status: "published", publishedAt: "2026-10-01T09:00:00.000Z", revision: 2, ...fields });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("ShiftEditor", () => {
  it("puts the shift's warnings first, and keeps one with the reason given", async () => {
    const kept = { ...MORAG_SATURDAY, revision: 2 };
    mocks.keep.mockResolvedValue(kept);
    const panel = renderEditor(MORAG_SATURDAY);
    const warnings = within(panel).getByRole("region", { name: "Warnings" });
    const form = panel.querySelector("form");
    expect(form).not.toBeNull();
    if (form !== null) expect(warnings.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(warnings).getByText("Morag Sinclair would have 9 hours between Friday's bar shift and Saturday's set-up; 11 are needed.")).toBeDefined();

    fireEvent.click(within(warnings).getByRole("button", { name: "Keep as it is…" }));
    const reason = within(warnings).getByLabelText("Why it stays as it is");
    const keepButton = within(warnings).getByRole("button", { name: "Keep, with this reason" });
    fireEvent.change(reason, { target: { value: "ok" } });
    expect(keepButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(reason, { target: { value: "Morag asked to finish Friday's bar; Monday off instead" } });
    fireEvent.click(keepButton);
    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith(kept, { tone: "settled", text: "Kept, with your reason." }); });
    expect(mocks.keep).toHaveBeenCalledWith(VENUE, MORAG_SATURDAY, "short_rest", "Morag asked to finish Friday's bar; Monday off instead");
  });

  it("puts focus back on Keep as it is when the reason is put away", () => {
    const panel = renderEditor(MORAG_SATURDAY);
    fireEvent.click(within(panel).getByRole("button", { name: "Keep as it is…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Not now" }));
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Keep as it is…" }));
  });

  it("sends the revision it was made from, and shows a colleague's newer change instead of overwriting it", async () => {
    const newer = { ...MORAG_SATURDAY, revision: 3, endsAt: "2026-10-10T16:00:00.000Z" };
    mocks.update.mockRejectedValue(new ApiError(409, "This shift changed a moment ago.", "SHIFT_CHANGED", newer));
    const panel = renderEditor(MORAG_SATURDAY);
    fireEvent.change(within(panel).getByLabelText("Ends"), { target: { value: "16:30" } });
    expect(within(panel).getByText("These are for the shift as saved. Save to check your changes.")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1); });
    expect(onSaved).toHaveBeenCalledWith(newer, { tone: "alert", text: "Someone changed this shift a moment ago. Here is how it stands now." });
    expect(mocks.update).toHaveBeenCalledWith(VENUE, MORAG_SATURDAY.id, expect.objectContaining({
      staffMemberId: MORAG, endsAt: "2026-10-10T15:30:00.000Z", expectedRevision: 1,
    }));
  });

  it("says the break the law asks for beside the break, and refuses a break as long as the shift", () => {
    const panel = renderEditor(shift({ id: "00000000-0000-4000-8000-0000000000b5", staffMemberId: MORAG, breakMinutes: 0 }));
    expect(within(panel).getByText("A shift this long needs a break of 20 minutes.")).toBeDefined();
    fireEvent.change(within(panel).getByLabelText("Break, minutes"), { target: { value: "450" } });
    expect(within(panel).getByText("The break must be shorter than the shift.")).toBeDefined();
    expect(within(panel).getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks for the longer break for someone under 18", () => {
    const week = rotaWeek({ records: [record({ id: CALLUM, displayName: "Callum Reid", turns18On: "2027-03-02" })] });
    const panel = renderEditor(shift({ id: "00000000-0000-4000-8000-0000000000b6", staffMemberId: CALLUM, breakMinutes: 20 }), { week });
    expect(within(panel).getByText("Someone under 18 needs a break of 30 minutes on a shift this long.")).toBeDefined();
  });

  it("says who is told and the notice given before a published shift is cancelled", async () => {
    const startsAt = new Date(Date.now() + 34.5 * 3_600_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 8 * 3_600_000).toISOString();
    const target = published({ startsAt, endsAt });
    const cancelled = { ...target, status: "cancelled" as const, revision: 3, cancelledAt: new Date().toISOString(), cancellationNoticeHours: 34 };
    mocks.cancel.mockResolvedValue(cancelled);
    const panel = renderEditor(target);
    expect(within(panel).getByText("Morag Sinclair will be told in the app.")).toBeDefined();

    fireEvent.click(within(panel).getByRole("button", { name: "Cancel this shift…" }));
    const question = within(panel).getByText(/^Cancel .+'s shift\?$/u);
    expect(document.activeElement).toBe(question);
    expect(within(panel).getByText("Morag Sinclair will be told in the app. That is 34 hours' notice, and it is recorded.")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel the shift" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith(cancelled, { tone: "settled", text: "Cancelled. Morag Sinclair has been told in the app." }); });
    expect(mocks.cancel).toHaveBeenCalledWith(VENUE, target);
  });

  it("keeps the shift when the question is put away, with focus back on the button that asked it", () => {
    const panel = renderEditor(published());
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel this shift…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Keep it" }));
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Cancel this shift…" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("removes a draft nobody was told of, saying so", async () => {
    mocks.remove.mockResolvedValue(undefined);
    const panel = renderEditor(MORAG_SATURDAY);
    fireEvent.click(within(panel).getByRole("button", { name: "Remove…" }));
    expect(within(panel).getByText("Nobody has been told of it, so it simply goes.")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "Remove" }));
    await waitFor(() => { expect(onRemoved).toHaveBeenCalledWith("Removed the draft. Nobody had been told of it."); });
    expect(mocks.remove).toHaveBeenCalledWith(VENUE, MORAG_SATURDAY);
  });

  it("starts at what an action said when it is opened after one, and closes with Escape", () => {
    const panel = renderEditor(MORAG_SATURDAY, { message: { tone: "settled", text: "Saved." } });
    expect(document.activeElement).toBe(within(panel).getByText("Saved."));
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the published shift's facts, and nothing to change, to someone who reads the rota", () => {
    const panel = renderEditor(published({ note: "Keys from the hallkeeper at 07:45" }), { canManage: false });
    expect(panel.querySelector("form")).toBeNull();
    expect(within(panel).getByText("08:30 to 16:00")).toBeDefined();
    expect(within(panel).getByText("Keys from the hallkeeper at 07:45")).toBeDefined();
    expect(within(panel).queryByRole("region", { name: "Warnings" })).toBeNull();
  });
});
