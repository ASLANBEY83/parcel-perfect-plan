# PARSELASYON - WebAPP

PARSELASYON OPTİMİZASYON UYGULAMASI – MASTER PROMPT



Türkçe bir web uygulaması geliştir.



Uygulamanın amacı, kullanıcı tarafından yüklenen imar adalarını gerçek geometrilerini koruyarak analiz etmek ve belirlenen parselasyon + yapılaşma kurallarının TAMAMINI aynı anda sağlayan MAKSİMUM SAYIDA KULLANILABİLİR PARSEL üretmektir.



ÇOK ÖNEMLİ:

Bu uygulama basit bir grid/paralel çizgi oluşturma uygulaması değildir.

Amaç sadece mümkün olan en fazla sayıda parsel çizmek değildir.



Bir parselin içine kurallara uygun yapı bloğu yerleştirilemiyorsa o parsel GEÇERSİZ kabul edilmelidir.



Öncelik:

MAKSİMUM GEÇERLİ PARSEL SAYISI

+

HER PARSELDE YAPI UYGUNLUĞU

+

290–330 m² alan hedefi

+

DÜZGÜN PARSEL VE YAPI GEOMETRİSİ





==================================================

1. TEKNOLOJİ

==================================================



Frontend:

- React

- TypeScript

- modern responsive UI

- Tailwind CSS



Harita:

- MapLibre GL JS veya Leaflet

- mümkünse MapLibre tercih et



Geometri:

- Turf.js kullan

- polygon intersection

- buffer

- offset

- line offset

- polygon clipping

- area

- distance

- bearing

- centroid

- boolean operations

gibi işlemleri destekle.



DXF:

- Öncelikle DXF yükleme ve okuma desteği oluştur.

- DWG doğrudan tarayıcıda okunamıyorsa DWG'yi desteklenmeyen format olarak sessizce kabul etme; kullanıcıya açıkça DXF dönüşümü gerektiğini bildir.

- DXF içindeki layer bilgilerini koru.



Gelecekte PostGIS'e aktarılabilecek şekilde veri modelini tasarla.





==================================================

2. DOSYA GİRİŞİ

==================================================



Kullanıcı DXF dosyası yükleyebilmeli.



DXF içindeki layer'ları analiz et.



Özellikle aşağıdaki layer'ları tanı:



ADA

YAPI_INSAA_HATTI



Ancak kullanıcı layer isimlerini arayüzden değiştirebilsin.



Örneğin:



Ada katmanı:

[ ADA ▼ ]



Yapı inşaat hattı:

[ YAPI_INSAA_HATTI ▼ ]



Uygulama kapalı poligonları ada olarak algılamalı.



Her ADA bağımsız bir çalışma birimi olmalı.





==================================================

3. VARSAYILAN PARAMETRELER

==================================================



Aşağıdaki değerleri ayarlanabilir parametre olarak oluştur:



Minimum parsel alanı:

290 m²



Maksimum parsel alanı:

330 m²



Ara parsel minimum cephe:

12 m



Köşe parsel minimum cephe:

14 m



Ön bahçe çekme:

5 m



Yan bahçe çekme:

3 m



Arka bahçe çekme:

3 m



Minimum yapı alanı:

100 m²



Minimum yapı cephesi:

6 m



TAKS:

0.35



Karşılıklı bölme noktası toleransı:

1.00 m





==================================================

4. ADA GEOMETRİSİNİN KORUNMASI

==================================================



En önemli kural:



Üretilen hiçbir parsel ADA sınırının dışına çıkamaz.



Her parsel tamamen ilgili ADA polygonunun içinde olmalıdır.



Parselasyon sonunda:



UNION(tüm parseller) ≈ ADA



olmalıdır.



Ada dışındaki alan parsel olarak üretilemez.



Ada içerisinde çözülemeyen küçük artık alanlar ayrıca "ARTIK ALAN" olarak raporlanmalıdır.





==================================================

5. PARSELASYON MANTIĞI

==================================================



İmar adaları genel olarak genişliği yaklaşık 40 m, uzunluğu 60–100 m veya benzeri değişken geometrilere sahip olabilir.



Temel yaklaşım:



ADA iki uzun yol cephesine göre analiz edilir.



İki uzun yol cephesinde sırt sırta iki parsel sırası oluşturulur.



