/**
 * KÖŞE PARSEL TEŞHİS BETİĞİ (salt okuma / ölçüm; algoritmayı değiştirmez).
 * Çalıştırma: bun scripts/diagnose-corner.ts [dxfPath]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "../src/lib/dxf";
import { defaultParams, optimizeBlock, detectRoadFrontages, buildEnvelope, type Params, type Parcel, type BlockResult } from "../src/lib/parcelation";
import { dist, ringArea, polylineLength, nearestOnPolyline, type Pt, type Ring } from "../src/lib/geo";

const f = (v: number, d = 2) => Number(v.toFixed(d));

const P: Params = {
  ...defaultParams,
  frontSetback: 5,
  sideSetback: 3,
  rearSetback: 3,
  minBuildingFront: 6,
  minBuildingDepth: defaultParams.minBuildingDepth,
};

/** Kenarın sonsuz doğrusuna göre zarfın minimum içe kayması = FİİLEN uygulanan çekme. */
function appliedSetback(a: Pt, b: Pt, env: Ring): number {
  const L = dist(a, b);
  if (L < 1e-9 || env.length < 3) return NaN;
  const nx = -(b[1] - a[1]) / L;
  const ny = (b[0] - a[0]) / L;
  let m = Infinity;
  for (const q of env) m = Math.min(m, Math.abs((q[0] - a[0]) * nx + (q[1] - a[1]) * ny));
  return m;
}

/** Kenar ada sınırında mı (yola cepheli mi)? */
function onRoad(a: Pt, b: Pt, roadLines: Pt[][], tol = 0.9): boolean {
  const mids: Pt[] = [0.15, 0.5, 0.85].map((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  return mids.every((m) => roadLines.some((l) => nearestOnPolyline(m, l).d < tol));
}

function reportParcel(p: Parcel, roadLines: Pt[][], frontages: Pt[][]) {
  const edges: string[] = [];
  for (let i = 0; i < p.ring.length; i++) {
    const a = p.ring[i];
    const b = p.ring[(i + 1) % p.ring.length];
    const road = onRoad(a, b, roadLines);
    const onDetected = frontages
      .map((fr, k) => (onRoad(a, b, [fr], 1.2) ? k : -1))
      .filter((k) => k >= 0);
    const app = p.envelope ? appliedSetback(a, b, p.envelope) : NaN;
    edges.push(
      `    kenar${i} uz=${f(dist(a, b))} adaSınırı=${road ? "EVET" : "hayır"} tespitEdilenCephe=${onDetected.length ? onDetected.join(",") : "-"} uygulananÇekme=${f(app)}`,
    );
  }
  console.log(
    `  #${p.no} ${p.corner ? "KÖŞE" : "ara "} alan=${f(p.area)} cephe=${f(p.frontage)} derinlik=${f(p.depth)} ` +
      `zarf=${p.envelope ? f(Math.abs(ringArea(p.envelope))) : "YOK"} ` +
      `blok=${p.building ? f(p.buildingArea) : "YOK"} blokCephe=${f(p.buildingFront)} blokDerinlik=${f(p.buildingDepth)} ` +
      `geçerli=${p.valid}${p.issues.length ? " :: " + p.issues.join(" | ") : ""}`,
  );
  console.log(edges.join("\n"));
}

function runBlock(name: string, ring: Ring, params: Params = P): BlockResult {
  const b = optimizeBlock(ring, [], params, { id: name, name, variant: 0 });
  const frontages = detectRoadFrontages(b.ring);
  const roadLines: Pt[][] = [[...b.ring, b.ring[0]]];
  console.log(
    `\n### ${name} | ada alanı=${f(Math.abs(ringArea(b.ring)))} m² | tespit edilen yol cephesi=${frontages.length} ` +
      `(${frontages.map((x) => f(polylineLength(x))).join(" m, ")} m) | roadLines eleman sayısı=${roadLines.length} (tüm ada sınırı)`,
  );
  const corners = b.parcels.filter((x) => x.corner);
  console.log(
    `parsel ${b.parcels.length} | geçerli ${b.parcels.filter((x) => x.valid).length} | köşe ${corners.length} | köşe geçerli ${corners.filter((x) => x.valid).length}`,
  );
  for (const p of b.parcels) reportParcel(p, roadLines, frontages);
  return b;
}

// ---------------- 1) GERÇEK DXF ----------------
const dxfPath = process.argv[2] ?? "/mnt/user-uploads/350ADA.DXF";
const doc = parseDxf(readFileSync(dxfPath, "latin1"));
console.log("DXF katmanları:", doc.layers.join(", "));
const adaLayer = doc.layers.find((l) => /ADA/i.test(l)) ?? doc.layers[0];
const rings = polygonsOfLayer(doc, adaLayer).filter((r) => Math.abs(ringArea(r)) > 500);
rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
console.log(`ADA katmanı=${adaLayer} | uygun halka=${rings.length}`);

const real: BlockResult[] = [];
for (let i = 0; i < Math.min(rings.length, 2); i++) real.push(runBlock(`GERÇEK ADA ${i + 1} (${adaLayer})`, rings[i]));

// ---------------- 2) KÖŞE SENARYOLARI ----------------
const rot = (r: Ring, deg: number): Ring => {
  const t = (deg * Math.PI) / 180;
  return r.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)] as Pt);
};
// A) iki yol cephesi ~90°: dikdörtgen ada
const A: Ring = [[0, 0], [80, 0], [80, 40], [0, 40]];
// B) eğik: paralelkenar ada
const B: Ring = [[0, 0], [80, 0], [92, 40], [12, 40]];
// C) köşe parselin uzun cephesi yolda (geniş, sığ ada)
const C: Ring = [[0, 0], [120, 0], [120, 26], [0, 26]];
// D) köşe parselin kısa cephesi yolda (dar, derin ada)
const D: Ring = [[0, 0], [40, 0], [40, 60], [0, 60]];
const scen = runBlock("SENARYO A (90°, 80x40)", A);
const scenB = runBlock("SENARYO B (eğik paralelkenar)", B);
const scenC = runBlock("SENARYO C (uzun cephe yolda 120x26)", C);
const scenD = runBlock("SENARYO D (kısa cephe yolda 40x60)", D);
// Yön duyarlılığı: aynı ada 30° ve 45° döndürülmüş
const scenR30 = runBlock("SENARYO A-30° döndürülmüş", rot(A, 30));
const scenR45 = runBlock("SENARYO A-45° döndürülmüş", rot(A, 45));

