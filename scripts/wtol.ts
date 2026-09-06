import { optimizeBlock, defaultParams } from "@/lib/parcelation";
import { parseDxf, polygonsOfLayer, linesOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
const doc = parseDxf(sampleDxf());
const blocks = polygonsOfLayer(doc, "ADA");
const p = { ...defaultParams, tolerance: 2.0 };
let worst = 0, pairs = 0;
for (const [i, ringB] of blocks.entries()) {
  const r = optimizeBlock(`A${i}`, `ADA ${i+1}`, ringB, linesOfLayer(doc, "YAPI_INSAA_HATTI"), [], [], p);
  console.log(`ADA ${i+1}: ${r.parcels.length} parsel, ${r.parcels.filter(x=>x.valid).length} geçerli`);
  const pts: [number,number,number][] = [];
  r.parcels.forEach((pc, pi) => pc.ring.forEach(q => pts.push([q[0], q[1], pi])));
  for (let a=0;a<pts.length;a++) for (let b=a+1;b<pts.length;b++) {
    if (pts[a]![2]===pts[b]![2]) continue;
    const d = Math.hypot(pts[a]![0]-pts[b]![0], pts[a]![1]-pts[b]![1]);
    if (d > 1e-6 && d <= p.tolerance) { pairs++; worst = Math.max(worst, d); }
  }
}
console.log("tolerans içinde AYRIK kalan köşe çifti:", pairs, "en büyük:", worst.toFixed(3));
