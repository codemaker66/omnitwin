import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const HEADER_BYTES = 160;
const MAX_PAYLOAD_BYTES = 1_048_576;
const MAX_FRAME_BYTES = HEADER_BYTES + MAX_PAYLOAD_BYTES;
const MAX_DIAGNOSTIC_BYTES = 16_384;
const CHILD_TIMEOUT_MS = 20_000;
const CHILD_TEARDOWN_CONFIRM_MS = 3_000;
const EXPECTED_TARGET = "x86_64-pc-windows-msvc";
const EXPECTED_EXECUTABLE = "venviewer-extra-stdio-proof-helper.exe";
const OVERLAPPED_STDIO = ["pipe", "pipe", "pipe", "overlapped", "overlapped"];
const MAGIC = Buffer.from([0x56, 0x4e, 0x53, 0x44, 0x50, 0x30, 0x31, 0x00]);

const proofRoot = dirname(fileURLToPath(import.meta.url));
const helperRoot = join(proofRoot, "helper");
const isWindows = process.platform === "win32";

let temporaryRoot;
let packagedExecutable;
let packagedExecutableSha256;
let rustcRelease;

if (!isWindows) {
  test("the inherited OVERLAPPED-pipe proof requires Windows", {
    skip: "The CRT descriptor and CancelIoEx contracts are Windows-specific.",
  }, () => {});
} else {
  before(() => {
    assert.equal(
      process.arch,
      "x64",
      `This proof matches ${EXPECTED_TARGET}; Windows ${process.arch} is unsupported.`,
    );
    temporaryRoot = mkdtempSync(join(tmpdir(), "venviewer-extra-stdio-proof-"));
    const targetDirectory = join(temporaryRoot, "target");
    const packageDirectory = join(temporaryRoot, "package");

    const rustc = runBuildTool("rustc", ["-Vv"]);
    const releaseMatch = /^release: (.+)$/mu.exec(rustc.stdout);
    const hostMatch = /^host: (.+)$/mu.exec(rustc.stdout);
    assert.ok(releaseMatch, "rustc output did not identify its release");
    assert.ok(hostMatch, "rustc output did not identify its host");
    rustcRelease = releaseMatch[1];
    assert.equal(rustcRelease, "1.87.0", "the proof must use the pinned Rust release");
    assert.equal(hostMatch[1], EXPECTED_TARGET, "the proof must use the Windows MSVC host");

    runBuildTool("cargo", [
      "build",
      "--manifest-path",
      join(helperRoot, "Cargo.toml"),
      "--release",
      "--locked",
      "--offline",
      "--target",
      EXPECTED_TARGET,
      "--target-dir",
      targetDirectory,
    ]);

    const builtExecutable = join(
      targetDirectory,
      EXPECTED_TARGET,
      "release",
      EXPECTED_EXECUTABLE,
    );
    assert.ok(existsSync(builtExecutable), "Cargo did not produce the proof executable");
    mkdirSync(packageDirectory);
    packagedExecutable = join(packageDirectory, EXPECTED_EXECUTABLE);
    copyFileSync(builtExecutable, packagedExecutable);
    packagedExecutableSha256 = sha256File(packagedExecutable);
  });

  after(() => {
    if (temporaryRoot === undefined) return;
    const resolvedTemporaryRoot = resolve(temporaryRoot);
    const resolvedSystemTemp = resolve(tmpdir());
    const expectedPrefix = `${resolvedSystemTemp}${sep}`.toLocaleLowerCase("en-US");
    assert.ok(
      resolvedTemporaryRoot.toLocaleLowerCase("en-US").startsWith(expectedPrefix) &&
        basename(resolvedTemporaryRoot).startsWith("venviewer-extra-stdio-proof-"),
      "refusing to clean a directory outside this proof's temporary root",
    );
    rmSync(resolvedTemporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test("fd 3 reads and fd 4 writes one exact 1 MiB frame with OVERLAPPED handles", async (context) => {
    const payload = deterministicBytes(MAX_PAYLOAD_BYTES, 73, 19);
    const request = wireFrame({ kind: 2, payload, workSequence: 9n });
    const result = await runFixture({ mode: "roundtrip", fd3Chunks: [request] });

    assertSuccess(result, "roundtrip");
    const response = parseFrames(result.fd4);
    assert.equal(response.length, 1);
    assert.equal(response[0].kind, 1, "fd 4 must carry a source frame");
    assert.equal(response[0].workSequence, 9n);
    assert.deepEqual(response[0].payload, payload);
    assert.equal(result.metadata.count, MAX_PAYLOAD_BYTES);

    context.diagnostic(JSON.stringify({
      nativeWindowsExecution: true,
      target: EXPECTED_TARGET,
      rustcRelease,
      packagedExecutableSha256,
      payloadBytes: payload.length,
      payloadSha256: sha256Bytes(payload),
      fd3: result.metadata.fd3,
      fd4: result.metadata.fd4,
    }));
  });

  test("a header and payload split across practical write boundaries still form one frame", async () => {
    const payload = deterministicBytes(262_177, 29, 7);
    const request = wireFrame({ kind: 2, payload, workSequence: 10n });
    const chunks = [
      request.subarray(0, 1),
      request.subarray(1, 79),
      request.subarray(79, 159),
      request.subarray(159, 160),
      request.subarray(160, 161),
      request.subarray(161, 65_537),
      request.subarray(65_537),
    ];
    const result = await runFixture({ mode: "roundtrip", fd3Chunks: chunks });
    assertSuccess(result, "roundtrip");
    const [response] = parseFrames(result.fd4);
    assert.equal(response.kind, 1);
    assert.deepEqual(response.payload, payload);
  });

  test("two coalesced input frames remain two ordered source/catalog output frames", async () => {
    const firstPayload = Buffer.from("first coalesced payload", "utf8");
    const secondPayload = deterministicBytes(131_101, 17, 3);
    const coalesced = Buffer.concat([
      wireFrame({ kind: 2, payload: firstPayload, workSequence: 11n }),
      wireFrame({ kind: 2, payload: secondPayload, workSequence: 12n }),
    ]);
    const result = await runFixture({ mode: "two-frames", fd3Chunks: [coalesced] });
    assertSuccess(result, "two-frames");
    const frames = parseFrames(result.fd4);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames.map(({ kind }) => kind), [1, 3]);
    assert.deepEqual(frames[0].payload, firstPayload);
    assert.deepEqual(frames[1].payload, secondPayload);
    assert.equal(result.metadata.count, 2);
  });

  test("an oversized declaration is rejected from the 160-byte preflight header", async () => {
    const header = wireFrame({ kind: 2, payload: Buffer.alloc(0), workSequence: 13n })
      .subarray(0, HEADER_BYTES);
    header.writeUInt32BE(MAX_PAYLOAD_BYTES + 1, 24);
    const result = await runFixture({ mode: "read-only", fd3Chunks: [header] });
    assert.deepEqual(result.exit, { code: 67, signal: null });
    assert.equal(result.stdout.length, 0);
    assert.equal(result.fd4.length, 0);
    assert.match(result.stderr.toString("utf8"), /InvalidFrame\(FrameTooLarge\)/u);
  });

  test("invalid magic is terminal and a following valid frame is never used for resynchronization", async () => {
    const invalid = Buffer.alloc(HEADER_BYTES, 0xa5);
    const valid = wireFrame({ kind: 2, payload: Buffer.from("must not be read") });
    const result = await runFixture({
      mode: "read-only",
      fd3Chunks: [Buffer.concat([invalid, valid])],
    });
    assert.deepEqual(result.exit, { code: 67, signal: null });
    assert.equal(result.fd4.length, 0);
    assert.match(result.stderr.toString("utf8"), /InvalidFrame\(InvalidMagic\)/u);
  });

  test("EOF halfway through the fixed header is an incomplete terminal frame", async () => {
    const request = wireFrame({ kind: 2, payload: Buffer.from("header eof") });
    const result = await runFixture({
      mode: "read-only",
      fd3Chunks: [request.subarray(0, 80)],
    });
    assert.deepEqual(result.exit, { code: 68, signal: null });
    assert.equal(result.fd4.length, 0);
    assert.match(result.stderr.toString("utf8"), /IncompleteFrame/u);
  });

  test("EOF halfway through the payload is an incomplete terminal frame", async () => {
    const request = wireFrame({ kind: 2, payload: deterministicBytes(4_096, 11, 5) });
    const result = await runFixture({
      mode: "read-only",
      fd3Chunks: [request.subarray(0, HEADER_BYTES + 777)],
    });
    assert.deepEqual(result.exit, { code: 68, signal: null });
    assert.equal(result.fd4.length, 0);
    assert.match(result.stderr.toString("utf8"), /IncompleteFrame/u);
  });

  test("a blocked fd 3 read is cancelled through its exact OVERLAPPED operation", async () => {
    const result = await runFixture({
      mode: "cancel-read",
      endFd3: false,
      controlByte: Buffer.from("c"),
      controlDelayMs: 30,
    });
    assertSuccess(result, "cancel-read");
    assert.equal(result.fd4.length, 0);
  });

  test("a backpressured fd 4 writer is cancelled, drained, and left poisoned", async () => {
    const result = await runFixture({
      mode: "cancel-write",
      endFd3: false,
      controlByte: Buffer.from("c"),
      controlDelayMs: 50,
      drainFd4: false,
    });
    assertSuccess(result, "cancel-write");
  });

  test("cancel-versus-complete generation races run at least 1,000 times", async () => {
    const result = await runFixture({
      mode: "cancel-race",
      endFd3: false,
      childTimeoutMs: 30_000,
    });
    assertSuccess(result, "cancel-race");
    assert.equal(result.metadata.count, 1_000);
  });

  test("reversed source direction on fd 3 is rejected before payload use", async () => {
    const reversed = wireFrame({ kind: 1, payload: Buffer.from("source on fd3") });
    const result = await runFixture({ mode: "read-only", fd3Chunks: [reversed] });
    assert.deepEqual(result.exit, { code: 67, signal: null });
    assert.equal(result.fd4.length, 0);
    assert.match(result.stderr.toString("utf8"), /WrongFrameDirection/u);
  });

  test("reversed output direction on fd 4 is rejected without writing bytes", async () => {
    const result = await runFixture({ mode: "wrong-write-direction", endFd3: false });
    assertSuccess(result, "wrong-write-direction");
    assert.equal(result.fd4.length, 0);
  });

  test("both canonical descriptors resolve to distinct pipe handles", async () => {
    const result = await runFixture({ mode: "mapping-only", endFd3: false });
    assertSuccess(result, "mapping-only");
    assert.equal(result.metadata.fd3, "node_to_helper_output");
    assert.equal(result.metadata.fd4, "helper_to_node_source_catalog");
  });

  test("missing fd 3 fails with a bounded mapping error", async () => {
    const result = await runFixture({
      mode: "mapping-only",
      stdio: ["pipe", "pipe", "pipe"],
      endFd3: false,
    });
    assert.deepEqual(result.exit, { code: 66, signal: null });
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString("utf8"), /MissingDescriptor\(3\)/u);
  });

  test("missing fd 4 fails with a bounded mapping error", async () => {
    const result = await runFixture({
      mode: "mapping-only",
      stdio: ["pipe", "pipe", "pipe", "overlapped"],
      endFd3: false,
    });
    assert.deepEqual(result.exit, { code: 66, signal: null });
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString("utf8"), /MissingDescriptor\(4\)/u);
  });

  test("a non-pipe fd 3 mapping is rejected", async () => {
    const ordinaryFile = openSync(join(temporaryRoot, "not-a-pipe.bin"), "w+");
    try {
      const result = await runFixture({
        mode: "mapping-only",
        stdio: ["pipe", "pipe", "pipe", ordinaryFile, "overlapped"],
        endFd3: false,
      });
      assert.deepEqual(result.exit, { code: 66, signal: null });
      assert.equal(result.stdout.length, 0);
      assert.match(result.stderr.toString("utf8"), /DescriptorIsNotPipe\(3\)/u);
    } finally {
      closeSync(ordinaryFile);
    }
  });

  test("a hung child is rejected only after that exact child closes", async () => {
    await assert.rejects(
      runFixture({ mode: "cancel-read", endFd3: false, childTimeoutMs: 50 }),
      /CHILD_TIMEOUT_AFTER_CONFIRMED_CLOSE/u,
    );
  });

  test("a diagnostic overflow is rejected only after that exact child closes", async () => {
    await assert.rejects(
      runFixture({
        mode: "mapping-only",
        endFd3: false,
        maxDiagnosticBytes: 1,
      }),
      /OUTPUT_BOUND_AFTER_CONFIRMED_CLOSE: stdout exceeded 1 bytes/u,
    );
  });

  test("an absent close event remains a distinct teardown-unconfirmed failure", async () => {
    const neverCloses = new Promise(() => {});
    const fakeChild = { kill: () => true };
    const confirmTeardown = createConfirmedTeardown(fakeChild, neverCloses, 20);
    await assert.rejects(
      confirmTeardown("TEST_ABSENT_CLOSE"),
      /EXACT_CHILD_TEARDOWN_UNCONFIRMED: TEST_ABSENT_CLOSE/u,
    );
  });

  test("an fd 3 write error settles only after exact-close confirmation", async () => {
    let exactCloseObserved = false;
    let resolveExactClose;
    const exactClose = new Promise((resolvePromise) => {
      resolveExactClose = resolvePromise;
    });
    const fakeChild = {
      kill: () => {
        setImmediate(() => {
          exactCloseObserved = true;
          resolveExactClose({ code: 68, signal: null });
        });
        return true;
      },
    };
    const failingWritable = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("forced fd3 write failure"));
      },
    });
    const confirmTeardown = createConfirmedTeardown(fakeChild, exactClose, 500);
    await assert.rejects(
      writeChunksAndEnd(failingWritable, [Buffer.from([1])], confirmTeardown),
      /FD3_WRITE_AFTER_CONFIRMED_CLOSE: forced fd3 write failure/u,
    );
    assert.equal(exactCloseObserved, true);
  });
}

