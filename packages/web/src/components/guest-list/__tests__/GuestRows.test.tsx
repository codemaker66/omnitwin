import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyGuestList, type Guest, type GuestList } from "../../../lib/guest-list/model.js";
import { tablePlanAZ } from "../../../lib/guest-list/paper.js";
import { GuestRows } from "../GuestRows.js";

// ---------------------------------------------------------------------------
// The ledger by guest, A to Z under their letters: it groups its letters
// exactly as the table plan does, one section a letter.
// ---------------------------------------------------------------------------

const PLAN_ID = "3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b34";
const TABLE_ID = "00000000-0000-4000-8000-000000000001";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Each name seated at table 1, in the order given. */
function seatedList(names: readonly string[]): GuestList {
  const guests: Guest[] = names.map((name, at) => ({ id: uuid(1000 + at), name, party: "", tableId: TABLE_ID, seat: at + 1 }));
  return {
    ...emptyGuestList(PLAN_ID, "2026-11-13T10:00:00.000Z"),
    tables: [{ id: TABLE_ID, number: 1, name: "", seats: 24 }],
    guests,
  };
}

/** Each letter section the rows drew, in order, with the names under it as shown. */
function sectionsShown(container: HTMLElement): readonly (readonly [string, readonly string[]])[] {
  return [...container.querySelectorAll("section.gl-letter")].map((section) => {
    const letter = section.querySelector("h3.gl-group")?.firstChild?.textContent ?? "";
    const names = [...section.querySelectorAll(".gl-guest__name")].map((name) => name.textContent ?? "");
    return [letter, names] as const;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuestRows", () => {
  it("gives each letter one section, the same sections in the same order as the table plan, with no duplicate key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const list = seatedList(["Ada Lamb", "Mary Łoś", "Ada Lowe", "Per Olsen", "Kari Øvergaard", "Ola Owen"]);

    const { container } = render(
      <GuestRows list={list} filter="all" moving={null} onChoose={() => undefined} onChange={() => undefined} onFocusHead={() => undefined} />,
    );

    // Soft, so a failure reports each of the three at once.
    const shown = sectionsShown(container);
    const letters = shown.map(([letter]) => letter);
    expect.soft(letters, "one section a letter").toEqual([...new Set(letters)]);
    expect.soft(shown, "the table plan's sections").toEqual(tablePlanAZ(list).groups.map((group) => [group.letter, group.entries.map((entry) => entry.label)]));
    const duplicateKeys = errors.mock.calls.filter((call) => call.map(String).join(" ").includes("same key"));
    expect.soft(duplicateKeys, "React's duplicate-key warnings").toEqual([]);
    expect(letters).toEqual(["L", "Ł", "O", "Ø"]);
  });
});
