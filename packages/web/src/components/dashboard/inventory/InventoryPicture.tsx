import { useState, type ReactElement } from "react";
import { getCanonicalAssetById } from "@omnitwin/types";
import chair from "../../../assets/inventory-style/chiavari-chair.webp";
import table from "../../../assets/inventory-style/round-table.webp";
import projector from "../../../assets/inventory-style/projector.webp";

/** Illustrative presentation only: never infers stock or catalogue identity. */
function illustration(name: string): string | null {
  const normalized = name.toLocaleLowerCase("en-GB").trim();
  if (["chiavari chair", "chiavari wedding chair", "chiavari wedding chairs"].includes(normalized)) return chair;
  if (["round table", "round banquet table", "6ft round table", "6 ft round table"].includes(normalized)) return table;
  if (normalized === "projector") return projector;
  return null;
}

export function InventoryPicture({ name, assetId, hero = false }: {
  readonly name: string; readonly assetId?: string; readonly hero?: boolean;
}): ReactElement {
  const modelPreview = assetId === undefined ? undefined : getCanonicalAssetById(assetId)?.thumbnailUrl;
  const src = modelPreview ?? illustration(name);
  const caption = modelPreview === undefined ? "Illustrative view" : "3D model preview";
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <figure className={`inventory-picture${hero ? " inventory-picture--hero" : ""}`}>
    {src !== null && failedSource !== src ? <><img src={src} alt={`${name}, ${caption.toLowerCase()}`} decoding="async"
      loading={hero ? "eager" : "lazy"} onError={() => { setFailedSource(src); }} />
      {hero ? <figcaption>{caption}</figcaption> : null}</> : <figcaption>{modelPreview === undefined ? "Equipment photo not added" : "Model preview unavailable"}</figcaption>}
  </figure>;
}
