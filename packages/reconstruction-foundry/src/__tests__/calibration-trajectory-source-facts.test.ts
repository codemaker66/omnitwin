import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT,
  FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
  FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
  FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX,
  FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT,
  FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES,
  FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES,
  FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS,
  FoundryCalibrationTrajectoryCsvSourceFactsSchema,
  FoundryCalibrationTrajectoryJsonSourceFactsSchema,
  FoundryCalibrationTrajectorySourceFactsOutcomeSchema,
  inspectCalibrationTrajectorySourceFacts,
  type FoundryCalibrationTrajectoryDocumentFormat,
  type FoundryCalibrationTrajectorySourceFactsFailureCode,
  type FoundryCalibrationTrajectorySourceFactsOutcome,
} from "../calibration-trajectory-source-facts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function withHandle<T>(bytes: Buffer, action: (handle: FileHandle) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "foundry-calibration-trajectory-facts-"));
  roots.push(root);
  const path = join(root, "source.document");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await action(handle);
  } finally {
    await handle.close();
  }
}

async function inspect(
  source: string | Buffer,
  format: FoundryCalibrationTrajectoryDocumentFormat = "csv",
  options: {
    readonly fileSize?: number;
    readonly sha256?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<FoundryCalibrationTrajectorySourceFactsOutcome> {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
  const sha256 = options.sha256 ?? createHash("sha256").update(bytes).digest("hex");
  return withHandle(bytes, (handle) => inspectCalibrationTrajectorySourceFacts(
    handle,
    options.fileSize ?? bytes.length,
    sha256,
    format,
    options.signal,
  ));
}

function expectFailure(
  outcome: FoundryCalibrationTrajectorySourceFactsOutcome,
  code: FoundryCalibrationTrajectorySourceFactsFailureCode,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
  });
  expect("facts" in outcome).toBe(false);
}

