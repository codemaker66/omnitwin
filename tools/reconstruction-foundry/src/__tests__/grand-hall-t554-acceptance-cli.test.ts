import { expect, it, vi } from "vitest";

import {
  GRAND_HALL_T554_ACCEPTANCE_USAGE,
  GrandHallT554AcceptanceCliReportingError,
  formatGrandHallT554AcceptanceFailure,
  parseGrandHallT554AcceptanceArguments,
  runGrandHallT554AcceptanceCli,
} from "../grand-hall-t554-acceptance-cli.js";

it("parses the template command exactly", () => {
    expect(parseGrandHallT554AcceptanceArguments([
      "template",
      "--review-pack", "C:/review-pack",
      "--out", "C:/template-output",
    ])).toEqual({
      command: "template",
      reviewPackDirectory: "C:/review-pack",
      outputDirectory: "C:/template-output",
    });
  });

  it("parses the acceptance command exactly", () => {
    expect(parseGrandHallT554AcceptanceArguments([
      "accept",
      "--review-pack", "C:/review-pack",
      "--panorama-root", "F:/panoramas",
      "--decisions", "C:/decisions.json",
      "--volume", "C:/volume.json",
      "--mask-root", "C:/masks",
      "--out", "C:/accepted",
    ])).toEqual({
      command: "accept",
      reviewPackDirectory: "C:/review-pack",
      panoramaSourceRoot: "F:/panoramas",
      decisionsPath: "C:/decisions.json",
      closedVolumePath: "C:/volume.json",
      maskRoot: "C:/masks",
      outputDirectory: "C:/accepted",
    });
  });

  it("parses the mask-binding preparation command exactly", () => {
    expect(parseGrandHallT554AcceptanceArguments([
      "bind-masks",
      "--decisions", "C:/pending/human-decisions.json",
      "--mask-root", "D:/grand-hall-masks",
      "--out", "D:/grand-hall-mask-bound-review",
    ])).toEqual({
      command: "bind-masks",
      decisionsPath: "C:/pending/human-decisions.json",
      maskRoot: "D:/grand-hall-masks",
      outputDirectory: "D:/grand-hall-mask-bound-review",
    });
  });

  it("rejects missing, duplicate, unknown, and cross-command options", () => {
    expect(() => parseGrandHallT554AcceptanceArguments(["template", "--review-pack", "C:/x"]))
      .toThrow();
    expect(() => parseGrandHallT554AcceptanceArguments([
      "template", "--review-pack", "C:/x", "--review-pack", "C:/y", "--out", "C:/z",
    ])).toThrow();
    expect(() => parseGrandHallT554AcceptanceArguments([
      "template", "--review-pack", "C:/x", "--out", "C:/z", "--mask-root", "C:/masks",
    ])).toThrow();
    expect(() => parseGrandHallT554AcceptanceArguments(["launch"]))
      .toThrow();
  });

  it("prints help without touching evidence", async () => {
    const write = vi.fn();
    const writeTemplates = vi.fn();
    const accept = vi.fn();

    expect(await runGrandHallT554AcceptanceCli(["--help"], {
      write,
      writeTemplates,
      accept,
    })).toBe(0);
    expect(write).toHaveBeenCalledWith(`${GRAND_HALL_T554_ACCEPTANCE_USAGE}\n`);
    expect(writeTemplates).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("runs template generation and reports authority-none output", async () => {
    const write = vi.fn();
    const writeTemplates = vi.fn(() => Promise.resolve({
      outputDirectory: "C:/template-output",
      reviewPackSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outputFileNames: ["closed-selection-volume.json", "human-decisions.json"] as const,
    }));

    expect(await runGrandHallT554AcceptanceCli([
      "template", "--review-pack", "C:/review-pack", "--out", "C:/template-output",
    ], {
      write,
      writeTemplates,
      accept: vi.fn(),
    })).toBe(0);
    expect(writeTemplates).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      state: "generated_human_pending_template",
      authority: "none",
      reviewPackSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("runs acceptance and never reports reconstruction or runtime authority", async () => {
    const write = vi.fn();
    const accept = vi.fn(() => Promise.resolve({
      outputDirectory: "C:/accepted",
      outputFileNames: [
        "closed-selection-volume.json",
        "interface-decisions.json",
        "panorama-mask-set.json",
        "room-membership.json",
      ] as const,
      authority: "human_accepted" as const,
      productionTrust: null,
      runtimeAdmissionAuthorized: false as const,
      reconstructionAuthorized: false as const,
      reviewPackSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      humanDecisionsSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      roomMembershipSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      interfaceDecisionsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      closedBoundarySha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      panoramaMaskSetSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      panoramaSourceCount: 148,
      candidatePanoramaSourceCount: 50,
      panoramaMaskCount: 48,
      interfaceDecisionCount: 8,
    }));

    expect(await runGrandHallT554AcceptanceCli([
      "accept",
      "--review-pack", "C:/review-pack",
      "--panorama-root", "F:/panoramas",
      "--decisions", "C:/decisions.json",
      "--volume", "C:/volume.json",
      "--mask-root", "C:/masks",
      "--out", "C:/accepted",
    ], {
      write,
      writeTemplates: vi.fn(),
      accept,
    })).toBe(0);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      state: "accepted_scope_artifacts_written",
      authority: "human_accepted",
      productionTrust: null,
      runtimeAdmissionAuthorized: false,
      reconstructionAuthorized: false,
    });
  });

  it("binds exact mask evidence while keeping human review pending", async () => {
    const write = vi.fn();
    const bindMasks = vi.fn(() => Promise.resolve({
      outputDirectory: "D:/grand-hall-mask-bound-review",
      outputFileNames: ["human-decisions.json"] as const,
      maskCount: 45,
    }));

    expect(await runGrandHallT554AcceptanceCli([
      "bind-masks",
      "--decisions", "C:/pending/human-decisions.json",
      "--mask-root", "D:/grand-hall-masks",
      "--out", "D:/grand-hall-mask-bound-review",
    ], {
      write,
      bindMasks,
    })).toBe(0);
    expect(bindMasks).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      state: "exact_mask_evidence_bound_human_review_still_pending",
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      maskCount: 45,
      reconstructionAuthorized: false,
      runtimeAdmissionAuthorized: false,
    });
  });

  it("warns that output may already be committed when receipt reporting fails", async () => {
    const write = vi.fn(() => {
      throw new Error("stdout closed");
    });
    const accept = vi.fn(() => Promise.resolve({
      outputDirectory: "C:/accepted",
    }));
    let failure: unknown;

    try {
      await runGrandHallT554AcceptanceCli([
        "accept",
        "--review-pack", "C:/review-pack",
        "--panorama-root", "F:/panoramas",
        "--decisions", "C:/decisions.json",
        "--volume", "C:/volume.json",
        "--mask-root", "C:/masks",
        "--out", "C:/accepted",
      ], {
        write,
        writeTemplates: vi.fn(),
        accept,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GrandHallT554AcceptanceCliReportingError);
    expect(formatGrandHallT554AcceptanceFailure(failure)).toContain(
      "acceptance may already be committed",
    );
    expect(formatGrandHallT554AcceptanceFailure(failure)).toContain(
      "publication-receipt.json",
    );
    expect(formatGrandHallT554AcceptanceFailure(failure)).not.toContain(
      "No scope acceptance authority was issued",
    );
  });
