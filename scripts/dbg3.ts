import { readFileSync } from "node:fs";
import { parseDxf, polygonsOfLayer } from "@/lib/dxf";
import { sampleDxf } from "@/lib/sample";
import { detectRoadFrontages } from "@/lib/parcelation";
import { polylineLength, ringArea } from "@/lib/geo";
const show = (l: string, r: any) => {
  const f = detectRoadFrontages(r);
  console.log(l, "alan", Math.round(ringArea(r)), "cephe sayısı", f.length, f.map((x) => Math.round(polylineLength(x))));
};
show("ÖRNEK", polygonsOfLayer(parseDxf(sampleDxf()), "ADA")[0]);
const d = parseDxf(readFileSync("/tmp/user-uploads/350ADA.DXF", "latin1"));
show("350ADA", polygonsOfLayer(d, d.layers.find((l) => /ADA/i.test(l))!)[0]);
