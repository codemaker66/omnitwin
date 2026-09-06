import { describe, expect, it, vi } from "vitest";
import { createQuizAudioEngine } from "../audio-engine.js";
import type { QuizAudioEngine } from "../audio-types.js";
import { attachInterruptions, type InterruptionEnv, type InterruptionTarget } from "../interruptions.js";
import { fakeRig, makeCue, settle, type FakeAudioContext } from "./fake-audio-context.js";

interface Bound {
  readonly listener: () => void;
  readonly once: boolean;
}

class FakeTarget implements InterruptionTarget {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly bound = new Map<string, Bound[]>();

  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void {
    const list = this.bound.get(type) ?? [];
    list.push({ listener, once: options?.once === true });
    this.bound.set(type, list);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.bound.set(type, (this.bound.get(type) ?? []).filter((entry) => entry.listener !== listener));
  }

  count(type: string): number {
    return (this.bound.get(type) ?? []).length;
  }

  fire(type: string): void {
    const list = [...(this.bound.get(type) ?? [])];
    for (const entry of list) {
      if (entry.once) this.removeEventListener(type, entry.listener);
      entry.listener();
    }
  }
}

interface Rig {
  readonly engine: QuizAudioEngine;
  readonly context: FakeAudioContext;
  readonly contexts: FakeAudioContext[];
  readonly doc: FakeTarget;
  readonly win: FakeTarget;
  readonly env: InterruptionEnv;
}

async function rig(): Promise<Rig> {
  const fake = fakeRig({ decodedFrames: 960_000 });
  const engine = createQuizAudioEngine(fake.deps);
  await engine.unlock();
  engine.setEnabled(true);
  await engine.loadCues([makeCue("bed-water", { loop: true, bus: "ambience", durationMs: 20_000 })]);
  const doc = new FakeTarget();
  const win = new FakeTarget();
  return { engine, context: fake.context(), contexts: fake.contexts, doc, win, env: { document: doc, window: win } };
}

describe("interruptions", () => {
  it("holds the beds while the tab is hidden and releases them on return", async () => {
    const { engine, context, doc, env } = await rig();
    const held = vi.spyOn(engine, "setBedsHeld");
    attachInterruptions(engine, context, env);
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(held).toHaveBeenLastCalledWith(true);
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(held).toHaveBeenLastCalledWith(false);
    expect(held).toHaveBeenCalledTimes(2);
  });

  it("resumes a suspended context on statechange, and on the next pointerdown when the platform refused", async () => {
    const { engine, context, win, env } = await rig();
    attachInterruptions(engine, context, env);
    expect(win.count("pointerdown")).toBe(0);
    context.resumeRejects = true;
    context.setState("suspended");
    await settle();
    expect(context.resumeCalls).toBe(2); // unlock's, then the refused one
    expect(context.state).toBe("suspended");
    expect(win.count("pointerdown")).toBe(1);
    context.resumeRejects = false;
    win.fire("pointerdown");
    await settle();
    expect(context.resumeCalls).toBe(3);
    expect(context.state).toBe("running");
    expect(win.count("pointerdown")).toBe(0);
  });

  it("rebuilds the engine once when the sample rate changes and re-binds to the new context", async () => {
    const { engine, context, contexts, env } = await rig();
    const rebuild = vi.spyOn(engine, "rebuild");
    attachInterruptions(engine, context, env);
    expect(context.listenerCount).toBe(1);
    context.sampleRate = 44_100;
    context.setState("running");
    await settle();
    await settle();
    // The old context closing fires its own statechange; the guard keeps that to one rebuild.
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(2);
    const next = contexts[1];
    expect(engine.context).toBe(next);
    expect(context.listenerCount).toBe(0);
    expect(next?.listenerCount).toBe(1);
    // The adapter now watches the new context.
    next?.setState("suspended");
    await settle();
    expect(next?.state).toBe("running");
    expect(next?.resumeCalls).toBe(1);
  });

  it("detach removes every listener", async () => {
    const { engine, context, doc, win, env } = await rig();
    const held = vi.spyOn(engine, "setBedsHeld");
    context.state = "suspended";
    const detach = attachInterruptions(engine, context, env);
    expect(win.count("pointerdown")).toBe(1);
    detach();
    expect(context.listenerCount).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
    expect(win.count("pointerdown")).toBe(0);
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    context.setState("suspended");
    expect(held).not.toHaveBeenCalled();
    expect(context.resumeCalls).toBe(1);
  });
});
