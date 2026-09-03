# Görev Listesi

- [x] Köşe parsel "uygun yapı bloğu üretilemedi" kök neden teşhisi
- [x] Minimum değişiklikle düzeltme (src/lib/parcelation.ts)
  - roadChains(): ada sınırı ayrı yol zincirlerine bölündü (roadLines artık tek polyline değil)
  - perpendicularRoadLength(): köşe parselde ikinci yol cephesi frontage ölçümüne dahil
  - derinlik ölçümü ANA cepheden yapılır (ikinci cephe derinliği düşürmez)
  - dejenere (iğne) parsel için ayrı red nedeni
  - Doğrulama: tsc 0, TEST A 14/14, TEST B 14/14, regresyon 7/7, gerçek 350ADA 12/12 geçerli
