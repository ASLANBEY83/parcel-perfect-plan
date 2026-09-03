/**
 * Köşe parsel red nedeni taraması (salt okuma). bun scripts/diagnose-corner-sweep.ts
 */
import { readFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "../src/lib/dxf";
import { defaultParams, optimizeBlock, type Params } from "../src/lib/parcelation";
import { ringArea, type Pt, type Ring } from "../src/lib/geo";

const f = (v: number, d = 2) => Number(v.toFixed(d));
const base: Params = { ...defaultParams, frontSetback: 5, sideSetback: 3, rearSetback: 3, minBuildingFront: 6 };

const doc = parseDxf(readFileSync("/mnt/user-uploads/350ADA.DXF", "latin1"));
const adaLayer = doc.layers.find((l) => /ADA/i.test(l)) ?? doc.layers[0];
const real = polygonsOfLayer(doc, adaLayer).filter((r) => Math.abs(ringArea(r)) > 500)[0];

const rot = (r: Ring, deg: number): Ring => {
  const t = (deg * Math.PI) / 180;
  return r.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)] as Pt);
};

const geoms: [string, Ring][] = [
  ["GERÇEK 350ADA", real],
  ["A dik 80x40", [[0, 0], [80, 0], [80, 40], [0, 40]]],
  ["B eğik paralelkenar", [[0, 0], [80, 0], [92, 40], [12, 40]]],
  ["C uzun cephe 120x26", [[0, 0], [120, 0], [120, 26], [0, 26]]],
  ["D kısa cephe 40x60", [[0, 0], [40, 0], [40, 60], [0, 60]]],
  ["E köşe pahlı (kırık köşe)", [[6, 0], [74, 0], [80, 6], [80, 40], [0, 40], [0, 6]]],
  ["F 60° eğik köşe", [[0, 0], [80, 0], [103, 40], [23, 40]]],
  ["G trapez (daralan)", [[0, 0], [90, 0], [70, 40], [10, 40]]],
  ["A 30° döndürülmüş", rot([[0, 0], [80, 0], [80, 40], [0, 40]], 30)],
  ["A 45° döndürülmüş", rot([[0, 0], [80, 0], [80, 40], [0, 40]], 45)],
];

const cfgs: [string, Partial<Params>][] = [
  ["275-400 (varsayılan)", {}],
  ["290-330", { minArea: 290, maxArea: 330 }],
  ["250-300", { minArea: 250, maxArea: 300 }],
  ["300-400 köşeCephe14", { minArea: 300, maxArea: 400, cornerFront: 14 }],
  ["290-330 minYapı80", { minArea: 290, maxArea: 330, minBuildingArea: 80 }],
  ["290-330 yapıDerinlik12", { minArea: 290, maxArea: 330, minBuildingDepth: 12 }],
];

for (const [gname, ring] of geoms) {
  for (const [cname, over] of cfgs) {
    const p: Params = { ...base, ...over };
    const b = optimizeBlock(ring, [], p, { id: "x", name: gname, variant: 0 });
    const cs = b.parcels.filter((x) => x.corner);
    const badC = cs.filter((x) => !x.valid);
    const blockFail = cs.filter((x) => !x.building);
    console.log(
      `${gname} | ${cname} | parsel ${b.parcels.length} geçerli ${b.parcels.filter((x) => x.valid).length} | ` +
        `köşe ${cs.length} geçersiz ${badC.length} | köşede blok üretilemedi ${blockFail.length}`,
    );
    for (const c of badC)
      console.log(
        `   ↳ KÖŞE #${c.no} alan=${f(c.area)} cephe=${f(c.frontage)} derinlik=${f(c.depth)} zarf=${c.envelope ? f(Math.abs(ringArea(c.envelope))) : "YOK"} ` +
          `blok=${c.building ? f(c.buildingArea) : "YOK"} blokCephe=${f(c.buildingFront)} blokDerinlik=${f(c.buildingDepth)} :: ${c.issues.join(" | ")}`,
      );
  }
}
