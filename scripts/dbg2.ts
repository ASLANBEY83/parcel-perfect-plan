import { readFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
import { defaultParams, optimizeBlock } from "@/lib/parcelation";
import { exportDXF } from "@/lib/exporters";
const run = (label: string, ring: any, ov = {}) => {
  const b = optimizeBlock(ring, [], { ...defaultParams, ...ov }, { id: "x", name: label, variant: 0 });
  console.log(label, "parsel", b.parcels.length, "geçerli", b.parcels.filter((x) => x.valid).length);
  console.log("  paralel log:", b.log?.filter((l) => /paralel/i.test(l)).join(" | ") || "(kullanılmadı)");
  const dxf = exportDXF([b], []);
  console.log("  DXF YAPI_YAKLASMA sayısı:", (dxf.match(/YAPI_YAKLASMA/g) || []).length);
};
const s = parseDxf(sampleDxf());
run("ÖRNEK", polygonsOfLayer(s, "ADA")[0]);
const d = parseDxf(readFileSync("/tmp/user-uploads/350ADA.DXF", "latin1"));
const layer = d.layers.find((l) => /ADA/i.test(l))!;
run("350ADA", polygonsOfLayer(d, layer)[0], { minArea: 290, maxArea: 330 });
