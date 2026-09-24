import { Component, Suspense, type ReactElement, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyWithPreload } from "../lazy-with-preload.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Page(): ReactElement {
  return <h1>Loaded page</h1>;
}

class Boundary extends Component<{ readonly children: ReactNode }, { readonly error: Error | null }> {
  override state: { readonly error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }
  override render(): ReactNode {
    return this.state.error === null ? this.props.children : <p role="alert">{this.state.error.message}</p>;
  }
}

function show(node: ReactElement): void {
  render(<Boundary><Suspense fallback={<p>Opening…</p>}>{node}</Suspense></Boundary>);
}

afterEach(cleanup);

describe("lazyWithPreload", () => {
  it("starts the import on preload and renders from that same import", async () => {
    const module = deferred<{ default: () => ReactElement }>();
    const load = vi.fn(() => module.promise);
    const LazyPage = lazyWithPreload(load);

    LazyPage.preload();
    LazyPage.preload();
    expect(load).toHaveBeenCalledTimes(1);

    show(<LazyPage />);
    expect(screen.getByText("Opening…")).toBeTruthy();
    await act(async () => { module.resolve({ default: Page }); await module.promise; });
    expect(await screen.findByRole("heading", { name: "Loaded page" })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not render the component when only preloaded", async () => {
    const rendered = vi.fn();
    const LazyPage = lazyWithPreload(() => Promise.resolve({ default: () => { rendered(); return <h1>Loaded page</h1>; } }));
    LazyPage.preload();
    await act(async () => { await Promise.resolve(); });
    expect(rendered).not.toHaveBeenCalled();
  });

  it("keeps a failed preload silent and lets the render-time import try again", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const load = vi.fn<() => Promise<{ default: () => ReactElement }>>()
        .mockRejectedValueOnce(new Error("offline during the account check"))
        .mockResolvedValueOnce({ default: Page });
      const LazyPage = lazyWithPreload(load);

      LazyPage.preload();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(load).toHaveBeenCalledTimes(1);

      show(<LazyPage />);
      expect(await screen.findByRole("heading", { name: "Loaded page" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(load).toHaveBeenCalledTimes(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("reports an import that fails while rendering through the error boundary, as lazy() does", async () => {
    const failure = new Error("Failed to fetch dynamically imported module");
    const LazyPage = lazyWithPreload(() => Promise.reject(failure));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      show(<LazyPage />);
      expect((await screen.findByRole("alert")).textContent).toBe(failure.message);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shares an in-flight preload's failure with the render that awaited it", async () => {
    const module = deferred<{ default: () => ReactElement }>();
    const load = vi.fn(() => module.promise);
    const LazyPage = lazyWithPreload(load);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      LazyPage.preload();
      show(<LazyPage />);
      await act(async () => { module.reject(new Error("chunk unavailable")); await module.promise.catch(() => undefined); });
      expect((await screen.findByRole("alert")).textContent).toBe("chunk unavailable");
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("never throws from preload, even when the loader throws synchronously", () => {
    const LazyPage = lazyWithPreload<() => ReactElement>(() => { throw new Error("no loader"); });
    expect(() => { LazyPage.preload(); }).not.toThrow();
  });
});
