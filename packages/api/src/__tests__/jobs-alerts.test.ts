import { describe, expect, it } from "vitest";
import {
  buildJobAlerts,
  buildOwnScope,
  logJobAlerts,
  sentryJobAlerts,
  type JobAlertsSentryClient,
  type SentryCheckIn,
  type SentryMessageContext,
  type SentryMonitorConfig,
} from "../services/jobs/alerts.js";
import { jobErrorText, type JobLogger } from "../services/jobs/kinds.js";

// T-702: who is told when the job list gives up. The Sentry reporter is
// tested through a stand-in client of the reporter's own small interface, so
// no module is mocked and nothing leaves the process. Every alert carries the
// kind, the job's id and the venue's id, and any text has been scrubbed.

interface SentMessage {
  readonly message: string;
  readonly level: SentryMessageContext["level"];
  readonly tags: SentryMessageContext["tags"];
  readonly fingerprint: readonly string[];
}

interface SentCheckIn {
  readonly checkIn: SentryCheckIn;
  readonly monitorConfig: SentryMonitorConfig;
}

interface LogEntry {
  readonly level: "info" | "warn" | "error";
  readonly obj: Record<string, unknown>;
  readonly msg: string | undefined;
}

function captureSentry(options: { readonly throws?: boolean } = {}): {
  readonly client: JobAlertsSentryClient;
  readonly sent: SentMessage[];
  readonly checkIns: SentCheckIn[];
} {
  const sent: SentMessage[] = [];
  const checkIns: SentCheckIn[] = [];
  const client: JobAlertsSentryClient = {
    captureMessage: (message, context) => {
      if (options.throws === true) throw new Error("Sentry is unreachable");
      sent.push({ message, level: context.level, tags: { ...context.tags }, fingerprint: [...context.fingerprint] });
      return "event-id";
    },
    captureCheckIn: (checkIn, monitorConfig) => {
      if (options.throws === true) throw new Error("Sentry is unreachable");
      checkIns.push({ checkIn, monitorConfig });
      return "check-in-id";
    },
  };
  return { client, sent, checkIns };
}

function recordingLogger(): JobLogger & { readonly entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (obj, msg) => { entries.push({ level: "info", obj, msg }); },
    warn: (obj, msg) => { entries.push({ level: "warn", obj, msg }); },
    error: (obj, msg) => { entries.push({ level: "error", obj, msg }); },
  };
}

const ADDRESS_REFUSAL = new Error("refused ada@example.org");

function deadEvent(jobId: string): SentMessage {
  const { client, sent } = captureSentry();
  sentryJobAlerts(client, recordingLogger()).jobDead({ id: jobId, kind: "email.send", venueId: "v1", reason: "the provider refused it" });
  const [event] = sent;
  if (event === undefined) throw new Error("Nothing was sent");
  return event;
}

function fingerprintOf(event: SentMessage): readonly string[] {
  return event.fingerprint;
}

