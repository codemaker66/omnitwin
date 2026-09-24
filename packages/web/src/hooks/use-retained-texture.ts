import { useLayoutEffect, useRef, useState } from "react";
import type { DisposableTexture, RetainedTextureCache } from "../lib/retained-texture-cache.js";

/**
 * Hold the cache's texture for `key` while mounted. `key` must name every
 * input `create` reads, because an existing texture for the key is reused
 * instead of calling it.
 *
 * Unmounting retains the texture for the cache's idle window, so a component
 * that returns after a camera gesture reuses it. A key change releases the old
 * texture at once, as a texture owned by one mount always was.
 */
export function useRetainedTexture<T extends DisposableTexture>(
  cache: RetainedTextureCache<T>,
  key: string,
  create: () => T | null,
): T | null {
  const [texture, setTexture] = useState<T | null>(null);
  const unmounting = useRef(false);

  // Declared first so its cleanup runs before the release below on unmount.
  useLayoutEffect(() => {
    unmounting.current = false;
    return () => { unmounting.current = true; };
  }, []);

  useLayoutEffect(() => {
    // Layout-effect state lands before the next frame draws, and the texture
    // the previous key held is not drawn again once this effect has run.
    setTexture(cache.acquire(key, create));
    return () => { cache.release(key, unmounting.current ? "retain" : "dispose"); };
    // `key` stands for every input of `create`.
  }, [cache, key]);

  return texture;
}
