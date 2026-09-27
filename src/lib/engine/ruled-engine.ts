// Genel parselasyon motoru (5 aşama):
//  1) Ada analizi  2) Sıra bölme  3) Sıra ifrazı  4) Kısıt çözümü  5) Denetim
//
// Temel fikir: her parsel sırası bir ÖN hat (yol cephesi) ile bir ARKA hat
// (ada orta hattı ya da karşı cephe) arasında kalan şerittir. Her ifraz hattı,
// ön hat üzerindeki sf chainage'i ile arka hat üzerindeki sr chainage'ini
// birleştiren düz bir doğrudur. Böylece içbükey/dışbükey (eğri) cephelerde
// kesimler birbirine yaklaşıp iğne şerit üretmez; sırt sırta köşe birleşimi
// sr'nin iki sırada ortaklaştırılmasıyla, alan dengesi ise yalnız sf (yol
// köşesi) kaydırılarak yapılır.
import {
  add,
  atChainage,
  dist,
  dot,
  ensureCCW,
  largestPoly,
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
  ringArea,
  sub,
  type MultiPoly,
  type Poly,
  type Pt,
  type Ring,
} from "../geo";
import type { BlockResult, Params, Parcel } from "../parcelation";

export interface EngineHelpers {
  evaluateParcel: (
    ring: Ring,
    frontLine: Pt[],
    buildingLines: Pt[][],
    allFrontages: Pt[][],
    roadLines: Pt[][],
    p: Params,
    corner: boolean,
    rowIndex: number,
  ) => Parcel | null;
  detectRoadFrontages: (ring: Ring) => Pt[][];
  roadChains: (ring: Ring) => Pt[][];
  simplifyRing: (ring: Ring, tol?: number) => Ring;
  extendLineToRing: (line: Pt[], ring: Ring) => Pt[];
  sideMaskToward: (line: Pt[], toward: Pt) => Poly;
}

interface Row {
  ring: Ring;
  front: Pt[];
  rear: Pt[];
  Lf: number;
  Lr: number;
  outF: number; // ön hattın normalinin sıra DIŞINI gösteren işareti
  outR: number;
  area: number;
  index: number;
  evalFront: Pt[]; // yapı yönlendirmesi için tespit edilen ana yol cephesi
  map: number[]; // ön hat chainage ızgarası -> arka hat chainage (monoton)
  refParam: number; // ön hattın başlangıcına yakın referans noktası (halka konumu)
}

interface Cut {
  sf: number;
  sr: number;
}

interface RowSol {
  row: Row;
  cuts: Cut[];
  targets: number[]; // kümülatif alan hedefleri
  parcels: Parcel[];
  valid: number;
  spread: number;
}

const openRing = (r: Pt[]): Ring => {
  const o = r.slice();
  while (o.length > 1 && dist(o[0], o[o.length - 1]) < 1e-9) o.pop();
  return o as Ring;
};

/** Tekrar eden, doğrusal ve geri dönen (sivri uç) noktaları temizler. */
/** Düğüm eklemeden sonra: yalnız tekrar eden ve sivri uç noktaları kaldırır (doğrusal düğümler korunur). */
function cleanRingKeep(r0: Pt[]): Ring {
  let o = openRing(r0);
  for (let it = 0; it < 200 && o.length > 3; it++) {
    const n = o.length;
    let idx = -1;
    for (let k = 0; k < n; k++) {
      const a = o[(k - 1 + n) % n], v = o[k], b = o[(k + 1) % n];
      if (dist(a, v) < 1e-6 || dist(a, b) < 1e-6) { idx = k; break; }
    }
    if (idx < 0) break;
    o.splice(idx, 1);
  }
  return o;
}

export function cleanRing(r0: Pt[]): Ring {
  let o = openRing(r0);
  for (let it = 0; it < 200 && o.length > 3; it++) {
    const n = o.length;
    let idx = -1;
    for (let k = 0; k < n; k++) {
      const a = o[(k - 1 + n) % n], v = o[k], b = o[(k + 1) % n];
      if (dist(a, v) < 1e-4) { idx = k; break; }
      const cr = Math.abs((v[0] - a[0]) * (b[1] - a[1]) - (v[1] - a[1]) * (b[0] - a[0]));
      if (cr / Math.max(dist(a, b), 1e-9) < 1e-3) { idx = k; break; }
    }
    if (idx < 0) break;
    o.splice(idx, 1);
  }
  return o;
}

