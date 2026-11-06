/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Field web vitals at p75 (goal 07, S8's report) — read-only.
//
// Usage:
//   DATABASE_URL=<connection-string> pnpm --filter @omnitwin/api web-vitals:report [days]
//
// Prints each vital's 75th percentile over the last `days` (default 28), by
// device class across every page and by page, beside goal 07's target. It
// reads web_vital_samples only and writes nothing.
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDbConnection } from "../db/client.js";
import { webVitalsP75, type WebVitalP75 } from "../services/web-vitals.js";

export function formatP75Line(row: WebVitalP75): string {
  const value = row.metric === "CLS" ? row.p75.toFixed(3) : `${String(Math.round(row.p75))} ms`;
  const target = row.metric === "CLS" ? String(row.target) : `${String(row.target)} ms`;
  return `${row.metric.padEnd(4)} ${row.device.padEnd(7)} ${(row.page ?? "(every page)").padEnd(32)} p75 ${value.padStart(9)}  target ${target}  ${row.meetsTarget ? "meets" : "MISSES"}  n=${String(row.samples)}`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("[web-vitals] DATABASE_URL is not set");
    process.exit(1);
  }
  const days = Number(process.argv[2] ?? "28");
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    console.error("[web-vitals] days must be a whole number from 1 to 90");
    process.exit(1);
  }
  const connection = createDbConnection(databaseUrl);
  try {
    const rows = await webVitalsP75(connection.db, days);
    console.log(`[web-vitals] p75 over the last ${String(days)} day(s); ${String(rows.length)} line(s)`);
    for (const row of rows) console.log(formatP75Line(row));
  } finally {
    await connection.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((err: unknown) => {
    console.error("[web-vitals] Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
