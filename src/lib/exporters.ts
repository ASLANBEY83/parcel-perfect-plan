import type { Pt, Ring } from "./geo";
import { closeRing } from "./geo";
import { writeDxf } from "./dxf";
import type { BlockResult, Params } from "./parcelation";
import { auditBlocks } from "./audit";
import { buildReportHtml } from "./report";

export function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportDXF(blocks: BlockResult[], buildingLines: Pt[][]) {
  const ents: { layer: string; points: Pt[]; closed: boolean }[] = [];
  for (const b of blocks) {
    ents.push({ layer: "ADA", points: b.ring, closed: true });
    for (const p of b.parcels) {
      ents.push({ layer: "PARSELLER", points: p.ring, closed: true });
      if (p.building) ents.push({ layer: "YAPI_BLOKLARI", points: p.building, closed: true });
    }
  }
  for (const l of buildingLines) ents.push({ layer: "YAPI_INSAA_HATTI", points: l, closed: false });
  return writeDxf(ents);
}

const ringToGeoJson = (r: Ring) => [closeRing(r)];

export function exportGeoJSON(blocks: BlockResult[], buildingLines: Pt[][]) {
  const features: any[] = [];
  for (const b of blocks) {
    features.push({
      type: "Feature",
      properties: { layer: "ADA", ada: b.name, alan: Number(b.ring.length) },
      geometry: { type: "Polygon", coordinates: ringToGeoJson(b.ring) },
    });
    for (const p of b.parcels) {
      features.push({
        type: "Feature",
        properties: {
          layer: "PARSELLER",
          ada: b.name,
          parsel_no: p.no,
          alan_m2: +p.area.toFixed(2),
          cephe_m: +p.frontage.toFixed(2),
          derinlik_m: +p.depth.toFixed(2),
          tip: p.corner ? "KÖŞE" : "ARA",
          yapi_alani_m2: +p.buildingArea.toFixed(2),
          yapi_cephesi_m: +p.buildingFront.toFixed(2),
          yapi_derinlik_m: +p.buildingDepth.toFixed(2),
          taks: +p.taksValue.toFixed(3),
          durum: p.valid ? "GEÇERLİ" : "GEÇERSİZ",
        },
        geometry: { type: "Polygon", coordinates: ringToGeoJson(p.ring) },
      });
      if (p.building)
        features.push({
          type: "Feature",
          properties: { layer: "YAPI_BLOKLARI", ada: b.name, parsel_no: p.no, alan_m2: +p.buildingArea.toFixed(2) },
          geometry: { type: "Polygon", coordinates: ringToGeoJson(p.building) },
        });
    }
  }
  for (const l of buildingLines)
    features.push({
      type: "Feature",
      properties: { layer: "YAPI_INSAA_HATTI" },
      geometry: { type: "LineString", coordinates: l },
    });
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

export function exportCSV(blocks: BlockResult[]) {
  const head = [
    "ADA",
    "PARSEL_NO",
    "ALAN_M2",
    "CEPHE_M",
    "DERINLIK_M",
    "TIP",
    "YAPI_ALANI_M2",
    "YAPI_CEPHESI_M",
    "YAPI_DERINLIK_M",
    "TAKS",
    "ON_CEKME",
    "YAN_CEKME",
    "ARKA_CEKME",
    "DURUM",
    "NOTLAR",
  ];
  const rows = blocks.flatMap((b) =>
    b.parcels.map((p) =>
      [
        b.name,
        p.no,
        p.area.toFixed(2),
        p.frontage.toFixed(2),
        p.depth.toFixed(2),
        p.corner ? "KÖŞE" : "ARA",
        p.buildingArea.toFixed(2),
        p.buildingFront.toFixed(2),
        p.buildingDepth.toFixed(2),
        p.taksValue.toFixed(3),
        5,
        3,
        3,
        p.valid ? "GEÇERLİ" : "GEÇERSİZ",
        p.issues.join(" | "),
      ].join(";"),
    ),
  );
  return [head.join(";"), ...rows].join("\n");
}

/** GeoPackage yerine taşınabilir GeoJSON tabanlı paket (PostGIS/GPKG'ye dönüştürülebilir). */
export function exportPackage(blocks: BlockResult[], buildingLines: Pt[][]) {
  return JSON.stringify(
    {
      format: "parselasyon-paket/1.0",
      crs: "yerel-projekte-metre",
      hedef: "PostGIS / GeoPackage aktarımı",
      katmanlar: ["ADA", "PARSELLER", "YAPI_INSAA_HATTI", "YAPI_BLOKLARI"],
      veri: JSON.parse(exportGeoJSON(blocks, buildingLines)),
    },
    null,
    2,
  );
}

/** Denetim raporunun CSV karşılığı (her parsel için kural bazında satır). */
export function exportAuditCSV(blocks: BlockResult[], params: Params) {
  const head = ["ADA", "PARSEL_NO", "TIP", "KOD", "KURAL", "BEKLENEN", "OLCULEN", "SONUC", "ACIKLAMA"];
  const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = auditBlocks(blocks, params).flatMap((a) =>
    a.checks.map((c) =>
      [a.ada, String(a.no), a.corner ? "KÖŞE" : "ARA", c.kod, c.kural, c.beklenen, c.olculen, c.sonuc, c.aciklama]
        .map(q)
        .join(";"),
    ),
  );
  return [head.join(";"), ...rows].join("\n");
}

/** Tüm çıktıları tek ZIP dosyası olarak indirir. */
export async function downloadZip(
  blocks: BlockResult[],
  buildingLines: Pt[][],
  params: Params,
  fileName = "parselasyon",
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("parselasyon.dxf", exportDXF(blocks, buildingLines));
  zip.file("parselasyon.geojson", exportGeoJSON(blocks, buildingLines));
  zip.file("parselasyon-paket.gpkg.json", exportPackage(blocks, buildingLines));
  zip.file("parsel-listesi.csv", exportCSV(blocks));
  zip.file("denetim-raporu.csv", exportAuditCSV(blocks, params));
  zip.file("rapor.html", buildReportHtml(blocks, params, fileName));
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}-cikti.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
