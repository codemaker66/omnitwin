import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createLocalOfflinePreviewProductionPermitLeaseStore,
  LOCAL_OFFLINE_PREVIEW_PRODUCTION_PERMIT_LEDGER_EPOCH_V1,
  localOfflinePreviewProductionPermitLedgerDatabasePath,
} from "../local-offline-normalization-preview-production-permit-lease-store.js";

describe("production offline-preview permit lease store", () => {
  it("uses one stable local replay domain across releases and key rotations", () => {
    expect(LOCAL_OFFLINE_PREVIEW_PRODUCTION_PERMIT_LEDGER_EPOCH_V1).toBe(
      "sha256:3aa6f533684ac5740001a7bc3c5618db209c58b20141fff1ea85f3db8d13f2ef",
    );
    expect(createLocalOfflinePreviewProductionPermitLeaseStore.length).toBe(0);
    expect(localOfflinePreviewProductionPermitLedgerDatabasePath.length).toBe(0);
  });

  it("uses an app-owned fixed database path and contains no provisioning path", async () => {
    const databasePath = localOfflinePreviewProductionPermitLedgerDatabasePath();
    expect(isAbsolute(databasePath)).toBe(true);
    expect(databasePath).toMatch(/offline-preview-permit-ledger-v2\.sqlite3$/u);

    const source = await readFile(new URL(
      "../local-offline-normalization-preview-production-permit-lease-store.ts",
      import.meta.url,
    ), "utf8");
    expect(source).toContain("openLocalOfflinePreviewSqlitePermitLedger");
    expect(source).not.toContain("Provision");
    expect(source).not.toContain("bundled-release");
    expect(source).not.toContain("releaseManifestSha256");
    expect(source).not.toContain("trustedPermitKeys");
    expect(source).not.toContain(
      "LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1",
    );
    expect(source).not.toContain(
      "FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE",
    );
    expect(source).toContain(
      "Any future storage-schema migration must copy every tombstone",
    );

    const buildConfiguration = JSON.parse(await readFile(new URL(
      "../../tsconfig.build.json",
      import.meta.url,
    ), "utf8")) as { readonly exclude?: readonly string[] };
    expect(buildConfiguration.exclude).toContain("src/__tests__/**");
  });
});
