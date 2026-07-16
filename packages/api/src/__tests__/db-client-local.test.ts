import { describe, expect, it } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { createDb, isLocalDatabaseUrl } from "../db/client.js";

// ---------------------------------------------------------------------------
// Local dev-database routing (Diary Slice 4, T-518). The serverless driver is
// WebSocket-only, so a localhost DATABASE_URL must be routed through the
// neon-proxy container from infra/dev-db/docker-compose.yml — and, just as
// load-bearing, a real Neon URL must NEVER trip that branch.
// ---------------------------------------------------------------------------

const NEON_URL =
  "postgresql://user:redacted@ep-example-123456-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://postgres:postgres@localhost:54329/omnitwin_dev";

describe("isLocalDatabaseUrl", () => {
  it("recognises localhost and 127.0.0.1", () => {
    expect(isLocalDatabaseUrl(LOCAL_URL)).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://a:b@127.0.0.1:5432/db")).toBe(true);
  });

  it("never claims a Neon host or malformed URL", () => {
    expect(isLocalDatabaseUrl(NEON_URL)).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
    // A host merely CONTAINING localhost is not local.
    expect(isLocalDatabaseUrl("postgresql://a:b@localhost.evil.example/db")).toBe(false);
  });
});

describe("createDb local proxy branch", () => {
  // Order matters: neonConfig is a module singleton, so the non-local case
  // must be asserted first, while the config is still pristine.
  it("leaves neonConfig untouched for a Neon URL", () => {
    createDb(NEON_URL);
    expect(neonConfig.useSecureWebSocket).toBe(true);
  });

  it("guards the pool against idle-client errors killing the process", async () => {
    // An idle pooled client's 'error' event is fatal without a listener
    // (observed live in Slice 4). Pin the handler's presence in source.
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const source = await readFile(resolve("src/db/client.ts"), "utf-8");
    expect(source).toContain('pool.on("error"');
  });

  it("routes a localhost URL through the dev proxy on 54331", () => {
    createDb(LOCAL_URL);
    expect(neonConfig.useSecureWebSocket).toBe(false);
    expect(neonConfig.pipelineConnect).toBe(false);
    const proxy = neonConfig.wsProxy;
    expect(typeof proxy).toBe("function");
    if (typeof proxy === "function") {
      expect(proxy("localhost", 54329)).toBe("localhost:54331/v1");
    }
  });
});
