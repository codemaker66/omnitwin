import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRecord } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { StaffDrawer } from "../StaffDrawer.js";
import { CALLUM, RECORDS, VENUE, record, rotaWeek } from "./rota-fixtures.js";

// ---------------------------------------------------------------------------
// Staff records beside the week: the facts the law needs, saved with the
// revision they were read at; what a save did said beside the button that did
// it; a colleague's newer record shown rather than overwritten; leave
// recorded as whole days on the venue's clock.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: { create: vi.fn(), update: vi.fn(), addLeave: vi.fn(), removeLeave: vi.fn() },
}));

vi.mock("../../../../api/rota.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/rota.js")>(),
  createStaffMember: mocks.create,
  updateStaffMember: mocks.update,
  addUnavailability: mocks.addLeave,
  removeUnavailability: mocks.removeLeave,
}));

const changed = vi.fn<(saved: StaffRecord | null) => void>();
const onClose = vi.fn<() => void>();

/** The drawer as the Rota view holds it: a saved record goes into the week at once. */
function Drawer({ openPersonId }: { readonly openPersonId: string | null }): ReactElement {
  const [week, setWeek] = useState(() => rotaWeek());
  return (
    <StaffDrawer venueId={VENUE} week={week} today="2026-10-05" openPersonId={openPersonId} onClose={onClose}
      onChanged={(saved) => {
        changed(saved);
        if (saved !== null) {
          setWeek((current) => ({
            ...current,
            records: current.records.some((one) => one.id === saved.id)
              ? current.records.map((one) => one.id === saved.id ? saved : one)
              : [...current.records, saved],
          }));
        }
      }} />
  );
}

