import { lazy, type LazyExoticComponent } from "react";

// ---------------------------------------------------------------------------
// lazyWithPreload — React.lazy whose chunk can be requested before it renders
//
// Guarded routes render their page only after the account check resolves, so
// a plain lazy() page starts downloading only then. preload() lets the route
// request the same chunk as soon as it matches, while the guard still decides
// whether the page may render. Both paths share one import, so the chunk and
// its stylesheets are requested once.
//
// A failed early request is forgotten rather than cached: the render-time
// import then makes its own attempt and reports its own error through the
// usual Suspense/error-boundary path, exactly as a plain lazy() page would.
// ---------------------------------------------------------------------------

export interface Preloadable {
  /** Starts (or joins) the chunk download. Never throws; never rejects. */
  readonly preload: () => void;
}

/** The component types React.lazy itself accepts (its own type constraint). */
type LazyComponentType = Parameters<typeof lazy>[0] extends () => Promise<{ default: infer C }> ? C : never;

export type PreloadableLazyComponent<T extends LazyComponentType> = LazyExoticComponent<T> & Preloadable;

export function lazyWithPreload<T extends LazyComponentType>(
  load: () => Promise<{ default: T }>,
): PreloadableLazyComponent<T> {
  let pending: Promise<{ default: T }> | null = null;
  const loadOnce = (): Promise<{ default: T }> => {
    if (pending === null) {
      const attempt = load();
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    return pending;
  };
  return Object.assign(lazy(loadOnce), {
    preload: (): void => {
      try {
        loadOnce().catch(() => undefined);
      } catch {
        // A loader that throws synchronously is retried and reported by render.
      }
    },
  });
}
