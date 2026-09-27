import { useEffect, useState } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import { getAvailableTransitions } from "../../api/configuration-reviews.js";

/** Where this layout stands in the venue's review, or null until it is read
 *  or when it cannot be (a layout that predates the review workflow, or a
 *  reader the API does not answer). The sheet then shows no review state
 *  rather than a guessed one. */
export function useSheetReviewStatus(configId: string): ConfigurationReviewStatus | null {
  const [read, setRead] = useState<{ readonly configId: string; readonly status: ConfigurationReviewStatus } | null>(null);
  useEffect(() => {
    let current = true;
    getAvailableTransitions(configId).then(({ currentStatus }) => {
      if (current) setRead({ configId, status: currentStatus });
    }).catch(() => {
      // No review record, or no permission to read one: show nothing.
    });
    return () => { current = false; };
  }, [configId]);
  return read?.configId === configId ? read.status : null;
}
