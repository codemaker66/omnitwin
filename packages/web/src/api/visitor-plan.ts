import { API_URL } from "../config/env.js";
import { ApiError } from "./client.js";

// ---------------------------------------------------------------------------
// The visitor's plan as a PDF (fix-first item 11).
//
// The organiser's own browser asks for its own plan with the id it already
// holds; the PDF that comes back carries no id, address or prices, so it is
// safe to send to anyone. Non-JSON, so it bypasses the typed request helper,
// the same way the hallkeeper sheet download does. No auth: a guest plan has
// no owner account.
// ---------------------------------------------------------------------------

function errorCode(body: unknown): string {
  if (typeof body === "object" && body !== null && "code" in body && typeof body.code === "string") {
    return body.code;
  }
  return "HTTP_ERROR";
}

export async function fetchVisitorPlanPdf(configId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(
    `${API_URL}/public/configurations/${encodeURIComponent(configId)}/plan.pdf`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    throw new ApiError(res.status, "The plan PDF could not be prepared.", errorCode(body));
  }
  const type = res.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/pdf") {
    throw new ApiError(0, "The server did not return a PDF.", "RESPONSE_VALIDATION_ERROR");
  }
  return res.blob();
}
