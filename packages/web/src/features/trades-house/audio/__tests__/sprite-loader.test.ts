import { describe, expect, it } from "vitest";
import { MP3_PRIMING_FRAMES, NO_TRIM, decodeCue, planTrim, trimBuffer } from "../sprite-loader.js";
import { FakeAudioContext, FakeBuffer } from "./fake-audio-context.js";

describe("sprite loader", () => {
  it("plans no trim without an expectation, or when the decoder delivered the expected count or fewer", () => {
    expect(planTrim(4800, null)).toBe(NO_TRIM);
    expect(planTrim(4800, 4800)).toBe(NO_TRIM);
    expect(planTrim(4000, 4800)).toBe(NO_TRIM);
    expect(planTrim(4800, 0)).toBe(NO_TRIM);
  });

  it("takes a short excess off the tail only, and a full priming block off the head with the rest off the tail", () => {
    expect(planTrim(4800 + 500, 4800)).toEqual({ head: 0, tail: 500 });
    expect(planTrim(4800 + MP3_PRIMING_FRAMES - 1, 4800)).toEqual({ head: 0, tail: MP3_PRIMING_FRAMES - 1 });
    expect(planTrim(4800 + MP3_PRIMING_FRAMES, 4800)).toEqual({ head: MP3_PRIMING_FRAMES, tail: 0 });
    expect(planTrim(4800 + MP3_PRIMING_FRAMES + 640, 4800)).toEqual({ head: MP3_PRIMING_FRAMES, tail: 640 });
    expect(MP3_PRIMING_FRAMES).toBe(576 + 529);
  });

  it("decodes and trims the head priming so the transient is back at the start", async () => {
    const context = new FakeAudioContext();
    context.decodedFrames = 5_000 + MP3_PRIMING_FRAMES + 40;
    context.decodeFill = "ramp";
    const buffer = await decodeCue(context, new ArrayBuffer(8), 5_000);
    expect(buffer.length).toBe(5_000);
    expect(buffer.sampleRate).toBe(context.sampleRate);
    expect(buffer.numberOfChannels).toBe(1);
    const data = buffer.getChannelData(0);
    expect(data[0]).toBe(MP3_PRIMING_FRAMES);
    expect(data[4_999]).toBe(MP3_PRIMING_FRAMES + 4_999);
  });

  it("hands the decoder a copy, so the retained bytes survive for a rebuild", async () => {
    const context = new FakeAudioContext();
    const bytes = new ArrayBuffer(8);
    const buffer = await decodeCue(context, bytes, null);
    expect(buffer.length).toBe(context.decodedFrames);
    expect(context.decoded).toHaveLength(1);
    expect(context.decoded[0]).not.toBe(bytes);
    expect(context.decoded[0]?.byteLength).toBe(8);
    expect(bytes.byteLength).toBe(8);
  });

  it("returns the same buffer when there is nothing to cut, and refuses to cut a buffer to nothing", () => {
    const context = new FakeAudioContext();
    const buffer = new FakeBuffer(2, 100, 48_000);
    expect(trimBuffer(context, buffer, NO_TRIM)).toBe(buffer);
    expect(trimBuffer(context, buffer, { head: 60, tail: 40 })).toBe(buffer);
    const cut = trimBuffer(context, buffer, { head: 10, tail: 10 });
    expect(cut).not.toBe(buffer);
    expect(cut.length).toBe(80);
    expect(cut.numberOfChannels).toBe(2);
  });
});
