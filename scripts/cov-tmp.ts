import { defaultParams, optimizeBlock } from "@/lib/parcelation";
import { computeBlockDebug } from "@/lib/parcel-debug";
import type { Ring } from "@/lib/geo";
const ring: Ring = [];
for (let i=0;i<24;i++){const t=(i/24)*Math.PI*2;ring.push([22*Math.cos(t)+3*Math.sin(2*t), 95*Math.sin(t)]);}
const p = { ...defaultParams, minArea: 290, maxArea: 330 };
const b = optimizeBlock(ring, [], p, { id:"o", name:"OVAL", variant:0 });
const d = computeBlockDebug(b, p);
console.log("kaplama%", (d.coverageRatio*100).toFixed(2), "artık", d.gapArea.toFixed(1), "geçerli", d.acceptedCount+"/"+d.candidateCount);
console.log(b.log.filter(l=>/Alan doğrulama|artık|paralel/i.test(l)).join("\n"));
