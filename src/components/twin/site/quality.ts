// Grafikstufe: Auf integrierter/mobiler Grafik kosten Echtzeitschatten ~40 ms pro Bild.
// Dort werden die Schatten statt dessen einmalig in die Bodentexturen gebacken.

let cached: { tier: "high" | "fast"; gpu: string } | null = null;

export function gpuTier() {
  if (cached) return cached;
  let gpu = "unbekannt";
  try {
    const override = localStorage.getItem("cortex-quality");
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    // unbekannt (z. B. Firefox mit Fingerprint-Schutz) → sicherheitshalber schnelle Stufe
    const strong = /NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro|Apple M\d|Apple GPU/i.test(gpu) && !/Intel|UHD|Iris|SwiftShader|llvmpipe/i.test(gpu);
    cached = { tier: override === "high" ? "high" : override === "fast" ? "fast" : strong ? "high" : "fast", gpu };
  } catch {
    cached = { tier: "fast", gpu };
  }
  return cached;
}

/** manuelle Wahl (Demo-Regie): "auto" | "fast" | "high" – wirkt nach dem Neuladen */
export function qualitySetting(): "auto" | "fast" | "high" {
  try {
    const v = localStorage.getItem("cortex-quality");
    return v === "fast" || v === "high" ? v : "auto";
  } catch {
    return "auto";
  }
}
export function setQuality(v: "auto" | "fast" | "high") {
  try {
    if (v === "auto") localStorage.removeItem("cortex-quality");
    else localStorage.setItem("cortex-quality", v);
  } catch {}
  location.reload();
}

/** Schattenwurf am Boden je Meter Objekthöhe (Sonne aus Südwest, wie das Richtungslicht der Szene) */
export const SHADOW_DIR: [number, number] = [90 / 190, -120 / 190];
