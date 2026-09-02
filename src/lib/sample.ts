import { writeDxf } from "./dxf";
import type { Pt } from "./geo";

/** Örnek imar adası (yamuk, kırıklı) + yapı inşaat hattı içeren DXF üretir. */
export function sampleDxf(): string {
  const ada: Pt[] = [
    [0, 0],
    [42, -1.5],
    [84, 0.8],
    [96, 2],
    [97.5, 41],
    [60, 42.5],
    [20, 41.2],
    [-1, 40],
  ];
  const hat1: Pt[] = [
    [1, 5],
    [45, 3.7],
    [96.6, 7],
  ];
  const hat2: Pt[] = [
    [0.5, 35],
    [50, 36.6],
    [96.9, 36],
  ];
  return writeDxf([
    { layer: "ADA", points: ada, closed: true },
    { layer: "YAPI_INSAA_HATTI", points: hat1, closed: false },
    { layer: "YAPI_INSAA_HATTI", points: hat2, closed: false },
  ]);
}
