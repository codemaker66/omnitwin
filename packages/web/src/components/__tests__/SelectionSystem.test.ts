import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SelectionSystem source guards", () => {
  it("reserves mobile touch-drag on empty canvas for camera movement, while keeping touch tap selection", async () => {
    const source = await readFile("src/components/SelectionSystem.tsx", "utf8");
    const pointerDownMatch = /function onPointerDown\(event: PointerEvent\): void \{[\s\S]*?function onMouseDown/u.exec(source);
    const pointerMoveMatch = /function onPointerMove\(event: PointerEvent\): void \{[\s\S]*?function onMouseMove/u.exec(source);
    const pointerUpMatch = /function onPointerUp\(event: PointerEvent\): void \{[\s\S]*?if \(isMarquee\.current\)/u.exec(source);

    expect(pointerDownMatch?.[0] ?? "").toContain('event.pointerType === "touch" && event.isPrimary');
    expect(pointerDownMatch?.[0] ?? "").toContain("touchTapCandidate.current = true");
    expect(pointerMoveMatch?.[0] ?? "").toContain('event.pointerType === "touch" && touchTapCandidate.current');
    expect(pointerMoveMatch?.[0] ?? "").toContain("touchTapCandidate.current = false");
    expect(pointerUpMatch?.[0] ?? "").toContain("interactionTargetAt(event.clientX, event.clientY)");
    expect(pointerUpMatch?.[0] ?? "").toContain("useSelectionStore.getState().select(found.itemId)");
  });

  it("lets a primary touch on furniture take the move gesture, and hands every later finger to the camera", async () => {
    const source = await readFile("src/components/SelectionSystem.tsx", "utf8");
    const pointerDown = /function onPointerDown\(event: PointerEvent\): void \{[\s\S]*?function onMouseDown/u.exec(source)?.[0] ?? "";

    // One finger on furniture the planner is already working with drags it,
    // and takes the camera out of play for the length of that drag.
    expect(pointerDown).toContain("touchClaimsMoveGesture(interactionTargetAt(event.clientX, event.clientY).itemId)");
    expect(pointerDown).toContain("releaseCameraLock.current = lockPlannerCamera()");

    // The second finger is the camera's, always. This guard has to come
    // BEFORE the gesture setup below it, or a pinch would open a second
    // selection gesture on the non-primary pointer.
    const secondFinger = pointerDown.indexOf('event.pointerType === "touch" && !event.isPrimary');
    const gestureSetup = pointerDown.indexOf("dragPointerId.current = event.pointerId");
    expect(secondFinger).toBeGreaterThan(-1);
    expect(gestureSetup).toBeGreaterThan(-1);
    expect(secondFinger).toBeLessThan(gestureSetup);

    // Nothing is draggable before the user has said what they are working on:
    // the first touch on an object selects it, it does not move it.
    const claim = /function touchClaimsMoveGesture\(itemId: string \| null\): boolean \{[\s\S]*?\n {4}\}/u.exec(source)?.[0] ?? "";
    expect(claim).toContain("if (itemId === null) return false");
    expect(claim).toContain("selected.has(itemId) || selected.size > 0");

    // Whatever ends the gesture gives the camera back, exactly once.
    const close = /function closePointerGesture\(\): void \{[\s\S]*?\n {4}\}/u.exec(source)?.[0] ?? "";
    expect(close).toContain("releaseCameraLock.current?.()");
    expect(close).toContain("releaseCameraLock.current = null");
  });
});
