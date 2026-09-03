# Görev Listesi

- [x] Köşe parsel "uygun yapı bloğu üretilemedi" kök neden teşhisi (kod değiştirilmedi)
  - Teşhis betikleri: scripts/diagnose-corner.ts, diagnose-corner-focus.ts, diagnose-corner-sweep.ts
  - Bulgular: (1) detectRoadFrontages yalnızca 2 karşıt bant döndürüyor → köşe parselin 2. yol cephesi `frontage` ölçümüne girmiyor
    (2) optimizeBlock roadLines = tüm ada sınırı (tek polyline) → makeBuilding.facedRoads/cornerFrontsOk tek yönde çalışıyor
    (3) makeBuilding aday ön hattı yalnız tek frontLine'a paralel kenarlardan seçiliyor → blok ikinci yola yönlendirilemiyor
    (4) sıra bölmeden artan iğne (sliver) köşe parseller → zarf hiç oluşmuyor
- [ ] Minimum değişiklikle düzeltme (kullanıcı onayı sonrası)
