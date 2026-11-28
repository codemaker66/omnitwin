import { useEffect } from "react";

/**
 * A private page: it has a title, is never indexed, and its address is never
 * sent on as a referrer. The two meta tags leave with the page.
 */
export function usePrivatePageHead(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(robots, referrer);
    return () => { robots.remove(); referrer.remove(); };
  }, []);
}
