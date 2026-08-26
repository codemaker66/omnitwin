import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS,
  GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
  GRAND_HALL_T554_NATIVE_TILE_COUNT,
  GrandHallT554NativeReviewCoverageControllerV1,
  emptyGrandHallT554NativeTileBitmapHex,
} from "../grand-hall-t554-native-review-coverage.js";

const NONCE = "a".repeat(43);
const EPOCH = "c".repeat(43);
const SUBJECT = `sha256:${"b".repeat(64)}`;

function paintedTile(column: number, row: number): {
  readonly column: number;
  readonly row: number;
  readonly generation: 1;
} {
  return { column, row, generation: 1 };
}

function everyPaintedTile(): readonly ReturnType<typeof paintedTile>[] {
  const tiles: ReturnType<typeof paintedTile>[] = [];
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 32; column += 1) {
      tiles.push(paintedTile(column, row));
    }
  }
  return tiles;
}

function sample(
  sequence: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-telemetry-sample.v1",
    sessionNonce: NONCE,
    sourceEpochNonce: EPOCH,
    subjectSha256: SUBJECT,
    renderGeneration: 1,
    sequence,
    documentVisibilityState: "visible",
    documentFocusState: "focused",
    viewportCssWidth: 256,
    viewportCssHeight: 256,
    devicePixelRatio: 1,
    sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    paintedTiles: [paintedTile(0, 0)],
    ...overrides,
  };
}

function controller(): {
  readonly instance: GrandHallT554NativeReviewCoverageControllerV1;
  readonly advance: (milliseconds: number) => void;
} {
  let now = Date.parse("2026-08-26T20:00:00.000Z");
  let monotonicNow = 1_000;
  return {
    instance: new GrandHallT554NativeReviewCoverageControllerV1({
      sessionNonce: NONCE,
      sourceEpochNonce: EPOCH,
      subjectSha256: SUBJECT,
      renderGeneration: 1,
      wallClock: () => new Date(now),
      monotonicNowMs: () => monotonicNow,
    }),
    advance: (milliseconds: number) => {
      now += milliseconds;
      monotonicNow += milliseconds;
    },
  };
}

