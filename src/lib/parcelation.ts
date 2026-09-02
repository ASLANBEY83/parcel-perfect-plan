import {
  add,
  atChainage,
  bbox,
  centroid,
  clipHalfPlane,
  dist,
  dot,
  ensureCCW,
  fromFrame,
  largestPoly,
  len,
  mpArea,
  mpDifference,
  mpIntersect,
  mpUnion,
  mul,
  nearestOnPolyline,
  norm,
  perp,
  pointInRing,
  polylineLength,
  principalAngle,
  ringArea,
  stddev,
  sub,
  toFrame,
  type MultiPoly,
  type Poly,
  type Pt,
  type Ring,
} from "./geo";
import {
  EDGE_CLASSIFICATION,
  EQUAL_AREA_SAMPLE_STEPS,
  FRONTAGE_DETECTION,
  ROAD_BAND,
  SOLUTION_SCORE_WEIGHTS,
} from "./parcelation-config";

export interface Params {
  minArea: number;
  maxArea: number;
  midFront: number;
  cornerFront: number;
  frontSetback: number;
  sideSetback: number;
  rearSetback: number;
  minBuildingArea: number;
  minBuildingFront: number;
  minBuildingDepth: number;
  taks: number;
  tolerance: number;
}

export const defaultParams: Params = {
  minArea: 275,
  maxArea: 400,
  midFront: 12,
  cornerFront: 14,
  frontSetback: 5,
  sideSetback: 3,
  rearSetback: 3,
  minBuildingArea: 60,
  minBuildingFront: 6,
  minBuildingDepth: 10,
  taks: 0.35,
  tolerance: 1.0,
};

export interface Parcel {
  no: number;
  row: number;
  ring: Ring;
  area: number;
  frontage: number;
  depth: number;
  corner: boolean;
  envelope: Ring | null;
  building: Ring | null;
  buildingArea: number;
  buildingFront: number;
  buildingDepth: number;
  taksValue: number;
  valid: boolean;
  issues: string[];
}

export interface BlockResult {
  id: string;
  name: string;
  ring: Ring;
  frontages: Pt[][];
  parcels: Parcel[];
  leftover: MultiPoly;
  leftoverArea: number;
  toleranceUsed: number;
  log: string[];
}

// -------------------- yardımcılar --------------------

interface CutDef {
  pt: Pt;
  dir: Pt; // kesme çizgisi doğrultusu (normalde yola dik)
  tangent: Pt; // yol cephesi doğrultusu (chainage artış yönü)
  s: number; // chainage
  paired: boolean;
}

/** Kesme çizgisinin, chainage artış yönünü gösteren normali. */
function cutNormal(c: CutDef): Pt {
  const n = perp(c.dir);
  return dot(n, c.tangent) < 0 ? mul(n, -1) : n;
}

function pieceBetween(ring: Ring, a: CutDef | null, b: CutDef | null, tangent: Pt): Ring {
  let r = ring;
  if (a) r = clipHalfPlane(r, a.pt, tangent); // a'dan sonrası
  if (r.length < 3) return [];
  if (b) r = clipHalfPlane(r, b.pt, mul(tangent, -1)); // b'den öncesi
  return r.length >= 3 ? r : [];
}

/** Satırı, cephe polyline'ı boyunca eşit alanlı N parçaya bölecek chainage'leri bulur. */
function equalAreaChainages(ring: Ring, line: Pt[], n: number, wStart = 1, wEnd = 1): number[] {
  const L = polylineLength(line);
  const total = ringArea(ring);
  const steps = EQUAL_AREA_SAMPLE_STEPS;
  const cum: { s: number; a: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = (L * i) / steps;
    const { pt, dir } = atChainage(line, s);
    const before = clipHalfPlane(ring, pt, mul(dir, -1));
    cum.push({ s, a: before.length >= 3 ? ringArea(before) : 0 });
  }
  // Köşe parseller iki yoldan da 5 m çekme yaptığı için ek alan payı alabilir.
  const w = Array.from({ length: n }, (_, i) => (n > 1 && i === 0 ? wStart : n > 1 && i === n - 1 ? wEnd : 1));
  const wSum = w.reduce((a, b) => a + b, 0);
  const cumW: number[] = [];
  let acc = 0;
  for (const x of w) cumW.push((acc += x));

  const out: number[] = [];
  for (let k = 1; k < n; k++) {
    const target = (total * cumW[k - 1]) / wSum;
    let s = (L * cumW[k - 1]) / wSum;
    for (let i = 1; i < cum.length; i++) {
      if (cum[i].a >= target) {
        const p = cum[i - 1];
        const q = cum[i];
        const t = q.a - p.a < 1e-9 ? 0 : (target - p.a) / (q.a - p.a);
        s = p.s + (q.s - p.s) * t;
        break;
      }
    }
    out.push(s);
  }

  return out;
}

function edgeLengthOnLines(ring: Ring, lines: Pt[][], tol = FRONTAGE_DETECTION.EDGE_ON_LINE_TOLERANCE): number {
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const near = lines.some(
      (l) =>
        nearestOnPolyline(m, l).d < tol &&
        nearestOnPolyline(a, l).d < tol * 1.5 &&
        nearestOnPolyline(b, l).d < tol * 1.5,
    );
    if (near) total += dist(a, b);
  }
  return total;
}

export type EdgeKind = "front" | "side" | "rear";

/**
 * Bir kenarın yol cephesi / yan / arka olarak sınıflandırılması.
 * Yol cephesi tespiti mevcut mekanizmayla (kenarın yol hattına yakınlığı,
 * kısa kenar istisnası) yapılır; yol cephesi olmayan kenarlar, yol cephesi
 * doğrultusuna paralel ise ARKA, dik ise YAN kenar sayılır.
 */
function classifyEdge(a: Pt, b: Pt, frontLines: Pt[][], roadFrontages: Pt[][]): EdgeKind {
  const H = FRONTAGE_DETECTION;
  const samples: Pt[] = H.FRONTAGE_SAMPLE_RATIOS.map((t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ]);
  const onRoad = samples.filter((m) =>
    frontLines.some((l) => nearestOnPolyline(m, l).d < H.ROAD_FRONTAGE_DISTANCE_TOLERANCE),
  ).length;
  const short = dist(a, b) < H.SHORT_EDGE_EXCEPTION_LENGTH;
  const need = short ? H.MIN_SAMPLES_ON_ROAD_SHORT : H.MIN_SAMPLES_ON_ROAD;
  if (onRoad >= need) return "front";

  // Yol cephesine paralel olan iç kenar arka bahçe sınırıdır.
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dirEdge = norm(sub(b, a));
  let best = { d: Infinity, dir: null as Pt | null };
  for (const l of roadFrontages) {
    if (l.length < 2) continue;
    const near = nearestOnPolyline(mid, l);
    if (near.d < best.d) {
      const seg = Math.min(near.seg, l.length - 2);
      best = { d: near.d, dir: norm(sub(l[seg + 1], l[seg])) };
    }
  }
  if (!best.dir) return "side";
  return Math.abs(dot(dirEdge, best.dir)) >= EDGE_CLASSIFICATION.REAR_EDGE_PARALLEL_MIN ? "rear" : "side";
}

/**
 * Yapı yaklaşma sınırı (zarf): her kenar geometrik olarak sınıflandırılır ve
 * kullanıcının girdiği runtime çekme mesafesi uygulanır:
 * yol cephesi → frontSetback, yan kenar → sideSetback, arka kenar → rearSetback.
 */
export function buildEnvelope(ring: Ring, frontLines: Pt[][], p: Params, roadFrontages: Pt[][] = []): Ring {
  const r = ensureCCW(ring);
  return clipInset(r, (i) => {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const kind = classifyEdge(a, b, frontLines, roadFrontages);
    return kind === "front" ? p.frontSetback : kind === "rear" ? p.rearSetback : p.sideSetback;
  });
}



function clipInset(r: Ring, distFor: (i: number) => number): Ring {
  let cur = r;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const d = norm(sub(b, a));
    const n = perp(d);
    cur = clipHalfPlane(cur, add(a, mul(n, distFor(i))), n);
    if (cur.length < 3) return [];
  }
  return cur;
}

