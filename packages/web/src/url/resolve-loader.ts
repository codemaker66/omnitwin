import { redirect, type LoaderFunctionArgs } from "react-router-dom";
import { LayoutResolveResponseSchema } from "@omnitwin/types";
import { api, ApiError } from "../api/client.js";

// ---------------------------------------------------------------------------
// React Router loader — converts an incoming URL into a config ID.
//
// Every route that shows a layout (`/plan/<code>`, `/<username>/<slug>`)
// uses this loader so the resolver decision happens BEFORE the 3D
// editor mounts:
//
//   - `canonical` — load proceeds; `{ configId }` becomes loader data.
//   - `redirect`  — loader returns a redirect Response; browser navigates
//                   to the canonical URL and re-runs the loader there.
//   - `not_found` — loader throws a 404 Response; router renders
//                   whatever error boundary is in scope (or the default).
//
// Loader errors fall through to the nearest `errorElement`. A network
// blip rethrows as an ApiError so the user sees a real error state
// rather than a silent 404.
// ---------------------------------------------------------------------------

export interface ResolvedLayoutData {
  readonly configId: string;
}

export async function resolveLayoutLoader(
  { request }: LoaderFunctionArgs,
): Promise<ResolvedLayoutData | Response> {
  // `request.url` is a full absolute URL; we only need the path portion
  // for the resolver (it parses `/plan/<x>` or `/<user>/<slug>`).
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    const result = await api.get(
      `/layouts/resolve?path=${encodeURIComponent(path)}`,
      LayoutResolveResponseSchema,
    );
    if (result.status === "not_found") {
      // React Router's convention for 404s is to throw a Response; the
      // lint rule that normally wants Error objects doesn't apply here.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new Response("Layout not found", { status: 404 });
    }
    if (result.status === "redirect") {
      // React Router treats a returned Response as a full navigation.
      // The server-side alias chain already decided the destination IS
      // canonical, so a single hop is sufficient.
      return redirect(result.toPath);
    }
    return { configId: result.configId };
  } catch (err) {
    // If the resolver itself returned a non-200 (e.g. 500), surface as
    // a router error so the user sees a real error page, not a 404.
    if (err instanceof Response) throw err;
    if (err instanceof ApiError) throw err;
    throw new Error("Failed to resolve layout URL");
  }
}
