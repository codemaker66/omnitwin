import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useEditorStore } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// SceneProvider — exposes the Three.js scene to non-Canvas code
//
// Punch list #24: the ortho-capture utility needs the live Three.js scene
// to render a top-down floor plan PNG. SaveSendPanel (which triggers the
// capture) is outside the <Canvas> and can't call useThree(). This
// component bridges the gap by writing the scene ref to the editor-store
// on mount and clearing it on unmount.
//
// Must be rendered inside the <Canvas> — it calls useThree() which only
// works within R3F's context provider.
// ---------------------------------------------------------------------------

export function SceneProvider(): null {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    useEditorStore.setState({ scene });
    return () => { useEditorStore.setState({ scene: null }); };
  }, [scene]);

  return null;
}