function rectRing(u0: number, u1: number, v0: number, v1: number, origin: Pt, u: Pt): Ring {
  return [
    fromFrame([u0, v0], origin, u),
    fromFrame([u1, v0], origin, u),
    fromFrame([u1, v1], origin, u),
    fromFrame([u0, v1], origin, u),
  ];
}

/** Konveks çokgenin v seviyesindeki u aralığı. */
function extentAt(f: Pt[], v: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    const a = f[i];
    const b = f[(i + 1) % f.length];
    if (Math.abs(a[1] - b[1]) < 1e-9) {
      if (Math.abs(a[1] - v) < 1e-6) {
        lo = Math.min(lo, a[0], b[0]);
        hi = Math.max(hi, a[0], b[0]);
      }
      continue;
    }
    const t = (v - a[1]) / (b[1] - a[1]);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const u = a[0] + (b[0] - a[0]) * t;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  return hi - lo > 1e-6 ? [lo, hi] : null;
}

/**
 * Parselde kurallara uygun yapı bloğu üretir.
 * Yapı daima yapı inşaa hattından (çekme sınırı) başlar ve düzgün dörtgen
 * (dikdörtgen ya da simetrik yamuk) olarak oluşturulur.
 * Köşe parsellerde iki cepheden 5 m çekme sonrası kalan alana göre düzgün
 * dikdörtgen blok üretmeye çalışılır.
 */
