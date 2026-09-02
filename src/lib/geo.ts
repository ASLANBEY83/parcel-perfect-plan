// Düzlemsel (metre tabanlı) geometri yardımcıları.
// DXF koordinatları projekte metre olduğundan, mesafe/alan hesapları düzlemsel
// (kartezyen) yapılır. Poligon topolojisi (kesişim, fark, birleşim, nokta-içinde)
// artık Turf.js üzerinden yürütülür; Turf bu işlemleri koordinat sistemi bağımsız
// (polygon-clipping tabanlı) yaptığı için metre tabanlı verilerle de doğrudur.
// UYARI: turf.area / turf.buffer / turf.length gibi fonksiyonlar WGS84 (derece)
// varsayar; metre koordinatlarda yanlış sonuç verecekleri için alan ve ofset
// hesapları düzlemsel formüllerle yapılır.
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type Pt = [number, number];
export type Ring = Pt[]; // kapalı kabul edilir (son nokta ilk noktaya eşit olmayabilir)
export type Poly = Ring[]; // [dış halka, ...delikler]
export type MultiPoly = Poly[];


export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const perp = (a: Pt): Pt => [-a[1], a[0]];
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const ringArea = (r: Ring) => Math.abs(signedArea(r));

export function polyArea(p: Poly): number {
  if (!p.length) return 0;
  return p.reduce((acc, r, i) => acc + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
}
export const mpArea = (mp: MultiPoly) => mp.reduce((a, p) => a + polyArea(p), 0);

export function closeRing(r: Ring): Ring {
  if (r.length < 3) return r;
  const first = r[0];
  const last = r[r.length - 1];
  return dist(first, last) < 1e-9 ? r : [...r, first];
}

/** MultiPoly -> GeoJSON Feature (Turf girdisi). */
export function toFeature(mp: MultiPoly): Feature<Polygon | MultiPolygon> | null {
  const coords = mp
    .map((p) => p.map((r) => closeRing(r)).filter((r) => r.length >= 4))
    .filter((p) => p.length > 0);
  if (!coords.length) return null;
  return coords.length === 1 ? turf.polygon(coords) : turf.multiPolygon(coords);
}

/** Turf sonucunu MultiPoly'ye çevirir (kapanış noktası atılır). */
export function fromFeature(feat: Feature<Polygon | MultiPolygon> | null | undefined): MultiPoly {
  if (!feat?.geometry) return [];
  const g = feat.geometry;
  const polys: number[][][][] = g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [g.coordinates as number[][][]];
  return polys.map((p) =>
    p.map((r) => {
      const rr = r.map((c) => [c[0], c[1]] as Pt);
      if (rr.length > 1 && dist(rr[0], rr[rr.length - 1]) < 1e-9) rr.pop();
      return rr;
    }),
  );
}

/** Turf ile kesişim (turf.intersect). */
export function mpIntersect(a: MultiPoly, b: MultiPoly): MultiPoly {
  const fa = toFeature(a);
  const fb = toFeature(b);
  if (!fa || !fb) return [];
  try {
    return fromFeature(turf.intersect(turf.featureCollection([fa, fb])));
  } catch {
    return [];
  }
}

/** Turf ile fark (turf.difference). */
export function mpDifference(a: MultiPoly, b: MultiPoly): MultiPoly {
  const fa = toFeature(a);
  if (!fa) return [];
  const fb = toFeature(b);
  if (!fb) return a;
  try {
    return fromFeature(turf.difference(turf.featureCollection([fa, fb])));
  } catch {
    return [];
  }
}

/** Turf ile birleşim (turf.union). */
export function mpUnion(a: MultiPoly, b: MultiPoly): MultiPoly {
  const fa = toFeature(a);
  if (!fa) return b;
  const fb = toFeature(b);
  if (!fb) return a;
  try {
    return fromFeature(turf.union(turf.featureCollection([fa, fb])) as Feature<Polygon | MultiPolygon>);
  } catch {
    return a;
  }
}


/** En büyük alanlı parçayı döndürür. */
export function largestPoly(mp: MultiPoly): Poly | null {
  if (!mp.length) return null;
  return mp.reduce((best, p) => (polyArea(p) > polyArea(best) ? p : best), mp[0]);
}

/** Sutherland–Hodgman: normal yönünün pozitif tarafını korur. */
export function clipHalfPlane(ring: Ring, p0: Pt, n: Pt): Ring {
  const out: Ring = [];
  const side = (p: Pt) => dot(sub(p, p0), n);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Poligonu her kenarından içe doğru (kenar bazlı mesafe ile) budar. Sonuç daima orijinalin içindedir. */
export function insetRing(ring: Ring, distFor: (edgeIndex: number) => number): Ring {
  let cur = ensureCCW(ring);
  const base = ensureCCW(ring);
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const d = norm(sub(b, a));
    const n = perp(d); // CCW halkada içe bakar
    const off = distFor(i);
    cur = clipHalfPlane(cur, add(a, mul(n, off)), n);
    if (cur.length < 3) return [];
  }
  return cur;
}

export function ensureCCW(r: Ring): Ring {
  return signedArea(r) < 0 ? [...r].reverse() : r;
}

/** Bir polyline'ın bir tarafını kaplayan çok büyük poligon üretir (kesme maskesi). */
export function sideMask(line: Pt[], sign: 1 | -1, far = 1e5): Poly {
  const pts = [...line];
  // uçları uzat
  const d0 = norm(sub(pts[1], pts[0]));
  const dn = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
  pts.unshift(add(pts[0], mul(d0, -far)));
  pts.push(add(pts[pts.length - 1], mul(dn, far)));
  const outward: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const n = mul(norm(perp(norm(sub(b, a)))), sign * far);
    outward.push(add(pts[i], n));
  }
  return [[...pts, ...outward]];
}

