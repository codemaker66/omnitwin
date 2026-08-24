import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  OWNER_CONFIRMED_AUTHORITY_STATEMENT,
  OWNER_CONFIRMED_SCOPE_STATEMENT,
  SourceRightsLedgerV0Schema,
} from "../room-scene-manifest.js";

const LEDGER_URL = new URL("../../../../state/source_rights.json", import.meta.url);

describe("source-rights ledger", () => {
  it("validates the append-only owner-confirmed XGRIDS and Matterport revision", async () => {
    const raw: unknown = JSON.parse(await readFile(LEDGER_URL, "utf8"));
    const ledger = SourceRightsLedgerV0Schema.parse(raw);
    const records = ledger.revisions.flatMap((revision) => revision.records);

    expect(records.map((record) => record.sourceFamily)).toEqual([
      "xgrids-grand-hall-big-model-variations",
      "matterport-trades-hall",
    ]);
    for (const record of records) {
      expect(record.authorityStatement).toBe(OWNER_CONFIRMED_AUTHORITY_STATEMENT);
      expect(record.scopeStatement).toBe(OWNER_CONFIRMED_SCOPE_STATEMENT);
      expect(record.evidenceLocationStatus).toBe("pending");
      expect(record.additionalPermissions).toEqual([
        "redistribution",
        "third_party_dissemination",
      ]);
      expect(record.unrelatedLicensesRequireSeparateReview).toBe(true);
    }
  });
});