describe("jobs: the Sentry reporter", () => {
  it("an alert carries the kind, the job and the venue, and no address", () => {
    const { client, sent } = captureSentry();
    const alerts = sentryJobAlerts(client, recordingLogger());
    alerts.jobDead({ id: "j1", kind: "email.send", venueId: "v1", reason: jobErrorText(ADDRESS_REFUSAL) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: "error", tags: { "job.kind": "email.send", "job.id": "j1", "venue.id": "v1" } });
    expect(JSON.stringify(sent[0])).not.toContain("@");
  });

  it("scrubs a reason that still holds an address before it is sent", () => {
    const { client, sent } = captureSentry();
    sentryJobAlerts(client, recordingLogger()).jobDead({ id: "j1", kind: "email.send", venueId: null, reason: "refused ada@example.org?token=abc" });
    expect(JSON.stringify(sent)).not.toContain("@");
    expect(JSON.stringify(sent)).not.toContain("token=abc");
  });

  it("groups one job's alerts together and keeps different jobs apart", () => {
    expect(fingerprintOf(deadEvent("j1"))).toEqual(fingerprintOf(deadEvent("j1")));
    expect(fingerprintOf(deadEvent("j1"))).not.toEqual(fingerprintOf(deadEvent("j2")));
  });

  it("keeps a dead job and a lost claim of the same job in different groups", () => {
    const { client, sent } = captureSentry();
    const alerts = sentryJobAlerts(client, recordingLogger());
    alerts.jobDead({ id: "j1", kind: "email.send", venueId: "v1", reason: "gave up" });
    alerts.claimLost({ id: "j1", kind: "email.send", venueId: "v1", lostClaims: 1 });
    expect(sent[0]?.fingerprint).not.toEqual(sent[1]?.fingerprint);
  });

  it("a lost claim is a warning with the job's fields and the count", () => {
    const { client, sent } = captureSentry();
    sentryJobAlerts(client, recordingLogger()).claimLost({ id: "j3", kind: "email.send", venueId: "v2", lostClaims: 1 });
    expect(sent[0]).toMatchObject({ level: "warning", tags: { "job.kind": "email.send", "job.id": "j3", "venue.id": "v2" } });
    expect(sent[0]?.message).toContain("1");
  });

  it("a platform job carries no venue tag", () => {
    const { client, sent } = captureSentry();
    sentryJobAlerts(client, recordingLogger()).jobDead({ id: "j4", kind: "jobs.daily", venueId: null, reason: "gave up" });
    expect(sent[0]?.tags).toEqual({ "job.kind": "jobs.daily", "job.id": "j4" });
  });

  it("a worker fault is an error grouped by what failed, and its recovery is info in a group of its own", () => {
    const { client, sent } = captureSentry();
    const alerts = sentryJobAlerts(client, recordingLogger());
    alerts.workerFault("database", "claimNextJob failed: connection refused for ada@example.org");
    alerts.workerRecovered("database");
    alerts.workerFault("loop", "the pass threw");
    expect(sent[0]).toMatchObject({ level: "error", tags: { "job.worker.fault": "database" } });
    expect(sent[1]).toMatchObject({ level: "info", tags: { "job.worker.fault": "database" } });
    // A recovery never lands in the fault's group, where it would reopen a resolved issue.
    expect(sent[0]?.fingerprint).toEqual(["job.worker-fault", "database"]);
    expect(sent[1]?.fingerprint).toEqual(["job.worker-recovered", "database"]);
    expect(sent[2]?.fingerprint).toEqual(["job.worker-fault", "loop"]);
    expect(JSON.stringify(sent)).not.toContain("@");
  });

  it("work stuck on the list is an error in a group of its own, with no job's tags and the text scrubbed", () => {
    const { client, sent } = captureSentry();
    const alerts = sentryJobAlerts(client, recordingLogger());
    const detail = "unreadable jobs 1; seen by ada@example.org?token=abc";
    alerts.listStuck(detail);
    alerts.workerFault("loop", "the pass threw");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      message: `The job list has work stuck unseen: ${jobErrorText(detail)}`,
      level: "error",
      tags: {},
      fingerprint: ["job.list-stuck"],
    });
    // Never the worker's loop fault's group: muting one does not mute the other.
    expect(sent[0]?.fingerprint).not.toEqual(sent[1]?.fingerprint);
    expect(JSON.stringify(sent)).not.toContain("@");
    expect(JSON.stringify(sent)).not.toContain("token=abc");
  });

  it("a check-in tells the monitor it ran, creating it with a daily schedule", () => {
    const { client, sent, checkIns } = captureSentry();
    sentryJobAlerts(client, recordingLogger()).checkIn("job-list-daily");
    expect(sent).toEqual([]);
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]?.checkIn).toEqual({ monitorSlug: "job-list-daily", status: "ok" });
    expect(checkIns[0]?.monitorConfig.schedule).toEqual({ type: "interval", value: 1, unit: "day" });
    expect(checkIns[0]?.monitorConfig.checkinMargin).toBeGreaterThan(0);
  });

  it("an unreachable Sentry is logged, never thrown at the caller", () => {
    const { client } = captureSentry({ throws: true });
    const logger = recordingLogger();
    const alerts = sentryJobAlerts(client, logger);
    expect(() => {
      alerts.jobDead({ id: "j1", kind: "email.send", venueId: "v1", reason: "gave up" });
      alerts.checkIn("job-list-daily");
    }).not.toThrow();
    expect(logger.entries.filter((entry) => entry.level === "error")).toHaveLength(2);
  });
});

describe("jobs: the log reporter", () => {
  it("without a DSN it logs instead, at error level, with the same fields", async () => {
    const logger = recordingLogger();
    const alerts = await buildJobAlerts({ SENTRY_DSN: undefined }, logger);
    alerts.jobDead({ id: "j1", kind: "email.send", venueId: "v1", reason: jobErrorText(ADDRESS_REFUSAL) });
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: "error",
      obj: { alert: "job.dead", "job.kind": "email.send", "job.id": "j1", "venue.id": "v1" },
    });
    expect(JSON.stringify(logger.entries)).not.toContain("@");
  });

  it("logs each alert at its level, carrying only the job's fields and scrubbed text", () => {
    const logger = recordingLogger();
    const alerts = logJobAlerts(logger);
    alerts.claimLost({ id: "j2", kind: "email.send", venueId: null, lostClaims: 1 });
    alerts.workerFault("database", "refused ada@example.org");
    alerts.workerRecovered("database");
    alerts.checkIn("job-list-daily");
    expect(logger.entries.map((entry) => [entry.level, entry.obj["alert"]])).toEqual([
      ["warn", "job.claim-lost"],
      ["error", "job.worker-fault"],
      ["info", "job.worker-recovered"],
      ["info", "job.check-in"],
    ]);
    expect(logger.entries[0]?.obj).toEqual({ alert: "job.claim-lost", "job.kind": "email.send", "job.id": "j2", lostClaims: 1 });
    expect(logger.entries[1]?.obj).toMatchObject({ "job.worker.fault": "database" });
    expect(logger.entries[3]?.obj).toEqual({ alert: "job.check-in", monitor: "job-list-daily" });
    expect(JSON.stringify(logger.entries)).not.toContain("@");
  });

  it("logs work stuck on the list as an error of its own, with the scrubbed detail and no job's fields", () => {
    const logger = recordingLogger();
    logJobAlerts(logger).listStuck("unreadable jobs 1; seen by ada@example.org");
    expect(logger.entries).toEqual([{
      level: "error",
      obj: { alert: "job.list-stuck", detail: "unreadable jobs 1; seen by [email address]" },
      msg: "The job list has work stuck unseen: unreadable jobs 1; seen by [email address]",
    }]);
  });
});

describe("jobs: a scope of its own for each pass and job run", () => {
  it("without a DSN builds no scope, so the worker calls each run as it is", async () => {
    expect(await buildOwnScope({ SENTRY_DSN: undefined })).toBeUndefined();
  });

  it("with a DSN builds one, which answers what the run answers", async () => {
    // Not initialised here: the SDK's scopes work without a client, and nothing is sent.
    const withOwnScope = await buildOwnScope({ SENTRY_DSN: "http://public@127.0.0.1:9/1" });
    expect(withOwnScope).toBeTypeOf("function");
    expect(withOwnScope?.(() => 42)).toBe(42);
  });
});