export function bbox(pts: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(r: Ring): Pt {
  let x = 0,
    y = 0,
    a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    x += (p[0] + q[0]) * f;
    y += (p[1] + q[1]) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    const b = bbox(r);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  return [x / (6 * a), y / (6 * a)];
}

export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Noktanın polyline'a en yakın mesafesi ve izdüşümü. */
export function nearestOnPolyline(p: Pt, line: Pt[]) {
  let best = { d: Infinity, pt: line[0] as Pt, seg: 0, t: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ab = sub(b, a);
    const l2 = dot(ab, ab) || 1e-9;
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    const pt = add(a, mul(ab, t)) as Pt;
    const d = dist(p, pt);
    if (d < best.d) best = { d, pt, seg: i, t };
  }
  return best;
}

export function polylineLength(line: Pt[]) {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) s += dist(line[i], line[i + 1]);
  return s;
}

/** Chainage (metre) -> nokta + teğet */
export function atChainage(line: Pt[], s: number): { pt: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const l = dist(line[i], line[i + 1]);
    if (acc + l >= s || i === line.length - 2) {
      const t = l < 1e-9 ? 0 : (s - acc) / l;
      const dir = norm(sub(line[i + 1], line[i]));
      return { pt: add(line[i], mul(sub(line[i + 1], line[i]), Math.max(0, Math.min(1, t)))), dir };
    }
    acc += l;
  }
  const n = line.length;
  return { pt: line[n - 1], dir: norm(sub(line[n - 1], line[n - 2])) };
}

export function resample(line: Pt[], n: number): Pt[] {
  const L = polylineLength(line);
  return Array.from({ length: n }, (_, i) => atChainage(line, (L * i) / (n - 1)).pt);
}

export function stddev(v: number[]) {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

/** En küçük alanlı yönlendirilmiş sınır kutusunun uzun eksen açısı (rad). */
export function principalAngle(ring: Ring): number {
  let best = { area: Infinity, ang: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang),
      s = Math.sin(-ang);
    const pts = ring.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c] as Pt);
    const bb = bbox(pts);
    const area = bb.w * bb.h;
    if (area < best.area) best = { area, ang: bb.w >= bb.h ? ang : ang + Math.PI / 2 };
  }
  return best.ang;
}

export function toFrame(p: Pt, origin: Pt, u: Pt): Pt {
  const v = perp(u);
  const d = sub(p, origin);
  return [dot(d, u), dot(d, v)];
}
export function fromFrame(p: Pt, origin: Pt, u: Pt): Pt {
  const v = perp(u);
  return [origin[0] + p[0] * u[0] + p[1] * v[0], origin[1] + p[0] * u[1] + p[1] * v[1]];
}

/** Yarıçapı r olan çokgen daire (v köşeli). */
function diskPoly(c: Pt, r: number, v = 12): Ring {
  return Array.from({ length: v }, (_, i) => {
    const a = (2 * Math.PI * i) / v;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Pt;
  });
}

/**
 * Halkayı içeriye doğru d kadar gerçek (paralel) ofsetler.
 * Sınırın d yarıçaplı Minkowski bandı halkadan çıkarılır; bu yöntem
 * içbükey (kırık) ada köşelerinde de doğru sonuç verir.
 */
export function offsetRingInward(ring: Ring, d: number): Ring[] {
  if (ring.length < 3 || d <= 0) return [ring];
  const r = ensureCCW(ring);
  const parts: MultiPoly = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const n = mul(norm(perp(norm(sub(b, a)))), d);
    parts.push([[add(a, n), add(b, n), add(b, mul(n, -1)), add(a, mul(n, -1))]]);
    parts.push([diskPoly(a, d / Math.cos(Math.PI / 48), 48)]);
  }
  const res = mpDifference([[r]], parts);
  return res.map((p) => p[0]).filter((x) => x && x.length >= 3);
}
