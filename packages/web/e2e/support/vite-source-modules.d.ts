// Live-stack specs import the planner's own store modules inside the page,
// by the URL Vite serves them at (one module instance per URL, so the spec
// and the app share state). TypeScript cannot resolve those URLs; each spec
// narrows the import to the small typed surface it uses.
declare module "/src/stores/*";
// The editor bridge, for its autosave delay override (planner-work-survives).
declare module "/src/components/editor/EditorBridge.tsx";
