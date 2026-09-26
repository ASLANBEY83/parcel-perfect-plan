# Parsel üretimini genel bir zemine oturtma

## Sorun
Şu anki motor, üst üste eklenmiş onarım adımlarından oluşuyor. Her adım bir öncekinin bozduğu yeri düzeltiyor: köşe birleştirme, boşluk doldurma, geri dağıtma, yeniden bölüştürme. 350 ve 353 numaralı adalarda sonuç doğru, ama 340 numaralı adada (uzun ve eğri) durum farklı:
- ~4,5 dakika sürüyor,
- 11 parsel koşulsuz kalıyor,
- 375 m² alan boşta kalıyor.

Nedeni şu: sol sıranın içbükey cephesinde dik kesimler birbirine yaklaşıp iğne gibi şeritler üretiyor. Sonraki adımlar bu şeritleri komşu parsellere yığıyor.

## Yeni yapı: tek akış, 5 sabit aşama
```text
1. Ada analizi   -> yol cepheleri, köşeler, eğrilik, sıra sayısı (1 ya da 2)
2. Sıra bölme    -> ada orta hattı (gerçek ortak sınır), her sıranın kendi cephesi
3. Sıra ifrazı   -> her sıra için: köşe parseli (kütleden geri hesap),
                    ara parseller eşit hedef alan, kesimler cepheye dik
                    (içbükey cephede kesimler ortak arka hat üzerinde eşit aralıklı)
4. Kısıt çözümü  -> tolerans birleşimi (tek düğüm), alan dengesi yalnız yol köşesinde,
                    min-max alan, cephe, çekme, TAKS; sağlanamazsa sıra yeniden
                    ifraz edilir (parsel sayısı -1/+1), onarım yamasıyla değil
5. Denetim       -> alan kapanışı = ada alanı, örtüşme 0, boşluk 0,
                    orta hat = parsel sınırı, koşulsuz parsel 0
```

Değişmez kurallar her aşamanın sonunda kontrol edilir. Bir kural bozulursa o aşama farklı bir parsel sayısı ya da kesim düzeniyle tekrarlanır. Bozuk sonuç bir sonraki aşamaya aktarılmaz.

## Kullanıcıya etkisi
- Ekran, parametreler, alternatifler ve çıktılar (DXF, PDF vb.) aynı kalır.
- Hiçbir adada boşta alan ya da kırmızı parsel kalmaz. Parsel sayısını düşürmek dışında bir çözüm yoksa işlem kaydında nedeni yazılır.
- Büyük adalar için süre sınırı: tek ada en fazla ~60 saniye.

## Doğrulama
Şu 4 ada, iki farklı parametre setiyle (275–400 ve 290–330) test edilir: örnek ada, 340, 350 ve 353.

Her test için kontrol edilenler:
- geçerli parsel oranı %100,
- boşta alan 0,
- örtüşme 0,
- tolerans içinde birleşmemiş köşe 0,
- orta hat sapması 0.

Mevcut regresyon testleri de geçmek zorunda.

## Teknik detaylar
- Ayrı modüller: `analysis.ts`, `rows.ts`, `rowSolver.ts`, `constraints.ts`, `audit.ts`. `optimizeBlock` bu aşamaları sırayla çağıran ince bir yönetici olur.
- Bugünkü doğrulanmış yardımcılar olduğu gibi taşınır: `chainageForArea`, `sharedBoundaryLine`, `snapVertexClusters`, `rebalanceRoadCorner`, `makeBuilding`.
- `solveRowLegacy`, `fillGaps` ve 3b/6/7 onarım döngüleri kaldırılır. Yerlerine aşama 4'teki "parsel sayısını değiştirip yeniden ifraz" döngüsü gelir.
- İçbükey cephe: kesim doğrultusu, cephe noktası ile arka hat üzerindeki eşit alan noktası birleştirilerek bulunur. Böylece iğne şerit oluşmaz.
- Geçici hata ayıklama kodları (`DBG_*`) temizlenir. Tüm adaları test eden betik `scripts/verify-all-adas.ts` eklenir.
