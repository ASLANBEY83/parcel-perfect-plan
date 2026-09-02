/** Yerel metre koordinatlı DXF geometrisini Web Mercator altlık (Google) döşemeleriyle eşleştirir. */

export const EARTH_CIRC = 40075016.686;
const R = 6378137;

export type BasemapType = "satellite" | "hybrid" | "street";

export const TILE_URL: Record<BasemapType, (x: number, y: number, z: number) => string> = {
  satellite: (x, y, z) => `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`,
  hybrid: (x, y, z) => `https://mt1.google.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}`,
  street: (x, y, z) => `https://mt1.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}`,
};

export function lonLatToMerc(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/** Mercator metre / gerçek yer metresi ölçek katsayısı (enleme bağlı). */
export function mercScale(lat: number) {
  return 1 / Math.cos((lat * Math.PI) / 180);
}

export interface Tile {
  key: string;
  url: string;
  /** ekran koordinatları */
  x: number;
  y: number;
  size: number;
}

interface TileArgs {
  type: BasemapType;
  /** DXF geometrisinin referans noktası (yerel metre) */
  originLocal: [number, number];
  lat: number;
  lon: number;
  /** ekran dönüşümü: sx = X*z + vx, sy = -Y*z + vy */
  view: { z: number; x: number; y: number };
  width: number;
  height: number;
}

/** Görünür alanı kaplayan Google döşemelerini ekran konumlarıyla döner. */
export function visibleTiles({ type, originLocal, lat, lon, view, width, height }: TileArgs): Tile[] {
  if (!isFinite(lat) || !isFinite(lon) || view.z <= 0) return [];
  const k = mercScale(lat);
  const [ox, oy] = lonLatToMerc(lon, lat);

  // yerel -> mercator
  const toMerc = (p: [number, number]): [number, number] => [
    ox + (p[0] - originLocal[0]) * k,
    oy + (p[1] - originLocal[1]) * k,
  ];
  // mercator -> ekran
  const mercToScreen = (m: [number, number]): [number, number] => {
    const lx = originLocal[0] + (m[0] - ox) / k;
    const ly = originLocal[1] + (m[1] - oy) / k;
    return [lx * view.z + view.x, -ly * view.z + view.y];
  };

  // ekran px / mercator metre
  const pxPerMerc = view.z / k;
  const zRaw = Math.log2((EARTH_CIRC * pxPerMerc) / 256);
  const z = Math.max(0, Math.min(21, Math.round(zRaw)));
  const n = 2 ** z;
  const tileMerc = EARTH_CIRC / n;

  // görünür ekran köşelerini yerel koordinata çevir
  const toLocal = (sx: number, sy: number): [number, number] => [(sx - view.x) / view.z, -(sy - view.y) / view.z];
  const corners: [number, number][] = [
    toMerc(toLocal(0, 0)),
    toMerc(toLocal(width, 0)),
    toMerc(toLocal(0, height)),
    toMerc(toLocal(width, height)),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);

  const tx = (mx: number) => Math.floor((mx + EARTH_CIRC / 2) / tileMerc);
  const ty = (my: number) => Math.floor((EARTH_CIRC / 2 - my) / tileMerc);

  const x0 = tx(Math.min(...xs));
  const x1 = tx(Math.max(...xs));
  const y0 = ty(Math.max(...ys));
  const y1 = ty(Math.min(...ys));

  const tiles: Tile[] = [];
  const maxTiles = 200;
  for (let X = x0; X <= x1; X++) {
    for (let Y = y0; Y <= y1; Y++) {
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      if (tiles.length >= maxTiles) return tiles;
      const mx = X * tileMerc - EARTH_CIRC / 2;
      const my = EARTH_CIRC / 2 - Y * tileMerc;
      const [sx, sy] = mercToScreen([mx, my]);
      const size = tileMerc * pxPerMerc;
      tiles.push({ key: `${z}/${X}/${Y}`, url: TILE_URL[type](X, Y, z), x: sx, y: sy, size: size + 0.5 });
    }
  }
  return tiles;
}

/* ---------- Coğrafi referanslama (TM/UTM -> WGS84) ---------- */

export interface TMDef {
  /** dilim orta meridyeni (derece) */
  lon0: number;
  /** ölçek katsayısı */
  k0: number;
  /** doğuya kaydırma (m) */
  falseEasting: number;
}

const A = 6378137;
const F = 1 / 298.257223563;

/** Transverse Mercator (GRS80/WGS84) ters dönüşüm: proje metre -> lon/lat */
export function tmToLonLat(x: number, y: number, def: TMDef): { lat: number; lon: number } {
  const e2 = F * (2 - F);
  const ep2 = e2 / (1 - e2);
  const E = (x - def.falseEasting) / def.k0;
  const M = y / def.k0;
  const mu = M / (A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1);
  const cp = Math.cos(phi1);
  const tp = Math.tan(phi1);
  const N1 = A / Math.sqrt(1 - e2 * sp * sp);
  const T1 = tp * tp;
  const C1 = ep2 * cp * cp;
  const R1 = (A * (1 - e2)) / Math.pow(1 - e2 * sp * sp, 1.5);
  const D = E / N1;
  const lat =
    phi1 -
    ((N1 * tp) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    (def.lon0 * Math.PI) / 180 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cp;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Türkiye ITRF/ED50 3° dilimleri ve UTM 6° dilimleri için hazır tanımlar */
export const TM_PRESETS: { id: string; label: string; def: TMDef }[] = [
  ...[27, 30, 33, 36, 39, 42, 45].map((lon0) => ({
    id: `tm3-${lon0}`,
    label: `3° dilim · OM ${lon0}° (k=1)`,
    def: { lon0, k0: 1, falseEasting: 500000 },
  })),
  ...[
    [35, 27],
    [36, 33],
    [37, 39],
    [38, 45],
  ].map(([zone, lon0]) => ({
    id: `utm-${zone}`,
    label: `UTM 6° · Zone ${zone} (OM ${lon0}°)`,
    def: { lon0, k0: 0.9996, falseEasting: 500000 },
  })),
];

/** DXF koordinatından dilimi tahmin eder; dilim önekli (ör. 36500000) koordinatları da çözer. */
export function guessTM(x: number): { def: TMDef; presetId: string } | null {
  if (!isFinite(x)) return null;
  if (x > 1_000_000) {
    const zone = Math.floor(x / 1_000_000);
    if (zone >= 9 && zone <= 15) {
      const lon0 = zone * 3;
      return { def: { lon0, k0: 1, falseEasting: zone * 1_000_000 + 500000 }, presetId: `tm3-${lon0}` };
    }
  }
  return null;
}