Şematik:



YOL

────────────────────────────────

│    │    │    │    │    │

│ P1 │ P2 │ P3 │ P4 │ P5 │

│    │    │    │    │    │

├────┼────┼────┼────┼────┤

│ P6 │ P7 │ P8 │ P9 │ P10│

│    │    │    │    │    │

────────────────────────────────

YOL



Ancak gerçek ADA dikdörtgen kabul edilmemelidir.



Gerçek ada geometrisi kullanılmalıdır.



Ada eğri, yamuk veya kırıklı olabilir.





==================================================

6. YOL CEPHELERİNİN BELİRLENMESİ

==================================================



Uygulama ADA polygonunun kenarlarını analiz ederek uzun kenarları/yol cephelerini belirlemelidir.



Ancak mümkünse kullanıcıya yol cephelerini harita üzerinde manuel olarak seçme imkanı da ver:



[ YOL CEPHELERİNİ OTOMATİK BUL ]

[ MANUEL SEÇ ]



Manuel seçim yapılırsa kullanıcı tarafından seçilen kenarlar önceliklidir.





==================================================

7. PARSEL CEPHE KURALLARI

==================================================



Ara parsel minimum yol cephesi:



12 metre.



Köşe parsel minimum yol cephesi:



14 metre.



Köşe parseller iki yol cephesi olan parsellerdir.



Köşe parsel kriterini sadece alan hesabına göre değil gerçek yol geometrisine göre belirle.





==================================================

8. PARSEL SINIRLARI

==================================================



Normal durumda parsel bölme sınırları yola DİK olmalıdır.



Yani yol cephesi ile parsel bölme çizgisi arasındaki açı yaklaşık 90 derece olmalıdır.



Ancak özel bir istisna vardır:



Karşılıklı iki uzun yol cephesindeki bölme noktaları birbirine 1 metre veya daha az mesafedeyse bu iki bölme noktası aynı ortak parsel sınırı ile birleştirilebilir.



Bu durumda:



YOLA DİKLİK şartı istisnai olarak kaldırılabilir.



1 metreden fazla fark varsa ortaklaştırma yapılmayacaktır.



Bu tolerans yalnızca gerçekten gerekli olduğunda kullanılmalıdır.





==================================================

9. PARSEL DERİNLİĞİ

==================================================



Parsel derinliği sabit değildir.



Alanı dengelemek amacıyla otomatik hesaplanmalıdır.



Amaç:



- mümkün olduğunca düzgün

- mümkün olduğunca dikdörtgene yakın

- kullanılabilir

- yapı yerleşimine uygun



parseller üretmektir.



Parseli sırf alanı tutturmak için gereksiz şekilde ince/uzun hale getirme.





==================================================

10. PARSEL ALANI

==================================================



Birinci tercih:



290 ≤ PARSEL ALANI ≤ 330 m²



olmalıdır.



Bu aralıkta maksimum parsel sayısını bul.



Eğer maksimum parsel sayısında tüm parsellerin 290–330 m² olması matematiksel/geometrik olarak mümkün değilse:



Parsel alanlarını birbirine mümkün olduğunca yaklaştır.



Örneğin:



301

302

303

301

304



gibi çözüm;



290

329

291

328



gibi çözüme göre daha yüksek puan almalıdır.



Alan dağılımında standart sapmayı minimize et.





==================================================

11. MAKSİMUM PARSEL SAYISI ALGORİTMASI

==================================================



Parsel sayısını artırarak çözüm ara.



Örneğin:



N = 8

N = 9

N = 10

N = 11

...



Her N için olası parsel bölme kombinasyonlarını değerlendir.



Her çözümde:



1. ADA dışına çıkıyor mu?

2. Her parsel yola cepheli mi?

3. Cephe şartı sağlanıyor mu?

4. Parsel alanı uygun mu?

5. Yapı bloğu oluşturulabiliyor mu?

6. Yapı alanı >=100 m² mi?

7. Yapı cephesi >=6 m mi?

8. Yan 3 m korunuyor mu?

9. Arka 3 m korunuyor mu?

10. Ön 5 m korunuyor mu?

11. TAKS <=0.35 mi?

12. Yapı geometrisi makul mü?



kontrol edilir.



Bir veya daha fazla parsel yapılaşamıyorsa o N çözümü GEÇERSİZDİR.



