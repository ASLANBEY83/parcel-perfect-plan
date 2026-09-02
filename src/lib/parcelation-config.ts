/**
 * Parselasyon motorunun ALGORİTMİK sabitleri.
 *
 * ÖNEMLİ: Buradaki değerler imar/regülasyon kuralı DEĞİLDİR. Bunlar geometri
 * tespitinin (yol cephesi bulma, kenar sınıflandırma) ve çözüm skorlamasının
 * sezgisel (heuristic) eşikleridir. Kullanıcıya parametre olarak açılmazlar;
 * tek amaçları kodun farklı yerlerine dağılmış "magic number"ları tek merkezde
 * isimlendirip belgelemektir. Değerler mevcut davranışı korumak için
 * değiştirilmemiştir.
 *
 * Kullanıcının girdiği gerçek imar parametreleri (minArea, maxArea, midFront,
 * cornerFront, frontSetback, sideSetback, rearSetback, minBuildingArea,
 * minBuildingFront, minBuildingDepth, taks, tolerance) `Params` üzerinden
 * runtime'da taşınır ve burada ASLA sabitlenmez.
 */

/** Eşit alanlı kesim aramasında cephe hattı boyunca örnekleme adım sayısı. */
export const EQUAL_AREA_SAMPLE_STEPS = 240;

/** Kenarın "yol cephesi" sayılması için geometrik eşikler. */
export const FRONTAGE_DETECTION = {
  /** Örnek noktanın yol/ada hattına en fazla bu mesafede olması gerekir (m). */
  ROAD_FRONTAGE_DISTANCE_TOLERANCE: 0.9,
  /** Bu uzunluğun altındaki kenarlar "kısa kenar" istisnasına girer (m). */
  SHORT_EDGE_EXCEPTION_LENGTH: 3,
  /** Kenar üzerinde yol yakınlığı test edilen normalize konumlar. */
  FRONTAGE_SAMPLE_RATIOS: [0.15, 0.3, 0.5, 0.7, 0.85] as const,
  /** Normal kenarda yol cephesi kararı için gereken en az örnek sayısı. */
  MIN_SAMPLES_ON_ROAD: 3,
  /** Kısa kenarda yol cephesi kararı için gereken en az örnek sayısı. */
  MIN_SAMPLES_ON_ROAD_SHORT: 2,
  /** Kenar orta noktasının hat üzerinde sayılması için tolerans (m). */
  EDGE_ON_LINE_TOLERANCE: 0.7,
} as const;

/** `detectRoadFrontages` içindeki principal-angle bant taraması eşikleri. */
export const ROAD_BAND = {
  /** Ada yüksekliğinin üst/alt bu oranı kadarlık bandı yol cephesi adayıdır. */
  ROAD_BAND_RATIO: 0.3,
  /** Kenarın uzun eksene "paralel" sayılması için açı eşiği (derece). */
  ROAD_BAND_ANGLE_DEG: 45,
  /** Bu uzunluğun altındaki zincirler yol cephesi kabul edilmez (m). */
  MIN_FRONTAGE_LENGTH: 5,
} as const;

/**
 * Kenar sınıflandırma: yol cephesi olmayan kenarlardan hangisi "arka" kenar
 * sayılır. Kenar doğrultusunun en yakın yol cephesi doğrultusuyla mutlak
 * paralellik değeri (|cos|) bu eşiğin üzerindeyse arka kenar, aksi halde yan
 * kenardır (kesme çizgileri yola diktir → yan kenar).
 */
export const EDGE_CLASSIFICATION = {
  REAR_EDGE_PARALLEL_MIN: 0.7,
} as const;

/**
 * `scoreSolution` ağırlıkları. Değerler mevcut davranışı korumak için
 * birebir taşınmıştır; optimizasyon mantığı değiştirilmemiştir.
 */
export const SOLUTION_SCORE_WEIGHTS = {
  /** Yapılaşma şartını sağlayan köşe parsel başına ödül. */
  CORNER_VALID: 40000,
  /** Geçerli parsel başına ödül. */
  VALID_PARCEL: 10000,
  /** Yapı bloğu üretilebilen parsel başına ödül. */
  HAS_BUILDING: 500,
  /** min–max alan aralığındaki parsel başına ödül. */
  AREA_IN_RANGE: 60,
  /** Maksimum alan aşımının m² başına cezası. */
  AREA_OVERFLOW_PENALTY: 1.5,
  /** Parsel alanlarının bağıl sapma cezası. */
  AREA_SPREAD_PENALTY: 20000,
  /** Yapı taban alanı standart sapması cezası. */
  BUILDING_AREA_SD_PENALTY: 3,
  /** Kullanılan tolerans (birleştirilen köşe) cezası. */
  TOLERANCE_USED_PENALTY: 2,
} as const;
