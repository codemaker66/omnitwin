import { useState, type ReactElement } from "react";
import { getCanonicalAssetById } from "@omnitwin/types";
import chair from "../../../assets/inventory-style/chiavari-chair.webp";
import chair128 from "../../../assets/inventory-style/ladder/chiavari-chair-128.webp";
import chair256 from "../../../assets/inventory-style/ladder/chiavari-chair-256.webp";
import chair480 from "../../../assets/inventory-style/ladder/chiavari-chair-480.webp";
import chair720 from "../../../assets/inventory-style/ladder/chiavari-chair-720.webp";
import table from "../../../assets/inventory-style/round-table.webp";
import table288 from "../../../assets/inventory-style/ladder/round-table-288.webp";
import table576 from "../../../assets/inventory-style/ladder/round-table-576.webp";
import table1080 from "../../../assets/inventory-style/ladder/round-table-1080.webp";
import projector from "../../../assets/inventory-style/projector.webp";
import projector288 from "../../../assets/inventory-style/ladder/projector-288.webp";
import projector576 from "../../../assets/inventory-style/ladder/projector-576.webp";
import projector1080 from "../../../assets/inventory-style/ladder/projector-1080.webp";

interface Illustration {
  readonly src: string;
  readonly srcSet: string;
  /** Width over height. */
  readonly aspect: number;
}

// Display-sized copies (scripts/build-image-ladders.mjs; ladder/provenance.json)
// under the lossless full-size WebP, which stays the widest candidate.
export const INVENTORY_ILLUSTRATIONS = {
  chair: { src: chair, srcSet: `${chair128} 128w, ${chair256} 256w, ${chair480} 480w, ${chair720} 720w, ${chair} 1024w`, aspect: 1024 / 1536 },
  table: { src: table, srcSet: `${table288} 288w, ${table576} 576w, ${table1080} 1080w, ${table} 1536w`, aspect: 1536 / 1024 },
  projector: { src: projector, srcSet: `${projector288} 288w, ${projector576} 576w, ${projector1080} 1080w, ${projector} 1536w`, aspect: 1536 / 1024 },
} as const satisfies Readonly<Record<string, Illustration>>;

/** Illustrative presentation only: never infers stock or catalogue identity. */
function illustration(name: string): Illustration | null {
  const normalized = name.toLocaleLowerCase("en-GB").trim();
  if (["chiavari chair", "chiavari wedding chair", "chiavari wedding chairs"].includes(normalized)) return INVENTORY_ILLUSTRATIONS.chair;
  if (["round table", "round banquet table", "6ft round table", "6 ft round table"].includes(normalized)) return INVENTORY_ILLUSTRATIONS.table;
  if (normalized === "projector") return INVENTORY_ILLUSTRATIONS.projector;
  return null;
}

/**
 * The widest the picture is drawn, in CSS px: InventoryStyle.css sets a box
 * at most 96 px tall in the list and 360 px for the featured item, and
 * object-fit: contain fits the picture's width to that height.
 */
export function inventoryPictureSizes(aspect: number, hero: boolean): string {
  return `${String(Math.ceil((hero ? 360 : 96) * aspect))}px`;
}

export function InventoryPicture({ name, assetId, hero = false }: {
  readonly name: string; readonly assetId?: string; readonly hero?: boolean;
}): ReactElement {
  const modelPreview = assetId === undefined ? undefined : getCanonicalAssetById(assetId)?.thumbnailUrl;
  const art = modelPreview === undefined ? illustration(name) : null;
  const src = modelPreview ?? art?.src ?? null;
  const caption = modelPreview === undefined ? "Illustrative view" : "3D model preview";
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <figure className={`inventory-picture${hero ? " inventory-picture--hero" : ""}`}>
    {src !== null && failedSource !== src ? <><img srcSet={art?.srcSet} sizes={art === null ? undefined : inventoryPictureSizes(art.aspect, hero)}
      src={src} alt={`${name}, ${caption.toLowerCase()}`} decoding="async"
      loading={hero ? "eager" : "lazy"} onError={() => { setFailedSource(src); }} />
      {hero ? <figcaption>{caption}</figcaption> : null}</> : <figcaption>{modelPreview === undefined ? "Equipment photo not added" : "Model preview unavailable"}</figcaption>}
  </figure>;
}
