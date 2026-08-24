import { describe, expect, it, vi } from "vitest";
import {
  constants,
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { createConnection } from "node:net";
import {
  GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV,
  receiveGrandHallAdminTokenFromBrowser,
} from "../scripts/grand-hall-admin-token-loopback-relay.js";

const PREVIEW_ORIGIN = "https://codex-grand-hall-venviewer.vercel.app";
const NONCE = "a".repeat(64);

function encryptedTokenEnvelope(publicKeySpkiBase64: string, token: string): Buffer {
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const plaintext = Buffer.from(token, "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrappedKey = publicEncrypt({
      key: createPublicKey({
        key: Buffer.from(publicKeySpkiBase64, "base64"),
        format: "der",
        type: "spki",
      }),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, aesKey);
    const envelope = Buffer.alloc(3 + wrappedKey.byteLength + iv.byteLength + encrypted.byteLength + tag.byteLength);
    envelope[0] = 1;
    envelope.writeUInt16BE(wrappedKey.byteLength, 1);
    wrappedKey.copy(envelope, 3);
    iv.copy(envelope, 3 + wrappedKey.byteLength);
    encrypted.copy(envelope, 3 + wrappedKey.byteLength + iv.byteLength);
    tag.copy(envelope, envelope.byteLength - tag.byteLength);
    return envelope;
  } finally {
    aesKey.fill(0);
    plaintext.fill(0);
  }
}

describe("Grand Hall browser-to-process admin-token relay", () => {
  it("accepts one token only from the exact staging Preview origin without logging it", async () => {
    const log = vi.fn<(line: string) => void>();
    const token = "header.payload.signature-secret-never-log";
    const receiving = receiveGrandHallAdminTokenFromBrowser({
      env: {
        [GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV]: PREVIEW_ORIGIN,
      },
      log,
      nonce: NONCE,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalled();
    });
    const command = log.mock.calls.map(([line]) => line).find((line) =>
      line.includes("http://127.0.0.1:"));
    const relayUrl = command?.match(/http:\/\/127\.0\.0\.1:\d+\/venviewer-grand-hall-token\/[a-f0-9]{64}/u)?.[0];
    const publicKeySpkiBase64 = command?.match(/atob\("([A-Za-z0-9+/=]+)"\)/u)?.[1];
    expect(relayUrl).toBeDefined();
    expect(publicKeySpkiBase64).toBeDefined();
    if (relayUrl === undefined || publicKeySpkiBase64 === undefined) {
      throw new Error("Relay URL or public key was not logged");
    }
    const encryptedToken = encryptedTokenEnvelope(publicKeySpkiBase64, token);
    expect(encryptedToken.includes(Buffer.from(token, "utf8"))).toBe(false);

    const rejected = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Origin: "https://wrong.vercel.app" },
      body: encryptedToken,
    });
    expect(rejected.status).toBe(403);

    const preflight = await fetch(relayUrl, {
      method: "OPTIONS",
      headers: {
        Origin: PREVIEW_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(PREVIEW_ORIGIN);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const accepted = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Origin: PREVIEW_ORIGIN },
      body: encryptedToken,
    });
    expect(accepted.status).toBe(204);
    await expect(receiving).resolves.toBe(token);
    expect(log.mock.calls.flat().join("\n")).not.toContain(token);
  });

  it("rejects a production/custom origin before opening a listener", async () => {
    await expect(receiveGrandHallAdminTokenFromBrowser({
      env: {
        [GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV]: "https://venviewer.com",
      },
      log: vi.fn(),
      nonce: NONCE,
    })).rejects.toThrow("Vercel staging Preview origin");
  });

  it("force-closes an incomplete allowed POST when the relay times out", async () => {
    const log = vi.fn<(line: string) => void>();
    const receiving = receiveGrandHallAdminTokenFromBrowser({
      env: {
        [GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV]: PREVIEW_ORIGIN,
      },
      log,
      nonce: NONCE,
      timeoutMs: 75,
    });
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalled();
    });
    const command = log.mock.calls.map(([line]) => line).find((line) =>
      line.includes("http://127.0.0.1:"));
    const relayUrlText = command?.match(
      /http:\/\/127\.0\.0\.1:\d+\/venviewer-grand-hall-token\/[a-f0-9]{64}/u,
    )?.[0];
    if (relayUrlText === undefined) throw new Error("Relay URL was not logged");
    const relayUrl = new URL(relayUrlText);
    const socket = createConnection({
      host: relayUrl.hostname,
      port: Number(relayUrl.port),
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write([
        `POST ${relayUrl.pathname} HTTP/1.1`,
        `Host: ${relayUrl.host}`,
        `Origin: ${PREVIEW_ORIGIN}`,
        "Content-Type: application/octet-stream",
        "Content-Length: 1000",
        "Connection: keep-alive",
        "",
        "x",
      ].join("\r\n"));

      const outcome = await Promise.race([
        receiving.then(
          () => "unexpected-success" as const,
          (error: unknown) => error,
        ),
        new Promise<"still-pending">((resolve) => {
          setTimeout(() => {
            resolve("still-pending");
          }, 500);
        }),
      ]);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toBe("The local browser token relay timed out");
    } finally {
      socket.destroy();
      await receiving.catch(() => undefined);
    }
  });

  it("cannot hang on a terminal malformed request while another peer holds a body open", async () => {
    const log = vi.fn<(line: string) => void>();
    const receiving = receiveGrandHallAdminTokenFromBrowser({
      env: {
        [GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV]: PREVIEW_ORIGIN,
      },
      log,
      nonce: NONCE,
      timeoutMs: 5_000,
    });
    const terminalOutcome = receiving.then(
      () => "unexpected-success" as const,
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalled();
    });
    const command = log.mock.calls.map(([line]) => line).find((line) =>
      line.includes("http://127.0.0.1:"));
    const relayUrlText = command?.match(
      /http:\/\/127\.0\.0\.1:\d+\/venviewer-grand-hall-token\/[a-f0-9]{64}/u,
    )?.[0];
    if (relayUrlText === undefined) throw new Error("Relay URL was not logged");
    const relayUrl = new URL(relayUrlText);
    const heldSocket = createConnection({
      host: relayUrl.hostname,
      port: Number(relayUrl.port),
    });
    try {
      await new Promise<void>((resolve, reject) => {
        heldSocket.once("connect", resolve);
        heldSocket.once("error", reject);
      });
      heldSocket.write([
        `POST ${relayUrl.pathname} HTTP/1.1`,
        `Host: ${relayUrl.host}`,
        `Origin: ${PREVIEW_ORIGIN}`,
        "Content-Type: application/octet-stream",
        "Content-Length: 1000",
        "Connection: keep-alive",
        "",
        "x",
      ].join("\r\n"));

      const malformed = await fetch(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", Origin: PREVIEW_ORIGIN },
        body: Buffer.from([1]),
      });
      expect(malformed.status).toBe(400);
      const outcome = await Promise.race([
        terminalOutcome,
        new Promise<"still-pending">((resolve) => {
          setTimeout(() => {
            resolve("still-pending");
          }, 1_000);
        }),
      ]);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain("Encrypted relay envelope");
    } finally {
      heldSocket.destroy();
      await receiving.catch(() => undefined);
    }
  });
});
