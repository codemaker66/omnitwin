import type { ReactNode } from "react";
import { useAuthStore } from "../../stores/auth-store.js";
import { canReadInternalEventData } from "../../lib/event-access.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

/** Internal event tools require current operational or platform authority. */
export function InternalEventRoute({ children }: { readonly children: ReactNode }): React.ReactElement {
  const auth = useAuthStore();
  const allowed = canReadInternalEventData(auth);
  return <ProtectedRoute {...(allowed ? {} : { allowedRoles: [] })}>{allowed ? children : null}</ProtectedRoute>;
}
