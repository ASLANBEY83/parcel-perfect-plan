/**
 * Doğrulama betiği (test amaçlı, uygulama davranışını değiştirmez).
 * Çalıştırma: bun scripts/verify-parcelation.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
import { defaultParams, optimizeBlock, buildEnvelope, type Params, type Parcel, type BlockResult } from "@/lib/parcelation";
import { dist, ringArea, type Pt, type Ring } from "@/lib/geo";

const f = (v: number, d = 2) => Number(v.toFixed(d));

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * vx, a[1] + t * vy]);
}
/** Bir noktanın halkanın en yakın kenarına mesafesi. */
function ringDist(p: Pt, r: Ring): number {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) m = Math.min(m, segDist(p, r[i], r[(i + 1) % r.length]));
  return m;
}
/** Zarfın (envelope) parsel sınırından minimum mesafesi = fiili en küçük çekme. */
function minEnvelopeOffset(env: Ring, parcel: Ring): number {
  let m = Infinity;
  for (const p of env) m = Math.min(m, ringDist(p, parcel));
  return m;
}

interface TestOut {
  name: string;
  params: Partial<Params>;
  total: number;
  valid: number;
  invalid: number;
  areaMin: number;
  areaMax: number;
  setbackViolations: number;
  frontageViolations: number;
  buildableViolations: number;
  minMeasuredSetback: number;
  reasons: Record<string, number>;
}

function runTest(name: string, ring: Ring, overrides: Partial<Params>): { out: TestOut; block: BlockResult } {
  const params: Params = { ...defaultParams, ...overrides };
  const block = optimizeBlock(ring, [], params, { id: "t", name, variant: 0 });
  const ps = block.parcels;
  const valid = ps.filter((p) => p.valid);
  const areas = ps.map((p) => p.area);

  let setbackViolations = 0;
  let minMeasuredSetback = Infinity;
  const minReq = Math.min(params.frontSetback, params.sideSetback, params.rearSetback);
  for (const p of ps) {
    if (!p.envelope || p.envelope.length < 3) continue;
    const off = minEnvelopeOffset(p.envelope, p.ring);
    minMeasuredSetback = Math.min(minMeasuredSetback, off);
    if (off < minReq - 0.15) setbackViolations++;
  }

  const frontageViolations = valid.filter(
    (p) => p.frontage < (p.corner ? params.cornerFront : params.midFront) - 0.05,
  ).length;
  const buildableViolations = valid.filter(
    (p) =>
      p.buildingArea < params.minBuildingArea - 0.5 ||
      p.buildingFront < params.minBuildingFront - 0.05 ||
      p.buildingDepth < params.minBuildingDepth - 0.05 ||
      p.taksValue > params.taks + 1e-3,
  ).length;

  const reasons: Record<string, number> = {};
  for (const p of ps.filter((x) => !x.valid))
    for (const i of p.issues.filter((i) => !i.startsWith("ℹ"))) {
      const k = i.replace(/[-+]?\d+([.,]\d+)?/g, "#").slice(0, 48);
      reasons[k] = (reasons[k] ?? 0) + 1;
    }

  return {
    block,
    out: {
      name,
      params: overrides,
      total: ps.length,
      valid: valid.length,
      invalid: ps.length - valid.length,
      areaMin: f(Math.min(...areas)),
      areaMax: f(Math.max(...areas)),
      setbackViolations,
      frontageViolations,
      buildableViolations,
      minMeasuredSetback: f(minMeasuredSetback === Infinity ? -1 : minMeasuredSetback),
      reasons,
    },
  };
}

