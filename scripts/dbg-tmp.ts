import { parseDxf, polygonsOfLayer } from "../src/lib/dxf";
import { sampleDxf } from "../src/lib/sample";
import { defaultParams, optimizeBlock } from "../src/lib/parcelation";
const doc = parseDxf(sampleDxf());
const layer = doc.layers.find((l)=>/ADA/i.test(l))!;
const ring = polygonsOfLayer(doc, layer)[0];
const b = optimizeBlock(ring, [], defaultParams, { id:"t", name:"t", variant:0 });
console.log(b.log?.join("\n"));
for (const p of b.parcels) console.log(p.no, p.corner, p.area.toFixed(2), p.valid);
