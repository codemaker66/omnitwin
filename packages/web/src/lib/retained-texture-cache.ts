// ---------------------------------------------------------------------------
// Retained texture cache — one texture per key, shared by every user.
//
// Components that draw an expensive texture (a canvas redraw plus a GPU
// upload) acquire it by a key naming every input that affects its pixels.
// Identical keys share one texture. When the last user lets go, the texture
// either goes at once ("dispose") or stays reusable for a short idle window
// ("retain"), so furniture annotations that unmount for a camera gesture get
// the same texture back when they return instead of redrawing it. The least
// recently released idle textures are disposed first once too many are idle.
// ---------------------------------------------------------------------------

export interface DisposableTexture {
  dispose(): void;
}

export interface RetainedTextureCacheOptions {
  /** How long a texture without users stays reusable. */
  readonly idleMs: number;
  /** Most textures kept without users; older ones are disposed first. */
  readonly maxIdle: number;
}

/** Release the last use now, or keep the texture for the idle window. */
export type TextureRelease = "dispose" | "retain";

interface CacheEntry<T> {
  readonly texture: T;
  users: number;
  expiry: ReturnType<typeof setTimeout> | null;
}

export class RetainedTextureCache<T extends DisposableTexture> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  /** Keys of retained entries without users, least recently released first. */
  private readonly idle = new Set<string>();
  private readonly options: RetainedTextureCacheOptions;

  constructor(options: RetainedTextureCacheOptions) {
    this.options = options;
  }

  /** Textures currently cached, with or without users. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Use the texture for `key`, creating it only when none is cached. A null
   * from `create` (no canvas available) is returned without being cached.
   */
  acquire(key: string, create: () => T | null): T | null {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      cached.users += 1;
      this.idle.delete(key);
      if (cached.expiry !== null) {
        clearTimeout(cached.expiry);
        cached.expiry = null;
      }
      return cached.texture;
    }
    const texture = create();
    if (texture === null) return null;
    this.entries.set(key, { texture, users: 1, expiry: null });
    return texture;
  }

  /** End one use of `key`. The texture is disposed exactly once, after its last use. */
  release(key: string, mode: TextureRelease): void {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.users === 0) return;
    entry.users -= 1;
    if (entry.users > 0) return;
    if (mode === "dispose" || this.options.maxIdle <= 0) {
      this.evict(key, entry);
      return;
    }
    this.idle.add(key);
    entry.expiry = setTimeout(() => { this.evict(key, entry); }, this.options.idleMs);
    for (const oldest of this.idle) {
      if (this.idle.size <= this.options.maxIdle) break;
      const stale = this.entries.get(oldest);
      if (stale === undefined) this.idle.delete(oldest);
      else this.evict(oldest, stale);
    }
  }

  private evict(key: string, entry: CacheEntry<T>): void {
    if (this.entries.get(key) !== entry) return;
    if (entry.expiry !== null) clearTimeout(entry.expiry);
    entry.expiry = null;
    this.idle.delete(key);
    this.entries.delete(key);
    entry.texture.dispose();
  }
}

let fontGeneration = 0;
let watchingFonts = false;

/**
 * Changes whenever the document finishes loading fonts. Canvas text drawn
 * before a web font arrives uses a fallback face, so a cached texture of text
 * must include this in its key: a remount after the font loads then redraws,
 * exactly as an uncached texture would.
 */
export function canvasFontGeneration(): number {
  if (!watchingFonts && typeof document !== "undefined") {
    watchingFonts = true;
    const { fonts } = document as Partial<Pick<Document, "fonts">>;
    fonts?.addEventListener("loadingdone", () => { fontGeneration += 1; });
  }
  return fontGeneration;
}