En yüksek N değeri seçilir.





==================================================

12. YAPI İNŞAAT HATTI

==================================================



DXF'teki:



YAPI_INSAA_HATTI



katmanı çok önemlidir.



Bu geometri yapıların başlangıç/cephe referansıdır.



Uygulama bu hattı:



- yok saymamalı

- rastgele değiştirmemeli

- yeniden tahmin etmemeli



Yapı bloğunun yol tarafındaki başlangıcı mümkün olduğunca bu yapılaşma hattından başlamalıdır.





==================================================

13. YAPI ÇEKME MESAFELERİ

==================================================



HER PARSEL İÇİN:



Ön bahçe:

5 metre



Yan bahçe:

3 metre



Arka bahçe:

3 metre



zorunludur.



Yapı bloğu bu sınırların dışına çıkamaz.



Yapılaşabilir alan:



PARSEL

minus

5 m ön çekme

minus

3 m yan çekmeler

minus

3 m arka çekme



mantığıyla gerçek geometri üzerinden hesaplanmalıdır.



Dikdörtgen varsayımı yapılmamalıdır.





==================================================

14. YAPI ALANI

==================================================



Minimum yapı alanı:



100 m²



Yapı 100 m²'nin altında olamaz.



İdeal hedef:



100–105 m²



Ancak parsel ve geometri izin veriyorsa 100 m²'ye mümkün olduğunca yakın yapı tercih edilir.





==================================================

15. TAKS

==================================================



YAPI ALANI / PARSEL ALANI <= 0.35



olmalıdır.



Örneğin:



300 m² parsel

maksimum yapı:

105 m²



olabilir.



106 m² yapı geçersizdir.





==================================================

16. YAPI CEPHESİ

==================================================



Minimum yapı cephesi:



6 metre.



6 metreden küçük yapı geçersizdir.



Cephe gerçek yapı polygonunun yol tarafındaki kenarından hesaplanmalıdır.





==================================================

17. YAPI ŞEKLİ

==================================================



Yapı dikdörtgen olmak zorunda değildir.



Kabul edilen geometriler:



- dikdörtgen

- kare

- yamuk

- sade çokgen



Parsel geometrisi gerektiriyorsa yapı bloğu yamuk olabilir.



Ancak:



- rastgele kırık

- zikzak

- sivri köşe

- çok sayıda küçük kenar

- anlamsız açı değişimleri



OLMAMALIDIR.



Özellikle yol cephesinde:



DÜZ

TEMİZ

MAKUL



bir yapı cephesi oluştur.



Yapı polygonunda gereksiz vertex sayısını azalt.





==================================================

18. YAPI ALANLARININ DENGELENMESİ

==================================================



Bütün yapıların alanları mümkün olduğunca birbirine yakın olmalıdır.



Örneğin:



101

102

102

103

101



iyi.



100

115

100

114



daha düşük puanlı.



Yapı alanı optimizasyonunda:



100 m² minimum

ve

TAKS 0.35 maksimum



arasındaki alan mümkün olduğunca dengeli dağıtılmalıdır.





==================================================

19. OPTİMİZASYON PUANI

==================================================



Her çözüm için skor hesapla.



Önerilen öncelik:



1. Geçerli parsel sayısı – EN YÜKSEK AĞIRLIK

2. Yapılaşabilir parsel sayısı

3. 290–330 m² aralığındaki parsel sayısı

4. Parsel alanlarının standart sapmasının düşük olması

5. Yapı alanlarının standart sapmasının düşük olması

6. Parsel geometrisinin düzgünlüğü

7. Yapı geometrisinin düzgünlüğü

8. 1 m tolerans kullanımının azaltılması



Parsel sayısı hiçbir zaman alan veya geometri puanı karşılığında azaltılmamalıdır.





==================================================

20. PARSEL GEOMETRİ KALİTE KONTROLÜ

==================================================



Her parsel için aşağıdaki kontrolleri yap:



- ADA içinde mi?

- Polygon kapalı mı?

- Polygon geçerli mi?

- Self-intersection var mı?

- Yol cephesi var mı?

- Yol cephesi >=12 m mi?

- Köşe ise >=14 m mi?

- Alan 290–330 m² mi?

- Değilse çözüm içinde alan sapması kabul edilebilir mi?

