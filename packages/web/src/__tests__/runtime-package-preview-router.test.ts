import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("exact runtime package preview route boundary", () => {
  it("puts the preview on its own Clerk and platform-admin guarded path", async () => {
    const source = await readFile(resolve("src/router.tsx"), "utf8");
    expect(source).toContain(
      'path: "/admin/runtime-package-previews/:runtimePackageId/view"',
    );
    expect(source).toMatch(
      /path: "\/admin\/runtime-package-previews\/:runtimePackageId\/view",[\s\S]*?withClerk\([\s\S]*?<ProtectedRoute allowedRoles=\{\["admin"\]\} requiredPlatformRole="admin">[\s\S]*?<LivingHallRuntimePreviewPage \/>/u,
    );
  });

  it("keeps the ordinary Living Hall route outside the preview wrapper", async () => {
    const source = await readFile(resolve("src/router.tsx"), "utf8");
    expect(source).toMatch(
      /path: "\/living-hall",\s*element: withSuspense\(<LivingHallPage \/>\)/u,
    );
  });
});
