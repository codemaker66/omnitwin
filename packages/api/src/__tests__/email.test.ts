import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  newEnquiryNotification,
  enquiryApproved,
  enquiryRejected,
} from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// Email template tests
// ---------------------------------------------------------------------------

describe("newEnquiryNotification", () => {
  const baseData = {
    spaceName: "Grand Hall",
    eventType: "Wedding",
    contactName: "Jane Smith",
    contactEmail: "jane@example.com",
    contactPhone: "+441234567890",
    eventDate: "2026-06-15",
    guestCount: 120,
    message: "We'd love to host our reception here.",
    dashboardUrl: "http://localhost:5173/dashboard",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = newEnquiryNotification(baseData);
    expect(subject).toContain("Grand Hall");
  });

  it("includes event type in subject", () => {
    const { subject } = newEnquiryNotification(baseData);
    expect(subject).toContain("Wedding");
  });

  it("includes contact info in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("jane@example.com");
    expect(html).toContain("Jane Smith");
    expect(html).toContain("+441234567890");
  });

  it("includes event details in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("2026-06-15");
    expect(html).toContain("120");
  });

  it("includes message in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("reception here");
  });

  it("includes dashboard link", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("http://localhost:5173/dashboard");
  });

  it("handles null event type gracefully", () => {
    const { subject, html } = newEnquiryNotification({ ...baseData, eventType: null });
    expect(subject).toBe("New enquiry for Grand Hall");
    expect(html).toContain("Grand Hall");
  });

  it("handles null message gracefully", () => {
    const { html } = newEnquiryNotification({ ...baseData, message: null });
    expect(html).not.toContain("reception here");
  });
});

describe("enquiryApproved", () => {
  const baseData = {
    venueName: "Trades Hall Glasgow",
    spaceName: "Grand Hall",
    eventDate: "2026-06-15",
    configUrl: "http://localhost:5173/editor/config-123",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = enquiryApproved(baseData);
    expect(subject).toContain("Grand Hall");
    expect(subject).toContain("approved");
  });

  it("includes venue name in body", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("Trades Hall Glasgow");
  });

  it("includes event date in body", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("2026-06-15");
  });

  it("includes config link", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("editor/config-123");
  });

  it("handles null configUrl", () => {
    const { html } = enquiryApproved({ ...baseData, configUrl: null });
    expect(html).not.toContain("View Your Layout");
  });
});

describe("enquiryRejected", () => {
  const baseData = {
    venueName: "Trades Hall Glasgow",
    spaceName: "Grand Hall",
    eventDate: "2026-06-15",
    note: "Space is booked for that date",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = enquiryRejected(baseData);
    expect(subject).toContain("Grand Hall");
  });

  it("includes note when provided", () => {
    const { html } = enquiryRejected(baseData);
    expect(html).toContain("Space is booked for that date");
  });

  it("works without note", () => {
    const { html } = enquiryRejected({ ...baseData, note: null });
    expect(html).not.toContain("Note from the events team");
    expect(html).toContain("alternative");
  });

  it("includes venue name", () => {
    const { html } = enquiryRejected(baseData);
    expect(html).toContain("Trades Hall Glasgow");
  });
});

// ---------------------------------------------------------------------------
// sendEmail — pipeline behaviour (idempotency, retry, dev mode, logging)
//
// These tests use a hand-rolled in-memory fake of the Drizzle `db.insert
// (...).values(...)` and `db.update(...).set(...).where(...)` chains so
// we don't need a live Postgres. The Resend client is mocked at the
// package boundary.
// ---------------------------------------------------------------------------

interface FakeRow {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  status: string;
  providerMessageId: string | null;
  lastError: string | null;
  attemptCount: number;
  sentAt: Date | null;
}

interface FakeDb {
  rows: FakeRow[];
  insert: (_: unknown) => { values: (v: Partial<FakeRow>) => Promise<void> };
  update: (_: unknown) => {
    set: (patch: Partial<FakeRow>) => {
      where: (_: unknown) => Promise<void>;
    };
  };
}

