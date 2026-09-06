import { useState, type ReactElement } from "react";
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

export function InventoryPicture({ name, hero = false }: { readonly name: string; readonly hero?: boolean }): ReactElement {
  const src = illustration(name);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <figure className={`inventory-picture${hero ? " inventory-picture--hero" : ""}`}>
    {src !== null && failedSource !== src ? <><img src={src} alt={`${name}, illustrative view`} decoding="async"
      loading={hero ? "eager" : "lazy"} onError={() => { setFailedSource(src); }} />
      {hero ? <figcaption>Illustrative view</figcaption> : null}</> : <figcaption>Equipment photo not added</figcaption>}
  </figure>;
}
