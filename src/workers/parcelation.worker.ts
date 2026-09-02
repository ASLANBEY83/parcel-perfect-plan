/// <reference lib="webworker" />
// Parselasyon hesabını ana thread'den ayırır: tarayıcı "sayfa yanıt vermiyor" demez.
import { optimizeBlock, type BlockResult, type Params } from "@/lib/parcelation";
import { computeBlockDebug, logBlockDebug, type BlockDebug } from "@/lib/parcel-debug";
import type { Pt, Ring } from "@/lib/geo";

export type WorkerRequest = {
  type: "compute";
  jobId: number;
  rings: Ring[];
  buildingLines: Pt[][];
  params: Params;
  variant: number;
};

export type WorkerResponse =
  | { type: "progress"; jobId: number; done: number; total: number }
  | { type: "block"; jobId: number; index: number; result: BlockResult; debug?: BlockDebug }
  | { type: "done"; jobId: number; results: BlockResult[] }
  | { type: "error"; jobId: number; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "compute") return;
  const { jobId, rings, buildingLines, params, variant } = msg;
  const results: BlockResult[] = [];
  try {
    rings.forEach((ring, i) => {
      const result = optimizeBlock(ring, buildingLines, params, {
        id: `ada-${i + 1}`,
        name: `ADA ${i + 1}`,
        variant,
      });
      results.push(result);
      let debug: BlockDebug | undefined;
      try {
        debug = computeBlockDebug(result, params);
        logBlockDebug(debug);
      } catch {
        debug = undefined;
      }
      (self as unknown as Worker).postMessage({ type: "block", jobId, index: i, result, debug } satisfies WorkerResponse);
      (self as unknown as Worker).postMessage({
        type: "progress",
        jobId,
        done: i + 1,
        total: rings.length,
      } satisfies WorkerResponse);
    });
    (self as unknown as Worker).postMessage({ type: "done", jobId, results } satisfies WorkerResponse);

  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      jobId,
      message: (err as Error).message,
    } satisfies WorkerResponse);
  }
};
