import { describe, expect, it } from "vitest";
import { createPlannerArrivalPolicy, GRAND_HALL_ARRIVAL, plannerArrivalKey, plannerInteriorSpawn } from "../planner-room-arrival.js";
import { roomSplatBundle, walkPoseForBundle } from "../../data/room-splat-bundles.js";
import { isContained } from "../../components/rooms/interior-camera.js";

describe("room-scoped planner arrival", () => {
  it("waits for capability and applies once through progress and canvas remounts", () => {
    const policy = createPlannerArrivalPolicy();
    const key = plannerArrivalKey("draft", "grand-hall");
    expect(policy.claim(null, true)).toBe(false);
    expect(policy.claim(key, false)).toBe(false);
    expect(policy.claim(key, true)).toBe(true);
    expect(policy.claim(key, true)).toBe(false);
    expect(policy.claim(key, false)).toBe(false);
    expect(policy.claim(key, true)).toBe(false);
  });

  it("honours an explicit same-valued choice before capability resolves", () => {
    const policy = createPlannerArrivalPolicy();
    const key = plannerArrivalKey("draft", "grand-hall");
    policy.choose(key);
    expect(policy.claim(key, true)).toBe(false);
    expect(policy.claim(plannerArrivalKey("other-draft", "grand-hall"), true)).toBe(true);
    expect(policy.claim(plannerArrivalKey("draft", "other-room"), true)).toBe(true);
  });

  it("uses an interior served-world pose without transforming it a second time", () => {
    const bundle = roomSplatBundle("grand-hall");
    expect(bundle).not.toBeNull();
    const pose = walkPoseForBundle(bundle!);
    expect(pose).not.toBeNull();
    const spawn = plannerInteriorSpawn("grand-hall", pose!);
    expect(spawn).toEqual(GRAND_HALL_ARRIVAL);
    expect(isContained(spawn.position, {
      min: [...pose!.bounds.min], max: [...pose!.bounds.max],
    })).toBe(true);
    const other = plannerInteriorSpawn("other-room", pose!);
    expect(other.position).toEqual(pose!.spawn.position);
    expect(other.pitch).toBe(0);
  });
});
