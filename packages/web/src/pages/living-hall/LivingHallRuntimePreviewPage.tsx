import { useParams } from "react-router-dom";
import { LivingHallPage } from "./LivingHallPage.js";

/** Platform-admin shell for one exact immutable Reception Room package. */
export function LivingHallRuntimePreviewPage(): React.ReactElement {
  const { runtimePackageId } = useParams<{ runtimePackageId: string }>();
  const exactId = runtimePackageId ?? "";
  return <LivingHallPage key={exactId} previewPackageId={exactId} />;
}
