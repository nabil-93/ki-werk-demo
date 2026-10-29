// Vorberechnete Schatten (für schwächere Grafik): Gebäude, Häuser, Bäume und Silos werfen ihren Schatten
// einmalig in eine niedrig aufgelöste Ebene, die weich in die Bodentexturen eingeblendet wird.

import { HALL_A_POLY, HALL_B_POLY, HRL_POLY, SILOS, WALL_H } from "../layout";
import { WERK, HOUSES } from "./siteData";
import { decode, shadowQuads, type V2 } from "./geo";
import { SHADOW_DIR } from "./quality";
import type { Tree } from "./treeData";

const P = (k: string) => decode(WERK[k]);

/** Werksgebäude als Prismen (Grundriss + Höhe inkl. Attika) */
export function werkPrisms(): { poly: V2[]; h: number }[] {
  return [
    { poly: HALL_A_POLY, h: WALL_H.hallA + 0.8 },
    { poly: HALL_B_POLY, h: WALL_H.hallB + 0.8 },
    { poly: P("hallC"), h: 10.1 },
    { poly: HRL_POLY, h: 24.6 },
    { poly: P("office"), h: 11.8 },
    { poly: P("tent"), h: 6.8 },
    { poly: P("workshop"), h: 7.6 },
    { poly: P("utilA"), h: 8.6 },
    { poly: P("utilB"), h: 6.6 },
    { poly: P("utilC"), h: 4.6 },
  ];
}

interface Frame {
  x0: number;
  z0: number;
  w: number; // Weltbreite in m
  h: number;
}

/**
 * Schattenebene zeichnen und weich auf den Zielkontext legen.
 * frame: Weltausschnitt, der genau den Zielcanvas abdeckt; res: Auflösung der Schattenebene.
 */
export function bakeShadows(target: CanvasRenderingContext2D, frame: Frame, res: number, opts: { trees?: Tree[]; houses?: boolean; alpha: number }) {
  const layer = document.createElement("canvas");
  layer.width = res;
  layer.height = Math.round((res * frame.h) / frame.w);
  const c = layer.getContext("2d")!;
  const s = res / frame.w;
  const X = (x: number) => (x - frame.x0) * s;
  const Z = (z: number) => (z - frame.z0) * s;
  const fillPoly = (pts: V2[]) => {
    c.beginPath();
    pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z))));
    c.closePath();
    c.fill();
  };
  c.fillStyle = "#000";
  c.strokeStyle = "#000";
  c.lineCap = "round";
  const [dx, dz] = SHADOW_DIR;
  for (const b of werkPrisms()) for (const q of shadowQuads(b.poly, b.h, SHADOW_DIR)) fillPoly(q);
  // Silos: Säule mit 16 m Höhe → breite Linie mit runden Enden
  c.lineWidth = 3.8 * s;
  for (const si of SILOS) {
    c.beginPath();
    c.moveTo(X(si.x), Z(si.z));
    c.lineTo(X(si.x + dx * 16), Z(si.z + dz * 16));
    c.stroke();
  }
  if (opts.houses) {
    for (const hs of HOUSES) {
      const poly = decode(hs.slice(2));
      const h = hs[1] / 10 + (hs[0] === 0 ? 2.6 : 0.3);
      for (const q of shadowQuads(poly, h, SHADOW_DIR)) fillPoly(q);
    }
  }
  if (opts.trees) {
    // Krone als weicher Fleck, versetzt in Schattenrichtung
    for (const t of opts.trees) {
      const r = t.w * 0.28;
      c.lineWidth = Math.max(1, r * 2 * s);
      c.beginPath();
      c.moveTo(X(t.x + dx * t.h * 0.3), Z(t.z + dz * t.h * 0.3));
      c.lineTo(X(t.x + dx * t.h * 0.8), Z(t.z + dz * t.h * 0.8));
      c.stroke();
    }
  }
  // weich einblenden (das Hochskalieren der kleinen Ebene ergibt weiche Kanten)
  target.save();
  target.globalAlpha = opts.alpha;
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = "high";
  target.drawImage(layer, 0, 0, target.canvas.width, target.canvas.height);
  target.restore();
}