function runBuildTool(command, args) {
  const result = spawnSync(command, args, {
    cwd: proofRoot,
    encoding: "utf8",
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message}`);
  assert.equal(
    result.status,
    0,
    `${command} failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function wireFrame({
  kind,
  payload,
  workSequence = 1n,
  chunkSequence = 1,
  terminal = true,
}) {
  assert.ok([1, 2, 3].includes(kind));
  assert.ok(payload.length <= MAX_PAYLOAD_BYTES);
  const frame = Buffer.alloc(HEADER_BYTES + payload.length);
  MAGIC.copy(frame, 0);
  frame.writeUInt16BE(1, 8);
  frame.writeUInt16BE(HEADER_BYTES, 10);
  frame[12] = kind;
  frame[13] = terminal ? 1 : 0;
  frame.writeBigUInt64BE(workSequence, 16);
  frame.writeUInt32BE(payload.length, 24);
  frame.writeUInt32BE(chunkSequence, 28);
  for (let reference = 0; reference < 6; reference += 1) {
    for (let byte = 0; byte < 16; byte += 1) {
      frame[32 + reference * 16 + byte] = 1 + ((reference * 37 + byte) % 255);
    }
  }
  createHash("sha256").update(payload).digest().copy(frame, 128);
  payload.copy(frame, HEADER_BYTES);
  return frame;
}

function parseFrames(bytes) {
  const frames = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert.ok(bytes.length - offset >= HEADER_BYTES, "fd 4 ended in a partial header");
    const header = bytes.subarray(offset, offset + HEADER_BYTES);
    assert.deepEqual(header.subarray(0, 8), MAGIC);
    assert.equal(header.readUInt16BE(8), 1);
    assert.equal(header.readUInt16BE(10), HEADER_BYTES);
    const payloadLength = header.readUInt32BE(24);
    assert.ok(payloadLength <= MAX_PAYLOAD_BYTES);
    const frameEnd = offset + HEADER_BYTES + payloadLength;
    assert.ok(frameEnd <= bytes.length, "fd 4 ended in a partial payload");
    const payload = bytes.subarray(offset + HEADER_BYTES, frameEnd);
    assert.deepEqual(header.subarray(128, 160), createHash("sha256").update(payload).digest());
    frames.push({
      kind: header[12],
      workSequence: header.readBigUInt64BE(16),
      chunkSequence: header.readUInt32BE(28),
      terminal: (header[13] & 1) !== 0,
      payload: Buffer.from(payload),
    });
    offset = frameEnd;
  }
  return frames;
}

async function runFixture(options) {
  assert.ok(packagedExecutable !== undefined);
  assert.equal(sha256File(packagedExecutable), packagedExecutableSha256);
  const stdio = options.stdio ?? OVERLAPPED_STDIO;
  const child = spawn(packagedExecutable, [options.mode], { stdio, windowsHide: true });
  const exactClose = observeExactChildClose(child);
  const confirmTeardown = createConfirmedTeardown(child, exactClose);
  const maximumDiagnosticBytes = options.maxDiagnosticBytes ?? MAX_DIAGNOSTIC_BYTES;
  const stdout = collectBounded(child.stdout, maximumDiagnosticBytes, "stdout", confirmTeardown);
  const stderr = collectBounded(child.stderr, maximumDiagnosticBytes, "stderr", confirmTeardown);

  let fd4;
  if (child.stdio[4] === undefined || child.stdio[4] === null) {
    fd4 = Promise.resolve(Buffer.alloc(0));
  } else if (options.drainFd4 === false) {
    child.stdio[4].pause();
    fd4 = exactClose.then(() => {
      child.stdio[4].destroy();
      return Buffer.alloc(0);
    });
  } else {
    fd4 = collectBounded(child.stdio[4], MAX_FRAME_BYTES * 2, "fd 4", confirmTeardown);
  }

  const exit = waitForExit(
    exactClose,
    confirmTeardown,
    options.childTimeoutMs ?? CHILD_TIMEOUT_MS,
  );

  let fd3Write = Promise.resolve();
  if (options.fd3Chunks !== undefined) {
    const fd3 = child.stdio[3];
    assert.ok(fd3 !== undefined && fd3 !== null, "Node did not expose parent pipe 3");
    fd3Write = writeChunksAndEnd(fd3, options.fd3Chunks, confirmTeardown);
  } else if (options.endFd3 !== false && child.stdio[3] !== undefined && child.stdio[3] !== null) {
    fd3Write = writeChunksAndEnd(child.stdio[3], [], confirmTeardown);
  }

  let controlWrite = Promise.resolve();
  if (options.controlByte !== undefined) {
    controlWrite = delayedEnd(
      child.stdin,
      options.controlByte,
      options.controlDelayMs ?? 0,
      confirmTeardown,
    );
  }

  const [stdoutBytes, stderrBytes, fd4Bytes, exitResult] = await Promise.all([
    stdout,
    stderr,
    fd4,
    exit,
    fd3Write,
    controlWrite,
  ]);
  return {
    stdout: stdoutBytes,
    stderr: stderrBytes,
    fd4: fd4Bytes,
    exit: exitResult,
    metadata: exitResult.code === 0 ? parseSingleJsonLine(stdoutBytes) : undefined,
  };
}

function collectBounded(stream, maximumBytes, label, confirmTeardown) {
  assert.ok(stream !== null && stream !== undefined, `${label} was not piped`);
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let totalBytes = 0;
    let settling = false;

    const rejectAfterConfirmedTeardown = (error) => {
      if (settling) return;
      settling = true;
      confirmTeardown(`OUTPUT_BOUND: ${label}`).then(
        () => rejectPromise(new Error(`OUTPUT_BOUND_AFTER_CONFIRMED_CLOSE: ${error.message}`)),
        rejectPromise,
      );
    };

    stream.on("data", (chunk) => {
      if (settling) return;
      totalBytes += chunk.length;
      if (totalBytes > maximumBytes) {
        rejectAfterConfirmedTeardown(new Error(`${label} exceeded ${maximumBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", rejectAfterConfirmedTeardown);
    stream.once("end", () => {
      if (!settling) resolvePromise(Buffer.concat(chunks, totalBytes));
    });
  });
}

function writeChunksAndEnd(stream, chunks, confirmTeardown) {
  return new Promise((resolvePromise, rejectPromise) => {
    let index = 0;
    let settling = false;
    const fail = (error) => {
      if (settling) return;
      settling = true;
      confirmTeardown("FD3_WRITE").then(
        () => rejectPromise(new Error(`FD3_WRITE_AFTER_CONFIRMED_CLOSE: ${error.message}`)),
        rejectPromise,
      );
    };
    stream.once("error", fail);

    const writeNext = () => {
      if (settling) return;
      if (index === chunks.length) {
        stream.end(() => {
          if (settling) return;
          settling = true;
          resolvePromise();
        });
        return;
      }
      const chunk = chunks[index];
      index += 1;
      stream.write(chunk, (error) => {
        if (error !== undefined && error !== null) {
          fail(error);
          return;
        }
        setImmediate(writeNext);
      });
    };
    writeNext();
  });
}

function delayedEnd(stream, bytes, delayMs, confirmTeardown) {
  assert.ok(stream !== null && stream !== undefined, "stdin control pipe was not available");
  return new Promise((resolvePromise, rejectPromise) => {
    let settling = false;
    const fail = (error) => {
      if (settling) return;
      settling = true;
      confirmTeardown("CONTROL_WRITE").then(
        () => rejectPromise(new Error(`CONTROL_WRITE_AFTER_CONFIRMED_CLOSE: ${error.message}`)),
        rejectPromise,
      );
    };
    stream.once("error", fail);
    setTimeout(() => {
      if (settling) return;
      stream.end(bytes, () => {
        if (settling) return;
        settling = true;
        resolvePromise();
      });
    }, delayMs);
  });
}

function observeExactChildClose(child) {
  let childError;
  child.once("error", (error) => {
    childError = error;
  });
  return new Promise((resolvePromise) => {
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal, childError });
    });
  });
}

function createConfirmedTeardown(child, exactClose, confirmationMs = CHILD_TEARDOWN_CONFIRM_MS) {
  let teardown;
  return (cause) => {
    if (teardown !== undefined) return teardown;
    teardown = new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        rejectPromise(new Error(`EXACT_CHILD_TEARDOWN_UNCONFIRMED: ${cause}`));
      }, confirmationMs);
      exactClose.then((result) => {
        clearTimeout(timeout);
        resolvePromise(result);
      });
      try {
        child.kill();
      } catch {
        // A signalling failure is not teardown evidence. Keep waiting for the
        // exact child's close event until the confirmation deadline.
      }
    });
    return teardown;
  };
}

function waitForExit(exactClose, confirmTeardown, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settling = false;
    const timeout = setTimeout(() => {
      if (settling) return;
      settling = true;
      confirmTeardown("CHILD_TIMEOUT").then(
        () => rejectPromise(new Error(
          `CHILD_TIMEOUT_AFTER_CONFIRMED_CLOSE: proof child exceeded ${timeoutMs} ms`,
        )),
        rejectPromise,
      );
    }, timeoutMs);
    exactClose.then(({ code, signal, childError }) => {
      if (settling) return;
      settling = true;
      clearTimeout(timeout);
      if (childError !== undefined) {
        rejectPromise(childError);
      } else {
        resolvePromise({ code, signal });
      }
    });
  });
}

function assertSuccess(result, mode) {
  assert.deepEqual(result.exit, { code: 0, signal: null });
  assert.equal(result.stderr.toString("utf8"), "");
  assert.equal(result.metadata.status, "ok");
  assert.equal(result.metadata.mode, mode);
  assert.equal(result.metadata.fd3, "node_to_helper_output");
  assert.equal(result.metadata.fd4, "helper_to_node_source_catalog");
}

function parseSingleJsonLine(bytes) {
  const text = bytes.toString("utf8");
  assert.ok(text.endsWith("\n"), "metadata was not newline terminated");
  assert.equal(text.indexOf("\n"), text.length - 1, "metadata contained multiple lines");
  return JSON.parse(text);
}

function deterministicBytes(length, multiplier, addend) {
  const bytes = Buffer.allocUnsafe(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * multiplier + addend) & 0xff;
  }
  return bytes;
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
