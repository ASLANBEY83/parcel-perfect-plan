// Ada bazında ölçülebilir teşhis (debug) metrikleri.
// ÖNEMLİ: Bu dosya parselasyon algoritmasını DEĞİŞTİRMEZ; yalnızca
// optimizeBlock çıktısını (BlockResult) ve runtime parametrelerini okuyup
// doğrulanabilir sayısal metrikler üretir.
import {
  bbox,
  dist,
  mpArea,
  mpDifference,
  mpIntersect,
  polylineLength,
  ringArea,
  type Ring,
} from "./geo";
import type { BlockResult, Params } from "./parcelation";

export interface BlockDebug {
  ada: string;
  /** Ada geometrisi */
  blockArea: number;
  blockPerimeter: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number };
  /** Yola cepheli kenar sayısı ve toplam yol cephesi uzunluğu (m) */
  frontageCount: number;
  frontageLength: number;
  /** Hesapta FİİLEN kullanılan parametre değerleri (UI -> worker -> algoritma) */
  paramsUsed: {
    minArea: number;
    maxArea: number;
    midFront: number;
    cornerFront: number;
    tolerance: number;
    frontSetback: number;
    sideSetback: number;
    rearSetback: number;
    taks: number;
    minBuildingArea: number;
    minBuildingFront: number;
    minBuildingDepth: number;
  };
  /** Aday / kabul / red sayıları */
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectReasons: Record<string, number>;
  cornerCount: number;
  rowCount: number;
  toleranceMerges: number;
  /** Kabul edilen parsellerin alan istatistikleri */
  acceptedArea: { min: number; max: number; avg: number; sum: number };
  allArea: { min: number; max: number; avg: number; sum: number };
  outOfRangeCount: number;
  /** Alan dengesi */
  totalParcelArea: number;
  areaOutsideBlock: number;
  overlapArea: number;
  gapArea: number;
  coverageRatio: number;
}

const stats = (v: number[]) => ({
  min: v.length ? Math.min(...v) : 0,
  max: v.length ? Math.max(...v) : 0,
  avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0,
  sum: v.reduce((a, b) => a + b, 0),
});

const perimeter = (r: Ring) => r.reduce((s, pt, i) => s + dist(pt, r[(i + 1) % r.length]), 0);

/** Red nedenlerini normalize eder (sayısal değerleri atarak gruplar). */
function reasonKey(issue: string): string {
  const s = issue.replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü]+/, "").trim();
  if (/minimum değerin altında/i.test(s)) return "alan (min parsel alanı altı)";
  if (/maksimum değerin üzerinde/i.test(s)) return "alan (max parsel alanı üstü)";
  if (/Yapılaşabilir minimum derinlik/i.test(s)) return "yapılaşabilir derinlik yetersiz";
  if (/kalan yapı alanı/i.test(s)) return "çekme sonrası yapı alanı yetersiz";
  if (/^Alan/i.test(s)) return "alan (min parsel alanı altı)";
  if (/Cephe|cephe/.test(s) && /Yapı/i.test(s)) return "yapı cephesi";
  if (/^Cephe/i.test(s)) return "parsel cephesi (ara/köşe cephe altı)";
  if (/Yapı alanı/i.test(s)) return "minimum yapı taban alanı";
  if (/Yapı derinliği/i.test(s)) return "minimum yapı derinliği";
  if (/TAKS/i.test(s)) return "TAKS aşımı";
  if (/yapı yaklaşma|çekme/i.test(s)) return "yapı yaklaşma sınırı";
  if (/blok|oturum/i.test(s)) return "yapı bloğu üretilemedi";
  if (/geometri|kapalı|geçersiz/i.test(s)) return "geometri";
  return s.slice(0, 60) || "belirtilmemiş";
}

