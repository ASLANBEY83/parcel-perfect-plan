import DxfParser from "dxf-parser";
import type { Pt, Ring } from "./geo";
import { closeRing, dist, ringArea } from "./geo";

export interface DxfEntity {
  layer: string;
  points: Pt[];
  closed: boolean;
}

export interface DxfDoc {
  layers: string[];
  entities: DxfEntity[];
}

export function parseDxf(text: string): DxfDoc {
  const parser = new DxfParser();
  const dxf: any = parser.parseSync(text);
  const entities: DxfEntity[] = [];
  const openLines: DxfEntity[] = [];

  for (const e of dxf?.entities ?? []) {
    const layer = String(e.layer ?? "0");
    if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const pts: Pt[] = (e.vertices ?? []).map((v: any) => [v.x, v.y] as Pt);
      if (pts.length < 2) continue;
      const closed = Boolean(e.shape ?? e.closed) || dist(pts[0], pts[pts.length - 1]) < 1e-6;
      entities.push({ layer, points: pts, closed });
    } else if (e.type === "LINE") {
      const s = e.vertices?.[0] ?? e.start;
      const t = e.vertices?.[1] ?? e.end;
      if (!s || !t) continue;
      openLines.push({ layer, points: [[s.x, s.y], [t.x, t.y]], closed: false });
    }
  }

  // LINE parçalarını katman bazında zincirle (kapalı halka oluşabilir)
  const byLayer = new Map<string, DxfEntity[]>();
  for (const l of openLines) {
    const arr = byLayer.get(l.layer) ?? [];
    arr.push(l);
    byLayer.set(l.layer, arr);
  }
  for (const [layer, segs] of byLayer) entities.push(...chainSegments(layer, segs));

  // Yalnızca gerçekten geometri içeren katmanlar listelenir; tablodaki boş
  // katmanlar (veri taşımayan tanımlar) katman seçiminde gösterilmez.
  const layers = Array.from(new Set(entities.filter((e) => e.points.length >= 2).map((e) => e.layer)));

  return { layers, entities };
}

function chainSegments(layer: string, segs: DxfEntity[], tol = 1e-4): DxfEntity[] {
  const used = new Array(segs.length).fill(false);
  const out: DxfEntity[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Pt[] = [...segs[i].points];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const [a, b] = segs[j].points;
        const head = chain[0];
        const tail = chain[chain.length - 1];
        if (dist(tail, a) < tol) chain.push(b);
        else if (dist(tail, b) < tol) chain.push(a);
        else if (dist(head, a) < tol) chain.unshift(b);
        else if (dist(head, b) < tol) chain.unshift(a);
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    const closed = chain.length > 3 && dist(chain[0], chain[chain.length - 1]) < tol;
    out.push({ layer, points: chain, closed });
  }
  return out;
}

/** Kapalı ve anlamlı alana sahip poligonlar */
export function polygonsOfLayer(doc: DxfDoc, layer: string): Ring[] {
  return doc.entities
    .filter((e) => e.layer === layer && e.closed && e.points.length >= 3)
    .map((e) => {
      const p = [...e.points];
      if (dist(p[0], p[p.length - 1]) < 1e-9) p.pop();
      return p;
    })
    .filter((r) => ringArea(r) > 1);
}

export function linesOfLayer(doc: DxfDoc, layer: string): Pt[][] {
  return doc.entities.filter((e) => e.layer === layer && e.points.length >= 2).map((e) => e.points);
}

// ---------------- DXF yazımı ----------------

interface DxfOutEntity {
  layer: string;
  points: Pt[];
  closed: boolean;
}

/** AutoCAD R12 (AC1009) uyumlu, tüm CAD yazılımlarında açılan DXF üretir. */
export function writeDxf(entities: DxfOutEntity[]): string {
  const layers = Array.from(new Set(entities.map((e) => e.layer)));
  const colorOf = (n: string) =>
    n === "PARSELLER" ? 3 : n === "YAPI_BLOKLARI" ? 1 : n === "ADA" ? 5 : n === "YAPI_INSAA_HATTI" ? 2 : 7;
  const L: string[] = [];
  const p = (code: number | string, v: string | number) => L.push(String(code), String(v));

  const all = entities.flatMap((e) => e.points);
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;

  // HEADER
  p(0, "SECTION");
  p(2, "HEADER");
  p(9, "$ACADVER");
  p(1, "AC1009");
  p(9, "$INSBASE");
  p(10, "0.0");
  p(20, "0.0");
  p(30, "0.0");
  p(9, "$EXTMIN");
  p(10, minX.toFixed(4));
  p(20, minY.toFixed(4));
  p(30, "0.0");
  p(9, "$EXTMAX");
  p(10, maxX.toFixed(4));
  p(20, maxY.toFixed(4));
  p(30, "0.0");
  p(0, "ENDSEC");

  // TABLES (LAYER)
  p(0, "SECTION");
  p(2, "TABLES");
  p(0, "TABLE");
  p(2, "LTYPE");
  p(70, 1);
  p(0, "LTYPE");
  p(2, "CONTINUOUS");
  p(70, 0);
  p(3, "Solid line");
  p(72, 65);
  p(73, 0);
  p(40, "0.0");
  p(0, "ENDTAB");
  p(0, "TABLE");
  p(2, "LAYER");
  p(70, layers.length);
  for (const n of layers) {
    p(0, "LAYER");
    p(2, n);
    p(70, 0);
    p(62, colorOf(n));
    p(6, "CONTINUOUS");
  }
  p(0, "ENDTAB");
  p(0, "ENDSEC");

  // ENTITIES (R12 POLYLINE/VERTEX/SEQEND)
  p(0, "SECTION");
  p(2, "ENTITIES");
  for (const e of entities) {
    const pts = e.closed ? closeRing(e.points).slice(0, -1) : e.points;
    if (pts.length < 2) continue;
    p(0, "POLYLINE");
    p(8, e.layer);
    p(66, 1);
    p(10, "0.0");
    p(20, "0.0");
    p(30, "0.0");
    p(70, e.closed ? 1 : 0);
    for (const q of pts) {
      p(0, "VERTEX");
      p(8, e.layer);
      p(10, q[0].toFixed(4));
      p(20, q[1].toFixed(4));
      p(30, "0.0");
    }
    p(0, "SEQEND");
    p(8, e.layer);
  }
  p(0, "ENDSEC");
  p(0, "EOF");
  return L.join("\r\n") + "\r\n";
}

