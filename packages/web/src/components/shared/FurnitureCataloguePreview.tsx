import { useState, type ReactElement, type ReactNode } from "react";
import { catalogueIcon, type CatalogueItem } from "../../lib/catalogue.js";

/** Source-model renders make similar furniture finishes recognisable in the picker. */
export function FurnitureCataloguePreview({ item, size = 36, fallback }: {
  readonly item: CatalogueItem;
  readonly size?: number;
  readonly fallback?: ReactNode;
}): ReactElement {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = item.thumbnailUrl;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, display: "flex", flexShrink: 0,
        alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 6,
        pointerEvents: "none", userSelect: "none" }}
    >
      {url !== undefined && url !== null && url.length > 0 && failedUrl !== url ? (
        <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async"
          draggable={false} onError={() => { setFailedUrl(url); }}
          style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : fallback ?? (
        <span style={{ width: "100%", height: "100%" }}
          dangerouslySetInnerHTML={{ __html: catalogueIcon(item) }} />
      )}
    </span>
  );
}