function chainageOn(line: Pt[], pt: Pt): number {
  const nb = nearestOnPolyline(pt, line);
  let acc = 0;
  for (let i = 0; i < nb.seg; i++) acc += dist(line[i], line[i + 1]);
  return acc + dist(line[nb.seg], line[nb.seg + 1] ?? line[nb.seg]) * nb.t;
}

/** Sıra halkasının orta hat DIŞINDA kalan (yola bakan) sınırı; başlangıcı orta hattın başına yakın. */
function rowFrontChain(rr: Ring, mid: Pt[]): Pt[] | null {
  const n = rr.length;
  const onMid = rr.map((a, i) => {
    const b = rr[(i + 1) % n];
    return nearestOnPolyline([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], mid).d < 1e-3;
  });
  if (!onMid.some(Boolean) || onMid.every(Boolean)) return null;
  // En uzun "orta hat dışı" kenar zinciri.
  let best: Pt[] = [];
  for (let st = 0; st < n; st++) {
    if (onMid[st] || !onMid[(st - 1 + n) % n]) continue;
    const ch: Pt[] = [rr[st]];
    let i = st;
    while (!onMid[i]) {
      ch.push(rr[(i + 1) % n]);
      i = (i + 1) % n;
      if (i === st) break;
    }
    if (polylineLength(ch) > polylineLength(best)) best = ch;
  }
  if (best.length < 2) return null;
  if (dist(best[0], mid[0]) > dist(best[best.length - 1], mid[0])) best.reverse();
  return best;
}

function subLine(line: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [atChainage(line, s0).pt];
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const l = dist(line[i], line[i + 1]);
    const sEnd = acc + l;
    if (sEnd > s0 + 1e-9 && sEnd < s1 - 1e-9) out.push(line[i + 1]);
    acc = sEnd;
  }
  out.push(atChainage(line, s1).pt);
  return out;
}

function offsetPts(line: Pt[], d: number): Pt[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const n = norm(perp(norm(sub(b, a))));
    return add(p, mul(n, d));
  });
}

function outwardSign(line: Pt[], ring: Ring): number {
  const L = polylineLength(line);
  const { pt, dir } = atChainage(line, L / 2);
  const n = norm(perp(dir));
  return pointInRing(add(pt, mul(n, 0.5)), ring) ? -1 : 1;
}

/** Noktanın halka üzerindeki konumu (kenar indeksi + kenar içi oran). */
function ringParam(ring: Ring, pt: Pt): number {
  let best = Infinity;
  let pos = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const ab = sub(b, a);
    const L2 = dot(ab, ab) || 1e-12;
    const t = Math.max(0, Math.min(1, dot(sub(pt, a), ab) / L2));
    const d = dist(pt, add(a, mul(ab, t)));
    if (d < best - 1e-12) {
      best = d;
      pos = i + t;
    }
  }
  return pos;
}

const ptAtParam = (ring: Ring, u: number): Pt => {
  const n = ring.length;
  const i = Math.floor(u) % n;
  const t = u - Math.floor(u);
  const a = ring[i];
  const b = ring[(i + 1) % n];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

/** Halka üzerinde u0'dan u1'e ileri yönde yürüyen yol. */
function ringPath(ring: Ring, u0: number, u1: number): Pt[] {
  const n = ring.length;
  let end = u1;
  while (end < u0) end += n;
  const out: Pt[] = [ptAtParam(ring, u0)];
  for (let k = Math.floor(u0) + 1; k <= end; k++) if (k > u0 + 1e-9 && k < end - 1e-9) out.push(ring[k % n]);
  out.push(ptAtParam(ring, end % n));
  return out;
}

const within = (u: number, a: number, b: number, n: number) => {
  // u, a'dan b'ye ileri yolda mı?
  const norm1 = (x: number) => ((x % n) + n) % n;
  const du = norm1(u - a);
  const db = norm1(b - a);
  return du <= db;
};

/** Kesimin başlangıç tarafında kalan sıra parçası (halka yolu + kesim doğrusu). */
function beforeRing(row: Row, c: Cut): Ring | null {
  const sf = Math.max(0, Math.min(row.Lf, c.sf));
  const sr = Math.max(0, Math.min(row.Lr, c.sr));
  const r = row.ring;
  const n = r.length;
  const uf = ringParam(r, atChainage(row.front, sf).pt);
  const ur = ringParam(r, atChainage(row.rear, sr).pt);
  const ref = row.refParam;
  const path = within(ref, uf, ur, n) ? ringPath(r, uf, ur) : ringPath(r, ur, uf);
  return path.length >= 3 ? (path as Ring) : null;
}

function areaBefore(row: Row, c: Cut): number {
  const b = beforeRing(row, c);
  return b ? ringArea(b) : 0;
}

function mapSr(row: Row, t: number): number {
  const G = row.map.length - 1;
  const x = Math.max(0, Math.min(1, t)) * G;
  const i = Math.min(G - 1, Math.floor(x));
  return row.map[i] + (row.map[i + 1] - row.map[i]) * (x - i);
}

/** Kümülatif hedef alan için kesim: sr sabitse yalnız sf aranır, değilse orantılı (ruled). */
function solveCut(row: Row, target: number, fixedSr: number | null): Cut {
  let lo = 0;
  let hi = 1;
  const mk = (t: number): Cut =>
    fixedSr == null ? { sf: t * row.Lf, sr: mapSr(row, t) } : { sf: t * row.Lf, sr: fixedSr };
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const a = areaBefore(row, mk(m));
    if (!(a < target)) hi = m;
    else lo = m;
  }
  return mk((lo + hi) / 2);
}

