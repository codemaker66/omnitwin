import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  type KeyObject,
  privateDecrypt,
  randomBytes,
} from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export const GRAND_HALL_ADMIN_TOKEN_RELAY_ENV =
  "RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN_RELAY";
export const GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV =
  "RUNTIME_PROFILE_INTAKE_EXPECTED_STAGING_WEB_ORIGIN";
export const GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE = "browser-loopback";
export const GRAND_HALL_ADMIN_TOKEN_RELAY_TIMEOUT_MS = 90_000;

const MAX_ENCRYPTED_TOKEN_BYTES = 20_000;
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const VERCEL_PREVIEW_SUFFIX = ".vercel.app";
const RELAY_CLOSE_GRACE_MS = 250;

export interface GrandHallAdminTokenRelayOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
  readonly timeoutMs?: number;
  readonly nonce?: string;
}

function expectedBrowserOrigin(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[GRAND_HALL_ADMIN_TOKEN_RELAY_BROWSER_ORIGIN_ENV];
  if (value === undefined || value.trim() !== value) {
    throw new Error("The exact staging browser origin is required for token relay");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The staging browser origin is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.port !== "" ||
    parsed.origin !== value ||
    parsed.hostname === "vercel.app" ||
    !parsed.hostname.endsWith(VERCEL_PREVIEW_SUFFIX)
  ) {
    throw new Error("Token relay requires the exact clean Vercel staging Preview origin");
  }
  return value;
}

function relayCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Vary", "Origin, Access-Control-Request-Private-Network");
}

function rejectRelayRequest(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Length": "0",
  });
  response.end();
}

function isAllowedRelayRequest(
  request: IncomingMessage,
  expectedOrigin: string,
  expectedPath: string,
): boolean {
  return request.url === expectedPath &&
    request.headers.origin === expectedOrigin &&
    request.headers.host === `127.0.0.1:${String(request.socket.localPort)}`;
}

function validateRelayedToken(value: string): string {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_ENCRYPTED_TOKEN_BYTES ||
    value.trim() !== value ||
    /[\r\n]/u.test(value) ||
    value.includes("\0")
  ) {
    throw new Error("The relayed staging session token is invalid");
  }
  return value;
}

function decryptRelayedToken(envelope: Buffer, privateKey: KeyObject): string {
  let aesKey: Buffer | null = null;
  let plaintext: Buffer | null = null;
  try {
    if (envelope.byteLength < 3 + AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES + 1) {
      throw new Error("Encrypted relay envelope is too short");
    }
    if (envelope[0] !== 1) throw new Error("Encrypted relay envelope version is invalid");
    const wrappedKeyBytes = envelope.readUInt16BE(1);
    const wrappedKeyStart = 3;
    const wrappedKeyEnd = wrappedKeyStart + wrappedKeyBytes;
    const ivEnd = wrappedKeyEnd + AES_GCM_IV_BYTES;
    if (wrappedKeyBytes === 0 || ivEnd + AES_GCM_TAG_BYTES >= envelope.byteLength) {
      throw new Error("Encrypted relay envelope boundaries are invalid");
    }
    aesKey = privateDecrypt({
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, envelope.subarray(wrappedKeyStart, wrappedKeyEnd));
    if (aesKey.byteLength !== AES_KEY_BYTES) {
      throw new Error("Encrypted relay key has an invalid length");
    }
    const encryptedToken = envelope.subarray(ivEnd, -AES_GCM_TAG_BYTES);
    const authTag = envelope.subarray(-AES_GCM_TAG_BYTES);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      aesKey,
      envelope.subarray(wrappedKeyEnd, ivEnd),
    );
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(encryptedToken), decipher.final()]);
    return validateRelayedToken(plaintext.toString("utf8"));
  } finally {
    aesKey?.fill(0);
    plaintext?.fill(0);
    envelope.fill(0);
  }
}

function browserRelayCommand(relayUrl: string, publicKeySpkiBase64: string): string {
  return [
    "await (async()=>{",
    `const p=Uint8Array.from(atob(${JSON.stringify(publicKeySpkiBase64)}),c=>c.charCodeAt(0));`,
    "const r=await crypto.subtle.importKey(\"spki\",p,{name:\"RSA-OAEP\",hash:\"SHA-256\"},false,[\"encrypt\"]);",
    "const a=await crypto.subtle.generateKey({name:\"AES-GCM\",length:256},true,[\"encrypt\"]);",
    "const k=new Uint8Array(await crypto.subtle.exportKey(\"raw\",a));",
    "const w=new Uint8Array(await crypto.subtle.encrypt({name:\"RSA-OAEP\"},r,k));",
    "const i=crypto.getRandomValues(new Uint8Array(12));",
    "const t=new TextEncoder().encode(await window.Clerk.session.getToken({skipCache:true}));",
    "let c,b;try{",
    "c=new Uint8Array(await crypto.subtle.encrypt({name:\"AES-GCM\",iv:i},a,t));",
    "b=new Uint8Array(3+w.length+i.length+c.length);b[0]=1;new DataView(b.buffer).setUint16(1,w.length);",
    "b.set(w,3);b.set(i,3+w.length);b.set(c,3+w.length+i.length);",
    `return await fetch(${JSON.stringify(relayUrl)},{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:b,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});`,
    "}finally{k.fill(0);t.fill(0);c?.fill(0);b?.fill(0);}})()",
  ].join("");
}

