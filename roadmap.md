# Görev Listesi

- [x] Köşe parsel "uygun yapı bloğu üretilemedi" kök neden teşhisi
- [x] Minimum değişiklikle düzeltme (src/lib/parcelation.ts)
  - roadChains(): ada sınırı ayrı yol zincirlerine bölündü (roadLines artık tek polyline değil)
  - perpendicularRoadLength(): köşe parselde ikinci yol cephesi frontage ölçümüne dahil
  - derinlik ölçümü ANA cepheden yapılır (ikinci cephe derinliği düşürmez)
  - dejenere (iğne) parsel için ayrı red nedeni
  - Doğrulama: tsc 0, TEST A 14/14, TEST B 14/14, regresyon 7/7, gerçek 350ADA 12/12 geçerli
- [x] Kütle (yapı bloğu) optimizasyonu: maksimum iç dikdörtgen
  - makeBuilding artık YALNIZ dik açılı, ana cepheye paralel dikdörtgen üretir (yamuk/serbest adaylar kaldırıldı)
  - safeExtent(): band uçları + tüm zarf köşe seviyeleri kesiştirilerek zarf dışına taşma engellenir
  - rectAt(): band başına bir kez hesaplanan güvenli u-aralığında genişlik/kaydırma taraması
  - performans: pahalı doğrulamalar (respectsSetback/cornerFrontsOk) yalnız daha iyi skorlu adaylarda
  - Doğrulama: tsgo 0, build OK, verify-parcelation 7/7 PASS (A 14/14, B 13/13),
    scripts/verify-building-rect.ts -> tüm bloklar dik açılı, zarf dışına taşma 0 (örnek + gerçek 350ADA 12/12)
- [x] Kural 3 son rötuşu: ara parsellerde tam sayı alan eşitlemesi
  - equalizeRowCuts(): tüm kesimler kesinleştikten sonra ara parseller tam sayı hedef alana taşınır
  - ortak köşe (paired) kesimleri de taşınabilir; hat yönü ortak noktaya bakacak şekilde korunur
  - küsurat sıra başına TEK tampon parselde toplanır, köşe parseller kütle kuralına göre kalır
  - Doğrulama: tsgo 0, TEST A 14/14, TEST B 13/13, regresyon 7/7, 350ADA 12/12, tüm bloklar dik açılı
