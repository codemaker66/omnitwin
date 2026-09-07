import { randomUUID } from "node:crypto";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { Pool as PgPool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb, createDbConnection, isLocalDatabaseUrl } from "../db/client.js";

const NEON_URL = "postgresql://user:redacted@ep-example.eu-west-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://postgres@127.0.0.1:55477/venviewer_platform_test";
const initialNeonConfig = {
  wsProxy: neonConfig.wsProxy,
  useSecureWebSocket: neonConfig.useSecureWebSocket,
  pipelineTLS: neonConfig.pipelineTLS,
  pipelineConnect: neonConfig.pipelineConnect,
};

afterEach(() => {
  Object.assign(neonConfig, initialNeonConfig);
  vi.restoreAllMocks();
});

describe("isLocalDatabaseUrl", () => {
  it.each([
    LOCAL_URL,
    "postgresql://postgres@localhost:54329/dev",
    "postgres://postgres@[::1]:55477/dev",
  ])("recognises a PostgreSQL loopback URL: %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([NEON_URL, "not a url", "postgresql://localhost.example/db", "https://localhost/db"])(
    "does not classify a remote or non-PostgreSQL URL as local: %s", (url) => {
      expect(isLocalDatabaseUrl(url)).toBe(false);
    },
  );
});

describe("database pool ownership", () => {
  it.each(["tcp", "neon"] as const)("owns a %s pool with an idle-error listener and idempotent close", async (transport) => {
    const PoolClass = transport === "tcp" ? PgPool : NeonPool;
    const listen = vi.spyOn(PoolClass.prototype, "on");
    const end = vi.spyOn(PoolClass.prototype, "end");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = createDbConnection(transport === "tcp" ? LOCAL_URL : NEON_URL);
    const pool = listen.mock.contexts[0];
    if (!(pool instanceof PgPool || pool instanceof NeonPool)) throw new Error("Pool listener was not installed");
    expect(pool).toBeInstanceOf(PoolClass);
    expect(listen.mock.calls[0]?.[0]).toBe("error");
    const failure = new Error("Idle connection dropped");
    expect(() => { pool.emit("error", failure); }).not.toThrow();
    expect(log).toHaveBeenCalledWith("[db] idle client error:", failure.message);
    const closing = connection.close();
    expect(connection.close()).toBe(closing);
    await closing;
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("preserves Neon settings when local and remote databases are mixed", async () => {
    const proxy = () => "configured.example/v1";
    neonConfig.wsProxy = proxy;
    neonConfig.useSecureWebSocket = true;
    neonConfig.pipelineTLS = true;
    neonConfig.pipelineConnect = "password";
    const connections = [createDbConnection(LOCAL_URL), createDbConnection(NEON_URL), createDbConnection(LOCAL_URL)];
    try {
      expect(neonConfig.wsProxy).toBe(proxy);
      expect(neonConfig.useSecureWebSocket).toBe(true);
      expect(neonConfig.pipelineTLS).toBe(true);
      expect(neonConfig.pipelineConnect).toBe("password");
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });

  it("keeps the existing database-only query interface", async () => {
    const listen = vi.spyOn(PgPool.prototype, "on");
    const db = createDb(LOCAL_URL);
    expect(typeof db.transaction).toBe("function");
    expect(typeof db.select).toBe("function");
    const pool = listen.mock.contexts[0];
    if (!(pool instanceof PgPool)) throw new Error("Pool listener was not installed");
    await pool.end();
  });
});

// Dedicated opt-in fixture only. Never read DATABASE_URL or load an env file.
const explicitTarget = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (explicitTarget !== undefined) {
  const url = new URL(explicitTarget);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Database client tests require their explicit disposable platform database");
  }
}

describe.skipIf(explicitTarget === undefined)("local database client on real PostgreSQL", () => {
  it("uses the URL port, commits and rolls back transactions, then closes the owned backend", async () => {
    if (explicitTarget === undefined) throw new Error("Explicit local database target required");
    const connection = createDbConnection(explicitTarget);
    const observer = new PgPool({ connectionString: explicitTarget, max: 1 });
    const namespace = `client_${randomUUID().replaceAll("-", "")}`;
    const table = sql`${sql.identifier(namespace)}.probe`;
    let created = false;
    try {
      const target = await connection.db.execute<{ database: string; host: string; port: number; pid: number }>(
        sql`SELECT current_database() AS database, host(inet_server_addr()) AS host,
          inet_server_port() AS port, pg_backend_pid() AS pid`,
      );
      expect(target.rows[0]?.database).toBe("venviewer_platform_test");
      // A Docker port forward preserves the requested endpoint but PostgreSQL
      // reports its container address and internal port, not host port 55477.
      expect(target.rows[0]?.host).toBeTypeOf("string");
      expect(target.rows[0]?.port).toBeGreaterThan(0);
      const backendPid = target.rows[0]?.pid;
      expect(backendPid).toBeGreaterThan(0);
      await connection.db.execute(sql`CREATE SCHEMA ${sql.identifier(namespace)}`);
      created = true;
      await connection.db.execute(sql`CREATE TABLE ${table} (value integer NOT NULL)`);
      await connection.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO ${table} (value) VALUES (1)`);
      });
      await expect(connection.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO ${table} (value) VALUES (2)`);
        throw new Error("rollback probe");
      })).rejects.toThrow("rollback probe");
      // Independent connection proves committed visibility and failed-write absence.
      expect((await observer.query<{ value: number }>(`SELECT value FROM "${namespace}".probe ORDER BY value`)).rows)
        .toEqual([{ value: 1 }]);
      await connection.close();
      await expect.poll(async () => Number((await observer.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE pid = $1", [backendPid],
      )).rows[0]?.count)).toBe(0);
      await expect(connection.db.execute(sql`SELECT 1`)).rejects.toThrow();
    } finally {
      await connection.close();
      if (created) await observer.query(`DROP SCHEMA "${namespace}" CASCADE`);
      await observer.end();
    }
  });
});
