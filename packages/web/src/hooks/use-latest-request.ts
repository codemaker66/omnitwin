import { useCallback, useEffect, useMemo, useRef } from "react";

/** Ownership for one stream of requests: only its latest mounted request may
 * publish data, errors or completion. Invalidate when the selected record changes.
 * This guards continuations even when a transport cannot cancel its request. */
export function useLatestRequest(): {
  readonly begin: () => () => boolean;
  readonly invalidate: () => void;
} {
  const generation = useRef(0);
  const mounted = useRef(true);
  const invalidate = useCallback(() => { generation.current += 1; }, []);
  const begin = useCallback(() => {
    generation.current += 1;
    const current = generation.current;
    return (): boolean => mounted.current && current === generation.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; invalidate(); };
  }, [invalidate]);
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