describe("Grand Hall T-554 server-derived native coverage", () => {
  it("requires delivered tiles and enough continuous native-scale dwell", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);

    const first = instance.recordTelemetry(sample(0));
    expect(first.derived.disqualifier).toBe("first_sample");
    expect(first.derived.creditedDurationMs).toBe(0);
    expect(instance.dwellMsForTile(0, 0)).toBe(0);

    advance(500);
    const second = instance.recordTelemetry(sample(1));
    expect(second.derived.disqualifier).toBeNull();
    expect(instance.dwellMsForTile(0, 0)).toBe(500);
    expect(instance.snapshot().completedTileCount).toBe(0);

    advance(500);
    const third = instance.recordTelemetry(sample(2));
    expect(third.derived.disqualifier).toBeNull();
    expect(instance.dwellMsForTile(0, 0)).toBe(
      GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
    );
    expect(instance.snapshot().completedTileCount).toBe(1);
    expect(instance.snapshot().complete).toBe(false);
  });

  it("does not let a one-millisecond full-grid claim complete coverage", () => {
    const { instance, advance } = controller();
    for (let row = 0; row < 16; row += 1) {
      for (let column = 0; column < 32; column += 1) {
        instance.recordDeliveredTile(column, row);
      }
    }
    const fullViewport = {
      viewportCssWidth: 8_192,
      viewportCssHeight: 4_096,
      paintedTiles: everyPaintedTile(),
    };
    instance.recordTelemetry(sample(0, fullViewport));
    advance(1);
    instance.recordTelemetry(sample(1, {
      ...fullViewport,
    }));
    expect(instance.snapshot().completedTileCount).toBe(0);
    expect(instance.snapshot().complete).toBe(false);
  });

  it("caps long heartbeat gaps instead of treating absence as review time", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    instance.recordTelemetry(sample(0));
    advance(60_000);
    const event = instance.recordTelemetry(sample(1));
    expect(event.derived.creditedDurationMs).toBe(
      GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS,
    );
    expect(instance.snapshot().completedTileCount).toBe(0);
  });

  it.each([
    ["hidden", "focused", 1, "document_not_visible"],
    ["visible", "blurred", 1, "document_not_focused"],
    ["visible", "focused", 0.5, "below_native_device_scale"],
  ] as const)(
    "refuses dwell for visibility=%s focus=%s scale=%s",
    (visibility, focus, renderedScale, expected) => {
      const { instance, advance } = controller();
      instance.recordDeliveredTile(0, 0);
      const overrides = {
        documentVisibilityState: visibility,
        documentFocusState: focus,
        viewportCssWidth: 256 * renderedScale,
        viewportCssHeight: 256 * renderedScale,
        sourceToCssTransform: {
          a: renderedScale,
          b: 0,
          c: 0,
          d: renderedScale,
          e: 0,
          f: 0,
        },
      };
      instance.recordTelemetry(sample(0, overrides));
      advance(500);
      const event = instance.recordTelemetry(sample(1, overrides));
      expect(event.derived.disqualifier).toBe(expected);
      expect(instance.dwellMsForTile(0, 0)).toBe(0);
    },
  );

  it("credits only tiles continuously and fully visible in consecutive samples", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    instance.recordDeliveredTile(1, 0);
    instance.recordTelemetry(sample(0));
    advance(500);
    const moved = instance.recordTelemetry(sample(1, {
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: -256, f: 0 },
      paintedTiles: [paintedTile(1, 0)],
    }));
    expect(moved.derived.disqualifier).toBe("no_continuously_visible_tiles");
    expect(instance.dwellMsForTile(0, 0)).toBe(0);
    expect(instance.dwellMsForTile(1, 0)).toBe(0);

    advance(500);
    instance.recordTelemetry(sample(2, {
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: -256, f: 0 },
      paintedTiles: [paintedTile(1, 0)],
    }));
    expect(instance.dwellMsForTile(1, 0)).toBe(500);
  });

  it("does not count partially visible or undelivered tiles", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    const partial = {
      viewportCssWidth: 256,
      viewportCssHeight: 256,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: -1, f: -1 },
    };
    instance.recordTelemetry(sample(0, partial));
    advance(500);
    const event = instance.recordTelemetry(sample(1, partial));
    expect(event.derived.disqualifier).toBe("no_fully_visible_delivered_tiles");
    expect(event.derived.fullyVisibleDeliveredTileBitsetHex).toBe(
      emptyGrandHallT554NativeTileBitmapHex(),
    );
    expect(instance.dwellMsForTile(0, 0)).toBe(0);
  });

  it("rejects caller-supplied completion fields and invalid viewport geometry", () => {
    const { instance } = controller();
    instance.recordDeliveredTile(0, 0);
    expect(() => instance.recordTelemetry({
      ...sample(0),
      completed: true,
      coverageBitsetHex: "ff".repeat(64),
    })).toThrow(/Unrecognized key|unrecognized/i);

    expect(() => instance.recordTelemetry(sample(0, {
      sourceToCssTransform: { a: 1, b: 0.01, c: 0, d: 1, e: 0, f: 0 },
    }))).toThrow(/rotated or skewed/i);
  });

  it("requires exact nonce, source epoch, render generation, subject, and sequence", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    expect(() => instance.recordTelemetry(sample(0, {
      sessionNonce: "d".repeat(43),
    }))).toThrow(/active server review session/i);
    expect(() => instance.recordTelemetry(sample(1))).toThrow(/gap-free/i);

    instance.recordTelemetry(sample(0));
    advance(500);
    expect(() => instance.recordTelemetry(sample(1, {
      subjectSha256: `sha256:${"e".repeat(64)}`,
    }))).toThrow(/active server review session/i);
    expect(() => instance.recordTelemetry(sample(1, {
      sourceEpochNonce: "f".repeat(43),
    }))).toThrow(/active server review session/i);
    expect(() => instance.recordTelemetry(sample(1, {
      renderGeneration: 2,
    }))).toThrow(/active server review session/i);
  });

  it("rejects wall-clock and monotonic-clock rollback without credit", () => {
    let wall = Date.parse("2026-08-26T20:00:00.000Z");
    let monotonic = 1_000;
    const instance = new GrandHallT554NativeReviewCoverageControllerV1({
      sessionNonce: NONCE,
      sourceEpochNonce: EPOCH,
      subjectSha256: SUBJECT,
      renderGeneration: 1,
      wallClock: () => new Date(wall),
      monotonicNowMs: () => monotonic,
    });
    instance.recordDeliveredTile(0, 0);
    instance.recordTelemetry(sample(0));

    wall -= 1;
    monotonic += 1;
    expect(() => instance.recordTelemetry(sample(1))).toThrow(/clocks must not move backwards/i);
    expect(instance.snapshot().eventCount).toBe(1);

    wall += 501;
    monotonic -= 2;
    expect(() => instance.recordTelemetry(sample(1))).toThrow(/clocks must not move backwards/i);
    expect(instance.dwellMsForTile(0, 0)).toBe(0);
  });

  it("does not credit stale or unpainted tile generations", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    const stalePaint = {
      paintedTiles: [{ column: 0, row: 0, generation: 2 }],
    };
    instance.recordTelemetry(sample(0, stalePaint));
    advance(500);
    const event = instance.recordTelemetry(sample(1, stalePaint));
    expect(event.derived.disqualifier).toBe("no_fully_visible_delivered_tiles");
    expect(instance.dwellMsForTile(0, 0)).toBe(0);
  });

  it("chains immutable server-timestamped events and returns defensive copies", () => {
    const { instance, advance } = controller();
    instance.recordDeliveredTile(0, 0);
    const first = instance.recordTelemetry(sample(0));
    advance(500);
    const second = instance.recordTelemetry(sample(1));
    expect(first.previousEventSha256).toBeNull();
    expect(second.previousEventSha256).toBe(first.eventSha256);
    expect(second.serverReceivedAt).toBe("2026-08-26T20:00:00.500Z");

    const events = instance.events();
    expect(events).toHaveLength(2);
    Object.defineProperty(events[0]!, "eventSha256", {
      configurable: true,
      enumerable: true,
      value: `sha256:${"0".repeat(64)}`,
      writable: true,
    });
    expect(instance.events()[0]!.eventSha256).toBe(first.eventSha256);
    expect(instance.snapshot().eventCount).toBe(2);
  });

  it("can complete all 512 tiles only after every delivered tile meets dwell", () => {
    const { instance, advance } = controller();
    for (let row = 0; row < 16; row += 1) {
      for (let column = 0; column < 32; column += 1) {
        instance.recordDeliveredTile(column, row);
      }
    }
    const fullViewport = {
      viewportCssWidth: 8_192,
      viewportCssHeight: 4_096,
      paintedTiles: everyPaintedTile(),
    };
    instance.recordTelemetry(sample(0, fullViewport));
    advance(500);
    instance.recordTelemetry(sample(1, fullViewport));
    advance(500);
    instance.recordTelemetry(sample(2, fullViewport));
    expect(instance.snapshot()).toMatchObject({
      completedTileCount: GRAND_HALL_T554_NATIVE_TILE_COUNT,
      complete: true,
      minimumDwellMsPerTile: GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
    });
  });
});
