// Tüm deneme adalarını iki parametre setiyle hesaplar ve kuralları denetler.
// Kullanım: bun scripts/verify-all-adas.ts [dosya-filtre] [set]
import { existsSync, readFileSync } from "fs";
import { parseDxf, polygonsOfLayer, linesOfLayer } from "../src/lib/dxf";
import { defaultParams, optimizeBlock } from "../src/lib/parcelation";
import { sampleDxf } from "../src/lib/sample";
import { mpArea, mpUnion, ringArea, type MultiPoly } from "../src/lib/geo";

const only = process.argv[2];
const sets = (process.argv[3] ?? "275-400,290-330").split(",");
const dir = existsSync("/mnt/user-uploads") ? "/mnt/user-uploads/" : "/tmp/user-uploads/";
const files: [string, () => string][] = [
  ["sample", sampleDxf],
  ...["340_ADA_KAMU_ALANLI.DXF", "350ADA.DXF", "353ADA.DXF"]
    .filter((f) => existsSync(dir + f))
    .map((f) => [f, () => readFileSync(dir + f, "latin1")] as [string, () => string]),
];
let fail = 0;
for (const [name, load] of files) {
  if (only && only !== "all" && !name.includes(only)) continue;
  const doc = parseDxf(load());
  const ada = doc.layers.find((l) => /ada/i.test(l)) ?? doc.layers[0];
  const hl = doc.layers.find((l) => /yap|cekme|çekme/i.test(l));
  const ring = polygonsOfLayer(doc, ada!)[0];
  for (const s of sets) {
    const [mn, mx] = s.split("-").map(Number);
    const t = Date.now();
    const r = optimizeBlock(ring, hl ? linesOfLayer(doc, hl) : [], { ...defaultParams, minArea: mn, maxArea: mx }, { id: "a", name: "A" });
    let u: MultiPoly = [];
    for (const q of r.parcels) u = mpUnion(u, [[q.ring]]);
    const sum = r.parcels.reduce((a, q) => a + q.area, 0);
    const overlap = Math.max(0, sum - mpArea(u));
    const bad = r.parcels.filter((q) => !q.valid);
    const ok = bad.length === 0 && r.leftoverArea < 0.05 && overlap < 0.05;
    if (!ok) fail++;
    console.log(
      `${ok ? "GEÇTİ" : "KALDI"} ${name} ${s}: ${r.parcels.length - bad.length}/${r.parcels.length} geçerli, ada ${ringArea(r.ring).toFixed(2)} m², artık ${r.leftoverArea.toFixed(2)} m², örtüşme ${overlap.toFixed(2)} m², ${((Date.now() - t) / 1000).toFixed(0)} sn`,
    );
    for (const b of bad) console.log(`   #${b.no} ${b.area.toFixed(1)} m²: ${b.issues[0]}`);
  }
}
process.exitCode = fail ? 1 : 0;
