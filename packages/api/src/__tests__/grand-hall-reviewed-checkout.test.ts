import { describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_REVIEWED_GIT_SHA_ENV,
  assertGrandHallReviewedCheckoutState,
  inspectGrandHallReviewedCheckout,
  reviewedGrandHallGitShaFromEnvironment,
} from "../scripts/grand-hall-reviewed-checkout.js";

const REVIEWED_SHA = "a".repeat(40);
const ROOT = "C:\\reviewed-grand-hall";

describe("Grand Hall reviewed checkout guard", () => {
  it("requires an explicit exact reviewed SHA", () => {
    expect(() => reviewedGrandHallGitShaFromEnvironment({})).toThrow(
      GRAND_HALL_REVIEWED_GIT_SHA_ENV,
    );
    expect(() => reviewedGrandHallGitShaFromEnvironment({
      [GRAND_HALL_REVIEWED_GIT_SHA_ENV]: "short",
    })).toThrow("exact lowercase reviewed commit SHA");
    expect(reviewedGrandHallGitShaFromEnvironment({
      [GRAND_HALL_REVIEWED_GIT_SHA_ENV]: REVIEWED_SHA,
    })).toBe(REVIEWED_SHA);
  });

  it("rejects wrong HEAD, a missing reviewed commit, tracked dirt, and untracked files", () => {
    const base = {
      repositoryRoot: ROOT,
      headSha: REVIEWED_SHA,
      reviewedCommitExists: true,
      statusPorcelain: "",
    } as const;
    expect(() => {
      assertGrandHallReviewedCheckoutState(base, REVIEWED_SHA);
    }).not.toThrow();
    for (const invalid of [
      { ...base, headSha: "b".repeat(40) },
      { ...base, reviewedCommitExists: false },
      { ...base, statusPorcelain: " M packages/api/src/env.ts" },
      { ...base, statusPorcelain: "?? untracked-secret.txt" },
    ]) {
      expect(() => {
        assertGrandHallReviewedCheckoutState(invalid, REVIEWED_SHA);
      })
        .toThrow("exact reviewed clean Git checkout");
    }
  });

  it("inspects HEAD, commit existence, and all tracked/untracked status from the script repository", async () => {
    const executeGit = vi.fn((args: readonly string[]) => {
      const command = args.slice(2).join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(ROOT);
      if (command === "rev-parse --verify HEAD^{commit}") return Promise.resolve(REVIEWED_SHA);
      if (command === `rev-parse --verify ${REVIEWED_SHA}^{commit}`) {
        return Promise.resolve(REVIEWED_SHA);
      }
      if (command === "status --porcelain=v1 --untracked-files=all --ignore-submodules=none") {
        return Promise.resolve("");
      }
      return Promise.reject(new Error("unexpected Git command"));
    });
    const state = await inspectGrandHallReviewedCheckout(
      REVIEWED_SHA,
      `${ROOT}\\packages\\api\\src\\scripts\\migrate-grand-hall-staging.ts`,
      {
        resolveRealPath: (path) => Promise.resolve(path),
        executeGit,
      },
    );
    expect(state).toEqual({
      repositoryRoot: ROOT,
      headSha: REVIEWED_SHA,
      reviewedCommitExists: true,
      statusPorcelain: "",
    });
    expect(executeGit).toHaveBeenCalledTimes(4);
  });
});
