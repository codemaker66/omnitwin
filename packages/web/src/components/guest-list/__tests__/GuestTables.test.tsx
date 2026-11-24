import { useState, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyGuestList, GuestListSchema, type Guest, type GuestList, type KitTable } from "../../../lib/guest-list/model.js";
import { GuestTables } from "../GuestTables.js";

// ---------------------------------------------------------------------------
// The tables view of the ledger: a row a table, one open at a time, seats by
// number, and the changes a planner makes to a table, with the guests a change
// sends back to seat counted in words.
// ---------------------------------------------------------------------------

const PLAN_ID = "3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b34";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function table(n: number, seats = 10, name = ""): KitTable {
  return { id: uuid(n), number: n, name, seats };
}

function guest(n: number, name: string, tableId: string | null = null, seat: number | null = null): Guest {
  return { id: uuid(1000 + n), name, party: "", tableId, seat };
}

function listOf(patch: Partial<GuestList>): GuestList {
  return { ...emptyGuestList(PLAN_ID, "2026-11-13T10:00:00.000Z"), ...patch };
}

interface HarnessProps {
  readonly initial: GuestList;
  readonly moving?: string | null;
  readonly onChoose?: (guestId: string) => void;
  readonly onPlace?: (tableId: string, seat?: number) => void;
  readonly onChange?: () => void;
}

function Harness({ initial, moving = null, onChoose = () => undefined, onPlace = () => undefined, onChange }: HarnessProps): ReactElement {
  const [list, setList] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  return (
    <>
      <GuestTables
        list={list}
        openTableId={openId}
        onToggle={(id) => { setOpenId((was) => (was === id ? null : id)); }}
        moving={moving}
        onChoose={onChoose}
        onPlace={onPlace}
        onChange={(change) => {
          onChange?.();
          setList((was) => change(was));
        }}
        onNotice={setNotice}
      />
      <p data-testid="notice">{notice}</p>
      <output data-testid="list">{JSON.stringify(list)}</output>
    </>
  );
}

function shown(): GuestList {
  const parsed: unknown = JSON.parse(screen.getByTestId("list").textContent ?? "null");
  return GuestListSchema.parse(parsed);
}

function row(number: number): HTMLElement {
  const toggle = screen.getAllByRole("button").find((b) => b.getAttribute("aria-expanded") !== null && (b.textContent ?? "").startsWith(`Table ${String(number)}`));
  const item = toggle?.closest("li");
  if (item === null || item === undefined) throw new Error("no such table row");
  return item;
}

function openRow(number: number): HTMLElement {
  const item = row(number);
  const toggle = within(item).getAllByRole("button").find((b) => b.getAttribute("aria-expanded") === "false");
  if (toggle === undefined) throw new Error("row has no closed toggle");
  fireEvent.click(toggle);
  return row(number);
}

afterEach(cleanup);