- Gereksiz dar/uzun mu?

- Yapı yerleşimine uygun mu?





==================================================

21. YAPI GEOMETRİ KALİTE KONTROLÜ

==================================================



Her yapı için:



- Parsel içinde mi?

- 5 m ön çekme korunuyor mu?

- Yan 3 m korunuyor mu?

- Arka 3 m korunuyor mu?

- Alan >=100 m² mi?

- TAKS <=0.35 mi?

- Cephe >=6 m mi?

- Self-intersection var mı?

- Çok fazla vertex var mı?

- Gereksiz kırık var mı?

- Anormal sivri açı var mı?

- Kullanılabilir bir yapı formu mu?



kontrol et.





==================================================

22. HARİTA ARAYÜZÜ

==================================================



Arayüz sade ve teknik olsun.



Sol panel:



DOSYA

[DXF YÜKLE]



LAYER SEÇİMİ



Ada:

[ADA]



Yapı hattı:

[YAPI_INSAA_HATTI]



PARAMETRELER



Min parsel:

290



Max parsel:

330



Ara cephe:

12



Köşe cephe:

14



Ön çekme:

5



Yan çekme:

3



Arka çekme:

3



Min yapı:

100



Min yapı cephe:

6



TAKS:

0.35



Tolerans:

1.00



[ PARSELASYONU HESAPLA ]



Haritanın sağ tarafında sonuç göster.





==================================================

23. HARİTA KATLARI

==================================================



Katmanlar:



ADA

PARSELLER

YAPI_INSAA_HATTI

YAPI_BLOKLARI

ARTIK_ALAN



Her katman açılıp kapatılabilmeli.



Parsel sınırları net görünmeli.



Yapı blokları farklı bir çizgi tipiyle gösterilmeli.



Harita kesinlikle gereksiz çizgilerle doldurulmamalı.





==================================================

24. PARSEL BİLGİSİ

==================================================



Kullanıcı parsele tıkladığında:



Parsel No

Alan

Cephe

Derinlik

Köşe/Ara

Yapı Alanı

Yapı Cephesi

TAKS

Ön çekme

Yan çekme

Arka çekme

Durum



göster.



Örneğin:



PARSEL 12



Alan:

302.15 m²



Cephe:

14.02 m



Tip:

KÖŞE



Yapı:

102.30 m²



Yapı cephesi:

6.85 m



TAKS:

0.338



Durum:

✓ GEÇERLİ





==================================================

25. HATALARIN GÖSTERİLMESİ

==================================================



Geçersiz çözüm oluşturma.



Ancak algoritma neden başarısız olduğunu kullanıcıya anlatmalı.



Örneğin:



"15 parsel denenmiştir.

14 parselde tüm yapılaşma şartları sağlanmıştır.

15. parselde minimum 100 m² yapı oluşturulamamıştır.

Bu nedenle 14 parsel çözümü seçilmiştir."



Bu bilgi sonuç panelinde gösterilmeli.





==================================================

26. SONUÇ ÖZETİ

==================================================



Hesaplama sonunda:



ADA SAYISI

TOPLAM PARSEL

GEÇERLİ PARSEL

ARTIK ALAN

ORTALAMA PARSEL ALANI

MIN PARSEL ALANI

MAX PARSEL ALANI

ORTALAMA YAPI ALANI

MIN YAPI ALANI

MAX YAPI ALANI



göster.



Örneğin:



ADA 1



Parsel:

14



Geçerli:

14/14



Ortalama alan:

296.6 m²



Min:

290.1 m²



Max:

320.4 m²



Ortalama yapı:

102.1 m²



Geçerli yapı:

14/14





==================================================

27. EXPORT

==================================================



Sonuçlar dışarı aktarılabilmeli.



Öncelik:



DXF export



GeoJSON export



CSV rapor



GeoPackage export



Katmanlar:



ADA

PARSELLER

YAPI_INSAA_HATTI

YAPI_BLOKLARI

ARTIK_ALAN



DXF export sırasında layer isimlerini koru.





==================================================

28. ÖNEMLİ GEOMETRİ KURALI

==================================================



Uygulama hiçbir zaman görsel olarak güzel göründüğü için geometrik kuralı ihlal etmemeli.



Önce geometri doğruluğu.



Sonra optimizasyon.



Sonra görsel kalite.





