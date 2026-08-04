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
});
