type ThreeDevWindow = Window & {
  __THREE__?: string;
};

delete (window as ThreeDevWindow).__THREE__;

// @sparkjsdev/spark loads its sorter WASM with WebAssembly.instantiateStreaming
// at import time. Under Node + happy-dom the streaming source (a happy-dom
// Response) is rejected by Node's WASM API ("source argument must be an
// instance of Response"), producing a benign async unhandled rejection that can
// flake longer-running test files. Apply the standard arrayBuffer fallback so
// the WASM instantiates normally in the test environment instead of rejecting.
if (typeof WebAssembly.instantiateStreaming === "function") {
  WebAssembly.instantiateStreaming = async (
    source: Response | PromiseLike<Response>,
    importObject?: WebAssembly.Imports,
  ): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
    const response = await source;
    const bytes = await response.arrayBuffer();
    return WebAssembly.instantiate(bytes, importObject);
  };
}