export function computeBlockDebug(block: BlockResult, params: Params): BlockDebug {
  const blockMp = [[block.ring]];
  const parcels = block.parcels;
  const accepted = parcels.filter((x) => x.valid);
  const rejected = parcels.filter((x) => !x.valid);

  const rejectReasons: Record<string, number> = {};
  for (const pc of rejected) {
    const reasons = pc.issues.filter((i) => !i.startsWith("ℹ"));
    if (!reasons.length) rejectReasons["belirtilmemiş"] = (rejectReasons["belirtilmemiş"] ?? 0) + 1;
    for (const r of reasons) {
      const k = reasonKey(r);
      rejectReasons[k] = (rejectReasons[k] ?? 0) + 1;
    }
  }

  // Toplam kaplama, ada dışı taşma, çakışma ve boşluk alanları
  let union: import("./geo").MultiPoly = [];
  let overlapArea = 0;
  for (const pc of parcels) {
    const mp = [[pc.ring]];
    overlapArea += Math.abs(mpArea(mpIntersect(union, mp)));
    union = mpDifference(union, mp).concat(mp);
  }
  const outside = Math.abs(mpArea(mpDifference(union, blockMp)));
  const blockArea = ringArea(block.ring);
  const totalParcelArea = parcels.reduce((s, x) => s + x.area, 0);

  return {
    ada: block.name,
    blockArea,
    blockPerimeter: perimeter(block.ring),
    bbox: bbox(block.ring),
    frontageCount: block.frontages.length,
    frontageLength: block.frontages.reduce((s, f) => s + polylineLength(f), 0),
    paramsUsed: {
      minArea: params.minArea,
      maxArea: params.maxArea,
      midFront: params.midFront,
      cornerFront: params.cornerFront,
      tolerance: params.tolerance,
      frontSetback: params.frontSetback,
      sideSetback: params.sideSetback,
      rearSetback: params.rearSetback,
      taks: params.taks,
      minBuildingArea: params.minBuildingArea,
      minBuildingFront: params.minBuildingFront,
      minBuildingDepth: params.minBuildingDepth,
    },
    candidateCount: parcels.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    rejectReasons,
    cornerCount: parcels.filter((x) => x.corner).length,
    rowCount: new Set(parcels.map((x) => x.row)).size,
    toleranceMerges: block.toleranceUsed,
    acceptedArea: stats(accepted.map((x) => x.area)),
    allArea: stats(parcels.map((x) => x.area)),
    outOfRangeCount: parcels.filter((x) => x.area < params.minArea - params.tolerance || x.area > params.maxArea + params.tolerance).length,
    totalParcelArea,
    areaOutsideBlock: outside,
    overlapArea,
    gapArea: block.leftoverArea,
    coverageRatio: blockArea > 0 ? totalParcelArea / blockArea : 0,
  };
}

/** Konsola tek satırda okunabilir özet basar (teşhis amaçlı). */
export function logBlockDebug(d: BlockDebug) {
  const f = (v: number, n = 2) => v.toFixed(n);
  console.info(
    `[PARSELASYON] ${d.ada} | ada ${f(d.blockArea)} m² (çevre ${f(d.blockPerimeter)} m, bbox ${f(d.bbox.w)}×${f(d.bbox.h)} m) | ` +
      `yol cephesi ${d.frontageCount} kenar / ${f(d.frontageLength)} m | ` +
      `params min=${d.paramsUsed.minArea} max=${d.paramsUsed.maxArea} ara=${d.paramsUsed.midFront} köşe=${d.paramsUsed.cornerFront} tol=${d.paramsUsed.tolerance} taks=${d.paramsUsed.taks} çekme=${d.paramsUsed.frontSetback}/${d.paramsUsed.sideSetback}/${d.paramsUsed.rearSetback} | ` +
      `aday ${d.candidateCount} → kabul ${d.acceptedCount}, red ${d.rejectedCount} | ` +
      `alan min/ort/max ${f(d.acceptedArea.min)}/${f(d.acceptedArea.avg)}/${f(d.acceptedArea.max)} m² | ` +
      `toplam ${f(d.totalParcelArea)} m², ada dışı ${f(d.areaOutsideBlock)} m², overlap ${f(d.overlapArea)} m², gap ${f(d.gapArea)} m², kaplama %${f(d.coverageRatio * 100, 1)}`,
    d.rejectReasons,
  );
}
