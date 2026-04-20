import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// metrics — minimal Prometheus-compatible exporter
//
// Acquisition reviewers expect to be able to scrape operational
// signals without adding dependencies or running a heavy SDK. We
// emit the primitives that matter for a hallkeeper-sheet service:
//
//   http_requests_total{method,route,status}  counter
//   http_request_duration_seconds{...}         histogram
//
// Shape is hand-rolled Prom text format — no `prom-client` dep. A
// production deployment with sophisticated metric needs (percentiles
// beyond a small set, cardinality controls) can swap this for
// prom-client without changing the endpoint contract.
//
// The /metrics route is PROTECTED by a shared-secret header. Exposing
// raw metrics publicly would leak request-rate signals that help an
// attacker size our infra. Set `METRICS_TOKEN` in env (optional —
// when unset, /metrics returns 404 so it's not discoverable).
// ---------------------------------------------------------------------------

const HISTOGRAM_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Counter {
  readonly kind: "counter";
  readonly value: Map<string, number>;
}

interface Histogram {
  readonly kind: "histogram";
  readonly buckets: Map<string, number[]>;
  readonly sums: Map<string, number>;
  readonly counts: Map<string, number>;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function getOrCreateCounter(name: string): Counter {
  let c = counters.get(name);
  if (c === undefined) {
    c = { kind: "counter", value: new Map() };
    counters.set(name, c);
  }
  return c;
}

function getOrCreateHistogram(name: string): Histogram {
  let h = histograms.get(name);
  if (h === undefined) {
    h = {
      kind: "histogram",
      buckets: new Map(),
      sums: new Map(),
      counts: new Map(),
    };
    histograms.set(name, h);
  }
  return h;
}

/**
 * Serialise a labels object to a deterministic Prom-compatible
 * key-string. Labels are sorted to make scrape output stable.
 */
function labelKey(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(",");
}

export function incrementCounter(
  name: string,
  labels: Readonly<Record<string, string>>,
  delta: number = 1,
): void {
  const c = getOrCreateCounter(name);
  const key = labelKey(labels);
  c.value.set(key, (c.value.get(key) ?? 0) + delta);
}

export function observeHistogram(
  name: string,
  labels: Readonly<Record<string, string>>,
  valueSeconds: number,
): void {
  const h = getOrCreateHistogram(name);
  const key = labelKey(labels);
  const bucketCounts = h.buckets.get(key) ?? new Array<number>(HISTOGRAM_BUCKETS_SECONDS.length).fill(0);
  for (let i = 0; i < HISTOGRAM_BUCKETS_SECONDS.length; i += 1) {
    const bound = HISTOGRAM_BUCKETS_SECONDS[i];
    if (bound !== undefined && valueSeconds <= bound) {
      const current = bucketCounts[i] ?? 0;
      bucketCounts[i] = current + 1;
    }
  }
  h.buckets.set(key, bucketCounts);
  h.sums.set(key, (h.sums.get(key) ?? 0) + valueSeconds);
  h.counts.set(key, (h.counts.get(key) ?? 0) + 1);
}

/**
 * Render the current registry as Prometheus text-format. Called by
 * the /metrics route; safe to call from a test.
 */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, counter] of counters) {
    lines.push(`# TYPE ${name} counter`);
    for (const [key, value] of counter.value) {
      lines.push(key.length > 0 ? `${name}{${key}} ${String(value)}` : `${name} ${String(value)}`);
    }
  }
  for (const [name, histogram] of histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const [key, buckets] of histogram.buckets) {
      for (let i = 0; i < HISTOGRAM_BUCKETS_SECONDS.length; i += 1) {
        const bound = HISTOGRAM_BUCKETS_SECONDS[i];
        const bucketVal = buckets[i];
        if (bound !== undefined && bucketVal !== undefined) {
          const bucketLabel = key.length > 0 ? `${key},le="${String(bound)}"` : `le="${String(bound)}"`;
          lines.push(`${name}_bucket{${bucketLabel}} ${String(bucketVal)}`);
        }
      }
      const plusInfLabel = key.length > 0 ? `${key},le="+Inf"` : `le="+Inf"`;
      lines.push(`${name}_bucket{${plusInfLabel}} ${String(histogram.counts.get(key) ?? 0)}`);
      lines.push(`${name}_sum${key.length > 0 ? `{${key}}` : ""} ${String(histogram.sums.get(key) ?? 0)}`);
      lines.push(`${name}_count${key.length > 0 ? `{${key}}` : ""} ${String(histogram.counts.get(key) ?? 0)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Wire metrics collection into a Fastify instance. Registers:
 *   - onRequest hook that stamps a start time
 *   - onResponse hook that records the latency histogram
 *   - GET /metrics protected by `metricsToken` (when undefined,
 *     endpoint 404s — metrics endpoint is not discoverable).
 */
export function registerMetrics(server: FastifyInstance, metricsToken: string | undefined): void {
  server.addHook("onRequest", (request, _reply, done) => {
    (request as unknown as { __startHrTime?: bigint }).__startHrTime = process.hrtime.bigint();
    done();
  });

  server.addHook("onResponse", (request, reply, done) => {
    const start = (request as unknown as { __startHrTime?: bigint }).__startHrTime;
    if (start !== undefined) {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      const routeTemplate: string =
        (request as unknown as { routeOptions?: { url?: string } }).routeOptions?.url
        ?? request.url;
      const labels = {
        method: request.method,
        route: routeTemplate,
        status: String(reply.statusCode),
      };
      incrementCounter("http_requests_total", labels);
      observeHistogram("http_request_duration_seconds", labels, durationSeconds);
    }
    done();
  });

  server.get("/metrics", async (request, reply) => {
    if (metricsToken === undefined || metricsToken === "") {
      return reply.status(404).send({ error: "Not found.", code: "NOT_FOUND" });
    }
    const auth = request.headers["authorization"];
    if (auth !== `Bearer ${metricsToken}`) {
      return reply.status(404).send({ error: "Not found.", code: "NOT_FOUND" });
    }
    void reply
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics());
  });
}

/** Test helper — resets every registered counter and histogram. */
export function __resetMetricsForTests(): void {
  counters.clear();
  histograms.clear();
}
