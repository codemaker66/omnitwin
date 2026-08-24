import { describe, expect, it } from "vitest";
import { get } from "node:http";
import {
  parseLocalGrandHallEvidenceDescriptor,
  verifyLocalGrandHallPresentationManifest,
} from "../local-grand-hall-evidence.js";

const liveDescriptorUrl = process.env["VENVIEWER_LIVE_ROOM_EVIDENCE_URL"];

async function liveDescriptor(): Promise<Record<string, unknown>> {
  if (liveDescriptorUrl === undefined) {
    throw new Error("The live room-evidence URL was not supplied.");
  }
  const body = await new Promise<string>((resolve, reject) => {
    const request = get(liveDescriptorUrl, {
      headers: { Origin: "http://127.0.0.1:55983" },
    }, (response) => {
      expect(response.statusCode).toBe(200);
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      response.on("error", reject);
    });
    request.on("error", reject);
  });
  return JSON.parse(body) as Record<string, unknown>;
}

describe.runIf(liveDescriptorUrl !== undefined)("sealed live Grand Hall evidence profile", () => {
  it("parses and cryptographically verifies the real profile-plus-leases descriptor", async () => {
    const value = await liveDescriptor();
    const candidate = parseLocalGrandHallEvidenceDescriptor(value, liveDescriptorUrl ?? "");

    await expect(verifyLocalGrandHallPresentationManifest(candidate)).resolves.toBeUndefined();
    expect(candidate.sources).toHaveLength(4);
    expect(candidate.presentations.panoramaWalk.presentationManifest.nodes).toHaveLength(49);
    expect(candidate.presentations.panoramaWalk.assetBaseUrl).not.toMatch(/\/$/u);
    expect(candidate.presentations.capturedImages.members).toHaveLength(5);
  });

  it("rejects own prototype-control keys before Zod can normalize them away", async () => {
    const rootMutation = await liveDescriptor();
    const rootProfile = rootMutation["profile"] as Record<string, unknown>;
    Object.defineProperty(rootProfile, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(() => {
      parseLocalGrandHallEvidenceDescriptor(rootMutation, liveDescriptorUrl ?? "");
    }).toThrow("not safe data with the exact bounded shape");

    const nestedMutation = await liveDescriptor();
    const nestedProfile = nestedMutation["profile"] as Record<string, unknown>;
    const rights = nestedProfile["rights"] as Record<string, unknown>;
    Object.defineProperty(rights, "constructor", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(() => {
      parseLocalGrandHallEvidenceDescriptor(nestedMutation, liveDescriptorUrl ?? "");
    }).toThrow("not safe data with the exact bounded shape");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects digest-bound ledger mutations even when the pinned digest string is unchanged", async () => {
    const value = await liveDescriptor();
    const profile = value["profile"] as Record<string, unknown>;
    const sourceLedger = profile["sourceLedger"] as Record<string, unknown>;
    const lcc2 = sourceLedger["lcc2"] as Record<string, unknown>;
    lcc2["verificationState"] = "mutated_without_resealing";

    const candidate = parseLocalGrandHallEvidenceDescriptor(value, liveDescriptorUrl ?? "");
    await expect(verifyLocalGrandHallPresentationManifest(candidate)).rejects.toThrow(
      "profile digest does not match",
    );
  });
});