function makeFakeDb(): FakeDb & { __lastUpdateKey: string | null } {
  const rows: FakeRow[] = [];
  let lastUpdateKey: string | null = null;
  const fake = {
    rows,
    __lastUpdateKey: lastUpdateKey,
    insert: (_table: unknown) => ({
      values: (v: Partial<FakeRow>): Promise<void> => {
        const key = v.idempotencyKey ?? "";
        if (rows.some((r) => r.idempotencyKey === key)) {
          // Mimic Postgres error code 23505 (unique_violation) so the
          // email module's isUniqueViolation() helper catches it.
          const err = Object.assign(
            new Error("duplicate key value violates unique constraint"),
            { code: "23505" },
          );
          return Promise.reject(err);
        }
        rows.push({
          idempotencyKey: key,
          recipient: v.recipient ?? "",
          subject: v.subject ?? "",
          status: v.status ?? "pending",
          providerMessageId: null,
          lastError: null,
          attemptCount: 0,
          sentAt: null,
        });
        return Promise.resolve();
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: Partial<FakeRow>) => ({
        where: (_cond: unknown): Promise<void> => {
          // The only WHERE in email.ts is eq(emailSends.idempotencyKey, ...).
          // We pick the most-recent row — all the tests operate on a
          // single idempotency key at a time, so this is sufficient.
          const target = rows[rows.length - 1];
          if (target !== undefined) {
            if (patch.status !== undefined) target.status = patch.status;
            if (patch.providerMessageId !== undefined) target.providerMessageId = patch.providerMessageId;
            if (patch.lastError !== undefined) target.lastError = patch.lastError;
            if (patch.attemptCount !== undefined) target.attemptCount = patch.attemptCount;
            if (patch.sentAt !== undefined) target.sentAt = patch.sentAt;
            lastUpdateKey = target.idempotencyKey;
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  // Expose last-update tracker via getter so closures can observe it.
  Object.defineProperty(fake, "__lastUpdateKey", { get: () => lastUpdateKey });
  return fake as FakeDb & { __lastUpdateKey: string | null };
}

interface CapturedLog {
  level: "info" | "warn" | "error";
  obj: Record<string, unknown>;
  msg?: string;
}

function makeCaptureLogger(): { logs: CapturedLog[]; info: (o: Record<string, unknown>, m?: string) => void; warn: (o: Record<string, unknown>, m?: string) => void; error: (o: Record<string, unknown>, m?: string) => void } {
  const logs: CapturedLog[] = [];
  return {
    logs,
    info: (obj, msg) => { logs.push({ level: "info", obj, msg }); },
    warn: (obj, msg) => { logs.push({ level: "warn", obj, msg }); },
    error: (obj, msg) => { logs.push({ level: "error", obj, msg }); },
  };
}

// Mock the Resend SDK so we control every response shape.
const resendSendMock: ReturnType<typeof vi.fn> = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (...args: unknown[]): unknown => resendSendMock(...args) as unknown,
    };
  },
}));

// Import AFTER vi.mock so the mocked Resend is used.
const emailModule = await import("../services/email.js");
const { sendEmail, __resetResendClientForTests } = emailModule;

describe("sendEmail — idempotency", () => {
  const basePayload = { to: "alice@example.com", subject: "Hello", html: "<p>Hi</p>" };

  beforeEach(() => {
    resendSendMock.mockReset();
    delete process.env["RESEND_API_KEY"];
    __resetResendClientForTests();
  });

  it("inserts an audit row on the first send and marks it dev_mode when RESEND_API_KEY is unset", async () => {
    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    const ok = await sendEmail(basePayload, { db: db as never, idempotencyKey: "enquiry-approved:abc", logger });
    expect(ok).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.status).toBe("dev_mode");
    expect(logger.logs.some((l) => l.obj["event"] === "email.dev_mode_skip")).toBe(true);
  });

  it("a second call with the same idempotency key is a no-op (dedup skip), not a double send", async () => {
    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    const opts = { db: db as never, idempotencyKey: "enquiry-approved:abc", logger };

    const first = await sendEmail(basePayload, opts);
    const second = await sendEmail(basePayload, opts);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(db.rows).toHaveLength(1); // only one audit row exists
    expect(logger.logs.some((l) => l.obj["event"] === "email.dedup_skip")).toBe(true);
  });

  it("different idempotency keys produce independent audit rows", async () => {
    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    await sendEmail(basePayload, { db: db as never, idempotencyKey: "k1", logger });
    await sendEmail(basePayload, { db: db as never, idempotencyKey: "k2", logger });
    expect(db.rows.map((r) => r.idempotencyKey)).toEqual(["k1", "k2"]);
  });
});

describe("sendEmail — retry behaviour", () => {
  const basePayload = { to: "bob@example.com", subject: "Hi", html: "<p>Hi</p>" };

  beforeEach(() => {
    resendSendMock.mockReset();
    process.env["RESEND_API_KEY"] = "re_test_key";
    __resetResendClientForTests();
  });

  it("retries transient failures and succeeds on a later attempt", async () => {
    // First two attempts return a 500; third succeeds.
    resendSendMock
      .mockResolvedValueOnce({ error: { statusCode: 500, message: "boom" } })
      .mockResolvedValueOnce({ error: { statusCode: 503, message: "boom again" } })
      .mockResolvedValueOnce({ data: { id: "msg-42" }, error: null });

    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    const ok = await sendEmail(basePayload, {
      db: db as never,
      idempotencyKey: "k-retry",
      logger,
      sleep: () => Promise.resolve(), // zero-wait backoff for tests
    });

    expect(ok).toBe(true);
    expect(resendSendMock).toHaveBeenCalledTimes(3);
    expect(db.rows[0]?.status).toBe("sent");
    expect(db.rows[0]?.providerMessageId).toBe("msg-42");
    expect(db.rows[0]?.attemptCount).toBe(3);
    const sentEvent = logger.logs.find((l) => l.obj["event"] === "email.sent");
    expect(sentEvent).toBeDefined();
    expect(sentEvent?.obj["providerMessageId"]).toBe("msg-42");
  });

  it("does NOT retry a 4xx permanent failure — one attempt, row marked failed", async () => {
    resendSendMock.mockResolvedValueOnce({
      error: { statusCode: 400, message: "invalid address" },
    });

    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    const ok = await sendEmail(basePayload, {
      db: db as never,
      idempotencyKey: "k-perm-fail",
      logger,
      sleep: () => Promise.resolve(),
    });

    expect(ok).toBe(false);
    expect(resendSendMock).toHaveBeenCalledTimes(1); // no retry on 4xx
    expect(db.rows[0]?.status).toBe("failed");
    expect(db.rows[0]?.lastError).toContain("invalid address");
    expect(logger.logs.some((l) => l.obj["event"] === "email.send_failed")).toBe(true);
  });

  it("retries on network exceptions (no statusCode) and fails after exhausting attempts", async () => {
    // 5 attempts total (initial + 4 retries). All throw network-like errors.
    resendSendMock.mockRejectedValue(new Error("ECONNRESET"));

    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    const ok = await sendEmail(basePayload, {
      db: db as never,
      idempotencyKey: "k-net-fail",
      logger,
      sleep: () => Promise.resolve(),
    });

    expect(ok).toBe(false);
    expect(resendSendMock).toHaveBeenCalledTimes(5);
    expect(db.rows[0]?.status).toBe("failed");
    expect(db.rows[0]?.attemptCount).toBe(5);
    expect(db.rows[0]?.lastError).toContain("ECONNRESET");
  });

  it("retries a 429 rate-limit (transient) but not a 401 (permanent)", async () => {
    resendSendMock.mockResolvedValueOnce({ error: { statusCode: 429, message: "rate limited" } });
    resendSendMock.mockResolvedValueOnce({ data: { id: "msg-rl" }, error: null });

    const db1 = makeFakeDb();
    const ok1 = await sendEmail(basePayload, {
      db: db1 as never,
      idempotencyKey: "k-429",
      sleep: () => Promise.resolve(),
    });
    expect(ok1).toBe(true);
    expect(resendSendMock).toHaveBeenCalledTimes(2); // initial + 1 retry

    resendSendMock.mockReset();
    resendSendMock.mockResolvedValueOnce({ error: { statusCode: 401, message: "bad key" } });
    const db2 = makeFakeDb();
    const ok2 = await sendEmail(basePayload, {
      db: db2 as never,
      idempotencyKey: "k-401",
      sleep: () => Promise.resolve(),
    });
    expect(ok2).toBe(false);
    expect(resendSendMock).toHaveBeenCalledTimes(1); // no retry on 401
  });
});

describe("sendEmail — structured logging shape", () => {
  const basePayload = { to: "carol@example.com", subject: "Hi", html: "<p>Hi</p>" };

  beforeEach(() => {
    resendSendMock.mockReset();
    process.env["RESEND_API_KEY"] = "re_test_key";
    __resetResendClientForTests();
  });

  it("every log record includes event, idempotencyKey, and recipient", async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: "msg-1" }, error: null });
    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    await sendEmail(basePayload, {
      db: db as never,
      idempotencyKey: "k-log-shape",
      logger,
    });

    expect(logger.logs.length).toBeGreaterThan(0);
    for (const entry of logger.logs) {
      expect(entry.obj).toHaveProperty("event");
      expect(entry.obj).toHaveProperty("idempotencyKey", "k-log-shape");
      expect(entry.obj).toHaveProperty("recipient", "carol@example.com");
    }
  });

  it("success emits `email.sent` at info level with the provider message id", async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: "msg-xyz" }, error: null });
    const db = makeFakeDb();
    const logger = makeCaptureLogger();
    await sendEmail(basePayload, { db: db as never, idempotencyKey: "k-ok", logger });

    const sent = logger.logs.find((l) => l.obj["event"] === "email.sent");
    expect(sent).toBeDefined();
    expect(sent?.level).toBe("info");
    expect(sent?.obj["providerMessageId"]).toBe("msg-xyz");
  });
});
