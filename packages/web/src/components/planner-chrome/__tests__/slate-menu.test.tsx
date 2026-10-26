import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRADES_HALL_ROOM_CAPACITIES } from "@omnitwin/types";
import { usePopoverState } from "../Popover.js";
import { SlateMenu, slateMenuRooms, type SlateMenuProps } from "../SlateMenu.js";

// ---------------------------------------------------------------------------
// The slate's menu (T-671 slice 7; spec 6.15, frame 19): the six rooms with
// their seated-dinner capacities as one grid, the current one ringed; this
// event's layouts, and for staff each act's layout; Event details; the walls,
// Cut or Full; and the Diary for staff. It never dims the room.
// ---------------------------------------------------------------------------

afterEach(cleanup);

type Patch = Partial<Omit<SlateMenuProps, "state">>;

function Open({ patch }: { readonly patch: Patch }): ReactElement {
  const state = usePopoverState();
  const { toggle } = state;
  useEffect(() => { toggle(); }, [toggle]);
  return (
    <>
      <button ref={state.triggerRef} type="button">St Andrew's Night dinner</button>
      <SlateMenu
        state={state}
        rooms={slateMenuRooms()}
        currentRoomSlug="grand-hall"
        onRoom={vi.fn()}
        layoutName="8 round tables of 10"
        otherLayouts={[]}
        acts={[]}
        actsSettable
        onUseForAct={vi.fn()}
        actBusy={null}
        actWaitsOn={null}
        actProblem={null}
        eventHref={null}
        diaryHref={null}
        wallsFull={false}
        onWalls={vi.fn()}
        {...patch}
      />
    </>
  );
}

function menu(patch: Patch = {}): HTMLElement {
  render(<MemoryRouter><Open patch={patch} /></MemoryRouter>);
  return screen.getByRole("dialog", { name: "The event and the room" });
}

describe("the rooms", () => {
  it("lists the six published rooms with their seated-dinner capacities, the current one ringed", () => {
    const panel = menu();
    const rooms = within(panel).getByRole("group", { name: "Rooms, seated for dinner" });
    const keys = within(rooms).getAllByRole("button");
    expect(keys).toHaveLength(6);
    expect(keys[0]?.textContent).toContain("Grand Hall");
    expect(keys[0]?.textContent).toContain(String(TRADES_HALL_ROOM_CAPACITIES["grand-hall"].dinner));
    expect(keys[0]?.getAttribute("aria-current")).toBe("true");
    expect(keys.filter((key) => key.getAttribute("aria-current") === "true")).toHaveLength(1);
    expect(rooms.textContent).not.toContain("The Grand Hall");
  });

  it("switches room in one press of another room", () => {
    const onRoom = vi.fn();
    const panel = menu({ onRoom });
    fireEvent.click(within(panel).getByRole("button", { name: /^Saloon/u }));
    expect(onRoom).toHaveBeenCalledWith("saloon");
  });
});

describe("the layouts for this event", () => {
  it("names this layout, and lists the event's others as links", () => {
    const panel = menu({ otherLayouts: [{ id: "c2", name: "Ceilidh, floor cleared", spaceName: "Grand Hall", href: "/plan/c2?eventId=e1" }] });
    const layouts = within(panel).getByRole("group", { name: "Layouts for this event" });
    expect(layouts.textContent).toContain("8 round tables of 10");
    expect(layouts.textContent).toContain("This layout");
    expect(within(layouts).getByRole("link", { name: /Ceilidh, floor cleared/u }).getAttribute("href")).toBe("/plan/c2?eventId=e1");
  });

  it("shows staff each act's layout and uses this one for an act", () => {
    const onUseForAct = vi.fn();
    const panel = menu({
      onUseForAct,
      acts: [
        { id: "p1", name: "Dinner", state: "this" },
        { id: "p2", name: "Ceilidh", state: "none" },
      ],
    });
    const layouts = within(panel).getByRole("group", { name: "Layouts for this event" });
    expect(layouts.textContent).toContain("Dinner");
    expect(layouts.textContent).toContain("uses this layout");
    expect(layouts.textContent).toContain("no layout yet");
    expect(within(layouts).queryByRole("button", { name: "Use this layout for Dinner" })).toBeNull();
    fireEvent.click(within(layouts).getByRole("button", { name: "Use this layout for Ceilidh" }));
    expect(onUseForAct).toHaveBeenCalledWith("p2");
  });

  it("shows a hallkeeper each act's layout without the means to change it", () => {
    const panel = menu({ actsSettable: false, acts: [{ id: "p2", name: "Ceilidh", state: "stale" }] });
    const layouts = within(panel).getByRole("group", { name: "Layouts for this event" });
    expect(layouts.textContent).toContain("uses an earlier save of this layout");
    expect(within(layouts).queryByRole("button")).toBeNull();
  });

  it("says when an act's layout could not be set", () => {
    const panel = menu({ acts: [{ id: "p2", name: "Ceilidh", state: "none" }], actProblem: "Ceilidh was not set: the layout changed on the server." });
    expect(within(panel).getByRole("alert").textContent).toBe("Ceilidh was not set: the layout changed on the server.");
  });

  it("waits, and says why, while this layout is still saving", () => {
    const onUseForAct = vi.fn();
    const panel = menu({ onUseForAct, actWaitsOn: "Saving this layout first", acts: [{ id: "p2", name: "Ceilidh", state: "other" }] });
    const key = within(panel).getByRole("button", { name: "Use this layout for Ceilidh: Saving this layout first" });
    fireEvent.click(key);
    expect(onUseForAct).not.toHaveBeenCalled();
  });
});

describe("the rest of the menu", () => {
  it("cuts or stands the walls", () => {
    const onWalls = vi.fn();
    const panel = menu({ onWalls });
    const walls = within(panel).getByRole("radiogroup", { name: "Walls" });
    expect(within(walls).getByRole("radio", { name: "Cut" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(walls).getByRole("radio", { name: "Full" }));
    expect(onWalls).toHaveBeenCalledWith(true);
  });

  it("offers Event details and the Diary only where they lead somewhere", () => {
    const bare = menu();
    expect(within(bare).queryByRole("link", { name: "Event details" })).toBeNull();
    expect(within(bare).queryByRole("link", { name: "Open in the Diary" })).toBeNull();
    cleanup();
    const staff = menu({ eventHref: "/ops/events/e1", diaryHref: "/diary?date=2026-11-28" });
    expect(within(staff).getByRole("link", { name: "Event details" }).getAttribute("href")).toBe("/ops/events/e1");
    expect(within(staff).getByRole("link", { name: "Open in the Diary" }).getAttribute("href")).toBe("/diary?date=2026-11-28");
  });
});
