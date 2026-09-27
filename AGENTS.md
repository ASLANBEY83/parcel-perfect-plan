<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- `ADA_ORTA_HAT`, teorik bölme adayından değil nihai iki parsel sırasının ortak sınırından türetilir; harita ve DXF geometrileri böylece aynı kalır.
- Parselasyon `optimizeBlock` önce `src/lib/engine/ruled-engine.ts` (5 aşama: analiz → sıra bölme → ön/arka hat kesimli sıra ifrazı → tolerans birleşimi → denetim) çalıştırır; tüm parseller geçerli ve artık yoksa onu döner, değilse eski motoru (`optimizeBlockLegacy`) da çalıştırıp daha iyisini seçer — eski motorun doğrulanmış sonuçları kaybolmasın diye.
- Genel motorda kesimler ön hat sf ile arka hat sr'yi birleştiren doğrulardır ve kesim alanı sıra halkası üzerinden (kırpma olmadan) hesaplanır — eğri cephede iğne şerit oluşmasın ve arama hızlı olsun diye.
- Tüm adaların denetimi `scripts/verify-all-adas.ts` ile yapılır (koşulsuz parsel, artık alan, örtüşme).
