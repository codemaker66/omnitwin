import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const receiptUrl = new URL(
  "../../../../docs/operations/grand-hall-native-lcc-ui-evidence-v1.json",
  import.meta.url,
);
const reportUrl = new URL(
  "../../../../docs/reports/grand-hall-native-lcc-ui-evidence-2026-08-30.md",
  import.meta.url,
);

const RECEIPT_FILE_SHA256 =
  "3cd6d5d788a38f4a9c8483ef2107a8082782a0242ce1e57f0fa7379f51e6eb63";
const REPORT_FILE_SHA256 =
  "1b917d0adfa9593ae8e3d317384744862c58671f01c9e604f63da1085e097983";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function field(parent: Record<string, unknown>, name: string): unknown {
  if (!Object.hasOwn(parent, name)) throw new Error(`Missing field: ${name}.`);
  return Reflect.get(parent, name);
}

function nested(parent: Record<string, unknown>, name: string): Record<string, unknown> {
  return record(field(parent, name), name);
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsedReceipt(): Record<string, unknown> {
  return record(JSON.parse(readFileSync(receiptUrl, "utf8")) as unknown, "receipt");
}

describe("Grand Hall native LCC visible-UI evidence files", () => {
  it("pins the exact receipt and concise report bytes", () => {
    expect(sha256(readFileSync(receiptUrl))).toBe(RECEIPT_FILE_SHA256);
    expect(sha256(readFileSync(reportUrl))).toBe(REPORT_FILE_SHA256);
  });

  it("keeps every downstream authority closed", () => {
    const receipt = parsedReceipt();
    const authority = nested(receipt, "authority");

    expect(field(receipt, "schemaVersion")).toBe(
      "venviewer.grand-hall.native-lcc-ui-evidence.v1",
    );
    expect(field(authority, "state")).toBe("none");
    expect(field(authority, "diagnosticOnly")).toBe(true);
    expect(field(authority, "humanAcceptance")).toBe("pending");
    for (const name of [
      "trainingAuthority",
      "runtimeAuthority",
      "stagingAuthority",
      "deploymentAuthority",
      "publicationAuthority",
      "architecturalTruthAuthority",
    ]) {
      expect(field(authority, name), name).toBe(false);
    }
  });

  it("binds the source, exact scratch clone, and scratch-only conversion", () => {
    const receipt = parsedReceipt();
    const source = nested(receipt, "canonicalSourcePackage");
    const scratch = nested(receipt, "scratchClone");
    const conversion = nested(receipt, "vendorConversion");
    const sourceMembers = array(field(source, "lockedMembers"), "lockedMembers");
    const types = array(field(conversion, "typeBreakdown"), "typeBreakdown");

    expect(field(source, "memberCount")).toBe(11);
    expect(sourceMembers).toHaveLength(11);
    expect(
      sourceMembers.map((value) => field(record(value, "member"), "relativePath")),
    ).toEqual([
      "Grand_Hall.lcc",
      "assets/poses.json",
      "attrs.lcp",
      "collision.lci",
      "data.bin",
      "environment.bin",
      "index.bin",
      "log.txt",
      "report.json",
      "shcoef.bin",
      "thumb.jpg",
    ]);
    expect(
      sourceMembers.reduce<number>(
        (total, value) =>
          total + Number(field(record(value, "member"), "byteLength")),
        0,
      ),
    ).toBe(1_127_138_769);
    expect(field(source, "totalByteLength")).toBe(1_127_138_769);
    expect(field(source, "canonicalPackageInventorySha256")).toBe(
      "sha256:d4f98368b737857038cab3fe2ac439057484b304ef0215abb649a6bc606f16a3",
    );
    expect(field(scratch, "sourceAndScratchMemberRecordsByteExact")).toBe(true);
    expect(field(scratch, "inventoryDigestPortability")).toBe(
      "windows-specific-operator-check-not-cross-platform-canonical",
    );
    expect(field(conversion, "memberCount")).toBe(60);
    expect(field(conversion, "totalByteLength")).toBe(214_350_601);
    expect(types).toHaveLength(6);
    expect(
      types.reduce<number>(
        (total, value) => total + Number(field(record(value, "type"), "memberCount")),
        0,
      ),
    ).toBe(60);
    expect(
      types.reduce<number>(
        (total, value) =>
          total + Number(field(record(value, "type"), "totalByteLength")),
        0,
      ),
    ).toBe(214_350_601);
  });

  it("labels the PNG as a UI screenshot without a deterministic camera receipt", () => {
    const receipt = parsedReceipt();
    const visible = nested(receipt, "visibleUiEvidence");
    const artifact = nested(visible, "artifact");
    const settings = nested(visible, "rendererSettingsUiObservation");
    const capture = nested(visible, "captureMethod");

    expect(field(artifact, "sha256")).toBe(
      "sha256:2e4dfe18a951a5764c09a7d3fcdbb2d0f32085b8d5eb46df9c7a11f53c89e12f",
    );
    expect(field(artifact, "byteLength")).toBe(1_824_870);
    expect([field(artifact, "widthPixels"), field(artifact, "heightPixels")]).toEqual([
      1600,
      900,
    ]);
    expect(field(settings, "programmaticallyAttested")).toBe(false);
    expect(field(capture, "kind")).toBe("windows-active-window-ui-screenshot");
    expect(field(capture, "vendorCaptureServiceUsed")).toBe(false);
    expect(field(capture, "firstPartyNativeCaptureModuleLoaded")).toBe(false);
    expect(field(capture, "generativeImageOperationUsed")).toBe(false);
    expect(field(capture, "uiChromeIncluded")).toBe(true);
  });

  it("retains the timeout and refuses a vendor network-silence claim", () => {
    const receipt = parsedReceipt();
    const attempt = nested(receipt, "priorUnattendedAttempt");
    const network = nested(receipt, "networkClaims");
    const limitations = array(field(receipt, "limitations"), "limitations");

    expect(field(attempt, "status")).toBe("timeout");
    expect(field(attempt, "hardWallClockTimeoutSeconds")).toBe(900);
    expect(field(attempt, "nativeReceiptProduced")).toBe(false);
    expect(field(attempt, "nativePngProduced")).toBe(false);
    expect(field(network, "vendorEditorPacketCapturePerformed")).toBe(false);
    expect(field(network, "vendorEditorNetworkSilenceClaimed")).toBe(false);
    expect(limitations).toContain(
      "The visible frame has no deterministic camera receipt, recovered camera pose, projection receipt, or convergence receipt.",
    );
    expect(limitations).toContain(
      "No claim is made that the vendor editor was network-silent.",
    );
  });
});
