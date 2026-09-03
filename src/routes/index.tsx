import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlanViewer, type BasemapConfig, type LayerVisibility } from "@/components/PlanViewer";
import { linesOfLayer, parseDxf, polygonsOfLayer, type DxfDoc } from "@/lib/dxf";
import type { Pt, Ring } from "@/lib/geo";
import { insetRing, offsetRingInward, ringArea } from "@/lib/geo";
import { defaultParams, optimizeBlock, summarize, type BlockResult, type Params, type Parcel } from "@/lib/parcelation";
import { download, downloadZip, exportAuditCSV, exportCSV, exportDXF, exportGeoJSON, exportPackage } from "@/lib/exporters";
import { openReportPdf } from "@/lib/report";
import { sampleDxf } from "@/lib/sample";
import { TM_PRESETS, guessTM, tmToLonLat } from "@/lib/basemap";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Check, Crosshair, Download, FileText, GitBranch, Layers, Map as MapIcon, Play, RefreshCw, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import type { WorkerRequest, WorkerResponse } from "@/workers/parcelation.worker";

function PanelItem({
  value,
  title,
  icon,
  children,
}: {
  value: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="overflow-hidden rounded-lg border border-border/70 bg-background/40 last:border-b"
    >
      <AccordionTrigger className="px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary hover:no-underline">
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-2.5 border-t border-border/60 px-3 pb-3 pt-3">{children}</AccordionContent>
    </AccordionItem>
  );
}


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Parselasyon Optimizasyon | İmar Adası Parsel ve Yapı Analizi" },
      {
        name: "description",
        content:
          `DXF imar adalarını gerçek geometriyle analiz eden, ${defaultParams.minArea}-${defaultParams.maxArea} m² parsel ve yapılaşma kurallarını sağlayan maksimum sayıda geçerli parsel üreten teknik uygulama.`,
      },
      { property: "og:title", content: "Parselasyon Optimizasyon Uygulaması" },
      {
        property: "og:description",
        content: "İmar adası DXF yükleyin; kurallara uygun maksimum geçerli parsel ve yapı bloğu çözümünü üretin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LAYER_KEYS: (keyof LayerVisibility)[] = ["ADA", "PARSELLER", "YAPI_INSAA_HATTI", "YAPI_BLOKLARI"];
const LAYER_LABELS: Record<keyof LayerVisibility, string> = {
  ADA: "Ada sınırı",
  PARSELLER: "Parseller",
  YAPI_INSAA_HATTI: "Yapı inşaat hattı",
  YAPI_BLOKLARI: "Yapı blokları",
};

/** Üretilen her parselasyon çözümü ayrı bir "alternatif katman" olarak saklanır. */
interface Alt {
  id: number;
  variant: number;
  scope: "one" | "all";
  results: BlockResult[];
}

function Index() {
  const [doc, setDoc] = useState<DxfDoc | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [adaLayer, setAdaLayer] = useState("ADA");
  const [hatLayer, setHatLayer] = useState("YAPI_INSAA_HATTI");
  const [params, setParams] = useState<Params>(defaultParams);
  const [results, setResults] = useState<BlockResult[]>([]);
  const [selected, setSelected] = useState<{ block: BlockResult; parcel: Parcel } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  const [alts, setAlts] = useState<Alt[]>([]);
  const [activeAlt, setActiveAlt] = useState<number | null>(null);
  const altSeq = useRef(0);
  const [zipping, setZipping] = useState(false);
  const [activeBlock, setActiveBlock] = useState(0);
  const [tab, setTab] = useState<"ayarlar" | "harita" | "sonuc">("harita");
  const [leftW, setLeftW] = useState(380);
  const startLeftResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftW;
    const move = (ev: PointerEvent) => setLeftW(Math.min(640, Math.max(280, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const [basemap, setBasemap] = useState<BasemapConfig>({
    enabled: false,
    type: "hybrid",
    lat: 39.925,
    lon: 32.8365,
    opacity: 0.85,
  });
  const [crs, setCrs] = useState<string>("tm3-33");
  const [layers, setLayers] = useState<LayerVisibility>({
    ADA: true,
    PARSELLER: true,
    YAPI_INSAA_HATTI: true,
    YAPI_BLOKLARI: true,
  });
  const fileRef = useRef<HTMLInputElement>(null);


  const adaRings: Ring[] = useMemo(() => (doc ? polygonsOfLayer(doc, adaLayer) : []), [doc, adaLayer]);
  const buildingLines: Pt[][] = useMemo(() => (doc ? linesOfLayer(doc, hatLayer) : []), [doc, hatLayer]);
  const exactBuildingLines: Pt[][] = useMemo(
    () =>
      adaRings
        .flatMap((ring) => {
          const off = offsetRingInward(ring, params.frontSetback);
          const rings = off.length ? off : [insetRing(ring, () => params.frontSetback)];
          return rings.filter((r) => r.length >= 3).map((r) => [...r, r[0]] as Pt[]);
        }),
    [adaRings, params.frontSetback],
  );

  /** DXF proje koordinatlarını (TM/UTM) enlem-boylama çevirip altlığı hizalar. */
  function georeference(rings: Ring[], presetId = crs) {
    const pts = rings.flat();
    if (!pts.length) return;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const guessed = guessTM(cx);
    const def = guessed?.def ?? TM_PRESETS.find((p) => p.id === presetId)?.def;
    if (!def) return;
    if (guessed) setCrs(guessed.presetId);
    // dilim önekli koordinatlarda enlem/boylam doğrudan; değilse seçili dilim kullanılır
    if (cy < 1_000_000 || cy > 10_000_000) return;
    const { lat, lon } = tmToLonLat(cx, cy, def);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85) return;
    setBasemap((b) => ({ ...b, lat, lon, refX: cx, refY: cy }));
  }

  function loadText(text: string, name: string) {
    try {
      const d = parseDxf(text);
      setDoc(d);
      setFileName(name);
      setResults([]);
      setAlts([]);
      setActiveAlt(null);
      setVariant(0);
      setSelected(null);
      const guessAda = d.layers.find((l) => /ada/i.test(l)) ?? d.layers[0] ?? "ADA";
      // Türkçe büyük/küçük harf (İ/I/ş) farkları ve yaygın adlandırmalar için normalize edilmiş arama
      const nrm = (s: string) =>
        s
          .toLocaleLowerCase("tr")
          .replace(/[ıİ]/g, "i")
          .replace(/[şŞ]/g, "s")
          .replace(/[çÇ]/g, "c")
          .replace(/[ğĞ]/g, "g")
          .replace(/[üÜ]/g, "u")
          .replace(/[öÖ]/g, "o");
      const guessHat =
        d.layers.find((l) => /insa|cekme|yaklasma|yapi_?ins|imar_?hat/.test(nrm(l))) ?? "YAPI_INSAA_HATTI";
      setAdaLayer(guessAda);
      setHatLayer(guessHat);
      georeference(polygonsOfLayer(d, guessAda));
      setNotice(`${name} okundu. ${d.layers.length} katman bulundu.`);
    } catch (err) {
      setNotice("DXF okunamadı: " + (err as Error).message);
    }
  }

  function onFile(f: File) {
    if (/\.dwg$/i.test(f.name)) {
      setNotice(
        "DWG dosyaları tarayıcıda okunamaz. Lütfen dosyayı CAD yazılımınızda DXF (ASCII) formatına dönüştürüp yeniden yükleyin.",
      );
      return;
    }
    const r = new FileReader();
    r.onload = () => loadText(String(r.result), f.name);
    r.readAsText(f);
  }

  /** Yeni çözümü alternatif katman listesine ekler ve haritada aktif eder. */
  function registerAlt(out: BlockResult[], variant: number, scope: "one" | "all") {
    const id = ++altSeq.current;
    setAlts((l) => [...l, { id, variant, scope, results: out }]);
    setActiveAlt(id);
    setResults(out);
    setActiveBlock(0);
    setSelected(null);
  }

  /** Kullanıcı listeden bir alternatifi seçtiğinde haritayı ve dışa aktarımı ona bağlar. */
  function selectAlt(a: Alt) {
    setActiveAlt(a.id);
    setResults(a.results);
    setVariant(a.variant);
    setActiveBlock(0);
    setSelected(null);
  }

  function removeAlt(id: number) {
    setAlts((l) => {
      const next = l.filter((a) => a.id !== id);
      if (activeAlt === id) {
        const last = next[next.length - 1];
        if (last) {
          setActiveAlt(last.id);
          setResults(last.results);
          setVariant(last.variant);
        } else {
          setActiveAlt(null);
          setResults([]);
        }
        setActiveBlock(0);
        setSelected(null);
      }
      return next;
    });
  }

  function runInline(rings: Ring[], variant: number) {
    setTimeout(() => {
      try {
        const out = rings.map((r, i) =>
          optimizeBlock(r, exactBuildingLines, params, { id: `ada-${i + 1}`, name: `ADA ${i + 1}`, variant }),
        );
        registerAlt(out, variant, rings.length > 1 ? "all" : "one");
        setNotice(variant > 0 ? `Alternatif parselasyon #${variant} üretildi.` : null);
      } catch (err) {
        setNotice("Hesaplama hatası: " + (err as Error).message);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    }, 30);
  }

  function cancelCompute() {
    workerRef.current?.terminate();
    workerRef.current = null;
    jobRef.current += 1;
    setBusy(false);
    setProgress(null);
    setNotice("Hesaplama iptal edildi.");
  }

  function compute(all: boolean, variant = 0) {
    if (!adaRings.length) {
      setNotice("Seçilen katmanda kapalı ada poligonu bulunamadı.");
      return;
    }
    const target = all ? adaRings : adaRings.slice(0, 1);
    setBusy(true);
    setVariant(variant);
    setNotice(null);
    setProgress({ done: 0, total: target.length });

    // Ağır geometri hesabı arka planda çalışır; arayüz ve harita donmaz.
    workerRef.current?.terminate();
    const jobId = ++jobRef.current;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/parcelation.worker.ts", import.meta.url), { type: "module" });
    } catch {
      runInline(target, variant);
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.jobId !== jobRef.current) return;
      if (msg.type === "progress") {
        setProgress({ done: msg.done, total: msg.total });
      } else if (msg.type === "done") {
        registerAlt(msg.results, variant, target.length > 1 ? "all" : "one");
        setNotice(variant > 0 ? `Alternatif parselasyon #${variant} üretildi.` : null);
        setBusy(false);
        setProgress(null);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else if (msg.type === "error") {
        setNotice("Hesaplama hatası: " + msg.message);
        setBusy(false);
        setProgress(null);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
    worker.onerror = () => {
      if (jobId !== jobRef.current) return;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      runInline(target, variant); // worker desteklenmiyorsa eski yol
    };

    worker.postMessage({
      type: "compute",
      jobId,
      rings: target,
      buildingLines: exactBuildingLines,
      params,
      variant,
    } satisfies WorkerRequest);
  }


  // Hesaplama süresi sayacı (yalnızca gösterim amaçlı)
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Sekme kapanırken/ayrılırken arka plan işçisini serbest bırak
  useEffect(() => () => workerRef.current?.terminate(), []);

  const sum = summarize(results);
  const active = results[activeBlock];

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-panel/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 font-mono text-xs font-bold text-primary">
            PO
          </span>
          <div>
            <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-primary">
              Parselasyon Optimizasyon
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              İmar adası geometrisini koruyarak maksimum geçerli parsel + yapı çözümü
            </p>
          </div>
        </div>
        <div className="truncate rounded-full border border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
          {fileName || "dosya yok"}
        </div>
      </header>


      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* SOL PANEL */}
        <aside
          style={{ ["--panel-w" as string]: `${leftW}px` }}
          className={`min-h-0 w-full shrink-0 overflow-y-auto bg-panel/95 p-3 lg:block lg:w-[var(--panel-w)] lg:border-r lg:border-border ${
            tab === "ayarlar" ? "block flex-1" : "hidden"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".dxf,.dwg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />

          {/* HIZLI EYLEMLER */}
          <div className="mb-3 space-y-2 rounded-lg border border-border/70 bg-background/40 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Btn small onClick={() => fileRef.current?.click()}>
                <Upload /> DXF Yükle
              </Btn>
              <Btn small variant="ghost" onClick={() => loadText(sampleDxf(), "ornek-ada.dxf")}>
                <FileText /> Örnek Ada
              </Btn>
            </div>
            {busy ? (
              <div className="space-y-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: progress && progress.total ? `${(progress.done / progress.total) * 100}%` : "25%",
                    }}
                  />
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Hesaplanıyor{progress ? ` · ${progress.done}/${progress.total} ada` : "…"} · {elapsed} sn
                </p>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Ağır geometri optimizasyonu arka planda çalışıyor; arayüz ve harita kullanılabilir durumda kalır.
                </p>
                <Btn small variant="ghost" onClick={cancelCompute}>
                  <X /> Vazgeç
                </Btn>
              </div>
            ) : (
              <Btn onClick={() => compute(false)} disabled={!adaRings.length}>
                <Play /> Parselasyonu Hesapla
              </Btn>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Btn small variant="ghost" onClick={() => compute(true)} disabled={busy || adaRings.length < 2}>
                <Layers /> Tüm adalar ({adaRings.length})
              </Btn>
              <Btn small variant="ghost" onClick={() => compute(false, variant + 1)} disabled={busy || !results.length}>
                <RefreshCw /> Alternatif{variant > 0 ? ` #${variant}` : ""}
              </Btn>
            </div>
          </div>

          <Accordion
            type="multiple"
            defaultValue={["katman", "parametre"]}
            className="space-y-2"
          >
            <PanelItem value="katman" icon={<Layers className="size-3.5" />} title="Katman Seçimi">
              <Field label="Ada katmanı">
                <Sel value={adaLayer} onChange={setAdaLayer}>
                  {(doc?.layers ?? ["ADA"]).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Sel>
              </Field>
              <Field label="Yapı inşaat hattı">
                <Sel value={hatLayer} onChange={setHatLayer}>
                  {(doc?.layers ?? ["YAPI_INSAA_HATTI"]).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Sel>
              </Field>
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                {adaRings.length} ada · DXF hat katmanında {buildingLines.length} nesne · hesaplanan{" "}
                {exactBuildingLines.length} adet tam {params.frontSetback.toFixed(2)} m paralel yapı hattı
              </p>
              <div className="space-y-1.5 pt-1">
                {LAYER_KEYS.map((k) => (
                  <Toggle
                    key={k}
                    label={LAYER_LABELS[k]}
                    checked={layers[k]}
                    onChange={(c) => setLayers({ ...layers, [k]: c })}
                  />
                ))}
              </div>
            </PanelItem>

            <PanelItem value="parametre" icon={<SlidersHorizontal className="size-3.5" />} title="Parametreler">
              <Tabs defaultValue="parsel">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="parsel" className="font-mono text-[10px] uppercase tracking-wider">
                    Parsel
                  </TabsTrigger>
                  <TabsTrigger value="yapi" className="font-mono text-[10px] uppercase tracking-wider">
                    Yapı
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="parsel" className="mt-3 grid grid-cols-2 gap-2">
                  <Num tone="blue" label="Min parsel (m²)" v={params.minArea} set={(v) => setParams({ ...params, minArea: v })} />
                  <Num tone="blue" label="Max parsel (m²)" v={params.maxArea} set={(v) => setParams({ ...params, maxArea: v })} />
                  <Num tone="blue" label="Ara cephe (m)" v={params.midFront} set={(v) => setParams({ ...params, midFront: v })} />
                  <Num tone="blue" label="Köşe cephe (m)" v={params.cornerFront} set={(v) => setParams({ ...params, cornerFront: v })} />
                  <Num
                    tone="blue"
                    label="Tolerans (m)"
                    step={0.05}
                    v={params.tolerance}
                    set={(v) => setParams({ ...params, tolerance: v })}
                  />
                </TabsContent>
                <TabsContent value="yapi" className="mt-3 grid grid-cols-2 gap-2">
                  <Num tone="green" label="Ön çekme (m)" v={params.frontSetback} set={(v) => setParams({ ...params, frontSetback: v })} />
                  <Num tone="green" label="Yan çekme (m)" v={params.sideSetback} set={(v) => setParams({ ...params, sideSetback: v })} />
                  <Num tone="green" label="Arka çekme (m)" v={params.rearSetback} set={(v) => setParams({ ...params, rearSetback: v })} />
                  <Num
                    tone="green"
                    label="Min yapı (m²)"
                    v={params.minBuildingArea}
                    set={(v) => setParams({ ...params, minBuildingArea: v })}
                  />
                  <Num
                    tone="green"
                    label="Min yapı cephe (m)"
                    v={params.minBuildingFront}
                    set={(v) => setParams({ ...params, minBuildingFront: v })}
                  />
                  <Num
                    tone="green"
                    label="Min yapı derinlik (m)"
                    v={params.minBuildingDepth}
                    set={(v) => setParams({ ...params, minBuildingDepth: v })}
                  />
                  <Num tone="green" label="TAKS" step={0.01} v={params.taks} set={(v) => setParams({ ...params, taks: v })} />
                </TabsContent>
              </Tabs>
            </PanelItem>

            <PanelItem value="altlik" icon={<MapIcon className="size-3.5" />} title="Harita Altlığı">
              <Toggle
                label="Altlığı göster"
                checked={basemap.enabled}
                onChange={(c) => setBasemap({ ...basemap, enabled: c })}
              />
              <Field label="Altlık tipi">
                <Sel value={basemap.type} onChange={(v) => setBasemap({ ...basemap, type: v as BasemapConfig["type"] })}>
                  <option value="hybrid">Uydu + etiket</option>
                  <option value="satellite">Uydu</option>
                  <option value="street">Sokak haritası</option>
                </Sel>
              </Field>
              <Field label="Koordinat sistemi (DXF)">
                <Sel
                  value={crs}
                  onChange={(v) => {
                    setCrs(v);
                    georeference(adaRings, v);
                  }}
                >
                  {TM_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Sel>
              </Field>
              <Btn small variant="ghost" disabled={!adaRings.length} onClick={() => georeference(adaRings)}>
                <Crosshair /> DXF koordinatından konumla
              </Btn>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Enlem (merkez)" step={0.0001} v={basemap.lat} set={(v) => setBasemap({ ...basemap, lat: v, refX: undefined, refY: undefined })} />
                <Num label="Boylam (merkez)" step={0.0001} v={basemap.lon} set={(v) => setBasemap({ ...basemap, lon: v, refX: undefined, refY: undefined })} />
              </div>
              <Field label={`Altlık opaklığı · ${Math.round(basemap.opacity * 100)}%`}>
                <Slider
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={[basemap.opacity]}
                  onValueChange={([v]: number[]) => setBasemap({ ...basemap, opacity: v })}
                  className="py-1.5"
                />
              </Field>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                DXF projeksiyon koordinatlı (TM/UTM) ise dilim seçilip otomatik konumlanır. Yerel koordinatlarda
                enlem/boylam elle girilebilir.
              </p>
            </PanelItem>

            <PanelItem value="alternatif" icon={<GitBranch className="size-3.5" />} title={`Alternatifler (${alts.length})`}>
              {alts.length === 0 ? (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Henüz alternatif yok. “Parselasyonu Hesapla” ve “Alternatif” butonları her çözümü buraya ayrı bir
                  katman olarak ekler; seçtiğiniz katman haritada gösterilir ve dışa aktarılır.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {alts.map((a) => {
                    const s = summarize(a.results);
                    const on = activeAlt === a.id;
                    return (
                      <div
                        key={a.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                          on ? "border-primary bg-primary/10" : "border-border/70 bg-background/40 hover:bg-accent/40",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => selectAlt(a)}
                          className="min-w-0 flex-1 text-left"
                          aria-pressed={on}
                        >
                          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-foreground">
                            {on && <Check className="size-3 text-primary" />}
                            {a.variant === 0 ? "Çözüm A" : `Alternatif #${a.variant}`}
                            <span className="text-[9px] font-normal uppercase tracking-wider text-muted-foreground">
                              {a.scope === "all" ? `${a.results.length} ada` : "tek ada"}
                            </span>
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {s.valid}/{s.parcels} geçerli parsel · ort. {Math.round(s.avgArea).toLocaleString("tr-TR")} m²
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAlt(a.id)}
                          aria-label="Alternatifi sil"
                          title="Alternatifi sil"
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Aktif alternatif (vurgulu satır) haritada görünür ve tüm dışa aktarımlarda kullanılır.
                  </p>
                </div>
              )}
            </PanelItem>

            <PanelItem value="export" icon={<Download className="size-3.5" />} title="Dışa Aktar">
              {activeAlt !== null && alts.length > 1 && (
                <p className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 font-mono text-[10px] text-primary">
                  Dışa aktarılacak: {(() => {
                    const a = alts.find((x) => x.id === activeAlt);
                    return a ? (a.variant === 0 ? "Çözüm A" : `Alternatif #${a.variant}`) : "";
                  })()}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  small
                  variant="ghost"
                  disabled={!results.length}
                  onClick={() => download("parselasyon.dxf", exportDXF(results, exactBuildingLines), "application/dxf")}
                >
                  DXF
                </Btn>
                <Btn
                  small
                  variant="ghost"
                  disabled={!results.length}
                  onClick={() =>
                    download("parselasyon.geojson", exportGeoJSON(results, exactBuildingLines), "application/geo+json")
                  }
                >
                  GeoJSON
                </Btn>
                <Btn small variant="ghost" disabled={!results.length} onClick={() => download("parsel-raporu.csv", exportCSV(results), "text/csv")}>
                  CSV
                </Btn>
                <Btn
                  small
                  variant="ghost"
                  disabled={!results.length}
                  onClick={() => download("parselasyon-paket.json", exportPackage(results, exactBuildingLines), "application/json")}
                >
                  Paket
                </Btn>
                <Btn
                  small
                  variant="ghost"
                  disabled={!results.length}
                  onClick={() => {
                    if (!openReportPdf(results, params, fileName || "parselasyon"))
                      setNotice("Rapor penceresi açılamadı. Tarayıcı açılır pencere iznini kontrol edin.");
                  }}
                >
                  PDF Rapor
                </Btn>
                <Btn
                  small
                  variant="ghost"
                  disabled={!results.length}
                  onClick={() => download("denetim-raporu.csv", exportAuditCSV(results, params), "text/csv")}
                >
                  Denetim CSV
                </Btn>
              </div>
              <Btn
                disabled={!results.length || zipping}
                onClick={async () => {
                  setZipping(true);
                  try {
                    await downloadZip(results, exactBuildingLines, params, (fileName || "parselasyon").replace(/\.dxf$/i, ""));
                  } catch (e) {
                    setNotice("ZIP oluşturulamadı: " + (e as Error).message);
                  } finally {
                    setZipping(false);
                  }
                }}
              >
                <Download /> {zipping ? "ZIP hazırlanıyor…" : "Tümünü ZIP indir"}
              </Btn>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                PDF Rapor; özet, kural seti, parsel listesi ve her geçersiz parsel için denetim bölümünü içerir.
              </p>
            </PanelItem>
          </Accordion>
        </aside>


        {/* SOL PANEL GENİŞLİK TUTAMACI */}
        <div
          onPointerDown={startLeftResize}
          onDoubleClick={() => setLeftW(380)}
          title="Paneli genişlet / daralt (çift tıkla sıfırla)"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary lg:block"
        />

        {/* HARİTA */}
        <main className={`relative min-h-0 flex-1 lg:block ${tab === "harita" ? "block" : "hidden"}`}>
          <PlanViewer
            blocks={results}
            rawBlocks={adaRings}
            buildingLines={exactBuildingLines}
            layers={layers}
            basemap={basemap}

            selected={selected ? { block: selected.block.id, no: selected.parcel.no } : null}
            onSelect={(b, p) => setSelected({ block: b, parcel: p })}
          />
          {notice && (
            <div className="absolute left-3 top-3 max-w-md rounded-md border border-border bg-panel/95 px-3 py-2 text-xs">
              {notice}
            </div>
          )}
          {!doc && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-md border border-border bg-panel/90 px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                DXF yükleyin veya "Örnek ada yükle" ile başlayın
              </p>
            </div>
          )}
        </main>

        {/* SAĞ PANEL */}
        <aside
          className={`min-h-0 w-full shrink-0 overflow-y-auto bg-panel p-4 lg:block lg:w-[320px] lg:border-l lg:border-border ${
            tab === "sonuc" ? "block flex-1" : "hidden"
          }`}
        >

          {!results.length ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Sonuçlar burada görünecek. Ada seçip "Parselasyonu Hesapla" ile başlayın.
            </p>
          ) : (
          <>
              <div className="mb-3 rounded border border-primary/50 bg-primary/20 px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-foreground/70">
                  Toplam üretilen parsel
                </div>
                <div className="font-mono text-5xl font-extrabold leading-none tracking-tight text-foreground drop-shadow">
                  {sum.parcels}
                </div>
                <p className="mt-2 font-mono text-[11px] text-foreground/80">
                  {sum.blocks} ada · {sum.valid}/{sum.parcels} geçerli · ort. alan {sum.avgArea.toFixed(1)} m²
                </p>
              </div>



              {results.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {results.map((b, i) => (
                    <button
                      key={b.id}
                      onClick={() => setActiveBlock(i)}
                      className={`rounded border px-2 py-1 font-mono text-[11px] ${
                        i === activeBlock ? "border-primary text-primary" : "border-border text-muted-foreground"
                      }`}
                      title={`${b.parcels.length} parsel`}
                    >
                      {b.name} · {b.parcels.length}
                    </button>
                  ))}
                </div>
              )}


              {selected && (
                <Section title={`PARSEL ${selected.parcel.no} · ${selected.block.name}`}>
                  <Row k="Alan" v={`${selected.parcel.area.toFixed(2)} m²`} />
                  <Row k="Cephe" v={`${selected.parcel.frontage.toFixed(2)} m`} />
                  <Row k="Derinlik" v={`${selected.parcel.depth.toFixed(2)} m`} />
                  <Row k="Tip" v={selected.parcel.corner ? "KÖŞE" : "ARA"} />
                  <Row k="Yapı" v={selected.parcel.building ? `${selected.parcel.buildingArea.toFixed(2)} m²` : "—"} />
                  <Row k="Yapı cephesi" v={selected.parcel.building ? `${selected.parcel.buildingFront.toFixed(2)} m` : "—"} />
                  <Row k="Yapı derinliği" v={selected.parcel.building ? `${selected.parcel.buildingDepth.toFixed(2)} m` : "—"} />
                  <Row k="TAKS" v={selected.parcel.taksValue.toFixed(3)} />
                  <Row k="Ön çekme" v={`${params.frontSetback} m`} />
                  <Row k="Yan çekme" v={`${params.sideSetback} m`} />
                  <Row k="Arka çekme" v={`${params.rearSetback} m`} />
                  <Row
                    k="Durum"
                    v={selected.parcel.valid ? "✓ GEÇERLİ" : "✕ GEÇERSİZ"}
                    tone={selected.parcel.valid ? "ok" : "bad"}
                  />
                  {selected.parcel.issues.map((s, i) => (
                    <p key={i} className="mt-1 font-mono text-[11px] text-destructive">
                      • {s}
                    </p>
                  ))}
                </Section>
              )}

              {active && (
                <>
                  <Section title={`${active.name} Özeti`}>
                    <Row k="Parsel" v={String(active.parcels.length)} />
                    <Row
                      k="Geçerli"
                      v={`${active.parcels.filter((p) => p.valid).length}/${active.parcels.length}`}
                      tone={active.parcels.every((p) => p.valid) ? "ok" : "bad"}
                    />
                    
                    <Row k="Ada alanı" v={`${ringArea(active.ring).toFixed(1)} m²`} />
                    <Row k="Tolerans kullanımı" v={String(active.toleranceUsed)} />
                  </Section>

                  <Section title="Genel Sonuç">
                    <Row k="Ada sayısı" v={String(sum.blocks)} />
                    <Row k="Toplam parsel" v={String(sum.parcels)} />
                    <Row k="Geçerli parsel" v={`${sum.valid}/${sum.parcels}`} />
                    <Row k="Ort. parsel alanı" v={`${sum.avgArea.toFixed(1)} m²`} />
                    <Row k="Min / Max parsel" v={`${sum.minArea.toFixed(1)} / ${sum.maxArea.toFixed(1)} m²`} />
                    <Row k="Ort. yapı alanı" v={`${sum.avgBuilding.toFixed(1)} m²`} />
                    <Row k="Min / Max yapı" v={`${sum.minBuilding.toFixed(1)} / ${sum.maxBuilding.toFixed(1)} m²`} />
                    <Row k="Yapılaşan parsel" v={`${sum.buildings}/${sum.parcels}`} />
                    
                  </Section>

                  <Section title="Algoritma Günlüğü">
                    {active.log.map((l, i) => (
                      <p key={i} className="mb-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {l}
                      </p>
                    ))}
                  </Section>

                  <Section title="Parsel Listesi">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full font-mono text-[11px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left">No</th>
                            <th className="text-right">Alan</th>
                            <th className="text-right">Cephe</th>
                            <th className="text-right">Yapı</th>
                            <th className="text-right">TAKS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.parcels.map((p) => (
                            <tr
                              key={p.no}
                              onClick={() => setSelected({ block: active, parcel: p })}
                              className={`cursor-pointer border-t border-border ${p.valid ? "" : "text-destructive"}`}
                            >
                              <td>{p.no}{p.corner ? "*" : ""}</td>
                              <td className="text-right">{p.area.toFixed(1)}</td>
                              <td className="text-right">{p.frontage.toFixed(1)}</td>
                              <td className="text-right">{p.buildingArea ? p.buildingArea.toFixed(1) : "—"}</td>
                              <td className="text-right">{p.taksValue ? p.taksValue.toFixed(2) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[10px] text-muted-foreground">* köşe parsel</p>
                    </div>
                  </Section>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      {/* MOBİL SEKMELER */}
      <nav className="flex shrink-0 border-t border-border bg-panel lg:hidden">
        {(
          [
            ["ayarlar", "Ayarlar"],
            ["harita", "Harita"],
            ["sonuc", "Sonuçlar"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-3 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              tab === k ? "border-t-2 border-primary text-primary" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );

}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Sel({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

function Num({
  label,
  v,
  set,
  step = 1,
  tone,
}: {
  label: string;
  v: number;
  set: (n: number) => void;
  step?: number;
  tone?: "blue" | "green";
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={v}
        onChange={(e) => set(Number(e.target.value))}
        className={cn(
          "h-8 bg-background/60 px-2 font-mono text-xs tabular-nums",
          tone === "blue" && "border-primary/30 focus-visible:border-primary",
          tone === "green" && "border-accent-foreground/20",
        )}
      />
    </Field>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40">
      <span className="text-foreground/90">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "solid",
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost";
  small?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      size={small ? "sm" : "default"}
      variant={variant === "solid" ? "default" : "outline"}
      className={cn(
        "w-full font-mono font-medium uppercase tracking-wider",
        small ? "h-8 text-[10px]" : "h-9 text-[11px]",
      )}
    >
      {children}
    </Button>
  );
}


function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/60 py-0.5">
      <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
      <span
        className={`font-mono text-[11px] ${tone === "ok" ? "text-primary" : tone === "bad" ? "text-destructive" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
