import { nativeValue } from "./native-splat-data.js";
import type { BufferGeometry } from "three";
import { nativeDataToGeometry, type NativeSplatData } from "./native-splat-data.js";
import { browserNativeWorkBudget } from "./native-work-budget.js";
export interface NativeSplatProgress {
    readonly loaded: number;
    readonly total: number | null;
    readonly phase: "fetch" | "decode";
}
export interface NativeSplatLoadOptions {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: NativeSplatProgress) => void;
}
type WorkerResult = {
    type: "progress";
    progress: NativeSplatProgress;
} | {
    type: "loaded";
    data: NativeSplatData;
} | {
    type: "error";
    message: string;
};
const queue: (() => void)[] = [];
let running = 0;
function pump(): void { while (running < browserNativeWorkBudget().decodeWorkers && queue.length > 0)
    nativeValue(queue.shift())(); }
/** Native Three geometry, with source count/degree in userData.nativeSplat. */
export function loadNativeSplatGeometry(url: string, options: NativeSplatLoadOptions = {}): Promise<BufferGeometry> {
    return new Promise((resolve, reject) => {
        let worker: Worker | undefined;
        let settled = false;
        let active = false;
        const finish = (error?: Error | DOMException, data?: NativeSplatData): void => {
            if (settled)
                return;
            settled = true;
            options.signal?.removeEventListener("abort", abort);
            worker?.terminate();
            const queuedIndex = queue.indexOf(start);
            if (queuedIndex >= 0)
                queue.splice(queuedIndex, 1);
            if (active)
                running--;
            if (error)
                reject(error);
            else if (data) {
                try {
                    resolve(nativeDataToGeometry(data));
                }
                catch (cause) {
                    reject(cause instanceof Error ? cause : new Error(String(cause)));
                }
            }
            pump();
        };
        const abort = (): void => { finish(new DOMException("Splat loading cancelled.", "AbortError")); };
        const start = (): void => {
            active = true;
            running++;
            try {
                worker = new Worker(new URL("./native-splat-worker.ts", import.meta.url), { type: "module" });
                worker.onmessage = (event: MessageEvent<WorkerResult>) => {
                    if (settled)
                        return;
                    const message = event.data;
                    if (message.type === "progress")
                        options.onProgress?.(message.progress);
                    else if (message.type === "error")
                        finish(new Error(message.message));
                    else
                        finish(undefined, message.data);
                };
                worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || "Native splat decoder worker failed.")); };
                worker.onmessageerror = () => { finish(new Error("Native splat decoder returned an unreadable result.")); };
                worker.postMessage({ url: new URL(url, document.baseURI).href });
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        };
        if (options.signal?.aborted === true) {
            abort();
            return;
        }
        options.signal?.addEventListener("abort", abort, { once: true });
        queue.push(start);
        pump();
    });
}
