/**
 * Odaklı köşe parsel teşhisi (salt okuma). bun scripts/diagnose-corner-focus.ts
 */
import { readFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "../src/lib/dxf";
import { defaultParams, optimizeBlock, detectRoadFrontages, type Params } from "../src/lib/parcelation";
import { dist, ringArea, polylineLength, nearestOnPolyline, type Pt, type Ring } from "../src/lib/geo";

const f = (v: number, d = 2) => Number(v.toFixed(d));
const base: Params = { ...defaultParams, frontSetback: 5, sideSetback: 3, rearSetback: 3, minBuildingFront: 6 };

function appliedSetback(a: Pt, b: Pt, env: Ring): number {
  const L = dist(a, b);
  if (L < 1e-9 || env.length < 3) return NaN;
  const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  let m = Infinity;
  for (const q of env) m = Math.min(m, Math.abs((q[0] - a[0]) * nx + (q[1] - a[1]) * ny));
  return m;
}
const onLine = (a: Pt, b: Pt, ls: Pt[][], tol = 1.0) =>
  [0.15, 0.5, 0.85].every((t) => ls.some((l) => nearestOnPolyline([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Pt, l).d < tol));

function run(name: string, ring: Ring, over: Partial<Params>) {
  const p: Params = { ...base, ...over };
  const b = optimizeBlock(ring, [], p, { id: "x", name, variant: 0 });
  const fr = detectRoadFrontages(b.ring);
  const road: Pt[][] = [[...b.ring, b.ring[0]]];
  console.log(`\n### ${name} | tespit edilen cephe ${fr.length} (${fr.map((x) => f(polylineLength(x))).join(", ")} m) | parsel ${b.parcels.length} geçerli ${b.parcels.filter((x) => x.valid).length}`);
  for (const c of b.parcels.filter((x) => x.corner)) {
    console.log(
      `KÖŞE #${c.no} alan=${f(c.area)} ölçülenCephe=${f(c.frontage)} (gerekli ${p.cornerFront}) derinlik=${f(c.depth)} zarf=${c.envelope ? f(Math.abs(ringArea(c.envelope))) : "YOK"} blok=${c.building ? f(c.buildingArea) : "YOK"} blokCephe=${f(c.buildingFront)} blokDerinlik=${f(c.buildingDepth)} geçerli=${c.valid} :: ${c.issues.join(" | ") || "-"}`,
    );
    let roadLen = 0, detLen = 0;
    for (let i = 0; i < c.ring.length; i++) {
      const a = c.ring[i], q = c.ring[(i + 1) % c.ring.length];
      const isRoad = onLine(a, q, road, 0.9);
      const det = fr.map((x, k) => (onLine(a, q, [x], 1.2) ? k : -1)).filter((k) => k >= 0);
      if (isRoad) roadLen += dist(a, q);
      if (det.length) detLen += dist(a, q);
      console.log(`   kenar${i} uz=${f(dist(a, q))} adaSınırı=${isRoad ? "EVET" : "hayır"} tespitEdilenCepheNo=${det.length ? det.join(",") : "-"} uygulananÇekme=${f(appliedSetback(a, q, c.envelope ?? []))}`);
    }
    console.log(`   → gerçek yol cephesi toplamı=${f(roadLen)} m, ölçüme giren (tespit edilen cephede) uzunluk=${f(detLen)} m`);
  }
}

const doc = parseDxf(readFileSync("/tmp/user-uploads/350ADA.DXF", "latin1"));
const layer = doc.layers.find((l) => /ADA/i.test(l)) ?? doc.layers[0];
const real = polygonsOfLayer(doc, layer).filter((r) => Math.abs(ringArea(r)) > 500)[0];

run("GERÇEK 350ADA, 290-330", real, { minArea: 290, maxArea: 330 });
run("F 60° eğik köşe, 290-330", [[0, 0], [80, 0], [103, 40], [23, 40]], { minArea: 290, maxArea: 330 });
run("E pahlı köşe, 290-330", [[6, 0], [74, 0], [80, 6], [80, 40], [0, 40], [0, 6]], { minArea: 290, maxArea: 330 });
run("H TEK SIRA 80x22 (arka kenar ada sınırı)", [[0, 0], [80, 0], [80, 22], [0, 22]], { minArea: 250, maxArea: 400 });
