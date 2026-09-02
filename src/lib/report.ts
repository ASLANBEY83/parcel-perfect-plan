import { auditBlocks, type ParcelAudit } from "./audit";
import { summarize, type BlockResult, type Params } from "./parcelation";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, d = 2) => v.toFixed(d);

function auditSection(a: ParcelAudit) {
  const rows = a.checks
    .map(
      (c) => `<tr class="${c.sonuc === "UYGUN DEĞİL" ? "bad" : c.sonuc === "BİLGİ" ? "info" : "ok"}">
        <td>${esc(c.kod)}</td><td>${esc(c.kural)}</td><td>${esc(c.beklenen)}</td>
        <td>${esc(c.olculen)}</td><td><b>${esc(c.sonuc)}</b></td><td>${esc(c.aciklama)}</td></tr>`,
    )
    .join("");
  return `<div class="audit">
    <h3>Ada ${esc(a.ada)} — Parsel ${a.no} ${a.corner ? "(KÖŞE)" : "(ARA)"} — ${a.valid ? "GEÇERLİ" : "GEÇERSİZ"}</h3>
    <p class="sum">Sağlanmayan kural sayısı: <b>${a.failed.length}</b>${
      a.failed.length ? " — " + esc(a.failed.map((c) => c.kod).join(", ")) : ""
    }</p>
    <table><thead><tr><th>Kod</th><th>Kural</th><th>Beklenen</th><th>Ölçülen</th><th>Sonuç</th><th>Açıklama / Gerekçe</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

/** Parselasyon sonuçları + denetim raporunu yazdırılabilir HTML olarak üretir. */
export function buildReportHtml(blocks: BlockResult[], params: Params, fileName = ""): string {
  const s = summarize(blocks);
  const audits = auditBlocks(blocks, params);
  const invalid = audits.filter((a) => !a.valid || a.failed.length);
  const now = new Date().toLocaleString("tr-TR");

  const paramRows = [
    ["Minimum parsel alanı", `${params.minArea} m²`],
    ["Maksimum parsel alanı", `${params.maxArea} m²`],
    ["Ara parsel min. cephe", `${params.midFront} m`],
    ["Köşe parsel min. cephe", `${params.cornerFront} m`],
    ["Yol cephesi çekme", `${params.frontSetback} m`],
    ["Yan bahçe çekme", `${params.sideSetback} m`],
    ["Arka bahçe çekme", `${params.rearSetback} m`],
    ["Min. yapı taban alanı", `${params.minBuildingArea} m²`],
    ["Min. yapı cephesi", `${params.minBuildingFront} m`],
    ["Min. yapı derinliği", `${params.minBuildingDepth} m`],
    ["TAKS", `${params.taks}`],
    ["Tolerans", `${params.tolerance} m²`],
  ]
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");

  const parcelRows = blocks
    .flatMap((b) =>
      b.parcels.map(
        (p) => `<tr class="${p.valid ? "" : "bad"}"><td>${esc(b.name)}</td><td>${p.no}</td>
        <td>${f(p.area)}</td><td>${f(p.frontage)}</td><td>${f(p.depth)}</td>
        <td>${p.corner ? "KÖŞE" : "ARA"}</td><td>${f(p.buildingArea)}</td><td>${f(p.buildingFront)}</td><td>${f(p.buildingDepth)}</td>
        <td>${f(p.taksValue, 3)}</td><td>${p.valid ? "GEÇERLİ" : "GEÇERSİZ"}</td></tr>`,
      ),
    )
    .join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>Parselasyon Raporu</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 2px solid #111; padding-bottom: 3px; }
  h3 { font-size: 12px; margin: 12px 0 4px; }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10px; }
  td { font-size: 10px; }
  tr.bad td { background: #fdecec; }
  tr.ok td { background: #f2fbf3; }
  tr.info td { background: #f6f6f6; }
  .cards { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .card { border: 1px solid #bbb; padding: 6px 10px; min-width: 110px; }
  .card b { display: block; font-size: 16px; }
  .card span { font-size: 9px; color: #555; text-transform: uppercase; }
  .audit { break-inside: avoid; page-break-inside: avoid; }
  .sum { margin: 2px 0 4px; font-size: 10px; }
  footer { margin-top: 14px; font-size: 9px; color: #666; border-top: 1px solid #ccc; padding-top: 5px; }
</style></head><body>
<h1>Parselasyon Optimizasyon Raporu</h1>
<div class="meta">Tarih: ${esc(now)}${fileName ? " &nbsp;•&nbsp; Kaynak dosya: " + esc(fileName) : ""}</div>

<h2>1. Özet</h2>
<div class="cards">
  <div class="card"><span>Toplam parsel</span><b>${s.parcels}</b></div>
  <div class="card"><span>Ada sayısı</span><b>${s.blocks}</b></div>
  <div class="card"><span>Geçerli parsel</span><b>${s.valid}</b></div>
  <div class="card"><span>Geçersiz parsel</span><b>${s.parcels - s.valid}</b></div>
  <div class="card"><span>Yapı bloğu</span><b>${s.buildings}</b></div>
  <div class="card"><span>Ort. parsel alanı</span><b>${f(s.avgArea)} m²</b></div>
  <div class="card"><span>Ort. yapı alanı</span><b>${f(s.avgBuilding)} m²</b></div>
</div>

<h2>2. Uygulanan Kural Seti</h2>
<table><thead><tr><th>Parametre</th><th>Değer</th></tr></thead><tbody>${paramRows}</tbody></table>

<h2>3. Parsel Listesi</h2>
<table><thead><tr><th>Ada</th><th>Parsel</th><th>Alan (m²)</th><th>Cephe (m)</th><th>Derinlik (m)</th>
<th>Tip</th><th>Yapı alanı (m²)</th><th>Yapı cephesi (m)</th><th>Yapı derinliği (m)</th><th>TAKS</th><th>Durum</th></tr></thead>
<tbody>${parcelRows}</tbody></table>

<h2>4. Denetim Raporu — Geçersiz / Uyarılı Parseller (${invalid.length})</h2>
${
  invalid.length
    ? invalid.map(auditSection).join("")
    : "<p>Tüm parseller belirlenen parselasyon ve yapılaşma kurallarının tamamını sağlamaktadır.</p>"
}

<footer>Bu rapor, yüklenen DXF geometrisi üzerinden otomatik olarak üretilmiştir; resmî onay öncesi kontrol edilmelidir.</footer>
</body></html>`;
}

/** Raporu yeni sekmede açıp yazdırma (PDF olarak kaydet) penceresini tetikler. */
export function openReportPdf(blocks: BlockResult[], params: Params, fileName = "") {
  const html = buildReportHtml(blocks, params, fileName);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
