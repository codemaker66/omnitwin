import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HallkeeperSheetV2Schema } from "@omnitwin/types";
import { HallkeeperWorkspace, type HallkeeperWorkspaceProps } from "../HallkeeperWorkspace.js";
import { useHallkeeperContext } from "../useHallkeeperContext.js";

vi.mock("../useHallkeeperContext.js", () => ({ useHallkeeperContext: vi.fn() }));
vi.mock("../HallkeeperStatusBanner.js", () => ({ HallkeeperStatusBanner: () => null }));
// Geometry and object linkage retain their own real-render tests. Here the
// marker callback exercises the workspace's category/filter/page navigation.
vi.mock("../InteractiveFloorPlan.js", () => ({
  InteractiveFloorPlan: ({ onMarkerClick }: { readonly onMarkerClick: (key: string) => void }) => (
    <div role="group" aria-label="Interactive saved floor plan">
      <button type="button" onClick={() => { onMarkerClick("dress|Centre|Linen 07|1"); }}>Find Linen 07 in the manifest</button>
    </div>
  ),
}));

const CONFIG_ID = "00000000-0000-4000-8000-000000000001";
const rowKey = (index: number): string => `furniture|Centre|Table ${String(index).padStart(2, "0")}|0`;

const sheet = HallkeeperSheetV2Schema.parse({
  config: { id: CONFIG_ID, name: "Trust dinner — room setup", guestCount: 120, layoutStyle: "dinner-rounds" },
  venue: { name: "Test venue", address: "Test address", timezone: "Europe/London" },
  space: { name: "North Gallery", widthM: 20, lengthM: 10, heightM: 5 },
  timing: null, instructions: null,
  phases: [
    { phase: "furniture", zones: [{ zone: "Centre", rows: Array.from({ length: 12 }, (_, offset) => {
      const index = offset + 1;
      return { key: rowKey(index), name: `Table ${String(index).padStart(2, "0")}`, category: "table", qty: 1,
        afterDepth: 0, isAccessory: false, notes: index === 9 ? "Board members at this table" : "", positions: [] };
    }) }] },
    { phase: "dress", zones: [{ zone: "Centre", rows: Array.from({ length: 8 }, (_, offset) => {
      const name = `Linen ${String(offset + 1).padStart(2, "0")}`;
      return { key: `dress|Centre|${name}|1`, name, category: "decor", qty: 1,
        afterDepth: 1, isAccessory: true, notes: "", positions: [] };
    }) }] },
  ],
  totals: { entries: [], totalRows: 20, totalItems: 20 }, diagramUrl: null, floorPlan: null,
  webViewUrl: `https://example.test/hallkeeper/${CONFIG_ID}`, generatedAt: "2026-09-07T09:00:00.000Z", approval: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useHallkeeperContext).mockReturnValue({ status: "idle", context: null, error: null, retry: vi.fn() });
});
afterEach(cleanup);

function mount(overrides: Partial<HallkeeperWorkspaceProps> = {}) {
  const props: HallkeeperWorkspaceProps = {
    data: sheet, checks: {}, onToggle: vi.fn(), highlightedRowKey: null, onHighlight: vi.fn(), disabled: false,
    notices: null, details: <p>Office briefing and day-of contact</p>, downloadBusy: false, onDownload: vi.fn(), onPrint: vi.fn(),
    ...overrides,
  };
  const rendered = render(<MemoryRouter><HallkeeperWorkspace {...props} /></MemoryRouter>);
  return { ...rendered, props };
}

function setupPanel() {
  return within(screen.getByRole("region", { name: "Setup workspace" }));
}

