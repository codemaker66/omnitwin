import { App as Editor } from "../App.js";
import { UserMenu } from "../components/auth/UserMenu.js";

// ---------------------------------------------------------------------------
// EditorPage — wraps the existing 3D editor with auth UI
// ---------------------------------------------------------------------------

export function EditorPage(): React.ReactElement {
  return (
    <>
      <UserMenu />
      <Editor />
    </>
  );
}
