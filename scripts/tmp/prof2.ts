import { parseDxf, polygonsOfLayer } from "../../src/lib/dxf";
import { sampleDxf } from "../../src/lib/sample";
import { defaultParams, optimizeBlock } from "../../src/lib/parcelation";
const doc = parseDxf(sampleDxf());
const ring = polygonsOfLayer(doc, "ADA")[0];
const g = globalThis as any; g.__c = {};
const t = Date.now();
optimizeBlock(ring, [], defaultParams, { id: "t", name: "t", variant: 0 });
console.log("ms", Date.now() - t, JSON.stringify(g.__c));
