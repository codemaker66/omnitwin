// -----------------------------------------------------------------------------
// sprite-loader — decode a cue once and correct the encoder delay. A cue's
// manifest entry may carry `expectedSamples`, the decoded length a reference
// decoder produced at build time. A browser whose MP3 decoder ignores the
// gapless header returns more frames than that: LAME's 576-frame encoder
// delay plus the 529-frame decoder delay at the head, and the encoder's
// padding at the tail. The head is where a poke's transient lives (within
// 5 ms of the file's start), so it is cut precisely, never by guesswork.
// -----------------------------------------------------------------------------
import type { MixerBuffer, MixerContext } from "./audio-types.js";

/** LAME encoder delay (576) plus the MPEG-1 Layer III decoder delay (529). */
export const MP3_PRIMING_FRAMES = 1105;

export interface TrimPlan {
  readonly head: number;
  readonly tail: number;
}

export const NO_TRIM: TrimPlan = { head: 0, tail: 0 };

export function planTrim(decodedLength: number, expectedSamples: number | null): TrimPlan {
  if (expectedSamples === null || expectedSamples < 1 || decodedLength <= expectedSamples) return NO_TRIM;
  const excess = decodedLength - expectedSamples;
  // Less than one priming block over: the decoder stripped the head and left
  // some tail padding. Padding is silence, so it goes from the end, and the
  // transient at the head is never touched.
  if (excess < MP3_PRIMING_FRAMES) return { head: 0, tail: excess };
  return { head: MP3_PRIMING_FRAMES, tail: excess - MP3_PRIMING_FRAMES };
}

export function trimBuffer(context: MixerContext, buffer: MixerBuffer, plan: TrimPlan): MixerBuffer {
  const length = buffer.length - plan.head - plan.tail;
  if ((plan.head === 0 && plan.tail === 0) || length < 1) return buffer;
  const trimmed = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(plan.head, plan.head + length), channel);
  }
  return trimmed;
}

/**
 * Decode `bytes` on `context` and trim to `expectedSamples` when the decoder
 * over-delivered. decodeAudioData detaches the buffer it is handed, and the
 * engine keeps the encoded bytes for a sample-rate rebuild, so a copy goes in.
 */
export async function decodeCue(
  context: MixerContext,
  bytes: ArrayBuffer,
  expectedSamples: number | null,
): Promise<MixerBuffer> {
  const decoded = await context.decodeAudioData(bytes.slice(0));
  return trimBuffer(context, decoded, planTrim(decoded.length, expectedSamples));
}
