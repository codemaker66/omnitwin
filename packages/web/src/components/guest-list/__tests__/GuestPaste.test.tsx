import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUESTS_MAX } from "../../../lib/guest-list/model.js";
import { GuestPaste } from "../GuestPaste.js";

// ---------------------------------------------------------------------------
// Pasting a list: what was found is said in counts before anything is added,
// only names and parties are handed on, and the planner can correct the
// heading and the columns the reader guessed.
// ---------------------------------------------------------------------------

const CANARY = "CANARY-Q7";

type Added = readonly { readonly name: string; readonly party: string }[];

function paste(text: string, roomLeft: number = GUESTS_MAX): { readonly onAdd: ReturnType<typeof vi.fn<(guests: Added) => void>> } {
  const onAdd = vi.fn<(guests: Added) => void>();
  render(<GuestPaste roomLeft={roomLeft} onAdd={onAdd} />);
  fireEvent.change(screen.getByLabelText("Paste the names"), { target: { value: text } });
  return { onAdd };
}

function added(onAdd: ReturnType<typeof vi.fn<(guests: Added) => void>>): Added {
  const call = onAdd.mock.calls[0];
  if (call === undefined) throw new Error("nothing was added");
  return call[0];
}

afterEach(cleanup);

describe("GuestPaste", () => {
  it("says only names and parties are taken, and how many columns are left", () => {
    const { onAdd } = paste([
      "Name\tParty\tEmail\tDiet",
      `Ailsa Fraser\tFraser family\t${CANARY}@example.com\tVegetarian`,
      "Chidi Okafor\tOkafor family\tchidi@example.com\tNone",
    ].join("\n"));
    expect(screen.getByText("2 names found. Only names and parties are taken. 2 other columns are left on your computer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(added(onAdd)).toEqual([
      { name: "Ailsa Fraser", party: "Fraser family" },
      { name: "Chidi Okafor", party: "Okafor family" },
    ]);
    expect(JSON.stringify(onAdd.mock.calls)).not.toContain(CANARY);
  });

  it("says one column is left in the singular", () => {
    paste("Name,Email\nAilsa Fraser,ailsa@example.com");
    expect(screen.getByText("1 name found. Only names and parties are taken. 1 other column is left on your computer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add 1 guest" })).toBeTruthy();
  });

  it("a plain list of names needs no column choices", () => {
    paste("Ailsa Fraser\nChidi Okafor\n\nMorag Kerr\n");
    expect(screen.getByText("3 names found. Only names and parties are taken.")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it("counts the rows it leaves out, by reason", () => {
    const tooLong = "A".repeat(81);
    paste([tooLong, "Ailsa Fraser", "Chidi Okafor", "Morag Kerr", "Ewan Shaw"].join("\n"), 2);
    expect(screen.getByText("2 names found. Only names and parties are taken.")).toBeTruthy();
    expect(screen.getByText("3 rows were left out: 1 name over 80 characters, 2 beyond the 600 a list can hold.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add 2 guests" })).toBeTruthy();
  });

  it("says a single row left out in the singular", () => {
    paste(["B".repeat(81), "Ailsa Fraser"].join("\n"));
    expect(screen.getByText("1 row was left out: 1 name over 80 characters.")).toBeTruthy();
  });

  it("counts a row with no name in it", () => {
    paste("Name\tParty\nAilsa Fraser\tFraser family\n\tOkafor family");
    expect(screen.getByText("1 row was left out: 1 with no name.")).toBeTruthy();
  });

  it("starts the heading tick-box from the guess, and it can be changed", () => {
    paste("Name\nAilsa Fraser\nChidi Okafor");
    const heading = screen.getByLabelText("The first row is a heading");
    expect(heading).toHaveProperty("checked", true);
    expect(screen.getByText("2 names found. Only names and parties are taken.")).toBeTruthy();
    fireEvent.click(heading);
    expect(heading).toHaveProperty("checked", false);
    expect(screen.getByText("3 names found. Only names and parties are taken.")).toBeTruthy();
  });

  it("shows the guessed columns, and a changed choice changes what is taken", () => {
    const { onAdd } = paste("Surname\tFirst name\tTable\nFraser\tAilsa\t3");
    const name = screen.getByLabelText("Name");
    const second = screen.getByLabelText("Second name");
    const party = screen.getByLabelText("Party");
    expect(name).toHaveProperty("value", "1");
    expect(second).toHaveProperty("value", "0");
    expect(party).toHaveProperty("value", "");
    fireEvent.change(party, { target: { value: "2" } });
    fireEvent.change(second, { target: { value: "" } });
    expect(screen.getByText("1 name found. Only names and parties are taken. 1 other column is left on your computer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 guest" }));
    expect(added(onAdd)).toEqual([{ name: "Ailsa", party: "3" }]);
  });

  it("keeps the first guest's name in the preview from a browser's translation", () => {
    paste("Fraser, Ailsa\nOkafor, Chidi");
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser").getAttribute("translate")).toBe("no");
  });

  it("adds a list written surname first as whole names with nothing chosen, and shows the first guest before it is added", () => {
    const { onAdd } = paste("Fraser, Ailsa\nOkafor, Chidi\nKerr, Morag");
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 3 guests" }));
    expect(added(onAdd).map((g) => g.name)).toEqual(["Ailsa Fraser", "Chidi Okafor", "Morag Kerr"]);
  });

  it("keeps today's guess for a spreadsheet's export, and the line shows what it will add", () => {
    const { onAdd } = paste("Fraser,Ailsa\nOkafor,Chidi");
    expect(screen.getByText("The first guest will be added as: Fraser")).toBeTruthy();
    // With one name column there is nothing to put the other way round.
    expect(screen.queryByRole("button", { name: "Put the two names the other way round" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Second name"), { target: { value: "1" } });
    expect(screen.getByText("The first guest will be added as: Fraser Ailsa")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Put the two names the other way round" }));
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    expect(added(onAdd).map((g) => g.name)).toEqual(["Ailsa Fraser", "Chidi Okafor"]);
  });

  it("follows every change of the selects, the party included when a party column is chosen", () => {
    const { onAdd } = paste("Name\tHousehold\tEmail\nAilsa Fraser\tFraser family\tailsa@example.com\nChidi Okafor\t\tchidi@example.com");
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser, party: Fraser family")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Party"), { target: { value: "" } });
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Party"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    expect(added(onAdd)[0]).toEqual({ name: "Ailsa Fraser", party: "Fraser family" });
  });

  it("puts the two name columns the other way round in one click, and back in another", () => {
    const { onAdd } = paste("Fraser, Ailsa\nOkafor, Chidi");
    const swap = screen.getByRole("button", { name: "Put the two names the other way round" });
    expect(swap.getAttribute("aria-pressed")).toBe("false");
    expect(swap.classList.contains("gl-button")).toBe(true);
    fireEvent.click(swap);
    expect(swap.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The first guest will be added as: Fraser Ailsa")).toBeTruthy();
    fireEvent.click(swap);
    expect(screen.getByText("The first guest will be added as: Ailsa Fraser")).toBeTruthy();
    fireEvent.click(swap);
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    expect(added(onAdd).map((g) => g.name)).toEqual(["Fraser Ailsa", "Okafor Chidi"]);
  });

  it("a one-column paste shows no line, no columns and no swap: its journey does not grow", () => {
    const { onAdd } = paste("Ailsa Fraser\nChidi Okafor");
    expect(screen.queryByText(/The first guest will be added as/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Put the two names the other way round" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    expect(added(onAdd).map((g) => g.name)).toEqual(["Ailsa Fraser", "Chidi Okafor"]);
  });

  it("offers no add while nothing is found, and says so", () => {
    paste("Name\n");
    expect(screen.getByText("No names were found in what was pasted.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
  });

  it("can be closed when the list already has guests", () => {
    const onClose = vi.fn<() => void>();
    render(<GuestPaste roomLeft={10} onAdd={() => undefined} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reads nothing from the clipboard by script", async () => {
    const source = await readFile(resolve("src/components/guest-list/GuestPaste.tsx"), "utf8");
    expect(source).not.toMatch(/navigator\.clipboard|clipboardData|readText\(|onPaste/);
  });
});