describe("HallkeeperWorkspace compact working views", () => {
  it("shows five working rows at a time and preserves every remaining row through pagination", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "North Gallery" })).toBeTruthy();
    expect(screen.getByText(sheet.config.name, { exact: true })).toBeTruthy();
    expect(setupPanel().getAllByRole("checkbox", { name: /^Table /u })).toHaveLength(5);
    expect(setupPanel().queryByRole("checkbox", { name: /^Table 06/u })).toBeNull();
    expect(setupPanel().getByText("1–5 of 12 checks")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next setup items" }));
    expect(setupPanel().getAllByRole("checkbox", { name: /^Table /u })).toHaveLength(5);
    expect(setupPanel().getByRole("checkbox", { name: /^Table 06/u })).toBeTruthy();
    expect(setupPanel().getByText("6–10 of 12 checks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next setup items" }));
    expect(setupPanel().getAllByRole("checkbox", { name: /^Table /u })).toHaveLength(2);
    expect(setupPanel().getByText("11–12 of 12 checks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next setup items" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous setup items" }));
    expect(setupPanel().getByText("6–10 of 12 checks")).toBeTruthy();
  });

  it("filters category, unchecked work and planner notes without mutating the checklist", () => {
    const { props } = mount({ checks: { [rowKey(1)]: true, [rowKey(2)]: true } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Remaining" }));
    expect(setupPanel().queryByRole("checkbox", { name: /^Table 01/u })).toBeNull();
    expect(setupPanel().getByRole("checkbox", { name: /^Table 03/u })).toBeTruthy();
    expect(setupPanel().getByText("1–5 of 10 checks")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a setup item" }), { target: { value: "Board members" } });
    expect(setupPanel().getAllByRole("checkbox", { name: /^Table /u })).toHaveLength(1);
    expect(setupPanel().getByRole("checkbox", { name: /^Table 09/u })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a setup item" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Setup category" }), { target: { value: "dress" } });
    expect(setupPanel().getAllByRole("checkbox", { name: /^Linen /u })).toHaveLength(5);
    expect(setupPanel().queryByRole("checkbox", { name: /^Table /u })).toBeNull();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("passes the exact stable key when a later-page row is checked", () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Next setup items" }));
    fireEvent.click(setupPanel().getByRole("checkbox", { name: /^Table 07/u }));
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(rowKey(7));
    expect(props.onHighlight).not.toHaveBeenCalled();
  });

  it("navigates from a plan marker to the correct category and page without recording a check", () => {
    const key = "dress|Centre|Linen 07|1";
    const { props } = mount({ checks: { [key]: true } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Remaining" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a setup item" }), { target: { value: "Table 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Hosting/u }));
    fireEvent.click(screen.getByRole("button", { name: "Find Linen 07 in the manifest" }));
    expect(screen.getByRole("option", { name: "Dress", selected: true })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Find a setup item" })).toHaveProperty("value", "");
    expect(screen.getByRole("checkbox", { name: "Remaining", checked: false })).toBeTruthy();
    expect(setupPanel().getByRole("checkbox", { name: /^Linen 07/u, checked: true })).toBeTruthy();
    expect(setupPanel().getByText("6–8 of 8 checks")).toBeTruthy();
    expect(props.onHighlight).toHaveBeenCalledExactlyOnceWith(key);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("treats every lifecycle stage selection as navigation, with no completion write", () => {
    const { props } = mount();
    const stageNav = within(screen.getByRole("navigation", { name: "Event workflow views" }));
    for (const name of ["Prepare", "Setup", "Checks", "Hosting", "Reset", "Handback"]) {
      fireEvent.click(stageNav.getByRole("button", { name: new RegExp(name, "u") }));
      expect(screen.getByRole("region", { name: `${name} workspace` })).toBeTruthy();
    }
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onHighlight).not.toHaveBeenCalled();
  });

  it("keeps real setup checks usable when the optional event context fails", () => {
    const retry = vi.fn();
    vi.mocked(useHallkeeperContext).mockReturnValue({ status: "error", context: null, error: "Event context could not be verified", retry });
    const { props } = mount();
    expect(screen.getByText("Event context could not be verified")).toBeTruthy();
    fireEvent.click(setupPanel().getByRole("checkbox", { name: /^Table 01/u }));
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(rowKey(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry context" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("prevents check writes when shared progress is unavailable while retaining view navigation", () => {
    const { props } = mount({ disabled: true });
    const check = setupPanel().getByRole("checkbox", { name: /^Table 01/u });
    expect(check.hasAttribute("disabled")).toBe(true);
    fireEvent.click(check);
    fireEvent.click(screen.getByRole("button", { name: "Next setup items" }));
    expect(setupPanel().getByText("6–10 of 12 checks")).toBeTruthy();
    expect(props.onToggle).not.toHaveBeenCalled();
  });
});
