import { writeFile } from "node:fs/promises";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema.js";
import { seedInventoryReservationsFixture } from "../test-support/inventory-reservations-fixture.js";

// Deliberately inserts a fresh isolated fixture, never deletes or resets stock.
const databaseUrl = process.env["VENVIEWER_INVENTORY_TEST_DATABASE_URL"];
const outputPath = process.argv[2];
if (databaseUrl === undefined || outputPath === undefined) {
  throw new Error("Set the local VENVIEWER_INVENTORY_TEST_DATABASE_URL and supply a manifest output path");
}
const parsed = new URL(databaseUrl);
const allowedDatabases = ["/venviewer_inventory_20260905", "/venviewer_inventory_reservations_browser_20260905"];
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "54329" || !allowedDatabases.includes(parsed.pathname)) {
  throw new Error("Seed refused: requires a named dedicated local inventory database on port 54329");
}
neonConfig.wsProxy = (host) => `${host}:54331/v1`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;
const pool = new Pool({ connectionString: databaseUrl });
try {
  const db = drizzle(pool, { schema });
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const fixture = await db.transaction((tx) => seedInventoryReservationsFixture(tx, tomorrow.toISOString().slice(0, 10)));
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
} finally {
  await pool.end();
}
