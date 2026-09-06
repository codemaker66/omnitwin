import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { deflateRawSync } from "node:zlib";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sparkDist = dirname(require.resolve("@sparkjsdev/spark"));
const metadata = JSON.stringify({
  version: 2,
  means: { files: ["means.webp"], mins: [0, 0, 0], maxs: [1, 1, 1] },
  scales: { files: ["scales.webp"], codebook: [0] },
  quats: { files: ["quats.webp"] },
  sh0: { files: ["sh0.webp"], codebook: [0] },
});

/** One metadata entry, optionally using ZIP64 headers. Missing ZIP64 extras are
 * the advisory's trigger. Parsing always happens in a terminable worker. */
function sogArchive(compressed: boolean, zip64: "none" | "valid" | "missing"): Uint8Array {
  const name = Buffer.from("nested/meta.json");
  const content = Buffer.from(metadata);
  const data = compressed ? deflateRawSync(content) : content;
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const extra = Buffer.alloc(zip64 === "valid" ? 28 : 0);
  if (zip64 === "valid") {
    extra.writeUInt16LE(1);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(content.length), 4);
    extra.writeBigUInt64LE(BigInt(data.length), 12);
    extra.writeBigUInt64LE(0n, 20);
  }
  const central = Buffer.alloc(46 + name.length + extra.length);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(45, 4);
  central.writeUInt16LE(45, 6);
  central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 16);
  central.writeUInt32LE(zip64 === "none" ? data.length : 0xffffffff, 20);
  central.writeUInt32LE(zip64 === "none" ? content.length : 0xffffffff, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(extra.length, 30);
  central.writeUInt32LE(zip64 === "none" ? 0 : 0xffffffff, 42);
  name.copy(central, 46);
  extra.copy(central, 46 + name.length);
  const centralOffset = local.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(zip64 === "none" ? 1 : 0xffff, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(zip64 === "none" ? centralOffset : 0xffffffff, 16);
  if (zip64 === "none") return new Uint8Array(Buffer.concat([local, data, central, end]));
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(45, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(1n, 24);
  zip64End.writeBigUInt64LE(1n, 32);
  zip64End.writeBigUInt64LE(BigInt(central.length), 40);
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(centralOffset + central.length), 8);
  locator.writeUInt32LE(1, 16);
  return new Uint8Array(Buffer.concat([local, data, central, zip64End, locator, end]));
}

function legacyParser(bundlePath: string): string {
  const source = ts.createSourceFile(bundlePath, readFileSync(bundlePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let payload: string | undefined;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (initializer && ts.isStringLiteral(initializer) && initializer.text.includes("function unzipSync(")) {
        if (payload !== undefined) throw new Error("More than one legacy ZIP worker payload");
        payload = initializer.text;
      }
    }
  }
  if (payload === undefined) throw new Error("Legacy ZIP worker payload was not found");
  // Run the actual embedded fflate implementation, excluding unrelated WASM,
  // rendering and worker startup. Bounds identify this pinned upstream bundle.
  const start = payload.indexOf("var u8 = Uint8Array");
  const unzip = payload.indexOf("function unzipSync(", start);
  const body = ts.createSourceFile("legacy-worker.js", payload, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let end = -1;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "unzipSync" && node.getStart(body) === unzip) end = node.end;
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (start < 0 || unzip < start || end < unzip) throw new Error("Legacy parser boundaries changed");
  return payload.slice(start, end);
}

function parseInWorker(bundlePath: string, bytes: Uint8Array, embedded: boolean): Promise<unknown> {
  const parser = embedded ? legacyParser(bundlePath) : null;
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      let parse;
      if (workerData.parser !== null) {
        parse = new Function('bytes', workerData.parser + '\\nreturn new TextDecoder().decode(unzipSync(bytes)["nested/meta.json"]);');
      } else if (workerData.moduleUrl.endsWith('/spark.cjs.js')) {
        // The published CJS entry uses a .js suffix under type:module. Execute
        // its actual CommonJS exports with dependencies resolved from its path.
        const { createRequire } = require('node:module');
        const { readFileSync } = require('node:fs');
        const module = { exports: {} };
        new Function('require', 'module', 'exports', readFileSync(new URL(workerData.moduleUrl), 'utf8'))(
          createRequire(workerData.moduleUrl), module, module.exports);
        parse = module.exports.getSplatFileType;
      } else {
        parse = (await import(workerData.moduleUrl)).getSplatFileType;
      }
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try { parentPort.postMessage({ value: parse(workerData.bytes) ?? null }); }
        catch (error) { parentPort.postMessage({ rejected: true, message: String(error) }); }
      });
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { moduleUrl: pathToFileURL(bundlePath).href, bytes, parser } });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = setTimeout(() => { finish(new Error("Spark parser worker did not initialize")); }, 15000);
    const finish = (error: Error | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => { if (error !== null) reject(error); else resolve(value); });
    };
    worker.once("error", (error) => { finish(error); });
    worker.on("message", (message: unknown) => {
      if (typeof message === "object" && message !== null && "ready" in message) {
        clearTimeout(timer);
        timer = setTimeout(() => { finish(new Error("Spark ZIP parser exceeded its two-second deadline")); }, 2000);
        worker.postMessage("parse");
      } else finish(null, message);
    });
  });
}

describe.each(["spark.module.js", "spark.cjs.js"])("Spark ZIP64 security patch: %s", (entry) => {
  const bundlePath = join(sparkDist, entry);
  it.each([false, true])("preserves valid %s-compressed SOG and ZIP64 metadata through the exported parser", async (compressed) => {
    for (const mode of ["none", "valid"] as const) {
      expect(await parseInWorker(bundlePath, sogArchive(compressed, mode), false)).toEqual({ value: "pcsogszip" });
    }
  });
  it("rejects missing ZIP64 extra fields through the actual exported parser without hanging", async () => {
    expect(await parseInWorker(bundlePath, sogArchive(false, "missing"), false)).toEqual({ value: null });
  });
  it("preserves valid compressed metadata in the embedded legacy worker parser", async () => {
    expect(await parseInWorker(bundlePath, sogArchive(true, "valid"), true)).toEqual({ value: metadata });
  });
  it("rejects missing ZIP64 extra fields in the embedded legacy worker parser without hanging", async () => {
    expect(await parseInWorker(bundlePath, sogArchive(false, "missing"), true)).toMatchObject({ rejected: true });
  });
});
