import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FoundryRestorationProviderProfileV0Schema,
  getFoundryRestorationProviderProfileV0,
} from "../restoration-experiment.js";

const FIXTURE_URL = new URL(
  "./fixtures/restoration-provider-profile-v0-difix.json",
  import.meta.url,
);
const FIXTURE_SHA256 =
  "aa02e4ccc9bdf74b4215261f03c6b10d3e7e98b46f93ebefbf3201e4f87b2d18";
const PROFILE_SHA256 =
  "sha256:c597c9cdc19190ffc9fdec62f902d052e219abab8634b3cb72041b2ff34f66e3";

describe("restoration experiment v0 serialized compatibility", () => {
  it("keeps the persisted Difix provider profile byte-stable", () => {
    const fixtureBytes = readFileSync(FIXTURE_URL);
    const fixtureText = fixtureBytes.toString("utf8");
    const fixture: unknown = JSON.parse(fixtureText);
    const parsed = FoundryRestorationProviderProfileV0Schema.parse(fixture);

    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(
      FIXTURE_SHA256,
    );
    expect(parsed.profileSha256).toBe(PROFILE_SHA256);
    expect(parsed).toEqual(getFoundryRestorationProviderProfileV0("difix3d_plus"));
    expect(`${JSON.stringify(parsed, null, 2)}\n`).toBe(fixtureText);
  });
});
