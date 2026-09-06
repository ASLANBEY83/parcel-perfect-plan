import { optimizeBlock, defaultParams } from "@/lib/parcelation";
import { parseDxf, polygonsOfLayer, linesOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
const doc = parseDxf(sampleDxf());
const blocks = polygonsOfLayer(doc, "ADA");
const p = { ...defaultParams, tolerance: 2.0 };
let worst = 0, pairs = 0;
for (const [i, ringB] of blocks.entries()) {
  const r = optimizeBlock(ringB, linesOfLayer(doc, "YAPI_INSAA_HATTI"), p, { id: `A${i}`, name: `ADA ${i + 1}` });
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

const doc2 = parseDxf(sampleDxf());
const r2 = optimizeBlock(polygonsOfLayer(doc2, "ADA")[0]!, linesOfLayer(doc2, "YAPI_INSAA_HATTI"), p, { id: "A0", name: "ADA 1" });
console.log("--- log ---");
r2.log.filter(l => /tolerans|birleş|garanti|doğrulama/i.test(l)).forEach(l => console.log(" *", l));
const pts2: {x:number;y:number;pi:number;row:number}[] = [];
r2.parcels.forEach((pc, pi) => pc.ring.forEach(q => pts2.push({x:q[0],y:q[1],pi,row:pc.row})));
let shown = 0;
for (let a=0;a<pts2.length;a++) for (let b=a+1;b<pts2.length;b++) {
  if (pts2[a]!.pi===pts2[b]!.pi) continue;
  const d = Math.hypot(pts2[a]!.x-pts2[b]!.x, pts2[a]!.y-pts2[b]!.y);
  if (d>1e-6 && d<=p.tolerance && shown<10) { shown++; console.log("pair d=",d.toFixed(2),"p",pts2[a]!.pi,"row",pts2[a]!.row,"<->p",pts2[b]!.pi,"row",pts2[b]!.row); }
}
