import { parseDxf, polygonsOfLayer } from "../../src/lib/dxf";
import { sampleDxf } from "../../src/lib/sample";
import { defaultParams, optimizeBlock } from "../../src/lib/parcelation";
const doc = parseDxf(sampleDxf());
const ring = polygonsOfLayer(doc, "ADA")[0];
const t = Date.now();
const b = optimizeBlock(ring, [], defaultParams, { id: "t", name: "t", variant: 0 });
console.log("ms", Date.now() - t, "parcels", b.parcels.length, "valid", b.parcels.filter(p=>p.valid).length);
