import type { ReactElement } from "react";
import { RequestsProvider } from "../../components/requests/RequestsProvider.js";
import { DayBoardPage } from "./DayBoardPage.js";

// ---------------------------------------------------------------------------
// The Day Board as its route mounts it: the board, with the requests provider
// around it so each slot's reserved region can show what the room has asked
// for (Lane 9 fills Lane 6's <SlotRequests> contract through the provider's
// context; the board knows nothing about requests).
//
// The provider lives here rather than at the app root because the slab is a
// Day Board surface and nothing else consumes it. At the root it put the
// request API client, its schemas and zod into the bundle every visitor
// loads, the public front door included; here they arrive with this route.
// ---------------------------------------------------------------------------

export function DayBoardRoute(): ReactElement {
  return (
    <RequestsProvider>
      <DayBoardPage />
    </RequestsProvider>
  );
}
