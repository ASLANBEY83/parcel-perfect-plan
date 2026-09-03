import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Pt } from "@/lib/geo";
import { bbox } from "@/lib/geo";
import type { BlockResult, Parcel } from "@/lib/parcelation";
import { visibleTiles, type BasemapType } from "@/lib/basemap";

export interface LayerVisibility {
  ADA: boolean;
  PARSELLER: boolean;
  YAPI_INSAA_HATTI: boolean;
  YAPI_YAKLASMA: boolean;
  YAPI_BLOKLARI: boolean;
}

export interface BasemapConfig {
  enabled: boolean;
  type: BasemapType;
  lat: number;
  lon: number;
  opacity: number;
  /** lat/lon'un karşılık geldiği yerel (DXF) koordinat; yoksa geometri merkezi kullanılır */
  refX?: number | undefined;
  refY?: number | undefined;
}

interface Props {
  blocks: BlockResult[];
  rawBlocks: Pt[][];
  buildingLines: Pt[][];
  layers: LayerVisibility;
  basemap: BasemapConfig;
  selected: { block: string; no: number } | null;
  onSelect: (b: BlockResult, p: Parcel) => void;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 200;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const PlanViewer = memo(function PlanViewer({
  blocks,
  rawBlocks,
  buildingLines,
  layers,
  basemap,
  selected,
  onSelect,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ dist: number; z: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // --- ölçüm aracı ---
  const [tool, setTool] = useState<"none" | "dist" | "perp">("none");
  const [chain, setChain] = useState<Pt[]>([]);
  const [perpFrom, setPerpFrom] = useState<Pt | null>(null);
  const [perps, setPerps] = useState<{ a: Pt; b: Pt }[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const measuring = tool !== "none";

  const resetMeasure = useCallback(() => {
    setChain([]);
    setPerpFrom(null);
    setPerps([]);
    setHover(null);
  }, []);

  const allPts = useMemo<Pt[]>(
    () => [...rawBlocks.flat(), ...blocks.flatMap((b) => b.ring), ...buildingLines.flat()],
    [rawBlocks, blocks, buildingLines],
  );

  const segments = useMemo<[Pt, Pt][]>(() => {
    const out: [Pt, Pt][] = [];
    const closed = (r: Pt[]) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        out.push([a, b]);
      }
    };
    const open = (r: Pt[]) => {
      for (let i = 0; i + 1 < r.length; i++) out.push([r[i]!, r[i + 1]!]);
    };
    rawBlocks.forEach(closed);
    blocks.forEach((b) => {
      closed(b.ring);
      b.parcels.forEach((p) => {
        closed(p.ring);
        if (p.building) closed(p.building);
      });
    });
    buildingLines.forEach(open);
    return out;
  }, [rawBlocks, blocks, buildingLines]);

  const center = useMemo<Pt>(() => {
    if (!allPts.length) return [0, 0];
    const b = bbox(allPts);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }, [allPts]);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !allPts.length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const bb = bbox(allPts);
    const pad = 40;
    const z = clamp(
      Math.min((r.width - pad * 2) / (bb.w || 1), (r.height - pad * 2) / (bb.h || 1)),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    setView({
      z,
      x: r.width / 2 - ((bb.minX + bb.maxX) / 2) * z,
      y: r.height / 2 + ((bb.minY + bb.maxY) / 2) * z,
    });
  }, [allPts]);

  const fitRef = useRef(fit);
  fitRef.current = fit;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // görünür hale gelince (mobil sekme) ve geometri değişince ekrana sığdır
  const visible = size.w >= 2 && size.h >= 2;
  useEffect(() => {
    if (visible) fitRef.current();
  }, [visible, allPts]);



  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const v = viewRef.current;
      const next = clamp(v.z * Math.exp(-dy * 0.0018), MIN_ZOOM, MAX_ZOOM);
      const k = next / v.z;
      setView({ z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomAt = (factor: number, px: number, py: number) => {
    const v = viewRef.current;
    const next = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM);
    const k = next / v.z;
    setView({ z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
  };

  const toScreen = (p: Pt) => `${p[0] * view.z + view.x},${-p[1] * view.z + view.y}`;
  const poly = (pts: Pt[]) => pts.map(toScreen).join(" ");

  const scaleBarMeters = niceStep(120 / view.z);
  const sx = (p: Pt) => p[0] * view.z + view.x;
  const sy = (p: Pt) => -p[1] * view.z + view.y;

  /** ekran noktasını dünya koordinatına çevirip köşe/hat üzerine yapıştırır */
  const snap = (px: number, py: number): { p: Pt; kind: "vertex" | "edge" | "free" } => {
    const w: Pt = [(px - view.x) / view.z, -(py - view.y) / view.z];
    const tolV = 12 / view.z;
    const tolE = 8 / view.z;
    let best: Pt | null = null;
    let bd = tolV;
    for (const [a, b] of segments) {
      for (const v of [a, b]) {
        const d = Math.hypot(v[0] - w[0], v[1] - w[1]);
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    if (best) return { p: best, kind: "vertex" };
    let bde = tolE;
    for (const [a, b] of segments) {
      const f = footOnSegment(w, a, b);
      const d = Math.hypot(f[0] - w[0], f[1] - w[1]);
      if (d < bde) {
        bde = d;
        best = f;
      }
    }
    if (best) return { p: best, kind: "edge" };
    return { p: w, kind: "free" };
  };

  /** verilen köşeden en yakın hatta dik iner */
  const dropPerp = (from: Pt, px: number, py: number): Pt | null => {
    const w: Pt = [(px - view.x) / view.z, -(py - view.y) / view.z];
    let best: Pt | null = null;
    let bd = Infinity;
    for (const [a, b] of segments) {
      const near = footOnSegment(w, a, b);
      const dCursor = Math.hypot(near[0] - w[0], near[1] - w[1]);
      if (dCursor > 20 / view.z) continue;
      const foot = footOnLine(from, a, b);
      const len = Math.hypot(foot[0] - from[0], foot[1] - from[1]);
      if (len < 1e-6) continue;
      if (dCursor < bd) {
        bd = dCursor;
        best = foot;
      }
    }
    return best;
  };

  const handleMeasureClick = (px: number, py: number) => {
    if (tool === "dist") {
      const { p } = snap(px, py);
      setChain((c) => [...c, p]);
      return;
    }
    if (tool === "perp") {
      if (!perpFrom) {
        const { p } = snap(px, py);
        setPerpFrom(p);
      } else {
        const foot = dropPerp(perpFrom, px, py);
        if (foot) {
          setPerps((l) => [...l, { a: perpFrom, b: foot }]);
          setPerpFrom(null);
        }
      }
    }
  };

  const tiles = useMemo(
    () =>
      basemap.enabled && size.w > 0
        ? visibleTiles({
            type: basemap.type,
            originLocal:
              basemap.refX !== undefined && basemap.refY !== undefined ? [basemap.refX, basemap.refY] : center,
            lat: basemap.lat,
            lon: basemap.lon,
            view,
            width: size.w,
            height: size.h,
          })
        : [],
    [basemap, center, view, size],
  );

  return (
    <div
      ref={ref}
      className={
        "relative h-full w-full overflow-hidden bg-canvas " +
        (measuring ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")
      }
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          const v = viewRef.current;
          const rect = ref.current!.getBoundingClientRect();
          pinch.current = {
            dist: Math.hypot(a.x - b.x, a.y - b.y),
            z: v.z,
            cx: (a.x + b.x) / 2 - rect.left,
            cy: (a.y + b.y) / 2 - rect.top,
            vx: v.x,
            vy: v.y,
          };
          drag.current = null;
        } else {
          drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
          down.current = { x: e.clientX, y: e.clientY, moved: false };
        }
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4)
          down.current.moved = true;
        if (measuring && !drag.current) {
          const rect = ref.current!.getBoundingClientRect();
          setHover(snap(e.clientX - rect.left, e.clientY - rect.top).p);
        }
        const p = pinch.current;
        if (p && pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const next = clamp((p.z * d) / (p.dist || 1), MIN_ZOOM, MAX_ZOOM);
          const k = next / p.z;
          setView({ z: next, x: p.cx - (p.cx - p.vx) * k, y: p.cy - (p.cy - p.vy) * k });
          return;
        }
        const d = drag.current;
        if (!d) return;
        const nx = d.ox + (e.clientX - d.x);
        const ny = d.oy + (e.clientY - d.y);
        setView((v) => ({ ...v, x: nx, y: ny }));
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
        const d = down.current;
        down.current = null;
        if (measuring && d && !d.moved) {
          const rect = ref.current!.getBoundingClientRect();
          handleMeasureClick(e.clientX - rect.left, e.clientY - rect.top);
        }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
      }}
      onPointerLeave={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
      }}
    >
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" className="stroke-grid" strokeWidth="1" />
          </pattern>
        </defs>
        {!basemap.enabled && <rect width="100%" height="100%" fill="url(#grid)" />}

        {tiles.length > 0 && (
          <g opacity={basemap.opacity}>
            {tiles.map((t) => (
              <image
                key={t.key}
                href={t.url}
                x={t.x}
                y={t.y}
                width={t.size}
                height={t.size}
                preserveAspectRatio="none"
              />
            ))}
          </g>
        )}

        {layers.ADA &&
          rawBlocks.map((r, i) => (
            <polygon key={`raw-${i}`} points={poly(r)} className="fill-none stroke-ada" strokeWidth={4} />
          ))}

        {layers.ADA &&
          blocks.map((b, i) => {
            const c = centroidOf(rawBlocks[i] ?? []);
            if (!c) return null;
            return (
              <text
                key={`block-label-${b.id}`}
                x={c[0] * view.z + view.x}
                y={-c[1] * view.z + view.y}
                className="pointer-events-none fill-label font-mono"
                fontSize={14}
                fontWeight="bold"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {b.name}
              </text>
            );
          })}


        {layers.PARSELLER &&
          blocks.flatMap((b) =>
            b.parcels.map((p) => {
              const isSel = selected?.block === b.id && selected.no === p.no;
              return (
                <polygon
                  key={`${b.id}-p-${p.no}`}
                  points={poly(p.ring)}
                  className={
                    "cursor-pointer " +
                    (isSel
                      ? "fill-parcel-sel stroke-parcel-sel"
                      : p.valid
                        ? "fill-parcel stroke-parcel-line hover:fill-parcel-hover"
                        : "fill-invalid stroke-destructive")
                  }
                  strokeWidth={isSel ? 1.8 : 1.2}
                  pointerEvents={measuring ? "none" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(b, p);
                  }}
                />
              );
            }),
          )}

        {layers.YAPI_YAKLASMA &&
          blocks.flatMap((b) =>
            b.parcels
              .filter((p) => p.envelope)
              .map((p) => (
                <polygon
                  key={`${b.id}-env-${p.no}`}
                  points={poly(p.envelope!)}
                  className="pointer-events-none fill-envelope stroke-envelope-line"
                  strokeWidth={1.1}
                  strokeDasharray="7 4"
                />
              )),
          )}

        {layers.YAPI_BLOKLARI &&
          blocks.flatMap((b) =>
            b.parcels
              .filter((p) => p.building)
              .map((p) => (
                <polygon
                  key={`${b.id}-b-${p.no}`}
                  points={poly(p.building!)}
                  className="pointer-events-none fill-building stroke-building-line"
                  strokeWidth={0.8}
                />
              )),
          )}

        {layers.YAPI_INSAA_HATTI &&
          buildingLines.map((l, i) => (
            <polyline
              key={`bl-${i}`}
              points={poly(l)}
              className="fill-none stroke-buildline"
              strokeWidth={1.6}
              strokeDasharray="10 4 2 4"
            />
          ))}

        {layers.PARSELLER &&
          view.z > 2.2 &&
          blocks.flatMap((b) =>
            b.parcels.map((p) => {
              const c = centroidOf(p.ring);
              return (
                <text
                  key={`${b.id}-t-${p.no}`}
                  x={c[0] * view.z + view.x}
                  y={-c[1] * view.z + view.y}
                  className="pointer-events-none fill-label font-mono"
                  fontSize={11}
                  textAnchor="middle"
                >
                  {p.no}
                </text>
              );
            }),
          )}
        {/* ölçüm katmanı */}
        <g className="pointer-events-none">
          {chain.length > 0 && (
            <>
              <polyline
                points={poly(tool === "dist" && hover ? [...chain, hover] : chain)}
                className="fill-none stroke-measure"
                strokeWidth={1.6}
                strokeDasharray="6 3"
              />
              {(tool === "dist" && hover ? [...chain, hover] : chain).slice(1).map((p, i) => {
                const a = (tool === "dist" && hover ? [...chain, hover] : chain)[i]!;
                const m: Pt = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2];
                return (
                  <text
                    key={`ml-${i}`}
                    x={sx(m)}
                    y={sy(m) - 6}
                    className="fill-measure font-mono"
                    fontSize={11}
                    textAnchor="middle"
                  >
                    {fmt(Math.hypot(p[0] - a[0], p[1] - a[1]))} m
                  </text>
                );
              })}
              {chain.map((p, i) => (
                <circle key={`mp-${i}`} cx={sx(p)} cy={sy(p)} r={3} className="fill-measure" />
              ))}
            </>
          )}

          {perps.map((s, i) => (
            <g key={`pp-${i}`}>
              <line
                x1={sx(s.a)}
                y1={sy(s.a)}
                x2={sx(s.b)}
                y2={sy(s.b)}
                className="stroke-measure"
                strokeWidth={1.6}
              />
              <circle cx={sx(s.a)} cy={sy(s.a)} r={3} className="fill-measure" />
              <rect
                x={sx(s.b) - 3}
                y={sy(s.b) - 3}
                width={6}
                height={6}
                className="fill-none stroke-measure"
                strokeWidth={1.4}
              />
              <text
                x={(sx(s.a) + sx(s.b)) / 2}
                y={(sy(s.a) + sy(s.b)) / 2 - 6}
                className="fill-measure font-mono"
                fontSize={11}
                textAnchor="middle"
              >
                ⟂ {fmt(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]))} m
              </text>
            </g>
          ))}

          {perpFrom && hover && (
            <line
              x1={sx(perpFrom)}
              y1={sy(perpFrom)}
              x2={sx(hover)}
              y2={sy(hover)}
              className="stroke-measure/50"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}

          {measuring && hover && (
            <circle cx={sx(hover)} cy={sy(hover)} r={5} className="fill-none stroke-measure" strokeWidth={1.4} />
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-2 rounded bg-background/60 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        <div className="h-2 border-x border-b border-border" style={{ width: scaleBarMeters * view.z }} />
        <span>{scaleBarMeters} m</span>
      </div>

      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <MapBtn onClick={() => zoomAt(1.4, size.w / 2, size.h / 2)} label="Yakınlaştır">
          +
        </MapBtn>
        <MapBtn onClick={() => zoomAt(1 / 1.4, size.w / 2, size.h / 2)} label="Uzaklaştır">
          −
        </MapBtn>
        <MapBtn onClick={fit} label="Ekrana sığdır">
          ⤢
        </MapBtn>
        <MapBtn
          active={tool === "dist"}
          onClick={() => {
            setTool((t) => (t === "dist" ? "none" : "dist"));
            resetMeasure();
          }}
          label="Mesafe ölçümü"
        >
          📏
        </MapBtn>
        <MapBtn
          active={tool === "perp"}
          onClick={() => {
            setTool((t) => (t === "perp" ? "none" : "perp"));
            resetMeasure();
          }}
          label="Köşeden hatta dik ölçü"
        >
          ⟂
        </MapBtn>
        {(chain.length > 0 || perps.length > 0 || perpFrom) && (
          <MapBtn onClick={resetMeasure} label="Ölçümleri temizle">
            ✕
          </MapBtn>
        )}
      </div>

      {measuring && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg border border-border bg-panel/90 px-3 py-1.5 text-center font-mono text-[11px] text-foreground shadow-lg backdrop-blur">
          {tool === "dist" ? (
            <>
              Mesafe: köşe/hat üzerine tıklayarak nokta ekleyin
              {chain.length > 1 && (
                <span className="ml-2 text-measure">
                  Toplam {fmt(chain.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - chain[i]![0], p[1] - chain[i]![1]), 0))} m
                </span>
              )}
            </>
          ) : perpFrom ? (
            "Dik inilecek hattı seçin"
          ) : (
            "Önce köşe noktasını seçin (köşelere yapışır)"
          )}
        </div>
      )}

      {basemap.enabled && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur">
          Altlık: Google
        </span>
      )}
    </div>
  );
});

function MapBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "flex h-9 w-9 items-center justify-center rounded-lg border text-sm shadow-lg backdrop-blur transition-colors " +
        (active
          ? "border-measure bg-measure/20 text-measure"
          : "border-border bg-panel/90 text-foreground hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}

function centroidOf(r: Pt[]): Pt {
  const b = bbox(r);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

function niceStep(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 0.001))));
  const n = v / p;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
}

function footOnLine(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return [a[0], a[1]];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  return [a[0] + dx * t, a[1] + dy * t];
}

function footOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return [a[0], a[1]];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + dx * t, a[1] + dy * t];
}

function fmt(m: number) {
  return m >= 100 ? m.toFixed(1) : m.toFixed(2);
}
