import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  verifyFoundryLocalE57IntakeEnvironmentV0,
  verifyLocalE57RuntimeBundleReceipt,
} from "@omnitwin/reconstruction-foundry";
import {
  LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0,
  LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0,
} from "../local-e57-intake-environment-readiness.js";
import {
  LOCAL_HD_WORKER_READINESS_DTO_V0,
  assertLocalE57EnvironmentParentBinding,
} from "../local-hd-worker-readiness.js";

const MANIFEST_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-e57-intake-environment-v0.manifest.json",
  import.meta.url,
));
const GENERATED_PATH = fileURLToPath(new URL(
  "../local-e57-intake-environment.generated.ts",
  import.meta.url,
));
const GENERATOR_PATH = fileURLToPath(new URL(
  "../../scripts/generate-local-e57-intake-environment-source.mjs",
  import.meta.url,
));
const RUNTIME_BUNDLE_RECEIPT_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json",
  import.meta.url,
));

describe("Foundry local E57 environment readiness", () => {
  it("embeds the exact checked-in environment without a runtime file path", async () => {
    const checkedIn = verifyFoundryLocalE57IntakeEnvironmentV0(
      JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown,
    );

    expect(LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0).toEqual(checkedIn);
    expect(LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0.environmentSha256)
      .toBe(checkedIn.environmentSha256);
    expect(JSON.stringify(LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0))
      .not.toMatch(/[A-Z]:\\|Users\\|AppData\\/u);
  });

  it("keeps a compact fail-closed workbench DTO nested in the worker plan", () => {
    const dto = LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0;
    expect(LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment).toBe(dto);
    expect(dto).toMatchObject({
      target: {
        pythonVersion: "3.13.14",
        pythonAbi: "cp313",
        laneScope: "e57_read_only_intake_only",
        unifiedWithOpen3d: false,
      },
      summary: {
        artifactCount: 4,
        dependencyEdgeCount: 3,
        pye57MemberCount: 13,
        legalMaterialCount: 29,
        openItemCount: 6,
      },
      compatibility: {
        state: "isolated_unbundled_synthetic_smoke_passed",
        label: "Synthetic compatibility observed; bundle not tested",
        bundleUnderTest: false,
        venueDataAccessed: false,
      },
      bundle: {
        state: "not_materialized",
        legalPackState: "not_assembled",
        microsoftCppRuntimeState: "host_dependency_observed_not_closed",
        cleanHostVerificationState: "not_performed",
        adapterBindingState: "not_wired",
      },
      execution: "disabled",
      authority: "none",
      followUp: {
        state: "candidate_materialized_repeat_receipt_matched_clean_host_open",
        candidateBundle: {
          bundleReceiptSha256:
            "9d93928658fb650a319edf1b65bad250b8fa213d810e3554d5e345b42a974696",
          fileCount: 1032,
          totalFileBytes: 66757784,
          repeatBuildCount: 2,
          repeatReceiptByteExact: true,
          applicationInstalled: false,
        },
        legalPack: {
          state: "assembled_in_candidate_bundle",
          materialCount: 30,
        },
        microsoftCppRuntime: {
          disposition: "central_prerequisite_direct_from_microsoft",
          selectedVersion: "14.51.36247",
          installerBundled: false,
          installationState: "not_performed",
        },
        pybind11: {
          versionClaim: "inferred_3.0.1_not_attested",
          noticeState: "exact_version_invariant_notice_included",
        },
        adapter: {
          wiringState: "complete_and_fail_closed",
          productionBindingState: "withheld_pending_clean_host_qualification",
          defaultBinding: null,
          looseDependencyFoldersAcceptedForExecution: false,
        },
        cleanHostQualification: {
          state: "not_performed",
          requiredBeforeProductionBinding: true,
          userOrVenueDataRequired: false,
        },
      },
    });
    expect(dto.artifacts.map((artifact) => artifact.id)).toEqual([
      "cpython-runtime",
      "pye57-wheel",
      "numpy-wheel",
      "pyquaternion-wheel",
    ]);
    expect(dto.openItems).toHaveLength(6);
    expect(dto.followUp.remainingGates.map((gate) => gate.id)).toEqual([
      "central-runtime-setup-review",
      "clean-host-qualification",
      "production-adapter-binding",
    ]);
    expect(() => {
      assertLocalE57EnvironmentParentBinding(
        LOCAL_HD_WORKER_READINESS_DTO_V0.manifestSha256,
        "0".repeat(64),
      );
    }).toThrow("not bound to this local HD worker manifest");
  });

  it("binds the compact follow-up to the complete checked-in candidate receipt", async () => {
    const receiptBytes = await readFile(RUNTIME_BUNDLE_RECEIPT_PATH);
    const receipt = verifyLocalE57RuntimeBundleReceipt(
      JSON.parse(receiptBytes.toString("utf8")) as unknown,
    );
    const followUp = LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0.followUp;

    expect(receipt.bundleReceiptSha256).toBe(
      followUp.candidateBundle.bundleReceiptSha256,
    );
    expect(receipt.fileCount).toBe(followUp.candidateBundle.fileCount);
    expect(receipt.totalFileBytes).toBe(followUp.candidateBundle.totalFileBytes);
    expect(receiptBytes.byteLength).toBe(followUp.candidateBundle.receiptByteSize);
    expect(createHash("sha256").update(receiptBytes).digest("hex")).toBe(
      followUp.candidateBundle.rawReceiptSha256,
    );
    expect(receipt.files.filter((file) => file.role === "legal")).toHaveLength(30);
  });

  it("ships a data-only generated source and no install or run controls", async () => {
    const source = await readFile(GENERATED_PATH, "utf8");
    expect(source).toContain(
      "export const LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_DOCUMENT: unknown = {",
    );
    expect(source).toContain(
      '"environmentSha256": "',
    );
    expect(source).not.toMatch(/readFile\(|writeFile\(|spawn\(|exec\(|fetch\(/u);
    expect(source).toContain('"execution": "disabled"');
    expect(source).toContain('"state": "not_materialized"');
  });

  it("rejects an invalid reviewed digest before generation", async () => {
    const generator = await import(pathToFileURL(GENERATOR_PATH).href) as {
      readonly computeEnvironmentSha256: (payload: unknown) => string;
      readonly verifyReviewedEnvironmentDocument: (document: unknown) => unknown;
    };
    const document = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
      readonly environmentSha256: string;
      readonly nextAction: string;
      readonly [key: string]: unknown;
    };
    const { environmentSha256: _environmentSha256, ...payload } = document;
    expect(generator.computeEnvironmentSha256(payload)).toBe(
      document.environmentSha256,
    );
    expect(() => generator.verifyReviewedEnvironmentDocument({
      ...document,
      nextAction: `${document.nextAction} drift`,
    })).toThrow("fingerprint does not match its canonical payload");
  });
});