function makeBuilding(
  parcel: Ring,
  envelope: Ring,
  frontLine: Pt[],
  buildingLines: Pt[][],
  parcelArea: number,
  p: Params,
  corner: boolean,
  roadLines: Pt[][] = [],
): { ring: Ring | null; area: number; front: number; depth: number } {
  if (envelope.length < 3) return { ring: null, area: 0, front: 0, depth: 0 };
  // Blok, ada sınırına ön bahçe mesafesinden daha yakın olamaz (köşe kırıklarında da).
  const respectsSetback = (r: Ring): boolean => {
    if (!roadLines.length) return true;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const steps = Math.max(2, Math.ceil(dist(a, b) / 1));
      for (let k = 0; k <= steps; k++) {
        const q: Pt = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
        for (const rl of roadLines) {
          if (rl.length < 2) continue;
          if (nearestOnPolyline(q, rl).d < p.frontSetback - 0.02) return false;
        }
      }
    }
    return true;
  };
  // Köşe başı parsellerde blok, cephe aldığı HER yola göre en az
  // minBuildingFront (6 m) genişlik vermelidir: bloğun o yolun doğrultusundaki
  // izdüşüm genişliği 6 m'nin altına düşemez.
  const facedRoads = (() => {
    if (!corner || !roadLines.length) return [] as Pt[][];
    const pc = centroid(parcel);
    return roadLines.filter((rl) => {
      if (rl.length < 2) return false;
      // parselin bu yola gerçekten cephesi var mı?
      let d = Infinity;
      for (const q of parcel) d = Math.min(d, nearestOnPolyline(q, rl).d);
      return d < p.frontSetback + 2 && nearestOnPolyline(pc, rl).d < 200;
    });
  })();
  const cornerFrontsOk = (r: Ring): boolean => {
    if (!corner) return true;
    // 1) Yapı inşaat hattına yaslanan kenarlar 6 m'den kısa olamaz
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let touching = false;
      for (const bl of buildingLines) {
        if (bl.length < 2) continue;
        const da = nearestOnPolyline(a, bl).d;
        const db = nearestOnPolyline(b, bl).d;
        const dm = nearestOnPolyline(mid, bl).d;
        if (Math.max(da, dm, db) < 1.0) touching = true;
      }
      if (touching && dist(a, b) < p.minBuildingFront - 1e-6) return false;
    }
    // 2) Cephe alınan her yol doğrultusunda blok genişliği >= 6 m
    for (const rl of facedRoads) {
      const c = centroid(r);
      const near = nearestOnPolyline(c, rl);
      const seg = Math.min(near.seg, rl.length - 2);
      const dir = norm(sub(rl[seg + 1], rl[seg]));
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of r) {
        const t = dot(q, dir);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      if (hi - lo < p.minBuildingFront - 1e-6) return false;
    }
    return true;
  };

  const maxByTaks = p.taks * parcelArea;
  if (maxByTaks < p.minBuildingArea) return { ring: null, area: 0, front: 0, depth: 0 };

  const c = centroid(envelope);
  const frontDir = (() => {
    const near = nearestOnPolyline(c, frontLine);
    const idx = Math.min(near.seg, frontLine.length - 2);
    return norm(sub(frontLine[idx + 1], frontLine[idx]));
  })();

  // Yalnızca gerçek ön yapı yaklaşma hattını aday kabul et.
  const cands: { origin: Pt; u: Pt; pref: number; v0Min: number }[] = [];
  for (let i = 0; i < envelope.length; i++) {
    const a = envelope[i];
    const b = envelope[(i + 1) % envelope.length];
    if (dist(a, b) < 1.0) continue;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const da = nearestOnPolyline(a, frontLine);
    const dm = nearestOnPolyline(mid, frontLine);
    const db = nearestOnPolyline(b, frontLine);
    const ds = [da.d, dm.d, db.d];
    const meanD = ds.reduce((sum, d) => sum + d, 0) / ds.length;
    const spread = Math.max(...ds) - Math.min(...ds);
    const roadSeg = Math.min(dm.seg, frontLine.length - 2);
    const roadDir = norm(sub(frontLine[roadSeg + 1], frontLine[roadSeg]));
    let u = norm(sub(b, a));
    const parallel = Math.abs(dot(u, roadDir));
    if (Math.abs(meanD - p.frontSetback) > 2 || spread > 2.5 || parallel < 0.82) continue;
    if (dot(perp(u), sub(c, mid)) < 0) u = mul(u, -1);
    cands.push({
      origin: mid,
      u,
      pref: Math.abs(meanD - p.frontSetback) * 10 + spread + (1 - parallel) * 10,
      v0Min: 0,
    });
  }

  // Zarf üzerinde ön cephe yoksa, yolun en yakın parçasını ön kabul et.
  if (!cands.length) {
    const near = nearestOnPolyline(c, frontLine);
    const idx = Math.min(near.seg, frontLine.length - 2);
    let u = norm(sub(frontLine[idx + 1], frontLine[idx]));
    if (dot(perp(u), sub(c, near.pt)) < 0) u = mul(u, -1);
    cands.push({ origin: near.pt, u, pref: 100, v0Min: 0 });
  }
  cands.sort((x, y) => x.pref - y.pref);

  const solveFor = (origin: Pt, u: Pt, v0Min: number) => {
    const f = envelope.map((q) => toFrame(q, origin, u));
    const bb = bbox(f);
    // Yapı inşaat hattı: zarfın ön kenarı (yerel çerçevede en küçük v).
    const vBase = Math.max(bb.minY + 1e-4, v0Min);
    const vMax = bb.maxY - 1e-4;
    if (vMax - vBase < p.minBuildingDepth - 1e-4) return null;
    let v0 = vBase;


    const quadAt = (h: number, width: number, off: number) => {
      const v1 = v0 + h;
      const e0 = extentAt(f, v0);
      const e1 = extentAt(f, v1);
      if (!e0 || !e1) return null;
      const lo = Math.max(e0[0], e1[0]);
      const hi = Math.min(e0[1], e1[1]);
      if (hi - lo + 1e-6 < width || width < p.minBuildingFront) return null;
      const half = width / 2;
      const center = Math.min(Math.max((lo + hi) / 2 + off, lo + half), hi - half);
      const u0 = center - half;
      const u1 = center + half;
      const area = width * h;
      const ring: Ring = [
        fromFrame([u0, v0], origin, u),
        fromFrame([u1, v0], origin, u),
        fromFrame([u1, v1], origin, u),
        fromFrame([u0, v1], origin, u),
      ];
      return { ring, area, front: width, depth: h };
    };

    const trapAt = (h: number, off: number) => {
      const v1 = v0 + h;
      const e0 = extentAt(f, v0);
      const e1 = extentAt(f, v1);
      if (!e0 || !e1) return null;
      const a0 = e0[1] - e0[0];
      const a1 = e1[1] - e1[0];
      if (a0 < p.minBuildingFront) return null;
      const k = Math.min(1, (2 * p.minBuildingArea) / (h * (a0 + a1)));
      const w0 = a0 * k;
      const w1 = a1 * k;
      if (w0 < p.minBuildingFront || w1 < p.minBuildingFront) return null;
      const c0 = Math.min(Math.max((e0[0] + e0[1]) / 2 + off, e0[0] + w0 / 2), e0[1] - w0 / 2);
      const c1 = Math.min(Math.max((e1[0] + e1[1]) / 2 + off, e1[0] + w1 / 2), e1[1] - w1 / 2);
      const area = ((w0 + w1) / 2) * h;
      const ring: Ring = [
        fromFrame([c0 - w0 / 2, v0], origin, u),
        fromFrame([c0 + w0 / 2, v0], origin, u),
        fromFrame([c1 + w1 / 2, v1], origin, u),
        fromFrame([c1 - w1 / 2, v1], origin, u),
      ];
      const taper = Math.abs(w0 - w1) / Math.max(w0, w1);
      return { ring, area, front: w0, depth: h, taper };
    };

    // Köşe başı parseller için: bir yan kenarı zarfın (ikinci yolun yapı inşaat hattı)
    // kenarına tam yaslanan düzgün yamuk.
    const trapSideAt = (h: number, side: 0 | 1) => {
      const v1 = v0 + h;
      const e0 = extentAt(f, v0);
      const e1 = extentAt(f, v1);
      if (!e0 || !e1) return null;
      const s0 = e0[side];
      const s1 = e1[side];
      const sgn = side === 0 ? 1 : -1; // iç tarafa doğru yön
      const avail0 = sgn * (e0[1 - side] - s0);
      const avail1 = sgn * (e1[1 - side] - s1);
      if (Math.min(avail0, avail1) < p.minBuildingFront) return null;
      const k = Math.min(1, (2 * p.minBuildingArea) / (h * (avail0 + avail1)));
      const w0 = avail0 * k;
      const w1 = avail1 * k;
      if (w0 < p.minBuildingFront || w1 < p.minBuildingFront) return null;
      const fL: Pt = side === 0 ? fromFrame([s0, v0], origin, u) : fromFrame([s0 + sgn * w0, v0], origin, u);
      const fR: Pt = side === 0 ? fromFrame([s0 + sgn * w0, v0], origin, u) : fromFrame([s0, v0], origin, u);
      const bR: Pt = side === 0 ? fromFrame([s1 + sgn * w1, v1], origin, u) : fromFrame([s1, v1], origin, u);
      const bL: Pt = side === 0 ? fromFrame([s1, v1], origin, u) : fromFrame([s1 + sgn * w1, v1], origin, u);
      const ring: Ring = [fL, fR, bR, bL];
      const area = ((w0 + w1) / 2) * h;
      const taper = Math.abs(w0 - w1) / Math.max(w0, w1);
      return { ring, area, front: w0, depth: h, taper };
    };


    const clipAt = (h: number) => {
      const v1 = v0 + h;
      const clip = (poly: Pt[], keep: (q: Pt) => boolean, at: (a: Pt, b: Pt) => Pt): Pt[] => {
        const out: Pt[] = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const ka = keep(a);
          const kb = keep(b);
          if (ka) out.push(a);
          if (ka !== kb) out.push(at(a, b));
        }
        return out;
      };
      const cutV = (a: Pt, b: Pt, v: number): Pt => {
        const t = (v - a[1]) / (b[1] - a[1] || 1e-9);
        return [a[0] + (b[0] - a[0]) * t, v];
      };
      let poly = clip(f, (q) => q[1] >= v0, (a, b) => cutV(a, b, v0));
      if (poly.length < 3) return null;
      poly = clip(poly, (q) => q[1] <= v1, (a, b) => cutV(a, b, v1));
      if (poly.length < 3) return null;
      const e0 = extentAt(f, v0);
      if (!e0) return null;
      const ring: Ring = poly.map((q) => fromFrame(q, origin, u));
      return { ring, area: Math.abs(ringArea(ring)), front: e0[1] - e0[0], depth: h, taper: 0.35 };
    };

    // Zarfı [vA,vB] × [uLo,uHi] bandına kırpar (teğetlik için öne uzatmada kullanılır).
    const clipBand = (vA: number, vB: number, uLo: number, uHi: number) => {
      const clip = (poly: Pt[], keep: (q: Pt) => boolean, at: (a: Pt, b: Pt) => Pt): Pt[] => {
        const out: Pt[] = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const ka = keep(a);
          const kb = keep(b);
          if (ka) out.push(a);
          if (ka !== kb) out.push(at(a, b));
        }
        return out;
      };
      const cutV = (a: Pt, b: Pt, v: number): Pt => {
        const t = (v - a[1]) / (b[1] - a[1] || 1e-9);
        return [a[0] + (b[0] - a[0]) * t, v];
      };
      const cutU = (a: Pt, b: Pt, uu: number): Pt => {
        const t = (uu - a[0]) / (b[0] - a[0] || 1e-9);
        return [uu, a[1] + (b[1] - a[1]) * t];
      };
      let poly: Pt[] = f.slice();
      poly = clip(poly, (q) => q[1] >= vA, (a, b) => cutV(a, b, vA));
      if (poly.length < 3) return null;
      poly = clip(poly, (q) => q[1] <= vB, (a, b) => cutV(a, b, vB));
      if (poly.length < 3) return null;
      poly = clip(poly, (q) => q[0] >= uLo, (a, b) => cutU(a, b, uLo));
      if (poly.length < 3) return null;
      poly = clip(poly, (q) => q[0] <= uHi, (a, b) => cutU(a, b, uHi));
      if (poly.length < 3) return null;
      return poly;
    };

    let best: { ring: Ring; area: number; front: number; depth: number } | null = null;
    let bestMeta: { v0: number; v1: number; uLo: number; uHi: number } | null = null;
    let bestScore = -Infinity;
    let bestSlide = 0;
    // Blok, yapı inşaat hattına teğet olmalı: önce kaydırmasız (v0 = hat) denenir,
    // yalnızca hiçbir çözüm bulunamazsa minimum kadar içeri kaydırılır.
    for (let slide = 0; slide <= 3.0 + 1e-9; slide += 0.25) {
      v0 = vBase + slide;
      const maxDepth = vMax - v0;
      if (maxDepth < p.minBuildingDepth - 1e-4) break;
      for (let h = p.minBuildingDepth; h <= maxDepth + 1e-6; h += 0.25) {
        for (const off of [0, -1, 1, -2, 2, -3, 3, -50, 50]) {
          const width = p.minBuildingArea / h;
          const cand: { ring: Ring; area: number; front: number; depth: number; taper: number; irregular?: boolean }[] = [];
          const rect = quadAt(h, width, off);
          if (rect) cand.push({ ...rect, taper: 0 });
          const trap = trapAt(h, off);
          if (trap) cand.push(trap);
          if (off === 0) {
            // Burun/kırık köşelerde de düzgün yamuk üretilebilsin: yan kenara
            // yaslanan yamuk her parselde denenir (yalnız köşe başlarında değil).
            for (const side of [0, 1] as const) {
              const ts = trapSideAt(h, side);
              if (ts) cand.push(ts);
            }
            const free = clipAt(h);
            if (free) cand.push({ ...free, irregular: true });
          }

          for (const q of cand) {
            if (q.area < p.minBuildingArea - 1e-6 || q.area > maxByTaks + 1e-6) continue;
            if (q.front < p.minBuildingFront) continue;
            if (q.depth < p.minBuildingDepth - 1e-4) continue;
            if (!respectsSetback(q.ring)) continue;
            if (!cornerFrontsOk(q.ring)) continue;
            const ratio = Math.min(q.front, q.depth) / Math.max(q.front, q.depth);
            // Köşe başı parsellerde blok, ikinci yola ait yapı inşaat hattına da
            // teğet olmalı ve o kenarda da en az 6 m cephe vermelidir.
            let sideBonus = 0;
            if (corner && buildingLines.length && q.ring.length === 4) {
              const sides: [Pt, Pt][] = [
                [q.ring[1], q.ring[2]],
                [q.ring[3], q.ring[0]],
              ];
              let m = Infinity;
              for (const [a, b] of sides) {
                if (dist(a, b) < p.minBuildingFront - 1e-6) continue; // 6 m altı cephe sayılmaz
                const sm: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                for (const bl of buildingLines) {
                  if (bl.length < 2) continue;
                  m = Math.min(m, Math.max(nearestOnPolyline(sm, bl).d, nearestOnPolyline(a, bl).d * 0.5));
                }
              }
              if (m < 4) sideBonus = (4 - m) * 60;
            }
            // Dikdörtgen çok daha tercih edilir; teğetlik (kaydırmasızlık) en ağır kriterdir.
            const score =
              -Math.abs(q.area - p.minBuildingArea) * 6 +
              ratio * 12 +
              q.depth * 0.5 -
              Math.abs(off) * 0.002 -
              q.taper * (corner ? 4 : 8) -
              (q.irregular ? 60 : 0) +
              sideBonus -
              slide * 200;


            if (score > bestScore) {
              bestScore = score;
              best = { ring: q.ring, area: q.area, front: q.front, depth: q.depth };
              bestSlide = slide;
              const uc = q.ring.map((r) => toFrame(r, origin, u)[0]);
              bestMeta = {
                v0,
                v1: v0 + q.depth,
                uLo: Math.min(...uc),
                uHi: Math.max(...uc),
              };
            }
          }
        }
      }
      if (best) break;
    }

    // Teğetlik düzeltmesi: blok hattan geride kaldıysa, TAKS sınırını aşmayacak
    // şekilde ön kenarı yapı inşaat hattına kadar uzat.
    if (best && bestMeta && bestSlide > 1e-6) {
      let lo = vBase;
      let hi = bestMeta.v0;
      let fixed: { ring: Ring; area: number; front: number; depth: number } | null = null;
      for (let it = 0; it < 24; it++) {
        const vTry = (lo + hi) / 2;
        const poly = clipBand(vTry, bestMeta.v1, bestMeta.uLo, bestMeta.uHi);
        if (poly) {
          const ring: Ring = poly.map((q) => fromFrame(q, origin, u));
          const area = Math.abs(ringArea(ring));
          const e = extentAt(f, vTry);
          const front = e ? Math.min(e[1], bestMeta.uHi) - Math.max(e[0], bestMeta.uLo) : 0;
          if (area <= maxByTaks + 1e-6 && front >= p.minBuildingFront - 1e-6 && respectsSetback(ring) && cornerFrontsOk(ring)) {
            fixed = { ring, area, front, depth: bestMeta.v1 - vTry };
            hi = vTry;
          } else {
            lo = vTry;
          }
        } else {
          lo = vTry;
        }
        if (hi - lo < 0.02) break;
      }
      if (fixed) {
        best = fixed;
        bestScore += 150;
      }
    }

    return best ? { ...best, score: bestScore } : null;

  };


  let winner: { ring: Ring; area: number; front: number; depth: number } | null = null;
  let winnerScore = -Infinity;

  for (const cand of cands) {
    const r = solveFor(cand.origin, cand.u, cand.v0Min);
    if (!r) continue;
    const fa = r.ring[0];
    const fb = r.ring[1];
    const fmid: Pt = [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2];
    const flushErr = Math.abs(nearestOnPolyline(fmid, frontLine).d - p.frontSetback);
    const par = Math.abs(dot(norm(sub(fb, fa)), frontDir));
    const score = (r.score ?? 0) - flushErr * 160 + par * 80 + (corner ? 0 : 0);

    if (score > winnerScore) {
      winnerScore = score;
      winner = { ring: r.ring, area: r.area, front: r.front, depth: r.depth };
    }
  }

  if (winner) return winner;
  return { ring: null, area: 0, front: 0, depth: 0 };
}





