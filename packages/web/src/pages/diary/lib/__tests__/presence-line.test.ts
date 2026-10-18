import { describe, expect, it } from "vitest";
import type { LivePresenceUser } from "../live-protocol.js";
import { presenceLine } from "../presence-line.js";

const ME = "me";
const elaine = (devices?: LivePresenceUser["devices"]): LivePresenceUser =>
  devices === undefined ? { userId: "u-elaine", name: "Elaine", role: "hallkeeper" } : { userId: "u-elaine", name: "Elaine", role: "hallkeeper", devices };
const fiona: LivePresenceUser = { userId: "u-fiona", name: "Fiona", role: "staff", devices: ["desk"] };
const me: LivePresenceUser = { userId: ME, name: "Me", role: "admin", devices: ["desk"] };

describe("the office's line about the screens", () => {
  it("names the wall once and each person's phone, and leaves the reader out", () => {
    expect(presenceLine([me, elaine(["wall", "phone"])], { nowWindowSeconds: 120, selfUserId: ME }))
      .toBe("Wall display live · Elaine's phone live");
  });

  it("one person on two devices is one person, not two names", () => {
    const line = presenceLine([elaine(["wall", "phone"])], { nowWindowSeconds: 120, selfUserId: ME });
    expect(line.split("Elaine")).toHaveLength(2);
  });

  it("says no hallkeeper screen is on, and when it escalates, from the venue's window", () => {
    expect(presenceLine([me], { nowWindowSeconds: 120, selfUserId: ME })).toBe("No hallkeeper screen is on; escalating in 2 min");
    expect(presenceLine([me, fiona], { nowWindowSeconds: 300, selfUserId: ME }))
      .toBe("No hallkeeper screen is on; escalating in 5 min · Fiona's desk live");
    expect(presenceLine([], { nowWindowSeconds: null, selfUserId: ME })).toBe("No hallkeeper screen is on");
    expect(presenceLine([me], { nowWindowSeconds: 90, selfUserId: ME })).toBe("No hallkeeper screen is on; escalating in 2 min");
  });

  it("a wall signed in by the office still counts as a hallkeeper screen", () => {
    expect(presenceLine([{ userId: "u-office", name: "Isla", role: "admin", devices: ["wall"] }], { nowWindowSeconds: 120, selfUserId: ME }))
      .toBe("Wall display live");
  });

  it("a hallkeeper reading the Diary is a hallkeeper screen: never told nobody is on", () => {
    const hallkeeperMe: LivePresenceUser = { userId: ME, name: "Me", role: "hallkeeper", devices: ["phone"] };
    expect(presenceLine([hallkeeperMe], { nowWindowSeconds: 120, selfUserId: ME })).toBe("Your screen is the hallkeeper screen");
    expect(presenceLine([hallkeeperMe, fiona], { nowWindowSeconds: 120, selfUserId: ME })).toBe("Fiona's desk live");
  });

  it("an older server that names no devices: a present hallkeeper is live somewhere", () => {
    expect(presenceLine([elaine()], { nowWindowSeconds: 120, selfUserId: ME })).toBe("Elaine live");
  });
});