// ---------------- 3) İZOLE KÖŞE PARSEL ZARF TESTİ ----------------
console.log("\n### İZOLE KÖŞE PARSEL ZARFI (iki yol cephesi)");
// L köşesinde parsel: alt kenar (y=0) ve sol kenar (x=0) yol
const cp: Ring = [[0, 0], [16, 0], [16, 25], [0, 25]];
const roads2: Pt[][] = [[[-20, 0], [60, 0]], [[0, -20], [0, 60]]];
const env2 = buildEnvelope(cp, roads2, P, roads2);
console.log(
  "iki yol cepheli köşe parsel zarfı alanı:",
  f(Math.abs(ringArea(env2))),
  "| kenar başına uygulanan çekme:",
  cp.map((_, i) => f(appliedSetback(cp[i], cp[(i + 1) % 4], env2))).join(" / "),
  "(alt=yol, sağ, üst, sol=yol)",
);

// GeoJSON çıktısı
const geo = (bs: { name: string; b: BlockResult }[]) => ({
  type: "FeatureCollection",
  features: bs.flatMap(({ name, b }) => [
    { type: "Feature", properties: { name, kind: "ada" }, geometry: { type: "Polygon", coordinates: [[...b.ring, b.ring[0]]] } },
    ...b.parcels.flatMap((p) => [
      { type: "Feature", properties: { name, kind: "parsel", no: p.no, corner: p.corner, valid: p.valid, area: f(p.area), issues: p.issues.join(" | ") }, geometry: { type: "Polygon", coordinates: [[...p.ring, p.ring[0]]] } },
      ...(p.envelope ? [{ type: "Feature", properties: { name, kind: "zarf", no: p.no }, geometry: { type: "Polygon", coordinates: [[...p.envelope, p.envelope[0]]] } }] : []),
      ...(p.building ? [{ type: "Feature", properties: { name, kind: "blok", no: p.no }, geometry: { type: "Polygon", coordinates: [[...p.building, p.building[0]]] } }] : []),
    ]),
  ]),
});
mkdirSync("/mnt/documents/kose-parsel-teshis", { recursive: true });
writeFileSync(
  "/mnt/documents/kose-parsel-teshis/corner-tests.geojson",
  JSON.stringify(
    geo([
      ...real.map((b, i) => ({ name: `GERCEK-${i + 1}`, b })),
      { name: "A", b: scen },
      { name: "B", b: scenB },
      { name: "C", b: scenC },
      { name: "D", b: scenD },
      { name: "A30", b: scenR30 },
      { name: "A45", b: scenR45 },
    ]),
    null,
    1,
  ),
);
console.log("\nGeoJSON: /mnt/documents/kose-parsel-teshis/corner-tests.geojson");