export async function receiveGrandHallAdminTokenFromBrowser(
  options: GrandHallAdminTokenRelayOptions,
): Promise<string> {
  const expectedOrigin = expectedBrowserOrigin(options.env);
  const timeoutMs = options.timeoutMs ?? GRAND_HALL_ADMIN_TOKEN_RELAY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5 * 60_000) {
    throw new Error("The browser token relay timeout is invalid");
  }
  const nonce = options.nonce ?? randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/u.test(nonce)) {
    throw new Error("The browser token relay nonce is invalid");
  }
  const expectedPath = `/venviewer-grand-hall-token/${nonce}`;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const publicKeySpkiBase64 = publicKey.export({
    type: "spki",
    format: "der",
  }).toString("base64");

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let closeWatchdog: NodeJS.Timeout | null = null;
    let outcomeDelivered = false;
    const activeSockets = new Set<Socket>();
    const settle = (
      outcome: { readonly token: string } | { readonly error: Error },
      responseSocket?: Socket,
    ): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      const deliverOutcome = (): void => {
        if (outcomeDelivered) return;
        outcomeDelivered = true;
        if (closeWatchdog !== null) clearTimeout(closeWatchdog);
        if ("token" in outcome) resolve(outcome.token);
        else reject(outcome.error);
      };
      try {
        server.close(deliverOutcome);
      } catch {
        for (const socket of activeSockets) socket.destroy();
        deliverOutcome();
        return;
      }
      // A different allowed peer may have left a partial body open. Close it
      // immediately; give only the terminal response socket a brief flush
      // window, then force-close everything and settle regardless of peers.
      for (const socket of activeSockets) {
        if (socket !== responseSocket) socket.destroy();
      }
      if (outcomeDelivered) return;
      closeWatchdog = setTimeout(() => {
        for (const socket of activeSockets) socket.destroy();
        deliverOutcome();
      }, RELAY_CLOSE_GRACE_MS);
    };
    const server = createServer((request, response) => {
      if (!isAllowedRelayRequest(request, expectedOrigin, expectedPath)) {
        rejectRelayRequest(response, 403);
        return;
      }
      relayCorsHeaders(response, expectedOrigin);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Content-Length": "0" });
        response.end();
        return;
      }
      if (
        request.method !== "POST" ||
        request.headers["content-type"]?.toLowerCase() !== "application/octet-stream"
      ) {
        rejectRelayRequest(response, 415);
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      request.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_ENCRYPTED_TOKEN_BYTES) {
          request.destroy();
          settle({ error: new Error("The relayed staging session token exceeded its limit") });
          return;
        }
        chunks.push(chunk);
      });
      request.on("error", () => {
        settle({ error: new Error("The browser token relay request failed safely") });
      });
      request.on("end", () => {
        let token: string;
        try {
          token = decryptRelayedToken(Buffer.concat(chunks), privateKey);
        } catch (error) {
          rejectRelayRequest(response, 400);
          settle({
            error: error instanceof Error
              ? error
              : new Error("The relayed staging session token is invalid"),
          }, request.socket);
          return;
        }
        response.writeHead(204, { "Content-Length": "0" });
        response.end();
        settle({ token }, request.socket);
      });
    });
    server.on("error", () => {
      settle({ error: new Error("The local browser token relay could not start safely") });
    });
    server.on("connection", (socket: Socket) => {
      activeSockets.add(socket);
      socket.once("close", () => {
        activeSockets.delete(socket);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        settle({ error: new Error("The local browser token relay address is invalid") });
        return;
      }
      const relayUrl = `http://127.0.0.1:${String(address.port)}${expectedPath}`;
      options.log("In the signed-in staging browser console, run this one-time non-secret command:");
      options.log(browserRelayCommand(relayUrl, publicKeySpkiBase64));
      options.log("Only one-time encrypted ciphertext will cross the browser network boundary.");
      timer = setTimeout(() => {
        settle({ error: new Error("The local browser token relay timed out") });
      }, timeoutMs);
    });
  });
}
