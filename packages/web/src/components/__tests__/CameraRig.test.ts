import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("CameraRig source guards", () => {
  it("suppresses the browser context menu for right-drag orbit outside human POV mode", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");
    const handlerMatch = /function onContextMenu\(event: MouseEvent\): void \{[\s\S]*?\n {4}\}/u.exec(source);
    const handler = handlerMatch?.[0] ?? "";

    expect(handler).toContain("event.preventDefault();");
    expect(handler).not.toContain("humanPovActiveRef");
    expect(source).toContain('canvas.addEventListener("contextmenu", onContextMenu);');
  });

  it("disables desktop right-button mouse orbit in lean control mode", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("RIGHT: (smoothControls ? 0 : -1) as number");
  });
});
