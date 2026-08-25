import { describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_V1_INTAKE_RETIRED_CODE,
  GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE,
  GrandHallV1IntakeRetiredError,
} from "../scripts/grand-hall-v1-intake-retired.js";
import { runGrandHallFrontierIntake } from "../scripts/intake-grand-hall-big-model-frontier.js";

describe("retired Grand Hall v1 frontier intake CLI", () => {
  it("fails before parsing, environment access, Git inspection, file reads, token access, or HTTP", async () => {
    const inspectGitState = vi.fn();
    const fetch = vi.fn();
    const receiveAdminTokenFromBrowser = vi.fn();
    const env = new Proxy<Record<string, string | undefined>>({}, {
      get: () => { throw new Error("retired intake must not read environment"); },
    });

    await expect(runGrandHallFrontierIntake({
      args: ["--invalid-legacy-argument"],
      env,
      dependencies: {
        inspectGitState,
        fetchImpl: fetch,
        receiveAdminTokenFromBrowser,
      },
    })).rejects.toMatchObject({
      name: "GrandHallV1IntakeRetiredError",
      code: GRAND_HALL_V1_INTAKE_RETIRED_CODE,
      message: GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE,
    });

    await expect(runGrandHallFrontierIntake({ args: [] }))
      .rejects.toBeInstanceOf(GrandHallV1IntakeRetiredError);
    expect(inspectGitState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(receiveAdminTokenFromBrowser).not.toHaveBeenCalled();
  });
});