function frontEdgeLength(ring: Ring, origin: Pt, u: Pt): number {
  const f = ring.map((q) => toFrame(q, origin, u));
  const vmin = Math.min(...f.map((q) => q[1]));
  let total = 0;
  for (let i = 0; i < f.length; i++) {
    const a = f[i];
    const b = f[(i + 1) % f.length];
    if (a[1] < vmin + 0.3 && b[1] < vmin + 0.3) total += Math.abs(a[0] - b[0]);
  }
  return total;
}

function simplifyRing(ring: Ring, tol = 0.05): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const cur = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (dist(prev, cur) < tol) continue;
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 0.002 && dot(d1, d2) > 0) continue; // doğrusal ara nokta
    out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

// -------------------- cephe tespiti --------------------

export function detectRoadFrontages(ring: Ring): Pt[][] {
  const r = ensureCCW(ring);
  const ang = principalAngle(r);
  const u: Pt = [Math.cos(ang), Math.sin(ang)];
  const f = r.map((q) => toFrame(q, r[0], u));
  const bb = bbox(f);
  const H = bb.maxY - bb.minY;
  const bandA: number[] = [];
  const bandB: number[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = f[i];
    const b = f[(i + 1) % r.length];
    const dir = norm([b[0] - a[0], b[1] - a[1]]);
    const alongU = Math.abs(dir[0]) > Math.cos((ROAD_BAND.ROAD_BAND_ANGLE_DEG * Math.PI) / 180);
    if (!alongU) continue;
    const mv = (a[1] + b[1]) / 2;
    if (mv < bb.minY + ROAD_BAND.ROAD_BAND_RATIO * H) bandA.push(i);
    else if (mv > bb.maxY - ROAD_BAND.ROAD_BAND_RATIO * H) bandB.push(i);
  }
  const chainOf = (idxs: number[]): Pt[] => {
    const pts: { u: number; p: Pt }[] = [];
    for (const i of idxs) {
      pts.push({ u: f[i][0], p: r[i] });
      pts.push({ u: f[(i + 1) % r.length][0], p: r[(i + 1) % r.length] });
    }
    pts.sort((x, y) => x.u - y.u);
    const out: Pt[] = [];
    for (const q of pts) if (!out.length || dist(out[out.length - 1], q.p) > 1e-6) out.push(q.p);
    return out;
  };
  const A = bandA.length ? chainOf(bandA) : [];
  const B = bandB.length ? chainOf(bandB) : [];
  return [A, B].filter((l) => l.length >= 2 && polylineLength(l) > ROAD_BAND.MIN_FRONTAGE_LENGTH);
}

// -------------------- ana optimizasyon --------------------

interface RowSolution {
  parcels: Parcel[];
  cuts: CutDef[];
  score: number;
  validCount: number;
  log: string[];
}

