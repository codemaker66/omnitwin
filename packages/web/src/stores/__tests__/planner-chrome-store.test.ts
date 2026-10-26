import { beforeEach, describe, expect, it } from "vitest";
import {
  CHROME_GUTTER_PX,
  ZONE_WIDTH_PX,
  requestedViewOffset,
  usePlannerChromeStore,
} from "../planner-chrome-store.js";

// ---------------------------------------------------------------------------
// The new chrome's zones (T-671 slice 6; spec 1.1 law 4, 5.1–5.4). One panel
// per zone: a second replaces the first. An open side zone asks the room to
// make room: the camera's view offset (applied on the GPU in slice 8) is
// tested here against the store.
// ---------------------------------------------------------------------------

beforeEach(() => {
  usePlannerChromeStore.getState().closeAll();
});

describe("the zones", () => {
  it("hold one panel each, and a second panel in a zone replaces the first", () => {
    const zones = usePlannerChromeStore.getState();
    zones.open("right", "send");
    zones.open("left", "add");
    expect(usePlannerChromeStore.getState().right).toBe("send");
    usePlannerChromeStore.getState().open("right", "lay-out");
    expect(usePlannerChromeStore.getState().right).toBe("lay-out");
    expect(usePlannerChromeStore.getState().left).toBe("add");
  });

  it("closes one zone at a time", () => {
    usePlannerChromeStore.getState().open("right", "details");
    usePlannerChromeStore.getState().open("left", "history");
    usePlannerChromeStore.getState().close("right");
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(usePlannerChromeStore.getState().left).toBe("history");
  });
});

describe("the room making room", () => {
  it("asks for nothing with the zones empty", () => {
    expect(requestedViewOffset({ left: null, right: null }, 1600)).toEqual({ left: 0, right: 0 });
  });

  it("asks for a side zone's width and its gutter on a desktop", () => {
    expect(requestedViewOffset({ left: null, right: "details" }, 1600)).toEqual({ left: 0, right: ZONE_WIDTH_PX.right + CHROME_GUTTER_PX });
    expect(requestedViewOffset({ left: "add", right: "send" }, 1600)).toEqual({
      left: ZONE_WIDTH_PX.left + CHROME_GUTTER_PX,
      right: ZONE_WIDTH_PX.right + CHROME_GUTTER_PX,
    });
    expect(ZONE_WIDTH_PX).toEqual({ left: 360, right: 344, compact: 320 });
  });

  it("asks for the narrower panels under 1280 px", () => {
    expect(requestedViewOffset({ left: "add", right: null }, 1180)).toEqual({ left: ZONE_WIDTH_PX.compact + CHROME_GUTTER_PX, right: 0 });
  });

  it("asks for nothing on a phone, where a sheet replaces the dock instead", () => {
    expect(requestedViewOffset({ left: "add", right: "send" }, 393)).toEqual({ left: 0, right: 0 });
  });

  it("follows the store", () => {
    usePlannerChromeStore.getState().open("right", "send");
    expect(usePlannerChromeStore.getState().viewOffset(1600).right).toBe(ZONE_WIDTH_PX.right + CHROME_GUTTER_PX);
  });
});
