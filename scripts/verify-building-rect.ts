import { readFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
import { defaultParams, optimizeBlock, type Params } from "@/lib/parcelation";
import { dist, dot, norm, sub, mpDifference, mpArea, type Ring } from "@/lib/geo";

function check(label: string, ring: Ring, ov: Partial<Params>) {
  const p = { ...defaultParams, ...ov };
  const b = optimizeBlock(ring, [], p, { id: "x", name: label, variant: 0 });
  let rects = 0,
    bad = 0,
    outside = 0,
    blocks = 0;
  for (const q of b.parcels) {
    if (!q.building) continue;
    blocks++;
    const r = q.building;
    if (r.length !== 4) {
      bad++;
      continue;
    }
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const a = norm(sub(r[(i + 1) % 4], r[i]));
      const c = norm(sub(r[(i + 2) % 4], r[(i + 1) % 4]));
      if (Math.abs(dot(a, c)) > 0.01) ok = false;
    }
    if (dist(r[0], r[1]) < 1e-6) ok = false;
    if (ok) rects++; else bad++;
    if (q.envelope) {
      const out = mpArea(mpDifference([[r]], [[q.envelope]]));
      if (out > 0.05) {
        outside++;
        console.log(`  #${q.no} zarf dışı taşma: ${out.toFixed(3)} m²`);
      }
    }
  }
  console.log(
    `${label}: parsel=${b.parcels.length} geçerli=${b.parcels.filter((x) => x.valid).length} blok=${blocks} dikAçılıDikdörtgen=${rects} bozuk=${bad} zarfDışıTaşan=${outside}`,
  );
}
const s = parseDxf(sampleDxf());
const sr = polygonsOfLayer(s, "ADA")[0];
check("ÖRNEK 275-400", sr, {});
check("ÖRNEK 290-330", sr, { minArea: 290, maxArea: 330 });
try {
  const d = parseDxf(readFileSync("/tmp/user-uploads/350ADA.DXF", "latin1"));
  const layer = d.layers.find((l) => /ADA/i.test(l)) ?? d.layers[0];
  for (const [i, r] of polygonsOfLayer(d, layer).entries())
    check(`350ADA#${i + 1} 290-330`, r, { minArea: 290, maxArea: 330 });
} catch (e) {
  console.log("350ADA yok:", (e as Error).message);
}