function buildRowParcels(
  rowRing: Ring,
  frontLine: Pt[],
  cuts: CutDef[],
  buildingLines: Pt[][],
  allFrontages: Pt[][],
  roadLines: Pt[][],
  p: Params,
  rowIndex: number,
): Parcel[] {
  const tangentAt = (c: CutDef): Pt => cutNormal(c);
  const parcels: Parcel[] = [];
  const n = cuts.length + 1;
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? null : cuts[i - 1];
    const b = i === n - 1 ? null : cuts[i];
    const tangent = a ? tangentAt(a) : b ? tangentAt(b) : [1, 0];
    let ring = rowRing;
    if (a) ring = clipHalfPlane(ring, a.pt, tangentAt(a));
    if (ring.length >= 3 && b) ring = clipHalfPlane(ring, b.pt, mul(tangentAt(b), -1));
    if (ring.length < 3) continue;
    ring = simplifyRing(ring);
    const area = ringArea(ring);
    const frontage = edgeLengthOnLines(ring, allFrontages);
    const envelope = buildEnvelope(ring, roadLines, p, allFrontages);
    const corner = i === 0 || i === n - 1;
    const bld = envelope.length >= 3
      ? makeBuilding(ring, envelope, frontLine, buildingLines, area, p, corner, roadLines)
      : { ring: null, area: 0, front: 0, depth: 0 };
    const depth = area / Math.max(frontage, 1e-6);
    const issues: string[] = [];
    let hard = 0;
    const fail = (m: string) => {
      hard++;
      issues.push(m);
    };
    // Parsel alanı HARD CONSTRAINT: kullanıcının girdiği min–max aralığı dışı geçersizdir.
    if (area < p.minArea)
      fail(`Parsel alanı minimum değerin altında: ${area.toFixed(1)} m² < ${p.minArea} m²`);
    if (area > p.maxArea)
      fail(`Parsel alanı maksimum değerin üzerinde: ${area.toFixed(1)} m² > ${p.maxArea} m²`);
    const minF = corner ? p.cornerFront : p.midFront;
    if (frontage < minF - 1e-6)
      fail(`${corner ? "Köşe" : "Ara"} parsel cephesi ${frontage.toFixed(2)} m < ${minF} m`);
    if (!bld.ring) {
      // Red nedenini ayrıştır: önleyici geometrik kapasite kontrolü.
      const requiredDepth = p.frontSetback + p.rearSetback + p.minBuildingDepth;
      const usableDepth = depth;
      const envArea = envelope.length >= 3 ? Math.abs(ringArea(envelope)) : 0;
      if (envelope.length < 3)
        fail(
          `Ön/yan/arka çekme (${p.frontSetback}/${p.sideSetback}/${p.rearSetback} m) nedeniyle yapı yaklaşma sınırı oluşmuyor`,
        );
      else if (usableDepth < requiredDepth - 1e-6)
        fail(
          `Yapılaşabilir minimum derinlik sağlanamıyor: kullanılabilir ${usableDepth.toFixed(2)} m < gerekli ${requiredDepth.toFixed(2)} m (ön ${p.frontSetback} + arka ${p.rearSetback} + yapı ${p.minBuildingDepth})`,
        );
      else if (envArea < p.minBuildingArea - 1e-6)
        fail(
          `Çekme mesafelerinden sonra kalan yapı alanı ${envArea.toFixed(1)} m² < ${p.minBuildingArea} m²`,
        );
      else fail("Kurallara uygun yapı bloğu oluşturulamadı");
    } else {
      if (bld.area < p.minBuildingArea) fail(`Yapı alanı ${bld.area.toFixed(1)} m² < ${p.minBuildingArea} m²`);
      if (bld.front < p.minBuildingFront) fail(`Yapı cephesi ${bld.front.toFixed(2)} m < ${p.minBuildingFront} m`);
      if (bld.depth < p.minBuildingDepth - 1e-4) fail(`Yapı derinliği ${bld.depth.toFixed(2)} m < ${p.minBuildingDepth} m`);
      if (bld.area / area > p.taks + 1e-6) fail(`TAKS ${(bld.area / area).toFixed(3)} > ${p.taks}`);
    }
    parcels.push({
      no: 0,
      row: rowIndex,
      ring,
      area,
      frontage,
      depth,
      corner,
      envelope: envelope.length >= 3 ? envelope : null,
      building: bld.ring,
      buildingArea: bld.area,
      buildingFront: bld.front,
      buildingDepth: bld.depth,
      taksValue: bld.area / area,
      valid: hard === 0,
      issues,
    });
    void tangent;
  }
  return parcels;
}

function cornerValidCount(parcels: Parcel[]): number {
  return parcels.filter((x) => x.corner && x.valid).length;
}

function areaSpread(parcels: Parcel[]): number {
  // Köşe parseller iki cepheden 5 m çekme nedeniyle farklı büyüklükte olabilir;
  // eşitlik ölçütü ara parseller üzerinden alınır.
  const mid = parcels.filter((x) => !x.corner);
  const src = mid.length >= 2 ? mid : parcels;
  if (src.length < 2) return 0;
  const areas = src.map((x) => x.area);
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
  return mean < 1e-6 ? 0 : stddev(areas) / mean; // bağıl sapma
}


function scoreSolution(parcels: Parcel[], p: Params, tolUsed: number): number {
  const valid = parcels.filter((x) => x.valid);
  const inRange = parcels.filter((x) => x.area >= p.minArea && x.area <= p.maxArea).length;
  const bldSd = stddev(valid.map((x) => x.buildingArea));
  // Maksimum alan aşımı artık HARD CONSTRAINT (parsel geçersiz olur); buradaki ceza
  // yalnızca aynı geçerli parsel sayısına sahip çözümler arasında ayrım içindir.
  const overflow = parcels.reduce((s, x) => s + Math.max(0, x.area - p.maxArea), 0);
  const W = SOLUTION_SCORE_WEIGHTS;
  return (
    cornerValidCount(parcels) * W.CORNER_VALID +
    valid.length * W.VALID_PARCEL +
    parcels.filter((x) => x.building).length * W.HAS_BUILDING +
    inRange * W.AREA_IN_RANGE -
    overflow * W.AREA_OVERFLOW_PENALTY -
    // Parsel yüzölçümleri mümkün olduğunca eşit olsun.
    areaSpread(parcels) * W.AREA_SPREAD_PENALTY -
    bldSd * W.BUILDING_AREA_SD_PENALTY -
    tolUsed * W.TOLERANCE_USED_PENALTY
  );
}


