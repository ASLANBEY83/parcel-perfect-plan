import { readFileSync } from "fs";
import { parseDxf, polygonsOfLayer, linesOfLayer } from "./lib/dxf";
import { optimizeBlock, defaultParams } from "./lib/parcelation";
import { computeBlockDebug } from "./lib/parcel-debug";

const text = readFileSync("/tmp/user-uploads/353ADA.DXF", "latin1");
const doc = parseDxf(text);
console.log("layers:", doc.layers);
const adaLayer = doc.layers.find(l => /ada/i.test(l)) ?? doc.layers[0];
console.log("using ada layer", adaLayer);
const rings = polygonsOfLayer(doc, adaLayer!);
console.log("rings count", rings.length, rings.map(r=>r.length));
const hatLayer = doc.layers.find(l => /yapi.*insa|insa.*yapi/i.test(l)) ?? doc.layers.find(l=>/yapi/i.test(l));
console.log("hatLayer", hatLayer);
const buildingLines = hatLayer ? linesOfLayer(doc, hatLayer) : [];

rings.forEach((ring, i) => {
  const result = optimizeBlock(ring, buildingLines, defaultParams, { id: `ada-${i+1}`, name: `ADA ${i+1}`, variant: 0 });
  console.log(`--- block ${i} parcels=${result.parcels.length} leftoverArea=${result.leftoverArea.toFixed(2)} toleranceUsed=${result.toleranceUsed}`);
  console.log(result.log.join("\n"));
});
