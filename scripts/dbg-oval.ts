import { defaultParams, optimizeBlock, detectRoadFrontages } from "@/lib/parcelation";
import { polylineLength, ringArea, type Pt, type Ring } from "@/lib/geo";
const n = Number(process.argv[2] ?? 40);
const ring: Ring = [];
for (let i = 0; i < n; i++) {
  const t = (2 * Math.PI * i) / n;
  ring.push([65 * Math.cos(t), 23 * Math.sin(t)] as Pt);
}
console.log("n", n, "alan", Math.round(ringArea(ring)));
const f = detectRoadFrontages(ring);
console.log("cephe", f.length, f.map((x) => Math.round(polylineLength(x))));
const t0 = Date.now();
const b = optimizeBlock(ring, [], { ...defaultParams, minArea: 290, maxArea: 330 }, { id: "o", name: "OVAL", variant: 0 });
console.log("süre", ((Date.now() - t0) / 1000).toFixed(1), "s | parsel", b.parcels.length, "geçerli", b.parcels.filter((p) => p.valid).length);
console.log((b.log ?? []).filter((l) => /paralel/i.test(l)).join("\n"));
for (const p of b.parcels)
  console.log(`#${p.no} sıra${p.row} köşe=${p.corner} alan=${p.area.toFixed(1)} cephe=${p.frontage.toFixed(1)} derinlik=${p.depth.toFixed(1)} valid=${p.valid} :: ${p.issues.filter((i) => !i.startsWith("ℹ")).join(" | ")}`);
