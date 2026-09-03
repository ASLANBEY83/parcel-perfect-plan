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
- [x] 1 m tolerans kuralı yeniden uygulandı (weldRearCorners)
  - alan eşitlemesinden SONRA sırt sırta köşeler tekrar tek ortak noktada birleştirilir
  - yol tarafı chainage korunur, yalnız kesim doğrultusu ortak noktaya döndürülür
  - geçerlilik düşerse uygulanmaz; doğrulama: tsgo 0, build OK, A 14/14, B 13/13, 350ADA 12/12, regresyon 7/7
- [x] Tolerans içi sırt sırta köşe birleşimi + yol kenarı ile alan dengeleme
  - weldRearCorners: birleşme eşiği p.tolerance (sabit 1 m değil)
  - rebalanceCutsToAreas(): ortak arka nokta sabit tutulur, alan sapması kesimin
    YOL KENARINDAKİ ucu chainage boyunca kaydırılarak giderilir (cepheye dik olma kuralı göz ardı)
  - Doğrulama: tsgo 0, regresyon 7/7, A 14/14, B 13/13, 350ADA 12/12, tüm bloklar dik açılı
- [x] Ada kırık noktası birleşimi (snapRowToAdaVertices)
  - kesim arka köşesi tolerans içinde ada sınırı kırık noktasına yakınsa köşe TAM o noktaya taşınır
  - weldRearCorners ortak noktası da tolerans içindeki ada kırık noktasına çekilir
  - alan sapması kesimin YOL KENARINDAKİ ucu kaydırılarak dengelenir (diklik kuralı istisna)
  - Doğrulama: tsgo 0, A 14/14, B 13/13, 350ADA 12/12, regresyon 7/7, tüm bloklar dik açılı

- [x] Tolerans içi tüm köşelerin tek noktada birleşmesi (snapVertexClusters): kesim geometrisinden bağımsız son geometrik kontrol; ada kırık noktası küme içindeyse ortak nokta O olur. Doğrulama: 350ADA tolerans 2 m -> ayrık köşe çifti 0, 12/12 geçerli, regresyon 7/7

- Oval/elips adalar: uzun yol cephesine paralel, ada genişliğinin ~yarısı kadar ofsetli bant ile ada ikiye bölünüp mevcut blok/parsel algoritmaları uygulanıyor (`parallelSplitAt`, `bufferPolyline`).
- Koşul garantisi: artık parseller komşusuna birleştiriliyor veya parsel olarak üretilmiyor; üretilen tüm parseller koşulları sağlıyor.
- Yapı yaklaşma sınırları DXF çıktısına `YAPI_YAKLASMA` katmanı olarak eklendi.
