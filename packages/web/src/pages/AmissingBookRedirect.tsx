import { useEffect, type ReactElement } from "react";
import { ActivityStatus } from "../components/shared/Activity.js";

/** Client navigation and local preview also need a full document load: the game
 * is a standalone export, outside the React router. Production redirects these
 * legacy URLs at the edge before the application is downloaded. */
export function AmissingBookRedirect(): ReactElement {
  // Vite dev serves public files literally; directory-index rewrites belong to
  // Vercel/preview. Use the explicit document only in development.
  const entry = import.meta.env.DEV ? "/amissing-book/index.html" : "/amissing-book/";
  const destination = `${entry}${window.location.search}${window.location.hash}`;
  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return (
    <main>
      <ActivityStatus>Opening The Amissing Book…</ActivityStatus>
      <p><a href={destination}>Play the game</a></p>
    </main>
  );
}