const callum = RECORDS.find((one) => one.id === CALLUM) ?? record({ id: CALLUM, displayName: "Callum Reid" });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("StaffDrawer", () => {
  it("lists the people rostered with what needs doing, and opens a record in its place", () => {
    render(<Drawer openPersonId={null} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    expect(document.activeElement).toBe(within(drawer).getByRole("heading", { name: "Staff" }));
    const item = within(drawer).getByRole("button", { name: /^Callum Reid/u });
    expect(item.textContent).toContain("No right-to-work check recorded");
    expect(item.textContent).toContain("No account, so told in person");
    fireEvent.click(item);
    expect(document.activeElement).toBe(within(drawer).getByRole("heading", { name: "Callum Reid" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "All staff" }));
    expect(document.activeElement).toBe(within(drawer).getByRole("button", { name: /^Callum Reid/u }));
  });

  it("saves with the revision it was read at, and says so beside Save", async () => {
    const saved = { ...callum, rightToWorkCheckedOn: "2026-09-24", revision: 2 };
    mocks.update.mockResolvedValue(saved);
    render(<Drawer openPersonId={CALLUM} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    fireEvent.change(within(drawer).getByLabelText("Right to work checked on"), { target: { value: "2026-09-24" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));

    const notice = await within(drawer).findByText("Saved.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(notice);
    const save = within(drawer).getByRole("button", { name: "Save" });
    expect(save.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Saved and read back, the form is the record again: nothing left to save twice.
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(VENUE, CALLUM, {
      displayName: "Callum Reid", email: null, phone: null, employmentType: "casual", skills: ["setup"],
      barTrainedOn: null, turns18On: null, rightToWorkCheckedOn: "2026-09-24", rightToWorkExpiresOn: null,
      workingTimeOptOut: false, userId: null, expectedRevision: 1,
    });
    expect(changed).toHaveBeenCalledWith(saved);

    // "Saved." stops being true once the form is changed again.
    fireEvent.change(within(drawer).getByLabelText("Phone"), { target: { value: "07700 900123" } });
    expect(within(drawer).queryByText("Saved.")).toBeNull();
  });

  it("will not save an expiry before its check", () => {
    render(<Drawer openPersonId={CALLUM} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    fireEvent.change(within(drawer).getByLabelText("Right to work checked on"), { target: { value: "2026-09-24" } });
    fireEvent.change(within(drawer).getByLabelText("Check runs out on"), { target: { value: "2026-09-01" } });
    expect(within(drawer).getByText("The expiry comes after the check.")).toBeDefined();
    expect(within(drawer).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a colleague's newer record instead of overwriting it", async () => {
    const newer = { ...callum, phone: "0141 552 2004", revision: 4 };
    mocks.update.mockRejectedValue(new ApiError(409, "This record changed a moment ago.", "PERSON_CHANGED", newer));
    render(<Drawer openPersonId={CALLUM} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    fireEvent.change(within(drawer).getByLabelText("Email"), { target: { value: "callum@example.test" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect((await within(drawer).findByRole("alert")).textContent).toBe("Someone changed this record a moment ago. Here is how it stands now.");
    expect(within(drawer).getByLabelText<HTMLInputElement>("Phone").value).toBe("0141 552 2004");
    expect(within(drawer).getByLabelText<HTMLInputElement>("Email").value).toBe("");
  });

  it("records leave as whole days on the venue's clock", async () => {
    mocks.addLeave.mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000f9", staffMemberId: CALLUM, startsAt: "2026-10-06T23:00:00.000Z",
      endsAt: "2026-10-08T23:00:00.000Z", reason: "leave", note: null,
    });
    render(<Drawer openPersonId={CALLUM} />);
    const leave = screen.getByRole("region", { name: "Leave and unavailability" });
    fireEvent.change(within(leave).getByLabelText("From"), { target: { value: "2026-10-07" } });
    fireEvent.change(within(leave).getByLabelText("To, and including"), { target: { value: "2026-10-08" } });
    fireEvent.click(within(leave).getByRole("button", { name: "Record" }));
    expect(await within(leave).findByText("On leave recorded for Callum Reid. Shifts on those days now say so.")).toBeDefined();
    expect(mocks.addLeave).toHaveBeenCalledWith(VENUE, {
      staffMemberId: CALLUM, startsAt: "2026-10-06T23:00:00.000Z", endsAt: "2026-10-08T23:00:00.000Z", reason: "leave", note: null,
    });
    expect(changed).toHaveBeenCalledWith(null);
  });

  it("asks before taking someone off the rota, and says their shifts stay", async () => {
    mocks.update.mockResolvedValue({ ...callum, isActive: false, revision: 2 });
    render(<Drawer openPersonId={CALLUM} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Take off the rota…" }));
    expect(document.activeElement).toBe(within(drawer).getByText("Take Callum Reid off the rota?"));
    fireEvent.click(within(drawer).getByRole("button", { name: "Keep them on" }));
    expect(document.activeElement).toBe(within(drawer).getByRole("button", { name: "Take off the rota…" }));

    fireEvent.click(within(drawer).getByRole("button", { name: "Take off the rota…" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Take off the rota" }));
    expect(await within(drawer).findByText("Callum Reid is off the rota. Their shifts stay as they were.")).toBeDefined();
    expect(mocks.update).toHaveBeenCalledWith(VENUE, CALLUM, { isActive: false, expectedRevision: 1 });
    expect(within(drawer).getByRole("button", { name: "Put back on the rota" })).toBeDefined();
  });

  it("adds a person who needs no login, then opens their record", async () => {
    const added = record({ id: "00000000-0000-4000-8000-0000000000a9", displayName: "Eilidh Grant", skills: ["bar"], rightToWorkCheckedOn: null });
    mocks.create.mockResolvedValue(added);
    render(<Drawer openPersonId={null} />);
    const drawer = screen.getByRole("region", { name: "Staff" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Add a person" }));
    const submit = within(drawer).getByRole("button", { name: "Add to the rota" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(drawer).getByLabelText("Name"), { target: { value: "  Eilidh Grant " } });
    fireEvent.click(within(drawer).getByRole("checkbox", { name: "Bar" }));
    fireEvent.click(submit);
    expect(await within(drawer).findByText("Added Eilidh Grant to the rota.")).toBeDefined();
    expect(within(drawer).getByRole("heading", { name: "Eilidh Grant" })).toBeDefined();
    expect(mocks.create).toHaveBeenCalledWith(VENUE, expect.objectContaining({ displayName: "Eilidh Grant", skills: ["bar"], employmentType: "casual", userId: null }));
  });

  it("closes with Escape", () => {
    render(<Drawer openPersonId={null} />);
    fireEvent.keyDown(screen.getByRole("region", { name: "Staff" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("StaffDrawer waits honestly", () => {
  it("shows Activity while a record it was opened at is still on its way", async () => {
    render(<StaffDrawer venueId={VENUE} week={rotaWeek()} today="2026-10-05" openPersonId="00000000-0000-4000-8000-0000000000aa"
      onChanged={changed} onClose={onClose} />);
    await waitFor(() => { expect(screen.getByRole("status").textContent).toContain("Loading the record…"); });
  });
});