==================================================

29. KESİNLİKLE YAPMA

==================================================



Şunları yapma:



- Rastgele grid oluşturma.

- Ada sınırını dikdörtgen varsayma.

- Ada dışına parsel çıkarma.

- Parseli sadece alan hesabıyla oluşturma.

- Yapıyı sadece dikdörtgen olarak üretme.

- Yapı inşaat hattını yok sayma.

- 5 m ön çekmeyi ihlal etme.

- 3 m yan çekmeyi ihlal etme.

- 3 m arka çekmeyi ihlal etme.

- 100 m² altı yapı üretme.

- 6 m altı yapı cephesi üretme.

- TAKS 0.35'i aşma.

- 12 m altı ara parsel üretme.

- 14 m altı köşe parsel üretme.

- Sırf parsel sayısını artırmak için yapılaşabilirliği bozma.

- Gereksiz kırıklı yapı oluşturma.

- Gereksiz kırıklı parsel oluşturma.

- Önceki hesaplama sonuçlarını yeni ada geometrisi yerine kullanma.





==================================================

30. GELİŞTİRME STRATEJİSİ

==================================================



İlk aşamada bütün adaları aynı anda optimize etmeye çalışma.



Önce:



ADA 1



üzerinde algoritmayı çalıştır.



Sonucu haritada göster.



Kullanıcı onayından sonra:



ADA 2

ADA 3

...

ADA N



üzerinde çalıştır.



Ancak algoritma modüler tasarlanmalı.



Fonksiyon mantığı:



analyzeBlock()

detectRoadFrontages()

generateParcelCandidates()

optimizeParcelCount()

validateParcel()

createBuildableEnvelope()

generateBuildingCandidate()

validateBuilding()

scoreSolution()

selectBestSolution()

exportDXF()

exportGeoJSON()

exportGeoPackage()





==================================================

31. ALGORİTMANIN ANA MANTIĞI

==================================================



Özet algoritma:



1. DXF yükle.

2. ADA polygonlarını bul.

3. YAPI_INSAA_HATTI geometrilerini bul.

4. Her ADA'yı ayrı analiz et.

5. Uzun yol cephelerini belirle.

6. İki sıralı sırt sırta parselasyon modeli oluştur.

7. Farklı parsel sayılarını dene.

8. Her parsel için minimum cephe kontrolü yap.

9. Parsel alanlarını 290–330 m² hedefle.

10. Karşılıklı bölme noktalarını 1 m toleransla kontrol et.

11. Her parsel için gerçek yapılaşabilir alanı oluştur.

12. 5 m ön çekme uygula.

13. 3 m yan çekme uygula.

14. 3 m arka çekme uygula.

15. YAPI_INSAA_HATTI ile yapı başlangıç geometrisini ilişkilendir.

16. En az 100 m² yapı adayı oluştur.

17. Minimum 6 m cepheyi kontrol et.

18. TAKS 0.35 kontrol et.

19. Yapı geometrisinin sade olup olmadığını kontrol et.

20. Tüm parseller geçerliyse çözümü kabul et.

21. Daha fazla parsel sayısını dene.

22. En yüksek geçerli parsel sayısını seç.

23. Aynı sayıda birden fazla çözüm varsa alan dağılımı en dengeli olanı seç.

24. Sonuçları haritada göster.

25. DXF/GeoJSON/GeoPackage/CSV olarak dışa aktar.





==================================================

32. SON KURAL

==================================================



BU UYGULAMANIN TEMEL FELSEFESİ:



"ÖNCE MAKSİMUM PARSEL SAYISI,

AMA SADECE GERÇEKTEN YAPILAŞABİLEN PARSELLERİ SAY."



Her parsel:



PARSELASYON KURALLARI

+

YAPIŞMA/YAPI ÇEKME KURALLARI

+

GEOMETRİ KURALLARI



üçünü birlikte sağlamalıdır.



Bir parsel bunlardan herhangi birini sağlamıyorsa GEÇERSİZDİR.



Uygulama kullanıcıya yalnızca görsel olarak güzel görünen bir sonuç değil, hangi kuralın neden sağlandığını gösterebilen denetlenebilir bir geometrik çözüm üretmelidir.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://parcel-perfect-plan.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0ca3fb72-19d3-49be-832c-b947c109fb9b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
