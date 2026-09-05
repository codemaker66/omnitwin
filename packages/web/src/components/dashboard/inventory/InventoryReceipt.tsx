import type { ReactElement } from "react";
import type { VenueInventoryReceipt } from "@omnitwin/types";
import { useAuthStore } from "../../../stores/auth-store.js";

export function InventoryReceipt({ receipt }: { readonly receipt: VenueInventoryReceipt }): ReactElement {
  const user = useAuthStore((state) => state.user);
  const actorName = user?.id === receipt.actorUserId && user.name.trim() !== "" ? user.name : "Venue administrator";
  const before = receipt.before;
  const after = receipt.after;
  return <details className="inventory-receipt">
    <summary><span>{receipt.reason}</span><time dateTime={receipt.recordedAt}>
      {new Date(receipt.recordedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
    </time></summary>
    <dl>
      <div><dt>Owned</dt><dd>{before?.ownedQuantity ?? "Not recorded"} → {after.ownedQuantity}</dd></div>
      <div><dt>Damaged</dt><dd>{before?.damagedQuantity ?? "Not recorded"} → {after.damagedQuantity}</dd></div>
      <div><dt>Other unavailable</dt><dd>{before?.unavailableQuantity ?? "Not recorded"} → {after.unavailableQuantity}</dd></div>
      <div><dt>Storage</dt><dd>{before?.storageLocation ?? "Not recorded"} → {after.storageLocation ?? "Not recorded"}</dd></div>
      <div><dt>Status</dt><dd>{before?.status ?? "Not recorded"} → {after.status}</dd></div>
      <div><dt>Recorded by</dt><dd>{actorName}<details><summary>Audit identifiers</summary>
        <p>Administrator <code>{receipt.actorUserId}</code></p><p>Receipt <code>{receipt.command.commandId}</code></p>
      </details></dd></div>
      <div><dt>Record version</dt><dd>{after.revision}</dd></div>
    </dl>
  </details>;
}