function pieces(row: Row, cuts: Cut[]): Ring[] | null {
  const main: Ring[] = [];
  const extras: Poly[] = [];
  let prev: MultiPoly = [];
  try {
    for (let j = 0; j <= cuts.length; j++) {
      const br = j < cuts.length ? beforeRing(row, cuts[j]) : null;
      if (j < cuts.length && !br) return null;
      const cur = j < cuts.length ? mpIntersect([[row.ring]], [[br!]]) : [[row.ring]];
      const piece = prev.length ? mpDifference(cur, prev) : cur;
      const lp = largestPoly(piece);
      if (!lp) return null;
      for (const q of piece) if (q !== lp) extras.push(q);
      main.push(openRing(lp[0]));
      prev = cur;
    }
    // Maske ile sıra sınırı arasındaki küçük artıklar değdikleri parçaya eklenir.
    for (const g of extras) {
      if (mpArea([g]) < 1e-3) continue;
      let done = false;
      for (let k = 0; k < main.length && !done; k++) {
        const u = mpUnion([[main[k]]], [g]);
        if (u.length === 1) {
          main[k] = openRing(u[0][0]);
          done = true;
        }
      }
    }
  } catch (e) {
    return null;
  }
  return main.map((r) => cleanRing(r));
}

export function runEngine(
  ring0: Ring,
  buildingLines: Pt[][],
  p: Params,
  opts: { name: string; id: string; manualFrontages?: Pt[][]; variant?: number },
  H: EngineHelpers,
): BlockResult {
  const t0 = Date.now();
  const BUDGET = 55000;
  const over = () => Date.now() - t0 > BUDGET;
  const log: string[] = [];

  // ---------- 1) ADA ANALİZİ ----------
  const ring = ensureCCW(H.simplifyRing(ring0));
  const adaArea = ringArea(ring);
  const frontages = opts.manualFrontages?.length ? opts.manualFrontages : H.detectRoadFrontages(ring);
  const roadLines = H.roadChains(ring);
  log.push(`Aşama 1 – Ada analizi: ${adaArea.toFixed(1)} m², ${frontages.length} yol cephesi.`);
  const minRowDepth = p.frontSetback + p.minBuildingDepth + p.rearSetback;

  let evalFronts: Pt[][] = frontages;
  const evalP = (r: Ring, row: Row, corner: boolean): Parcel => {
    const q = H.evaluateParcel(r, row.evalFront, buildingLines, evalFronts, roadLines, p, corner, row.index);
    if (q) return q;
    return {
      no: 0, row: row.index, ring: r, area: ringArea(r), frontage: 0, depth: 0, corner,
      envelope: null, building: null, buildingArea: 0, buildingFront: 0, buildingDepth: 0,
      taksValue: 0, valid: false, issues: ["Geçersiz geometri"],
    };
  };

  const mkRow = (r: Ring, front: Pt[], rear: Pt[], index: number, evalFront?: Pt[]): Row | null => {
    if (front.length < 2 || rear.length < 2) return null;
    const rr = ensureCCW(r);
    return {
      ring: rr, front, rear, evalFront: evalFront ?? front, Lf: polylineLength(front), Lr: polylineLength(rear),
      outF: outwardSign(front, rr), outR: outwardSign(rear, rr), area: ringArea(rr), index,
      map: (() => {
        const G = 240;
        const Lf = polylineLength(front);
        const Lr = polylineLength(rear);
        const m: number[] = [];
        for (let i = 0; i <= G; i++) m.push(chainageOn(rear, atChainage(front, (Lf * i) / G).pt));
        m[0] = 0;
        m[G] = Lr;
        for (let i = 1; i <= G; i++) m[i] = Math.max(m[i], m[i - 1]);
        return m;
      })(),
      refParam: ringParam(rr, atChainage(front, Math.min(0.05, polylineLength(front) / 1000)).pt),
    };
  };

  // ---------- 3) SIRA İFRAZI ----------
  const evalLayout = (row: Row, weights: number[], fixed: (number | null)[] | null, full: boolean): RowSol | null => {
    const n = weights.length;
    const W = weights.reduce((a, b) => a + b, 0);
    const targets: number[] = [];
    let acc = 0;
    for (let j = 0; j < n - 1; j++) {
      acc += (weights[j] / W) * row.area;
      targets.push(acc);
    }
    const cuts = targets.map((t, j) => solveCut(row, t, fixed ? fixed[j] : null));
    const rings = pieces(row, cuts);
    if (!rings) return null;
    const areas = rings.map((r) => ringArea(r));
    const inRange = areas.filter((a) => a >= p.minArea - 0.05 && a <= p.maxArea + 0.05).length;
    const mean = areas.reduce((a, b) => a + b, 0) / n;
    const spread = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    if (!full) return { row, cuts, targets, parcels: [], valid: inRange, spread };
    const parcels = rings.map((r, j) => {
      const corner = j === 0 || j === n - 1;
      let q = evalP(r, row, corner);
      if (!q.valid && corner && n > 2) {
        // Köşe sayılmayan uç (ikinci yol cephesi yoksa) ara parsel kurallarıyla denenir.
        const q2 = evalP(r, row, false);
        if (q2.valid) q = q2;
      }
      return q;
    });
    return { row, cuts, targets, parcels, valid: parcels.filter((q) => q.valid).length, spread };
  };

  const better = (a: RowSol | null, b: RowSol | null) => {
    if (!a) return b;
    if (!b) return a;
    const ia = a.parcels.length - a.valid;
    const ib = b.parcels.length - b.valid;
    if (a.valid !== b.valid) return b.valid > a.valid ? b : a;
    if (ia !== ib) return ib < ia ? b : a;
    return b.spread < a.spread ? b : a;
  };

  const solveRowGeneral = (row: Row): RowSol | null => {
    const target = (p.minArea + p.maxArea) / 2;
    const nLo = Math.max(1, Math.ceil(row.area / (p.maxArea + 0.05)));
    const nHi = Math.max(nLo, Math.floor(row.area / Math.max(1, p.minArea - 0.05)));
    const minW = Math.max(p.midFront, p.minBuildingFront + 2 * p.sideSetback);
    const capW = Math.max(1, Math.floor(row.Lf / minW) + 1);
    const ns: number[] = [];
    for (let n = Math.min(nHi, capW); n >= nLo; n--) ns.push(n);
    if (!ns.length) ns.push(Math.max(1, Math.min(nLo, capW)));
    void target;
    ns.sort((a, b) => b - a); // geçerli parsel sayısı öncelikli: en çok parselden başlanır
    // Kaba tarama: eşit alan, farklı parsel sayıları (yalnız alan aralığı).
    const coarse: RowSol[] = [];
    for (const n of ns.slice(0, 8)) {
      const s = evalLayout(row, new Array(n).fill(1), null, true);
      if (s) coarse.push(s);
      if (s && s.valid === n) break;
      if (over()) break;
    }
    let best: RowSol | null = null;
    for (const s of coarse) best = better(best, s);
    if (!best || best.valid === best.parcels.length || over()) return best;
    // İnce ayar: uç (köşe) parsel ağırlıkları.
    const top = coarse
      .slice()
      .sort((a, b) => (a.parcels.length - a.valid) - (b.parcels.length - b.valid))
      .slice(0, 3);
    for (const base of top) {
      const n = base.parcels.length;
      if (n < 2) continue;
      let wA = 1;
      let wB = 1;
      let cur: RowSol | null = base;
      for (const end of [0, 1]) {
        for (const w of [1.1, 1.2, 1.35, 1.5, 1.7, 1.9, 2.2, 2.5, 0.9]) {
          if (over()) break;
          const ws = new Array(n).fill(1);
          ws[0] = end === 0 ? w : wA;
          ws[n - 1] = end === 1 ? w : wB;
          const s = evalLayout(row, ws, null, true);
          if (s && better(cur, s) === s) {
            cur = s;
            if (end === 0) wA = w;
            else wB = w;
          }
        }
      }
      // Uç kesimlerin arka noktası kaydırılarak (yola diklik aranmadan) köşe parsel biçimi iyileştirilir.
      if (cur && cur.valid < cur.parcels.length && n >= 2) {
        const ws = new Array(n).fill(1);
        ws[0] = wA;
        ws[n - 1] = wB;
        for (const end of [0, 1]) {
          const ci = end === 0 ? 0 : n - 2;
          const q = end === 0 ? cur.parcels[0] : cur.parcels[n - 1];
          if (!q || q.valid) continue;
          for (const d of [3, -3, 6, -6, 9, -9, 12]) {
            if (over()) break;
            const fixed: (number | null)[] = cur.cuts.map(() => null);
            fixed[ci] = Math.max(0, Math.min(row.Lr, cur.cuts[ci].sr + d));
            const s2 = evalLayout(row, ws, fixed, true);
            if (s2 && better(cur, s2) === s2) cur = s2;
            const q2 = end === 0 ? cur.parcels[0] : cur.parcels[n - 1];
            if (q2?.valid) break;
          }
        }
      }
      best = better(best, cur);
      if (best && best.valid === best.parcels.length) break;
    }
    return best;
  };

  // Sıra onarımı: koşulsuz parselin komşu kesimleri kaydırılır ya da kaldırılır.
  // Yalnız değişen parseller yeniden değerlendirilir; geçersiz sayısı azalmıyorsa geri alınır.
  const rebuild = (sol: RowSol, cuts: Cut[]): RowSol | null => {
    const rings = pieces(sol.row, cuts);
    if (!rings) return null;
    const n = rings.length;
    const oldByKey = new Map<string, Parcel>();
    const key = (r: Ring) => r.map((v) => v[0].toFixed(3) + "," + v[1].toFixed(3)).join(";");
    for (const q of sol.parcels) oldByKey.set(key(q.ring), q);
    const parcels = rings.map((r, j) => {
      const old = oldByKey.get(key(r));
      if (old) return old;
      const corner = j === 0 || j === n - 1;
      let q = evalP(r, sol.row, corner);
      if (!q.valid && corner && n > 2) {
        const q2 = evalP(r, sol.row, false);
        if (q2.valid) q = q2;
      }
      return q;
    });
    const areas = parcels.map((q) => q.area);
    const mean = areas.reduce((a, b) => a + b, 0) / n;
    const spread = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    let acc = 0;
    const targets = areas.slice(0, -1).map((a) => (acc += a));
    return { row: sol.row, cuts, targets, parcels, valid: parcels.filter((q) => q.valid).length, spread };
  };
  const invalidCount = (s: RowSol) => s.parcels.length - s.valid;
  const repairRow = (sol0: RowSol): RowSol => {
    let sol = sol0;
    const tried = new Set<string>();
    for (let guard = 0; guard < 40 && invalidCount(sol) > 0 && !over(); guard++) {
      const idx = sol.parcels.findIndex((q, j) => !q.valid && !tried.has(`${j}:${sol.parcels.length}`));
      if (idx < 0) break;
      tried.add(`${idx}:${sol.parcels.length}`);
      let best: RowSol | null = null;
      const consider = (c: RowSol | null) => {
        if (!c) return;
        if (invalidCount(c) >= invalidCount(sol) || c.valid < sol.valid) return;
        if (!best || invalidCount(c) < invalidCount(best) || (invalidCount(c) === invalidCount(best) && c.valid > best.valid)) best = c;
      };
      for (const ci of [idx - 1, idx]) {
        if (ci < 0 || ci >= sol.cuts.length) continue;
        // (a) Kesimi yol tarafında kaydır (arka nokta sabit: diklik aranmaz), sonra ikisini birlikte.
        for (const d of [1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
          const cuts = sol.cuts.map((c) => ({ ...c }));
          cuts[ci].sf = Math.max(0, Math.min(sol.row.Lf, cuts[ci].sf + d));
          if ((ci > 0 && cuts[ci].sf <= cuts[ci - 1].sf) || (ci < cuts.length - 1 && cuts[ci].sf >= cuts[ci + 1].sf)) continue;
          consider(rebuild(sol, cuts));
          const cuts2 = cuts.map((c) => ({ ...c }));
          cuts2[ci].sr = Math.max(0, Math.min(sol.row.Lr, sol.cuts[ci].sr + d));
          consider(rebuild(sol, cuts2));
          if (best && invalidCount(best) === 0) break;
        }
        // (b) Kesimi kaldır: komşusuyla birleşir.
        {
          const merged = rebuild(sol, sol.cuts.filter((_, k) => k !== ci));
          // Birleşim yalnız birleşen parsel koşulları sağlıyorsa kabul edilir (dev parsel üretilmez).
          if (merged && merged.parcels.every((q) => q.area <= p.maxArea + 0.05 || !sol.parcels.every((o) => o.area <= p.maxArea + 0.05))) consider(merged);
        }
      }
      if (best) {
        sol = best;
        tried.clear();
      }
    }
    return sol;
  };

  // ---------- 2) SIRA BÖLME ----------
  interface Layout { rows: Row[]; sols: RowSol[]; mid: Pt[]; fronts: Pt[][] }
  const layouts: Layout[] = [];
  const solveLayout = (rows: Row[], mid: Pt[]) => {
    const sols: RowSol[] = [];
    evalFronts = rows.length === 2 ? rows.map((r) => r.front) : frontages;
    for (const r of rows) {
      const s0 = solveRowGeneral(r);
      const s = s0 && s0.valid < s0.parcels.length ? repairRow(s0) : s0;
      if (!s) return;
      sols.push(s);
    }
    layouts.push({ rows, sols, mid, fronts: evalFronts });
  };

  if (frontages.length >= 2) {
    const sorted = [...frontages].sort((a, b) => polylineLength(b) - polylineLength(a));
    const A = sorted[0];
    let B = sorted[1];
    const LA = polylineLength(A);
    const K = Math.max(6, Math.min(40, Math.round(LA / 8)));
    const combos: [number, number][] = [
      [0.5, 0.5], [0.45, 0.45], [0.55, 0.55], [0.4, 0.6], [0.6, 0.4], [0.45, 0.55], [0.55, 0.45],
      [0.4, 0.4], [0.6, 0.6], [0.5, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.5],
    ];
    for (const [wa, wb] of combos) {
      if (over() && layouts.length) break;
      const w = (wa + wb) / 2;
      const mid: Pt[] = [];
      for (let i = 0; i <= K; i++) {
        const a = atChainage(A, (LA * i) / K).pt;
        const b = nearestOnPolyline(a, B).pt;
        const wi = wa + ((wb - wa) * i) / K;
        mid.push([a[0] + (b[0] - a[0]) * wi, a[1] + (b[1] - a[1]) * wi]);
      }
      const midFull = H.extendLineToRing(mid, ring);
      let ra: Poly | null = null;
      let rb: Poly | null = null;
      try {
        const mask = H.sideMaskToward(midFull, A[Math.floor(A.length / 2)]);
        ra = largestPoly(mpIntersect([[ring]], [mask]));
        rb = largestPoly(mpDifference([[ring]], [mask]));
      } catch {
        continue;
      }
      if (!ra || !rb) continue;
      if (dist(B[0], midFull[0]) > dist(B[B.length - 1], midFull[0])) B = B.slice().reverse();
      const ringA = ensureCCW(openRing(ra[0]));
      const ringB = ensureCCW(openRing(rb[0]));
      const FA = rowFrontChain(ringA, midFull) ?? A;
      const FB = rowFrontChain(ringB, midFull) ?? B;
      const rowA = mkRow(ringA, FA, midFull, 0, A);
      const rowB = mkRow(ringB, FB, midFull, 1, B);
      if (!rowA || !rowB) continue;
      if (rowA.area / polylineLength(A) < minRowDepth || rowB.area / polylineLength(B) < minRowDepth) continue;
      if (Math.abs(rowA.area + rowB.area - adaArea) > 0.5) continue;
      solveLayout([rowA, rowB], midFull);
      const last = layouts[layouts.length - 1];
      if (last && last.sols.every((s) => s.valid === s.parcels.length)) break;
      void w;
    }
    // Tek sıra (derin ada): ön A, arka B.
    if (!over()) {
      const Bs = dist(B[0], A[0]) < dist(B[B.length - 1], A[0]) ? B : B.slice().reverse();
      const row = mkRow(ring, A, Bs, 0);
      if (row) solveLayout([row], []);
    }
  } else {
    const A = frontages[0] ?? roadLines.sort((a, b) => polylineLength(b) - polylineLength(a))[0];
    if (A && A.length >= 2) {
      const s = outwardSign(A, ring);
      const rear = offsetPts(A, -s * 300);
      const row = mkRow(ring, A, rear, 0);
      if (row) solveLayout([row], []);
    }
  }

  const invalidOf = (l: Layout) => l.sols.reduce((a, s) => a + s.parcels.length - s.valid, 0);
  const validOf = (l: Layout) => l.sols.reduce((a, s) => a + s.valid, 0);
  layouts.sort((x, y) => invalidOf(x) - invalidOf(y) || validOf(y) - validOf(x));
  const variant = opts.variant ?? 0;
  const pick = layouts.length ? layouts[Math.min(variant, layouts.length - 1)] : null;
  if (!pick) {
    log.push("Motor: ada için uygun sıra düzeni bulunamadı.");
    return { id: opts.id, name: opts.name, ring, frontages, splitLine: [], parcels: [], leftover: [[ring]], leftoverArea: adaArea, toleranceUsed: p.tolerance, log };
  }
  evalFronts = pick.fronts;
  log.push(
    `Aşama 2 – Sıra bölme: ${pick.rows.length === 2 ? "ada orta hattı ile iki sıra" : "tek sıra"} (${layouts.length} düzen denendi).`,
  );
  log.push(
    `Aşama 3 – Sıra ifrazı: ${pick.sols.map((s, i) => `sıra ${i + 1}: ${s.valid}/${s.parcels.length}`).join(", ")} geçerli.`,
  );

  // ---------- 4) KISIT ÇÖZÜMÜ: sırt sırta köşeler tek noktada ----------
  let welded = 0;
  if (pick.rows.length === 2 && p.tolerance > 0) {
    const Lr = pick.rows[0].Lr;
    const midVerts: number[] = [0, Lr];
    {
      let acc = 0;
      for (let i = 0; i < pick.mid.length - 1; i++) {
        acc += dist(pick.mid[i], pick.mid[i + 1]);
        if (i < pick.mid.length - 2) midVerts.push(acc);
      }
    }
    const fixedA: (number | null)[] = pick.sols[0].cuts.map(() => null);
    const fixedB: (number | null)[] = pick.sols[1].cuts.map(() => null);
    const trySol = (k: 0 | 1, fixed: (number | null)[]): RowSol | null => {
      const s = pick.sols[k];
      const n = s.parcels.length;
      // Ağırlıklar hedeflerden geri çözülür (aynı alan hedefleri korunur).
      const areas = [...s.targets, s.row.area].map((t, j, arr) => t - (j ? arr[j - 1] : 0));
      const W = areas.reduce((a, b) => a + b, 0);
      return evalLayout(s.row, areas.map((a) => (a / W) * n), fixed, true);
    };
    const pairs: { i: number; j: number; d: number }[] = [];
    pick.sols[0].cuts.forEach((a, i) =>
      pick.sols[1].cuts.forEach((b, j) => {
        const d = Math.abs(a.sr - b.sr);
        if (d < p.tolerance && d > 1e-3) pairs.push({ i, j, d });
      }),
    );
    pairs.sort((x, y) => x.d - y.d);
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    for (const pr of pairs) {
      if (over()) break;
      if (usedA.has(pr.i) || usedB.has(pr.j)) continue;
      const sa = pick.sols[0].cuts[pr.i].sr;
      const sb = pick.sols[1].cuts[pr.j].sr;
      let sStar = (sa + sb) / 2;
      const v = midVerts.find((m) => Math.abs(m - sStar) < p.tolerance);
      if (v != null && Math.abs(v - sa) < p.tolerance && Math.abs(v - sb) < p.tolerance) sStar = v;
      const fa = fixedA.slice();
      const fb = fixedB.slice();
      fa[pr.i] = sStar;
      fb[pr.j] = sStar;
      // Diğer kesimlerin mevcut sr değerleri korunur.
      pick.sols[0].cuts.forEach((c, k) => { if (fa[k] == null) fa[k] = c.sr; });
      pick.sols[1].cuts.forEach((c, k) => { if (fb[k] == null) fb[k] = c.sr; });
      const na = trySol(0, fa);
      const nb = trySol(1, fb);
      if (!na || !nb) continue;
      if (na.valid < pick.sols[0].valid || nb.valid < pick.sols[1].valid) continue;
      pick.sols[0] = na;
      pick.sols[1] = nb;
      fa.forEach((x, k) => (fixedA[k] = x));
      fb.forEach((x, k) => (fixedB[k] = x));
      usedA.add(pr.i);
      usedB.add(pr.j);
      welded++;
    }
    // Arka köşeler orta hat kırıklarına ve uçlarına tolerans içinde oturtulur.
    for (const k of [0, 1] as const) {
      const fixed = k === 0 ? fixedA : fixedB;
      const used = k === 0 ? usedA : usedB;
      pick.sols[k].cuts.forEach((c, i) => {
        if (used.has(i) || over()) return;
        const v = midVerts.find((m) => Math.abs(m - c.sr) < p.tolerance && Math.abs(m - c.sr) > 1e-3);
        if (v == null) return;
        const f = pick.sols[k].cuts.map((x) => x.sr) as (number | null)[];
        f[i] = v;
        const ns = trySol(k, f);
        if (ns && ns.valid >= pick.sols[k].valid) {
          pick.sols[k] = ns;
          fixed[i] = v;
          welded++;
        }
      });
    }
  }
  log.push(
    `Aşama 4 – Kısıt çözümü: ${welded} sırt sırta köşe ${p.tolerance.toFixed(2)} m tolerans içinde tek noktada birleştirildi; alan dengesi yol tarafındaki köşeler kaydırılarak yapıldı (bu hatlarda yola diklik aranmaz).`,
  );

  // ---------- 5) DENETİM ----------
  const parcels: Parcel[] = [];
  for (const s of pick.sols) parcels.push(...s.parcels);
  // Kalan parçalar (ör. sıra bölmede küçük bileşenler) değen parsele eklenir.
  let uni: MultiPoly = [];
  for (const q of parcels) uni = mpUnion(uni, [[q.ring]]);
  const gaps = mpDifference([[ring]], uni).filter((g) => mpArea([g]) > 0.01);
  for (const g of gaps) {
    let bi = -1;
    let bestA = Infinity;
    parcels.forEach((q, i) => {
      const u = mpUnion([[q.ring]], [g]);
      if (u.length === 1 && q.area < bestA) {
        bestA = q.area;
        bi = i;
      }
    });
    if (bi >= 0) {
      const u = mpUnion([[parcels[bi].ring]], [g]);
      const row = pick.rows[parcels[bi].row] ?? pick.rows[0];
      parcels[bi] = evalP(openRing(u[0][0]), row, parcels[bi].corner);
    }
  }
  // Ortak düğümler: bir parselin köşesi komşunun kenarındaysa o kenara eklenir.
  for (const q of parcels) {
    const allV: Pt[] = [];
    for (const o of parcels) if (o !== q) for (const v of o.ring) allV.push(v);
    const out: Pt[] = [];
    const r = q.ring;
    for (let k = 0; k < r.length; k++) {
      const a = r[k];
      const b = r[(k + 1) % r.length];
      out.push(a);
      const ab = sub(b, a);
      const L2 = dot(ab, ab);
      if (L2 < 1e-12) continue;
      const on: { t: number; v: Pt }[] = [];
      for (const v of allV) {
        const t = dot(sub(v, a), ab) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const pr: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t];
        if (dist(pr, v) < 0.02) on.push({ t, v });
      }
      on.sort((x, y) => x.t - y.t).forEach((x) => {
        if (dist(out[out.length - 1], x.v) > 1e-6) out.push(x.v);
      });
    }
    q.ring = cleanRingKeep(out);
  }
  parcels.forEach((q, i) => (q.no = i + 1));

  let union: MultiPoly = [];
  for (const q of parcels) union = mpUnion(union, [[q.ring]]);
  const leftover = mpDifference([[ring]], union).filter((g) => mpArea([g]) > 0.01);
  const leftoverArea = mpArea(leftover);
  const sumA = parcels.reduce((a, q) => a + q.area, 0);
  const overlap = Math.max(0, sumA - mpArea(union));
  const validCount = parcels.filter((q) => q.valid).length;
  log.push(
    `Aşama 5 – Denetim: ada ${adaArea.toFixed(2)} m², parseller toplamı ${sumA.toFixed(2)} m², fark ${(adaArea - sumA).toFixed(2)} m², örtüşme ${overlap.toFixed(2)} m², artık ${leftoverArea.toFixed(2)} m².`,
  );
  log.push(`Toplam ${parcels.length} parsel üretildi; ${validCount} parsel tüm parselasyon ve yapılaşma şartlarını sağlıyor.`);
  log.push(`Motor süresi: ${((Date.now() - t0) / 1000).toFixed(1)} sn.`);

  return {
    id: opts.id,
    name: opts.name,
    ring,
    frontages,
    splitLine: pick.mid,
    parcels,
    leftover,
    leftoverArea,
    toleranceUsed: p.tolerance,
    log,
  };
}