/** rearSetback'in geometriye uygulandığını ölçerek doğrular. */
function envelopeTest() {
  // Yola (alt kenar, y=0) cepheli dikdörtgen parsel
  const parcel: Ring = [[0, 0], [20, 0], [20, 30], [0, 30]];
  const road: Pt[][] = [[[-50, 0], [70, 0]]];
  const cases: Partial<Params>[] = [
    { frontSetback: 5, sideSetback: 3, rearSetback: 3 },
    { frontSetback: 6, sideSetback: 4, rearSetback: 7 },
    { frontSetback: 3, sideSetback: 2, rearSetback: 10 },
  ];
  return cases.map((c) => {
    const p = { ...defaultParams, ...c };
    const env = buildEnvelope(parcel, road, p, road);
    const xs = env.map((q) => q[0]);
    const ys = env.map((q) => q[1]);
    return {
      istenen: { on: p.frontSetback, yan: p.sideSetback, arka: p.rearSetback },
      olculen: {
        on: f(Math.min(...ys)),
        arka: f(30 - Math.max(...ys)),
        yanSol: f(Math.min(...xs)),
        yanSag: f(20 - Math.max(...xs)),
      },
      alan: f(Math.abs(ringArea(env))),
    };
  });
}

function toGeoJSON(tests: { name: string; block: BlockResult }[]) {
  const features: unknown[] = [];
  const poly = (r: Ring, props: Record<string, unknown>) => ({
    type: "Feature",
    properties: props,
    geometry: { type: "Polygon", coordinates: [[...r, r[0]].map((p) => [p[0], p[1]])] },
  });
  for (const t of tests) {
    features.push(poly(t.block.ring, { test: t.name, kind: "ada" }));
    for (const p of t.block.parcels) {
      features.push(
        poly(p.ring, {
          test: t.name,
          kind: "parsel",
          no: p.no,
          area: f(p.area),
          valid: p.valid,
          frontage: f(p.frontage),
          issues: p.issues.join(" | "),
        }),
      );
      if (p.envelope) features.push(poly(p.envelope, { test: t.name, kind: "yapi_yaklasma", no: p.no }));
      if (p.building) features.push(poly(p.building, { test: t.name, kind: "yapi_blogu", no: p.no, area: f(p.buildingArea) }));
    }
  }
  return { type: "FeatureCollection", features };
}

const doc = parseDxf(sampleDxf());
const adaLayer = doc.layers.find((l) => /ADA/i.test(l)) ?? doc.layers[0];
const rings = polygonsOfLayer(doc, adaLayer);
const ring = rings[0];
console.log("ADA katmanı:", adaLayer, "| halka sayısı:", rings.length, "| ada alanı:", f(Math.abs(ringArea(ring))), "m²");

const A = runTest("TEST A (275-400 varsayılan)", ring, {});
const B = runTest("TEST B (290-330)", ring, { minArea: 290, maxArea: 330 });
const C = runTest("TEST C (setback 6/4/7)", ring, { frontSetback: 6, sideSetback: 4, rearSetback: 7 });

console.log("\n=== ENVELOPE (setback) TESTİ ===");
console.log(JSON.stringify(envelopeTest(), null, 2));

console.log("\n=== ADA TESTLERİ ===");
for (const t of [A, B, C]) console.log(JSON.stringify(t.out, null, 2));

mkdirSync("/mnt/documents/parselasyon-dogrulama", { recursive: true });
const path = "/mnt/documents/parselasyon-dogrulama/tests.geojson";
writeFileSync(path, JSON.stringify(toGeoJSON([
  { name: "A", block: A.block },
  { name: "B", block: B.block },
  { name: "C", block: C.block },
]), null, 1));
console.log("\nGeoJSON yazıldı:", path);

// --- TEST C detay teşhisi ---
console.log("\n=== TEST C PARSEL DETAY ===");
for (const p of C.block.parcels) {
  console.log(
    `#${p.no} row${p.row} corner=${p.corner} alan=${f(p.area)} cephe=${f(p.frontage)} derinlik=${f(p.depth)} ` +
      `zarf=${p.envelope ? f(Math.abs(ringArea(p.envelope))) : "yok"} blok=${p.building ? f(p.buildingArea) : "yok"} ` +
      `yapıCephe=${f(p.buildingFront)} yapıDerinlik=${f(p.buildingDepth)} taks=${f(p.taksValue, 3)} valid=${p.valid} :: ${p.issues.join(" | ")}`,
  );
}
console.log("gerekli min derinlik (on+arka+minBuildingDepth):", 6 + 7 + defaultParams.minBuildingDepth);