describe("calibration/trajectory Source Facts inspector", () => {
  it("establishes complete CSV record structure and exact decimal lexeme summaries", async () => {
    const text = [
      "ts,tx,note\r\n",
      "0,-0,\"alpha,beta\"\r\n",
      "1.0,2e1,\"line one\nline two\"\r\n",
    ].join("");
    const outcome = await inspect(text);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "csv",
        profile: "utf8_csv_record_structure_v0",
        inspectionCoverage: "complete_record_structure",
        records: {
          count: 3,
          uniformFieldCount: true,
          minimumFieldCount: 3,
          maximumFieldCount: 3,
          firstFields: ["ts", "tx", "note"],
          lastFields: ["1.0", "2e1", "line one\nline two"],
        },
        fields: { count: 9, quotedCount: 2, multilineCount: 1 },
        lineBreaks: { crlfCount: 3, lfCount: 1, crCount: 0, trailing: true },
      },
    });
    if (outcome.state !== "established" || outcome.facts.format !== "csv") {
      throw new Error("expected CSV facts");
    }
    expect(outcome.facts.columns[0]).toMatchObject({
      ordinal: 0,
      observedFieldCount: 3,
      nonDecimalFieldCount: 1,
      decimals: {
        count: 2,
        firstLexeme: "0",
        lastLexeme: "1.0",
        minimumLexeme: "0",
        maximumLexeme: "1.0",
      },
    });
    expect(outcome.facts.columns[1]).toMatchObject({
      ordinal: 1,
      decimals: {
        count: 2,
        firstLexeme: "-0",
        lastLexeme: "2e1",
        minimumLexeme: "-0",
        maximumLexeme: "2e1",
        negativeZeroLexemeCount: 1,
      },
    });
    expect(outcome.sourceSha256).toBe(createHash("sha256").update(text).digest("hex"));
    expect(FoundryCalibrationTrajectoryCsvSourceFactsSchema.parse(outcome.facts)).toEqual(outcome.facts);
    expect(FoundryCalibrationTrajectorySourceFactsOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it("accepts a UTF-8 BOM, escaped quotes, ragged records, and no final newline", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("a,b\r1,\"x\"\"y\"\n2", "utf8"),
    ]);
    const outcome = await inspect(bytes);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "csv",
        encoding: { bom: "present" },
        records: {
          count: 3,
          uniformFieldCount: false,
          minimumFieldCount: 1,
          maximumFieldCount: 2,
          lastFields: ["2"],
        },
        lineBreaks: { crlfCount: 0, lfCount: 1, crCount: 1, trailing: false },
      },
    });
  });

  it("establishes complete JSON syntax/shape while retaining numeric boundary lexemes as text", async () => {
    const text = JSON.stringify({
      poses: [
        { t: 1000, v: [-0, 2.5] },
        { t: -12, v: [3, 4] },
      ],
      label: "fixture",
      enabled: true,
      extra: null,
    }).replace("1000", "1e3").replace("0,2.5", "0,2.50");
    const outcome = await inspect(text, "json");
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "json",
        profile: "bounded_json_syntax_shape_v0",
        inspectionCoverage: "complete_syntax_and_shape",
        root: {
          kind: "object",
          objectKeys: ["poses", "label", "enabled", "extra"],
          arrayLength: null,
        },
        structure: {
          objectCount: 3,
          arrayCount: 3,
          stringValueCount: 1,
          numberCount: 6,
          booleanCount: 1,
          nullCount: 1,
          maximumArrayLength: 2,
        },
        strings: { valueCount: 1, minimumCodeUnits: 7, maximumCodeUnits: 7 },
        numbers: {
          count: 6,
          firstLexeme: "1e3",
          lastLexeme: "4",
          minimumLexeme: "-12",
          maximumLexeme: "1e3",
          exponentLexemeCount: 1,
          fractionLexemeCount: 1,
        },
      },
    });
    if (outcome.state !== "established" || outcome.facts.format !== "json") {
      throw new Error("expected JSON facts");
    }
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.parse(outcome.facts)).toEqual(outcome.facts);
  });

  it("compares very large decimal exponents without lossy JavaScript number conversion", async () => {
    const largeExponent = "9".repeat(120);
    const text = `[1e${largeExponent},-1e${largeExponent},0,-0]`;
    const outcome = await inspect(text, "json");
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        numbers: {
          count: 4,
          firstLexeme: `1e${largeExponent}`,
          lastLexeme: "-0",
          minimumLexeme: `-1e${largeExponent}`,
          maximumLexeme: `1e${largeExponent}`,
          negativeZeroLexemeCount: 1,
        },
      },
    });
  });

  it("orders signed zero and sub-unit decimals by numeric value", async () => {
    const outcome = await inspect("[0,0.001,-0,-0.001]", "json");
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        numbers: {
          minimumLexeme: "-0.001",
          maximumLexeme: "0.001",
          negativeZeroLexemeCount: 1,
        },
      },
    });
  });

  it("applies the numeric lexeme cap only to valid CSV decimals", async () => {
    const longText = "e".repeat(
      FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS + 1,
    );
    const textOutcome = await inspect(longText);
    expect(textOutcome).toMatchObject({
      state: "established",
      facts: {
        columns: [{ nonDecimalFieldCount: 1, decimals: { count: 0 } }],
      },
    });
    expectFailure(
      await inspect("1".repeat(
        FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS + 1,
      )),
      "CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED",
    );
  });

  it("rejects decoded duplicate JSON keys, malformed syntax, and invalid Unicode scalars", async () => {
    expectFailure(
      await inspect("{\"a\":1,\"\\u0061\":2}", "json"),
      "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY",
    );
    expectFailure(
      await inspect("{\"a\":1} trailing", "json"),
      "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
    );
    expectFailure(
      await inspect("{\"a\":NaN}", "json"),
      "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
    );
    expectFailure(
      await inspect("{\"a\":\"\\ud800\"}", "json"),
      "CALIBRATION_TRAJECTORY_JSON_UNICODE_SCALAR_INVALID",
    );
  });

  it("rejects malformed CSV quoting, NUL bytes, and invalid UTF-8 without partial facts", async () => {
    expectFailure(
      await inspect("a,b\n1,\"unterminated"),
      "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
    );
    expectFailure(
      await inspect(Buffer.from([0x61, 0x00, 0x62])),
      "CALIBRATION_TRAJECTORY_CSV_NUL_BYTE",
    );
    expectFailure(
      await inspect(Buffer.from([0x61, 0x2c, 0xc3, 0x28])),
      "CALIBRATION_TRAJECTORY_DOCUMENT_UTF8_INVALID",
    );
  });

  it("enforces bounded line, field, depth, string, and numeric lexeme resources", async () => {
    expectFailure(
      await inspect("x".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES + 1)),
      "CALIBRATION_TRAJECTORY_DOCUMENT_LINE_LIMIT_EXCEEDED",
    );
    expectFailure(
      await inspect(Array.from(
        { length: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT + 1 },
        () => "x",
      ).join(",")),
      "CALIBRATION_TRAJECTORY_CSV_FIELD_LIMIT_EXCEEDED",
    );
    const nested = "[".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX) +
      "0" + "]".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX);
    expectFailure(
      await inspect(nested, "json"),
      "CALIBRATION_TRAJECTORY_JSON_DEPTH_LIMIT_EXCEEDED",
    );
    expectFailure(
      await inspect(`"${"x".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS + 1)}"`, "json"),
      "CALIBRATION_TRAJECTORY_JSON_STRING_LIMIT_EXCEEDED",
    );
    expectFailure(
      await inspect("x".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS + 1)),
      "CALIBRATION_TRAJECTORY_CSV_STRING_LIMIT_EXCEEDED",
    );
    expectFailure(
      await inspect(`1${"0".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS)}`, "json"),
      "CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED",
    );
  });

  it("enforces record and JSON value-count limits independently of the byte ceiling", async () => {
    expectFailure(
      await inspect(`${"x\n".repeat(FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT)}x`),
      "CALIBRATION_TRAJECTORY_CSV_RECORD_LIMIT_EXCEEDED",
    );
    const fullCsvRow = Array.from(
      { length: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT },
      () => "0",
    ).join(",");
    const aggregateRows = Math.floor(
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT /
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
    ) + 1;
    expectFailure(
      await inspect(Array.from({ length: aggregateRows }, () => fullCsvRow).join("\n")),
      "CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_LIMIT_EXCEEDED",
    );

    const arrayValues = Math.floor(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT / 5,
    );
    const arraySource = `[${"0,".repeat(arrayValues - 1)}0]`;
    const objectMembers = arrayValues;
    const objectSource = `{${Array.from(
      { length: objectMembers },
      (_, index) => `"k${String(index)}":0`,
    ).join(",")}}`;
    const manyValues = `[${arraySource},\n${arraySource},\n${arraySource},\n${objectSource},\n${objectSource}]`;
    expectFailure(
      await inspect(manyValues, "json"),
      "CALIBRATION_TRAJECTORY_JSON_VALUE_LIMIT_EXCEEDED",
    );

    const perArray = FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT / 2;
    const memberHeavy = `[[${"0,".repeat(perArray - 1)}0],[${
      "0,".repeat(perArray - 1)
    }0],[0]]`;
    expectFailure(
      await inspect(memberHeavy, "json"),
      "CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED",
    );
  });

  it("keeps source-size, SHA-256, cancellation, and extension failures neutral and stable", async () => {
    const bytes = Buffer.from("a,b\n1,2\n", "utf8");
    expectFailure(
      await inspect(bytes, "csv", { fileSize: bytes.length + 1 }),
      "CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH",
    );
    expectFailure(
      await inspect(bytes, "csv", { sha256: "0".repeat(64) }),
      "CALIBRATION_TRAJECTORY_SOURCE_SHA256_MISMATCH",
    );
    const controller = new AbortController();
    controller.abort();
    expectFailure(
      await inspect(bytes, "csv", { signal: controller.signal }),
      "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
    );
    const unsupported = await withHandle(bytes, (handle) => inspectCalibrationTrajectorySourceFacts(
      handle,
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
      "yaml" as FoundryCalibrationTrajectoryDocumentFormat,
    ));
    expectFailure(unsupported, "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED");
  });

  it("rejects invalid bindings and contradictory failure registry pairs", async () => {
    await expect(inspect("a,b\n", "csv", { fileSize: -1 })).rejects.toThrow();
    await expect(inspect("a,b\n", "csv", { sha256: "bad" })).rejects.toThrow();
    expect(FoundryCalibrationTrajectorySourceFactsOutcomeSchema.safeParse({
      sourceSha256: "0".repeat(64),
      sourceSizeBytes: 0,
      state: "facts_not_established",
      category: "parse_failure",
      code: "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
    }).success).toBe(false);
  });

  it("rejects sources above the fixed 8 MiB ceiling before issuing facts", async () => {
    const bytes = Buffer.alloc(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES + 1, 0x20);
    expectFailure(
      await inspect(bytes),
      "CALIBRATION_TRAJECTORY_SOURCE_SIZE_LIMIT_EXCEEDED",
    );
  });

  it("detects same-handle source mutation before issuing document facts", async () => {
    const bytes = Buffer.from("a,b\n1,2\n", "utf8");
    const root = await mkdtemp(join(tmpdir(), "foundry-calibration-trajectory-mutation-"));
    roots.push(root);
    const path = join(root, "source.csv");
    await writeFile(path, bytes);
    const handle = await open(path, "r+");
    const originalStat = handle.stat.bind(handle);
    let statCallCount = 0;
    Object.defineProperty(handle, "stat", {
      configurable: true,
      value: async () => {
        statCallCount += 1;
        if (statCallCount === 2) await handle.truncate(bytes.length - 1);
        return originalStat();
      },
    });
    try {
      const outcome = await inspectCalibrationTrajectorySourceFacts(
        handle,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
        "csv",
      );
      expectFailure(outcome, "CALIBRATION_TRAJECTORY_SOURCE_CHANGED");
    } finally {
      await handle.close();
    }
  });

  it("rejects internally contradictory reassembled facts at the schema boundary", async () => {
    const csv = await inspect("a,b\n1,2");
    if (csv.state !== "established" || csv.facts.format !== "csv") throw new Error("expected CSV facts");
    expect(FoundryCalibrationTrajectoryCsvSourceFactsSchema.safeParse({
      ...csv.facts,
      records: { ...csv.facts.records, uniformFieldCount: false },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectorySourceFactsOutcomeSchema.safeParse({
      ...csv,
      sourceSizeBytes: csv.sourceSizeBytes + 1,
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectorySourceFactsOutcomeSchema.safeParse({
      ...csv,
      sourceSha256: csv.sourceSha256 === "f".repeat(64)
        ? "e".repeat(64)
        : "f".repeat(64),
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryCsvSourceFactsSchema.safeParse({
      ...csv.facts,
      records: { ...csv.facts.records, count: csv.facts.records.count + 1 },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryCsvSourceFactsSchema.safeParse({
      ...csv.facts,
      fields: { ...csv.facts.fields, emptyCount: csv.facts.fields.emptyCount + 1 },
    }).success).toBe(false);

    const json = await inspect("[1,2]", "json");
    if (json.state !== "established" || json.facts.format !== "json") throw new Error("expected JSON facts");
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      root: { ...json.facts.root, kind: "object" },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      root: { kind: "object", objectKeys: [], arrayLength: null },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      numbers: { ...json.facts.numbers, minimumLexeme: "not-a-decimal" },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      numbers: { ...json.facts.numbers, minimumLexeme: "1e+" },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      numbers: { ...json.facts.numbers, firstLexeme: "999" },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      structure: { ...json.facts.structure, arrayElementCount: 0 },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      root: { kind: "array", objectKeys: null, arrayLength: 0 },
    }).success).toBe(false);
    expect(FoundryCalibrationTrajectoryJsonSourceFactsSchema.safeParse({
      ...json.facts,
      structure: { ...json.facts.structure, maximumDepth: 1 },
    }).success).toBe(false);
  });

  it("freezes complete limits, limitations, and failure registries", () => {
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT.csv)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT.json)).toBe(true);
    expect(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT.csv)
      .not.toContain("CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY");
    expect(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT.json)
      .not.toContain("CALIBRATION_TRAJECTORY_CSV_NUL_BYTE");
    expect(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT.csv)
      .not.toContain("CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED");
    expect(Object.keys(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE).sort()).toEqual(
      [...FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES].sort(),
    );
  });
});