function solveRow(
  rowRing: Ring,
  frontLine: Pt[],
  buildingLines: Pt[][],
  allFrontages: Pt[][],
  roadLines: Pt[][],
  p: Params,
  rowIndex: number,
  tune = true,
): { best: RowSolution | null; log: string[] } {
  const area = ringArea(rowRing);
  // Parsel sayısı yalnızca min alana göre değil, yapılaşma şartlarının gerektirdiği
  // asgari cephe genişliğine göre de sınırlanır (köşelerde iki yönden 5 m çekme var).
  const frontLen = polylineLength(frontLine);
  const minWidthMid = Math.max(p.midFront, p.minBuildingFront + 2 * p.sideSetback);
  const minWidthCorner = Math.max(p.cornerFront, p.minBuildingFront + 2 * p.frontSetback);
  // Kapasite, cephe hattı boyunca kesme aralıklarına göre hesaplanır. Köşe parselleri
  // genelde ikinci yola da cephelidir ve gerçek cepheleri bu hattaki aralıktan büyüktür;
  // bu nedenle köşe payı hattın tamamından değil yalnızca bir kez düşülür ve nihai
  // uygunluk kararı yapılaşma denetimine bırakılır.
  const capByMid = Math.floor(frontLen / minWidthMid);
  const capWithCorners = Math.floor((frontLen - minWidthCorner) / minWidthMid) + 1;
  const widthCapacity = Math.max(1, capByMid, capWithCorners);
  const nMin = Math.max(1, Math.floor(area / p.maxArea) - 1);
  const nMax = Math.max(nMin, Math.min(Math.ceil(area / p.minArea) + 3, Math.max(1, widthCapacity)));


  const log: string[] = [];
  let best: RowSolution | null = null;
  for (let n = nMax; n >= nMin; n--) {
    let sol: RowSolution | null = null;
    const evaluate = (wA: number, wB: number): RowSolution => {
      const chain = equalAreaChainages(rowRing, frontLine, n, wA, wB);
      const cuts: CutDef[] = chain.map((s) => {
        const { pt, dir } = atChainage(frontLine, s);
        return { pt, dir: perp(dir), tangent: dir, s, paired: false };
      });
      const parcels = buildRowParcels(rowRing, frontLine, cuts, buildingLines, allFrontages, roadLines, p, rowIndex);
      const validCount = parcels.filter((x) => x.valid).length;
      return { parcels, cuts, score: scoreSolution(parcels, p, 0), validCount, log: [] };
    };
    // Öncelik sırası: köşe parsellerin yapılaşma şartı → toplam geçerli parsel
    // → parsel alanlarının eşitliği (skor içinde ağırlıklı) .
    // Öncelik: TOPLAM GEÇERLİ PARSEL SAYISI → köşe parsellerin uygunluğu → skor.
    // (Geçersiz alanlı/yapılaşamayan parseller "geçerli" sayılmadığı için büyük parsel
    // üretip başarısızlığı gizleyen çözümler bu sıralamada öne geçemez.)
    const better = (a: RowSolution, b: RowSolution | null) => {
      if (!b) return true;
      if (a.validCount !== b.validCount) return a.validCount > b.validCount;
      const ca = cornerValidCount(a.parcels);
      const cb = cornerValidCount(b.parcels);
      if (ca !== cb) return ca > cb;
      return a.score > b.score;
    };
    const cornersOk = (s: RowSolution) =>
      cornerValidCount(s.parcels) === s.parcels.filter((x) => x.corner).length;

    sol = evaluate(1, 1);
    if (tune && n > 1) {
      // Köşe parseli, iki cepheden 5 m çekme ile üretilen asgari yapı bloğunu
      // barındıracak EN KÜÇÜK büyüklüğe getirilir; kalan alan ara parsellere eşit dağılır.
      // Köşe ağırlığı 1'in altından başlar: çekme mesafeleri (2×5 m) tam olarak
      // kullanılıp yapı şartını sağlayan EN KÜÇÜK köşe parseli seçilir; böylece
      // kalan cephede daha fazla ara parsel üretilebilir.
      const grid = Array.from({ length: 33 }, (_, i) => 0.4 + i * 0.05); // 0.40 → 2.00


      const cornerOkAt = (i: 0 | 1, s: RowSolution) => {
        const ps = s.parcels;
        const c = i === 0 ? ps[0] : ps[ps.length - 1];
        return !!c && c.valid;
      };

      // 1. AŞAMA: her köşe için yapı şartını sağlayan en küçük ağırlık.
      let wA = 1;
      let wB = 1;
      let stage1: RowSolution = sol;
      for (const g of grid) {
        const c = evaluate(g, wB);
        if (cornerOkAt(0, c)) {
          stage1 = c;
          wA = g;
          break;
        }
        if (better(c, stage1)) stage1 = c;
      }
      // İnce ayar: geçerliliği bozmadan köşeyi biraz daha küçült.
      for (let k = 1; k <= 4; k++) {
        const g = wA - k * 0.0125;
        if (g < 0.3) break;
        const c = evaluate(g, wB);
        if (!cornerOkAt(0, c)) break;
        wA = g;
        stage1 = c;
      }
      for (const g of grid) {
        const c = evaluate(wA, g);
        if (cornerOkAt(1, c)) {
          stage1 = c;
          wB = g;
          break;
        }
        if (better(c, stage1)) stage1 = c;
      }
      for (let k = 1; k <= 4; k++) {
        const g = wB - k * 0.0125;
        if (g < 0.3) break;
        const c = evaluate(wA, g);
        if (!cornerOkAt(1, c)) break;
        wB = g;
        stage1 = c;
      }

      const finalStage1 = evaluate(wA, wB);
      if (better(finalStage1, stage1)) stage1 = finalStage1;
      if (better(stage1, sol)) sol = stage1;


      // 2. AŞAMA: köşeler sabitlendikten sonra ara parseller dengelenir.
      const starts: [number, number][] = [
        [wA, wB],
        [1, 1],
        [1.1, 1.1],
        [1.2, 1.2],
      ];

      for (const [sA, sB] of starts) {
        if (cornersOk(sol) && sol.validCount === n && sol.parcels.length === n) break;
        let a = sA;
        let b = sB;
        let local = evaluate(a, b);
        if (better(local, sol)) sol = local;
        for (let round = 0; round < 2; round++) {
          for (const g of grid) {
            const c = evaluate(g, b);
            if (better(c, local)) {
              local = c;
              a = g;
            }
          }
          for (const g of grid) {
            const c = evaluate(a, g);
            if (better(c, local)) {
              local = c;
              b = g;
            }
          }
          if (cornersOk(local) && local.validCount === n && local.parcels.length === n) break;
        }
        if (better(local, sol)) sol = local;
      }
    }
    const parcels = sol.parcels;
    const validCount = sol.validCount;

    if (validCount === parcels.length && parcels.length === n) {
      log.push(`Sıra ${rowIndex + 1}: ${n} parsel denendi → tüm parseller geçerli.`);
      best = sol;
      break;
    }
    const failing = parcels.find((x) => !x.valid);
    log.push(
      `Sıra ${rowIndex + 1}: ${n} parsel denendi → ${validCount}/${parcels.length} geçerli` +
        ` (köşe ${cornerValidCount(parcels)}/${parcels.filter((x) => x.corner).length})` +
        (failing ? ` (örn. ${failing.issues.find((s) => !s.startsWith("ℹ")) ?? failing.issues[0]})` : "") + ".",
    );
    if (better(sol, best)) best = sol;
  }
  return { best, log };
}

