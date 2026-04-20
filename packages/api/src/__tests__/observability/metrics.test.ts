import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMetricsForTests,
  incrementCounter,
  observeHistogram,
  renderMetrics,
} from "../../observability/metrics.js";

// ---------------------------------------------------------------------------
// metrics — Prometheus text-format exporter
//
// Acquisition reviewers will scrape /metrics and pipe it through
// `promtool check metrics` — the format must be syntactically
// valid. These tests pin the wire format + the bucket arithmetic.
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetMetricsForTests();
});

describe("incrementCounter", () => {
  it("registers a new counter and renders it", () => {
    incrementCounter("test_total", { route: "/foo", status: "200" });
    const out = renderMetrics();
    expect(out).toContain("# TYPE test_total counter");
    expect(out).toContain('test_total{route="/foo",status="200"} 1');
  });

  it("accumulates on the same label set", () => {
    incrementCounter("test_total", { route: "/foo" });
    incrementCounter("test_total", { route: "/foo" });
    incrementCounter("test_total", { route: "/foo" });
    const out = renderMetrics();
    expect(out).toContain('test_total{route="/foo"} 3');
  });

  it("keeps separate counts per label set", () => {
    incrementCounter("test_total", { route: "/foo" }, 2);
    incrementCounter("test_total", { route: "/bar" }, 5);
    const out = renderMetrics();
    expect(out).toContain('test_total{route="/foo"} 2');
    expect(out).toContain('test_total{route="/bar"} 5');
  });

  it("sorts label keys deterministically (route comes before status alphabetically)", () => {
    incrementCounter("test_total", { status: "200", route: "/foo" });
    const out = renderMetrics();
    expect(out).toContain('test_total{route="/foo",status="200"} 1');
  });

  it("escapes embedded quotes in label values", () => {
    incrementCounter("test_total", { msg: 'a "quoted" value' });
    const out = renderMetrics();
    expect(out).toContain('test_total{msg="a \\"quoted\\" value"} 1');
  });
});

describe("observeHistogram", () => {
  it("emits TYPE histogram + bucket lines for an observed value", () => {
    observeHistogram("test_seconds", { route: "/foo" }, 0.05);
    const out = renderMetrics();
    expect(out).toContain("# TYPE test_seconds histogram");
    // 0.05s falls into the 0.05 bucket (and every higher one)
    expect(out).toContain('test_seconds_bucket{route="/foo",le="0.05"} 1');
    expect(out).toContain('test_seconds_bucket{route="/foo",le="0.1"} 1');
    expect(out).toContain('test_seconds_bucket{route="/foo",le="+Inf"} 1');
  });

  it("counts observations into all buckets >= the value", () => {
    observeHistogram("test_seconds", { route: "/foo" }, 0.001);
    observeHistogram("test_seconds", { route: "/foo" }, 0.5);
    observeHistogram("test_seconds", { route: "/foo" }, 5);
    const out = renderMetrics();
    expect(out).toMatch(/test_seconds_bucket\{route="\/foo",le="0\.005"\} 1\b/);
    expect(out).toMatch(/test_seconds_bucket\{route="\/foo",le="0\.5"\} 2\b/);
    expect(out).toMatch(/test_seconds_bucket\{route="\/foo",le="5"\} 3\b/);
    expect(out).toMatch(/test_seconds_bucket\{route="\/foo",le="\+Inf"\} 3\b/);
  });

  it("emits sum and count metric lines", () => {
    observeHistogram("test_seconds", { route: "/foo" }, 0.1);
    observeHistogram("test_seconds", { route: "/foo" }, 0.4);
    const out = renderMetrics();
    expect(out).toContain('test_seconds_sum{route="/foo"} 0.5');
    expect(out).toContain('test_seconds_count{route="/foo"} 2');
  });
});

describe("renderMetrics", () => {
  it("returns a trailing newline (Prom convention)", () => {
    incrementCounter("foo", {});
    const out = renderMetrics();
    expect(out.endsWith("\n")).toBe(true);
  });

  it("returns an empty newline when no metrics registered", () => {
    expect(renderMetrics()).toBe("\n");
  });
});
