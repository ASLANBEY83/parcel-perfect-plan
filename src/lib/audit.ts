import type { BlockResult, Params, Parcel } from "./parcelation";

export interface RuleCheck {
  kod: string;
  kural: string;
  beklenen: string;
  olculen: string;
  sonuc: "UYGUN" | "UYGUN DEĞİL" | "BİLGİ";
  aciklama: string;
}

export interface ParcelAudit {
  ada: string;
  no: number;
  corner: boolean;
  valid: boolean;
  checks: RuleCheck[];
  failed: RuleCheck[];
  issues: string[];
}

const f = (v: number, d = 2) => v.toFixed(d);

/** Bir parseli tüm parselasyon/yapılaşma kuralları açısından adım adım denetler. */
export function auditParcel(block: BlockResult, p: Parcel, params: Params): ParcelAudit {
  const checks: RuleCheck[] = [];
  const minFront = p.corner ? params.cornerFront : params.midFront;
  const tol = params.tolerance;

  const add = (
    kod: string,
    kural: string,
    beklenen: string,
    olculen: string,
    ok: boolean | null,
    aciklama: string,
  ) =>
    checks.push({
      kod,
      kural,
      beklenen,
      olculen,
      sonuc: ok === null ? "BİLGİ" : ok ? "UYGUN" : "UYGUN DEĞİL",
      aciklama,
    });

  // 1. Parsel alanı alt sınırı
  add(
    "P-01",
    "Minimum parsel alanı",
    `≥ ${params.minArea} m² (tolerans ${tol} m²)`,
    `${f(p.area)} m²`,
    p.area >= params.minArea - tol,
    p.area >= params.minArea - tol
      ? "Parsel alanı asgari ifraz şartını sağlıyor."
      : `Parsel alanı asgari sınırın ${f(params.minArea - p.area)} m² altında kaldı; komşu parselden alan aktarımı veya parsel sayısının bir azaltılması gerekir.`,
  );

  // 2. Parsel alanı üst sınırı (yapı şartı gereği aşılabilir, yalnızca bilgi)
  const overMax = p.area > params.maxArea + tol;
  add(
    "P-02",
    "Maksimum parsel alanı",
    `≤ ${params.maxArea} m² (yapılaşma şartı gereği aşılabilir)`,
    `${f(p.area)} m²`,
    null,
    !overMax
      ? "Üst sınır aşılmıyor."
      : `Üst sınır ${f(p.area - params.maxArea)} m² aşıldı; bu durum yapılaşma şartlarını sağlamak amacıyla kabul edilir ve kalan alan diğer parsellere dağıtılır.`,
  );

  // 3. Cephe genişliği
  add(
    "P-03",
    p.corner ? "Köşe parsel minimum cephe" : "Ara parsel minimum cephe",
    `≥ ${minFront} m`,
    `${f(p.frontage)} m`,
    p.frontage >= minFront - 0.05,
    p.frontage >= minFront - 0.05
      ? "Yola cephe şartı sağlanıyor."
      : `Cephe ${f(minFront - p.frontage)} m eksik; bu genişlikte yan bahçelerden sonra yapı cephesi oluşmuyor.`,
  );

  // 4. Parsel derinliği (ön + arka çekme + asgari yapı derinliği)
  const minDepth = params.frontSetback + params.rearSetback + params.minBuildingDepth;
  add(
    "P-04",
    "Parsel derinliği",
    `≥ ${minDepth} m (ön ${params.frontSetback} + arka ${params.rearSetback} + yapı ${params.minBuildingDepth})`,
    `${f(p.depth)} m`,
    p.depth >= minDepth - 0.05,
    p.depth >= minDepth - 0.05
      ? "Derinlik yapı için yeterli."
      : "Derinlik yetersiz; ön/arka çekme sonrası yapı için alan kalmıyor.",
  );

  // 5. Yapı yaklaşma sınırı (envelope)
  const hasEnv = !!p.envelope && p.envelope.length >= 3;
  add(
    "Y-01",
    "Yapı yaklaşma sınırı (çekme mesafeleri)",
    `Yol cephesi ${params.frontSetback} m, yan ${params.sideSetback} m, arka ${params.rearSetback} m`,
    hasEnv ? "Oluşturuldu" : "Oluşturulamadı",
    hasEnv,
    hasEnv
      ? "Tüm yola cepheli kenarlardan 5 m, komşu sınırlardan 3 m çekilerek yapı inşaat hattı üretildi."
      : "Çekme mesafeleri uygulandığında geriye kapalı bir yapı alanı kalmadı.",
  );

  // 6. Yapı bloğu üretimi
  const hasB = !!p.building;
  add(
    "Y-02",
    "Yapı bloğu oturumu",
    "Yapı inşaat hattına dayalı kapalı blok",
    hasB ? "Üretildi" : "Üretilemedi",
    hasB,
    hasB
      ? "Blok, yapı inşaat hattına yaslanarak yerleştirildi."
      : "Yapı yaklaşma sınırı içinde asgari yapı şartlarını sağlayan bir oturum bulunamadı.",
  );

  // 7. Minimum yapı alanı
  add(
    "Y-03",
    "Minimum yapı taban alanı",
    `≥ ${params.minBuildingArea} m²`,
    `${f(p.buildingArea)} m²`,
    p.buildingArea >= params.minBuildingArea - 0.5,
    p.buildingArea >= params.minBuildingArea - 0.5
      ? "Asgari taban alanı sağlanıyor."
      : `Taban alanı ${f(Math.max(0, params.minBuildingArea - p.buildingArea))} m² eksik; parsel genişliği veya derinliği artırılmalı.`,
  );

  // 8. Minimum yapı cephesi
  add(
    "Y-04",
    "Minimum yapı cephesi",
    `≥ ${params.minBuildingFront} m`,
    `${f(p.buildingFront)} m`,
    p.buildingFront >= params.minBuildingFront - 0.05,
    p.buildingFront >= params.minBuildingFront - 0.05
      ? "Yapı cephesi yeterli."
      : "Yan bahçelerden sonra kalan net genişlik asgari yapı cephesinin altında.",
  );

  // 9. TAKS
  add(
    "Y-05",
    "TAKS (taban alanı katsayısı)",
    `≤ ${params.taks}`,
    p.area > 0 ? f(p.taksValue, 3) : "-",
    p.taksValue <= params.taks + 1e-3,
    p.taksValue <= params.taks + 1e-3
      ? "TAKS sınırı aşılmıyor."
      : `TAKS ${f(p.taksValue - params.taks, 3)} aşıldı; yapı tabanı ${f(p.buildingArea - p.area * params.taks)} m² küçültülmeli.`,
  );

  // 10. Minimum yapı derinliği
  add(
    "Y-06",
    "Minimum yapı derinliği",
    `≥ ${params.minBuildingDepth} m`,
    f(p.buildingDepth),
    p.buildingDepth >= params.minBuildingDepth - 0.05,
    p.buildingDepth >= params.minBuildingDepth - 0.05
      ? "Yapı derinliği asgari şartı sağlıyor."
      : `Yapı derinliği ${f(params.minBuildingDepth - p.buildingDepth)} m eksik; yapı derinliği artırılmalı veya parsel derinliği genişletilmeli.`,
  );

  const failed = checks.filter((c) => c.sonuc === "UYGUN DEĞİL");
  return { ada: block.name, no: p.no, corner: p.corner, valid: p.valid, checks, failed, issues: p.issues };
}

export function auditBlocks(blocks: BlockResult[], params: Params): ParcelAudit[] {
  return blocks.flatMap((b) => b.parcels.map((p) => auditParcel(b, p, params)));
}