/** Kesme çizgisinin, sıranın arka (orta hat) kenarındaki uç noktası. */
function rearPointOfCut(rowRing: Ring, front: Pt[], c: CutDef): Pt | null {
  let best: Pt | null = null;
  let bestD = -Infinity;
  const n = rowRing.length;
  for (let i = 0; i < n; i++) {
    const a = rowRing[i];
    const b = rowRing[(i + 1) % n];
    const e = sub(b, a);
    const den = c.dir[0] * e[1] - c.dir[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const diff = sub(a, c.pt);
    const u = (diff[0] * c.dir[1] - diff[1] * c.dir[0]) / den;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const t = (diff[0] * e[1] - diff[1] * e[0]) / den;
    const q: Pt = add(c.pt, mul(c.dir, t));
    const d = nearestOnPolyline(q, front).d;
    if (d > bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}


export function optimizeBlock(
  ring0: Ring,
  buildingLines: Pt[][],
  p: Params,
  opts: { name: string; id: string; manualFrontages?: Pt[][]; variant?: number },
): BlockResult {
  const ring = ensureCCW(simplifyRing(ring0));
  const log: string[] = [];
  const frontages = opts.manualFrontages?.length ? opts.manualFrontages : detectRoadFrontages(ring);
  log.push(`${frontages.length} yol cephesi belirlendi.`);

  // Ada sınırlarının tamamı yola cephelidir: her ada kenarından frontSetback kadar ön çekme uygulanır.
  const roadLines: Pt[][] = [[...ring, ring[0]]];

  const blockMp: MultiPoly = [[ring]];
  let rows: { ring: Ring; front: Pt[] }[] = [];
  let solutions: (RowSolution | null)[] = [];
  // Adayı ikiye bölen hattın kırık köşe noktaları (varsa)
  let splitMid: Pt[] = [];


  /**
   * Ada bölüm (orta) hattı: eğri yerine 2-3 kırıklı düzgün bir polyline.
   * `ws` kontrol noktası ağırlıkları (uzunluk 2 → tek doğru, 3 → 1 kırık, 4 → 2 kırık).
   */
  const splitAt = (ws: number[]) => {
    const [A, B] = frontages;
    const L = polylineLength(A);
    const k = ws.length - 1;
    const mid: Pt[] = [];
    for (let i = 0; i <= k; i++) {
      const a = atChainage(A, (L * i) / k).pt;
      const b = nearestOnPolyline(a, B).pt;
      const w = ws[i];
      mid.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
    }
    const maskA = sideMaskToward(mid, A[Math.floor(A.length / 2)]);
    const ra = largestPoly(mpIntersect(blockMp, [maskA]));
    const rb = largestPoly(mpDifference(blockMp, [maskA]));
    const rws: { ring: Ring; front: Pt[] }[] = [];
    if (ra) rws.push({ ring: ensureCCW(ra[0]), front: A });
    if (rb) rws.push({ ring: ensureCCW(rb[0]), front: B });
    return { rows: rws, mid };
  };


  // Bir parsel sırasının teknik olarak mümkün olması için gereken en küçük derinlik.
  const minRowDepth = p.frontSetback + p.minBuildingDepth + p.rearSetback;

  if (frontages.length >= 2) {
    // 1) Sıra derinliği (orta hat konumu) hızlı taranır.
    type Cand = {
      rows: typeof rows;
      mid: Pt[];
      sols: (RowSolution | null)[];
      valid: number;
      score: number;
      log: string[];
    };
    const evaluate = (ws: number[], tune: boolean): Cand | null => {
      const { rows: rws, mid } = splitAt(ws);
      if (rws.length < 2) return null;
      // Ada ancak koşullar sağlanırsa ikiye bölünür: her iki sıra da min derinlik ve
      // min parsel alanını taşıyabilecek büyüklükte olmalı.
      for (const r of rws) {
        const len = polylineLength(r.front) || 1;
        const area = ringArea(r.ring);
        if (area / len < minRowDepth) return null;
        if (area < p.minArea) return null;
      }
      const localLog: string[] = [];
      const sols = rws.map((r, i) => {
        const res = solveRow(r.ring, r.front, buildingLines, frontages, roadLines, p, i, tune);
        localLog.push(...res.log);
        return res.best;
      });
      // Ada mümkün mertebe ortadan ikiye bölünsün: orta hattın 0.5'ten sapması cezalandırılır.
      const centerDev = ws.reduce((a, w) => a + Math.abs(w - 0.5), 0) / ws.length;
      return {
        rows: rws,
        mid,
        sols,
        valid: sols.reduce((a, s) => a + (s?.validCount ?? 0), 0),
        score: sols.reduce((a, s) => a + (s?.score ?? 0), 0) - centerDev * 8000,
        log: localLog,
      };
    };

    const better = (a: Cand | null, b: Cand | null) =>
      !a ? b : !b ? a : b.valid > a.valid || (b.valid === a.valid && b.score > a.score) ? b : a;


    const straight: { ws: number[]; c: Cand }[] = [];
    // Orta hat önce tam ortadan (0.5) denenir, gerekirse simetrik olarak uzaklaşılır.
    for (let w = 0.5; w >= 0.2999; w -= 0.02) {
      const c = evaluate([w, w], false);
      if (c) straight.push({ ws: [w, w], c });
    }
    for (let w = 0.52; w <= 0.7001; w += 0.02) {
      const c = evaluate([w, w], false);
      if (c) straight.push({ ws: [w, w], c });
    }
    straight.sort((x, y) => y.c.valid - x.c.valid || y.c.score - x.c.score);

    // 2) En iyi düz hat adaylarından yola çıkarak 1-2 kırıklı (3-4 kontrol noktalı)
    //    bölüm hattı denenir; kırık noktaları küçük adımlarla kaydırılır.
    const kinked: { ws: number[]; c: Cand }[] = [];
    for (const s of straight.slice(0, 3)) {
      for (const segs of [2, 3]) {
        let ws = new Array(segs + 1).fill(s.ws[0]) as number[];
        let cur = evaluate(ws, false);
        if (!cur) continue;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i <= segs; i++) {
            for (const d of [0.06, -0.06, 0.03, -0.03]) {
              const cand = ws.slice();
              cand[i] = Math.min(0.68, Math.max(0.32, cand[i] + d));
              // Kırıklar düzgün kalsın: komşu ağırlık farkı sınırlı.
              if (cand.some((v, j) => j > 0 && Math.abs(v - cand[j - 1]) > 0.12)) continue;
              const c = evaluate(cand, false);
              if (c && better(cur, c) === c) {
                cur = c;
                ws = cand;
              }
            }
          }
        }
        kinked.push({ ws, c: cur });
      }
    }

    const pool = [...straight.slice(0, 3), ...kinked];
    pool.sort((x, y) => y.c.valid - x.c.valid || y.c.score - x.c.score);

    // 3) En umutlu hatlarda köşe parsel genişlikleri ince ayarlanır.
    //    Alternatif çözümler için aynı geçerli parsel sayısına sahip adaylar arasında gezinilir.
    const finals: Cand[] = [];
    for (const s of pool.slice(0, 4)) {
      const tuned = evaluate(s.ws, true);
      const b = better(s.c, tuned);
      if (b) finals.push(b);
    }
    finals.sort((x, y) => y.valid - x.valid || y.score - x.score);
    const topValid = finals[0]?.valid ?? 0;
    const equals = finals.filter((c) => c.valid === topValid);
    const variant = opts.variant ?? 0;
    let best: Cand | null = equals.length ? equals[variant % equals.length] : null;
    if (variant > 0 && equals.length === 1) best = finals[variant % finals.length] ?? best;

    // 4) Bölünmemiş (tek sıra) alternatif: ada ikiye bölünemiyorsa ya da bölmek
    //    daha az geçerli parsel üretiyorsa ada bütün olarak parsellenir.
    let single: Cand | null = null;
    for (const f of frontages) {
      const res = solveRow(ring, f, buildingLines, frontages, roadLines, p, 0, true);
      const c: Cand = {
        rows: [{ ring, front: f }],
        mid: [],
        sols: [res.best],
        valid: res.best?.validCount ?? 0,
        score: res.best?.score ?? 0,
        log: res.log,
      };
      single = better(single, c);
    }
    const useSingle = !best || (single && single.valid > best.valid);

    if (useSingle && single) {
      rows = single.rows;
      solutions = single.sols;
      log.push(
        best
          ? "Ada ikiye bölünmedi: bölünmemiş tek sıra düzeni daha fazla geçerli parsel üretiyor."
          : "Ada derinliği/min parsel koşulları ikiye bölmeye yetmiyor; tek sıra parselasyon uygulandı.",
      );
      log.push(...single.log);
    } else if (best) {
      rows = best.rows;
      solutions = best.sols;
      splitMid = best.mid;
      log.push("Karşılıklı iki yol cephesine göre sırt sırta iki parsel sırası oluşturuldu.");
      log.push(
        `Ada'nın her kenarı yola cepheli kabul edildi; yol cephelerinden ${p.frontSetback} m, yan sınırlardan ${p.sideSetback} m, arka sınırlardan ${p.rearSetback} m yapı yaklaşma mesafesi uygulandı.`,
      );
      log.push("Sıra derinliği ve köşe parsel genişlikleri, geçerli parsel sayısı en yüksek olacak şekilde optimize edildi.");
      log.push(...best.log);
    }



  } else if (frontages.length === 1) {
    rows = [{ ring, front: frontages[0] }];
    const res = solveRow(ring, frontages[0], buildingLines, frontages, roadLines, p, 0);
    solutions = [res.best];
    log.push("Tek yol cephesi bulundu, tek sıra parselasyon uygulandı.");
    log.push(...res.log);
  } else {
    return {
      id: opts.id,
      name: opts.name,
      ring,
      frontages: [],
      parcels: [],
      leftover: blockMp,
      leftoverArea: ringArea(ring),
      toleranceUsed: 0,
      log: ["Ada üzerinde yol cephesi belirlenemedi. Cepheleri manuel seçin."],
    };
  }


  // Sırt sırta sıralarda, orta hatta yakın karşılıklı köşeler 1 m toleransla tek noktaya indirgenir.
  let toleranceUsed = 0;
  if (solutions.length === 2 && solutions[0] && solutions[1]) {
    const [sa, sb] = solutions as [RowSolution, RowSolution];
    const origA = sa.cuts.map((c) => ({ ...c }));
    const origB = sb.cuts.map((c) => ({ ...c }));
    const rearA = origA.map((c) => rearPointOfCut(rows[0].ring, rows[0].front, c));
    const rearB = origB.map((c) => rearPointOfCut(rows[1].ring, rows[1].front, c));

    const usedB = new Set<number>();
    const pairs: { ia: number; ib: number; shared: Pt; da: number; db: number }[] = [];
    rearA.forEach((pa, ia) => {
      if (!pa) return;
      let bi = -1;
      let bd = Infinity;
      rearB.forEach((pb, ib) => {
        if (!pb || usedB.has(ib)) return;
        const d = dist(pa, pb);
        if (d < bd) {
          bd = d;
          bi = ib;
        }
      });
      if (bi >= 0 && bd <= p.tolerance) {
        usedB.add(bi);
        const pb = rearB[bi]!;
        pairs.push({ ia, ib: bi, shared: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], da: 0, db: 0 });
      }
    });

    if (pairs.length) {
      const buildWith = () => {
        const cuts: CutDef[][] = [origA.map((c) => ({ ...c })), origB.map((c) => ({ ...c }))];
        for (const pr of pairs) {
          const setCut = (row: 0 | 1, idx: number, delta: number) => {
            const c = cuts[row][idx];
            const line = rows[row].front;
            const L = polylineLength(line);
            const s = Math.min(Math.max(c.s + delta, 0.5), L - 0.5);
            const pt = atChainage(line, s).pt;
            c.s = s;
            c.pt = pt;
            // Yola dik gelme şartı, ortak köşe noktası için istisna kabul edilir.
            c.dir = norm(sub(pr.shared, pt));
            c.paired = true;
          };
          setCut(0, pr.ia, pr.da);
          setCut(1, pr.ib, pr.db);
        }
        const rowsOut = [0, 1].map((i) =>
          buildRowParcels(rows[i].ring, rows[i].front, cuts[i], buildingLines, frontages, roadLines, p, i),
        );
        const valid = rowsOut.reduce((a, ps) => a + ps.filter((x) => x.valid).length, 0);
        const score = rowsOut.reduce((a, ps) => a + scoreSolution(ps, p, pairs.length), 0);
        return { cuts, rowsOut, valid, score };
      };

      let cur = buildWith();
      // Alan dengesi için, ortak noktaya bağlanan iki parselden birinin yol tarafındaki
      // noktası kaydırılarak en dengeli çözüm aranır.
      const deltas = [-1.5, -1, -0.5, -0.25, 0.25, 0.5, 1, 1.5];
      for (const pr of pairs) {
        for (const side of ["da", "db"] as const) {
          let bestDelta = 0;
          for (const d of deltas) {
            const prev = pr[side];
            pr[side] = prev + d;
            const trial = buildWith();
            if (trial.valid > cur.valid || (trial.valid === cur.valid && trial.score > cur.score)) {
              cur = trial;
              bestDelta = pr[side];
            }
            pr[side] = prev;
          }
          pr[side] = bestDelta || pr[side];
        }
      }

      const before = solutions.reduce((a, s) => a + (s?.validCount ?? 0), 0);
      if (cur.valid >= before) {
        toleranceUsed = pairs.length;
        [0, 1].forEach((i) => {
          solutions[i]!.parcels = cur.rowsOut[i];
          solutions[i]!.cuts = cur.cuts[i];
          solutions[i]!.validCount = cur.rowsOut[i].filter((x) => x.valid).length;
        });
        log.push(
          `${pairs.length} adet sırt sırta parsel köşesi ${p.tolerance.toFixed(2)} m tolerans içinde tek ortak noktada birleştirildi; alan dengesi için yol tarafındaki noktalar kaydırıldı (hatların yola dik gelme şartı bu noktalarda istisna).`,
        );
      } else {
        log.push("Ortak köşe birleştirmesi denendi ancak geçerlilik düştüğü için uygulanmadı.");
      }
    }
  }


  const parcels: Parcel[] = [];
  solutions.forEach((s) => s && parcels.push(...s.parcels));

  // Numaralandırma: kuzeybatı köşedeki parselden başlayıp saat ibresi yönünde
  {
    const cen = (r: Pt[]): Pt => {
      let x = 0;
      let y = 0;
      for (const p of r) {
        x += p[0];
        y += p[1];
      }
      return [x / (r.length || 1), y / (r.length || 1)];
    };
    // Ada sınırını saat ibresi yönünde sırala (y yukarı olduğu için negatif alan = saat yönü)
    let cw = ring.slice();
    if (cw.length > 1 && cw[0][0] === cw[cw.length - 1][0] && cw[0][1] === cw[cw.length - 1][1]) cw.pop();
    let a2 = 0;
    for (let i = 0; i < cw.length; i++) {
      const p = cw[i];
      const q = cw[(i + 1) % cw.length];
      a2 += p[0] * q[1] - q[0] * p[1];
    }
    if (a2 > 0) cw.reverse(); // pozitif alan = saat yönünün tersi → çevir

    // Kuzeybatı köşesine en yakın tepe noktasından başla
    let minX = Infinity;
    let maxY = -Infinity;
    for (const p of cw) {
      if (p[0] < minX) minX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    let startIdx = 0;
    let bestD = Infinity;
    cw.forEach((p, i) => {
      const d = (p[0] - minX) ** 2 + (p[1] - maxY) ** 2;
      if (d < bestD) {
        bestD = d;
        startIdx = i;
      }
    });
    cw = cw.slice(startIdx).concat(cw.slice(0, startIdx));

    // Her kenarın başlangıç yay uzunluğu
    const cum: number[] = [0];
    for (let i = 0; i < cw.length; i++) {
      const p = cw[i];
      const q = cw[(i + 1) % cw.length];
      cum.push(cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
    const total = cum[cw.length] || 1;

    // Parsel merkezini ada sınırına izdüşür → çevre boyunca konum (s)
    const sOf = (pt: Pt) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < cw.length; i++) {
        const p = cw[i];
        const q = cw[(i + 1) % cw.length];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const len2 = dx * dx + dy * dy || 1e-9;
        let t = ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const fx = p[0] + dx * t;
        const fy = p[1] + dy * t;
        const d = (pt[0] - fx) ** 2 + (pt[1] - fy) ** 2;
        if (d < bd) {
          bd = d;
          best = cum[i] + Math.sqrt(len2) * t;
        }
      }
      return { s: best, d: Math.sqrt(bd) };
    };

    const meta = new Map<Parcel, { s: number; d: number }>();
    for (const p of parcels) {
      const m = sOf(cen(p.ring));
      meta.set(p, m);
    }
    parcels.sort((a, b) => {
      const ma = meta.get(a)!;
      const mb = meta.get(b)!;
      if (Math.abs(ma.s - mb.s) > 0.5) return ma.s - mb.s;
      return ma.d - mb.d;
    });
    void total;

    // Sıralamayı, kuzeybatıya en yakın KÖŞE BAŞI parselden başlayacak şekilde döndür
    const corners = parcels.filter((p) => p.corner);
    if (corners.length) {
      let first = corners[0];
      let bd = Infinity;
      for (const p of corners) {
        const pc = cen(p.ring);
        const d = (pc[0] - minX) ** 2 + (pc[1] - maxY) ** 2;
        if (d < bd) {
          bd = d;
          first = p;
        }
      }
      const idx = parcels.indexOf(first);
      if (idx > 0) {
        const rotated = parcels.slice(idx).concat(parcels.slice(0, idx));
        parcels.length = 0;
        parcels.push(...rotated);
      }
    }
  }

  parcels.forEach((x, i) => (x.no = i + 1));



  let union: MultiPoly = [];
  for (const pc of parcels) union = mpUnion(union, [[pc.ring]]);
  const leftover = mpDifference(blockMp, union).filter((poly) => Math.abs(mpArea([poly])) > 0.5);
  const leftoverArea = mpArea(leftover);

  const validCount = parcels.filter((x) => x.valid).length;
  log.push(
    `Toplam ${parcels.length} parsel üretildi; ${validCount} parsel tüm parselasyon ve yapılaşma şartlarını sağlıyor.`,
  );
  if (leftoverArea > 1) log.push(`Çözülemeyen artık alan: ${leftoverArea.toFixed(1)} m².`);

  return {
    id: opts.id,
    name: opts.name,
    ring,
    frontages,
    parcels,
    leftover,
    leftoverArea,
    toleranceUsed,
    log,
  };
}

/** Bir polyline'ın, verilen referans noktasını içeren tarafını kaplayan maske. */
function sideMaskToward(line: Pt[], toward: Pt): Poly {
  const far = 1e4;
  const pts = [...line];
  const d0 = norm(sub(pts[1], pts[0]));
  const dn = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
  pts.unshift(add(pts[0], mul(d0, -far)));
  pts.push(add(pts[pts.length - 1], mul(dn, far)));
  const mid = pts[Math.floor(pts.length / 2)];
  const tangent = norm(sub(pts[Math.floor(pts.length / 2) + 1] ?? pts[pts.length - 1], mid));
  const n = perp(tangent);
  const sign = dot(sub(toward, mid), n) >= 0 ? 1 : -1;
  const outward: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const nn = mul(norm(perp(norm(sub(b, a)))), sign * far);
    outward.push(add(pts[i], nn));
  }
  return [[...pts, ...outward]];
}

export function summarize(blocks: BlockResult[]) {
  const parcels = blocks.flatMap((b) => b.parcels);
  const valid = parcels.filter((x) => x.valid);
  const areas = parcels.map((x) => x.area);
  const bAreas = parcels.filter((x) => x.building).map((x) => x.buildingArea);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  return {
    blocks: blocks.length,
    parcels: parcels.length,
    valid: valid.length,
    leftover: blocks.reduce((a, b) => a + b.leftoverArea, 0),
    avgArea: avg(areas),
    minArea: areas.length ? Math.min(...areas) : 0,
    maxArea: areas.length ? Math.max(...areas) : 0,
    avgBuilding: avg(bAreas),
    minBuilding: bAreas.length ? Math.min(...bAreas) : 0,
    maxBuilding: bAreas.length ? Math.max(...bAreas) : 0,
    buildings: bAreas.length,
  };
}

export const _internals = { len, mul, sub, add, dot, dist, pieceBetween };