describe("GuestTables", () => {
  it("says there are no tables yet", () => {
    render(<Harness initial={listOf({})} />);
    expect(screen.getByText("There are no tables yet.")).toBeTruthy();
  });

  it("a closed row shows the table's own name, its guests in a line, how full it is and what is free", () => {
    const list = listOf({
      tables: [table(1, 10, "Top table")],
      guests: [guest(2, "Chidi Okafor", uuid(1), 2), guest(1, "Ailsa Fraser", uuid(1), 1)],
    });
    render(<Harness initial={list} />);
    const item = row(1);
    expect(within(item).getByText("Top table")).toBeTruthy();
    expect(within(item).getByText("Ailsa Fraser, Chidi Okafor")).toBeTruthy();
    expect(within(item).getByText("2 of 10")).toBeTruthy();
    expect(within(item).getByText("8 free")).toBeTruthy();
  });

  it("a full table shows no free seats", () => {
    render(<Harness initial={listOf({ tables: [table(1, 1)], guests: [guest(1, "Ailsa Fraser", uuid(1), 1)] })} />);
    const item = row(1);
    expect(within(item).getByText("1 of 1")).toBeTruthy();
    expect(within(item).queryByText(/free$/)).toBeNull();
  });

  it("an open row shows seats 1 to n, the free ones marked, and only one row is open", () => {
    const list = listOf({ tables: [table(1, 4), table(2, 4)], guests: [guest(1, "Ailsa Fraser", uuid(1), 3)] });
    render(<Harness initial={list} />);
    const item = openRow(1);
    const seats = within(item).getAllByRole("listitem");
    expect(seats.map((li) => li.textContent)).toEqual(["1Free", "2Free", "3Ailsa Fraser", "4Free"]);
    openRow(2);
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("aria-expanded") === "true")).toHaveLength(1);
  });

  it("the open row offers the guests still to seat, and choosing one hands on its id", () => {
    const onChoose = vi.fn<(guestId: string) => void>();
    const list = listOf({ tables: [table(1, 4)], guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor", uuid(1), 1)] });
    render(<Harness initial={list} onChoose={onChoose} />);
    const item = openRow(1);
    expect(within(item).getByText("Choose a name, then a free seat:")).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Ailsa Fraser" }));
    expect(onChoose).toHaveBeenCalledWith(uuid(1001));
    fireEvent.click(within(item).getByRole("button", { name: "Chidi Okafor" }));
    expect(onChoose).toHaveBeenLastCalledWith(uuid(1002));
  });

  it("while a guest is chosen, a free seat or the table takes them", () => {
    const onPlace = vi.fn<(tableId: string, seat?: number) => void>();
    const list = listOf({ tables: [table(1, 3), table(2, 3)], guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor", uuid(1), 1)] });
    render(<Harness initial={list} moving={uuid(1001)} onPlace={onPlace} />);
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 2" }));
    expect(onPlace).toHaveBeenCalledWith(uuid(2));
    const item = openRow(1);
    fireEvent.click(within(item).getByRole("button", { name: "Seat here at table 1, seat 3" }));
    expect(onPlace).toHaveBeenLastCalledWith(uuid(1), 3);
    expect(within(item).getByRole("button", { name: "Ailsa Fraser" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("while a guest is chosen, a full table does not offer to take them", () => {
    const list = listOf({
      tables: [table(1, 1), table(2, 2), table(3, 2)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 1), guest(2, "Chidi Okafor"), guest(3, "Morag Kerr", uuid(3), 1), guest(4, "Niall Reid", uuid(3), 2)],
    });
    render(<Harness initial={list} moving={uuid(1002)} />);
    expect(within(row(1)).queryByRole("button", { name: /^Seat here/u })).toBeNull();
    expect(within(row(3)).queryByRole("button", { name: /^Seat here/u })).toBeNull();
    expect(within(row(2)).getByRole("button", { name: "Seat here at table 2" })).toBeTruthy();
  });

  it("names a table when the field is left, not while it is typed in", () => {
    const onChange = vi.fn<() => void>();
    render(<Harness initial={listOf({ tables: [table(1)] })} onChange={onChange} />);
    const item = openRow(1);
    const field = within(item).getByLabelText("Name of table 1");
    fireEvent.change(field, { target: { value: "Top " } });
    fireEvent.change(field, { target: { value: "Top table " } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(shown().tables[0]?.name).toBe("Top table");
  });

  it("lowering the seats sends the guests beyond them back to seat, and says how many", () => {
    const list = listOf({
      tables: [table(1, 10)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 2), guest(2, "Chidi Okafor", uuid(1), 7), guest(3, "Morag Kerr", uuid(1), 8)],
    });
    render(<Harness initial={list} />);
    const item = openRow(1);
    const field = within(item).getByLabelText("Seats at table 1");
    fireEvent.change(field, { target: { value: "6" } });
    expect(shown().tables[0]?.seats).toBe(10);
    fireEvent.blur(field);
    expect(shown().tables[0]?.seats).toBe(6);
    expect(shown().guests.filter((g) => g.tableId === null)).toHaveLength(2);
    expect(screen.getByTestId("notice").textContent).toBe("Table 1 now has 6 seats. 2 guests are now to seat.");
  });

  it("a blank seats field changes nothing", () => {
    const onChange = vi.fn<() => void>();
    render(<Harness initial={listOf({ tables: [table(1, 10)] })} onChange={onChange} />);
    const item = openRow(1);
    const field = within(item).getByLabelText("Seats at table 1");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(shown().tables[0]?.seats).toBe(10);
  });

  it("removing a table says how many of its guests are now to seat", () => {
    const list = listOf({
      tables: [table(1), table(2), table(3)],
      guests: [guest(1, "Ailsa Fraser", uuid(2), 1), guest(2, "Chidi Okafor", uuid(2), 2)],
    });
    render(<Harness initial={list} />);
    fireEvent.click(within(openRow(2)).getByRole("button", { name: "Remove table 2" }));
    expect(screen.getByTestId("notice").textContent).toBe("Table 2 was removed. Its 2 guests are now to seat.");
    expect(shown().tables.map((t) => t.number)).toEqual([1, 3]);
    expect(shown().guests.every((g) => g.tableId === null && g.seat === null)).toBe(true);

    fireEvent.click(within(openRow(3)).getByRole("button", { name: "Remove table 3" }));
    expect(screen.getByTestId("notice").textContent).toBe("Table 3 was removed.");
  });
});
