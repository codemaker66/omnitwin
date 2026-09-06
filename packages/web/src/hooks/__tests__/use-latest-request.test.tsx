import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLatestRequest } from "../use-latest-request.js";

afterEach(cleanup);

describe("useLatestRequest", () => {
  it("revokes previous requests on restart, selection invalidation and unmount", () => {
    const { result, unmount } = renderHook(useLatestRequest);
    const first = result.current.begin();
    const second = result.current.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    act(() => { result.current.invalidate(); });
    expect(second()).toBe(false);
    const begin = result.current.begin;
    const final = begin();
    unmount();
    expect(final()).toBe(false);
    expect(begin()()).toBe(false);
  });

  it("can own requests after StrictMode's effect cleanup and retains stable callbacks", () => {
    const { result, rerender } = renderHook(useLatestRequest, {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    const owner = result.current;
    const current = owner.begin();
    rerender();
    expect(result.current).toBe(owner);
    expect(current()).toBe(true);
  });
});
